import { partBytes, sizeOfPart } from '../../../shared/contracts/video-poc';
import type { NewRecording, Recording, VideoLibrary } from '../../../shared/contracts/video-poc';
import { VideoError } from './error';
import type { R2Object, R2Part, R2VideoStore } from './r2';
import type { VideoRepository, VideoRow } from './supabase';

type Repository = Pick<VideoRepository, 'list' | 'usage' | 'get' | 'reserve' | 'claim' | 'change' | 'remove'>;
type Storage = Pick<R2VideoStore, 'start' | 'parts' | 'signPart' | 'head' | 'complete' | 'signPlayback' | 'abort' | 'abortUnknown' | 'delete'>;

function metadata(row: VideoRow): Recording {
  return {
    id: row.id, name: row.filename, size: row.size_bytes, durationMs: row.duration_ms, sha256: row.sha256,
    status: row.status, expiresAt: row.expires_at, busyUntil: row.busy_until,
  };
}

function expired(row: VideoRow) {
  return Date.parse(row.expires_at) <= Date.now();
}

function busy() {
  return new VideoError(409, 'RECORDING_BUSY', 'An operation is in progress. Refresh the list or retry after the displayed time.');
}

function uploadId(row: VideoRow) {
  if (!row.upload_id) throw new VideoError(409, 'UPLOAD_NOT_STARTED', 'The multipart upload has not started. Refresh the list.');
  return row.upload_id;
}

function verifiedParts(row: VideoRow, parts: R2Part[]) {
  return parts.filter((part) => part.bytes === sizeOfPart(row.size_bytes, part.number)).sort((a, b) => a.number - b.number);
}

export class VideoService {
  constructor(private readonly db: Repository, private readonly storage: Storage, private readonly limit: number) {}

  async list(): Promise<VideoLibrary> {
    const [recordings, usedBytes] = await Promise.all([this.db.list(), this.db.usage()]);
    return { recordings: recordings.map(metadata), usedBytes, limitBytes: this.limit };
  }

  async start(recording: NewRecording) {
    const reservation = await this.db.reserve(recording);
    if (reservation.result === 'forbidden') throw new VideoError(403, 'ADMIN_REQUIRED', 'Active DEV admin membership is required.');
    if (reservation.result === 'conflict') throw new VideoError(409, 'RECORDING_CONFLICT', 'This upload ID belongs to a different recording.');
    if (reservation.result === 'quota') throw new VideoError(409, 'QUOTA_EXCEEDED', 'The DEV storage budget or recording limit is full. Delete test recordings and retry.');
    if (!('row' in reservation)) throw new Error('Unexpected reservation result');
    if (reservation.result === 'existing') return metadata(reservation.row);

    // A failed or ambiguous create keeps the reservation for explicit cleanup.
    const providerId = await this.storage.start(recording.id);
    const created = await this.db.change(reservation.row, { status: 'uploading', upload_id: providerId, busy_until: null });
    return metadata(created);
  }

  async listParts(id: string) {
    const row = await this.uploading(id);
    const parts = await this.storage.parts(id, uploadId(row));
    return { completed: verifiedParts(row, parts).map((part) => part.number) };
  }

  async partUrl(id: string, number: number) {
    const row = await this.uploading(id);
    const bytes = sizeOfPart(row.size_bytes, number);
    if (!Number.isSafeInteger(number) || number < 1 || !bytes) throw new VideoError(422, 'INVALID_PART', 'The part number is outside this recording.');
    const expiresIn = Math.max(1, Math.min(900, Math.floor((Date.parse(row.expires_at) - Date.now()) / 1000)));
    return this.storage.signPart(id, uploadId(row), number, bytes, expiresIn);
  }

  async complete(id: string) {
    const row = await this.requireRow(id);
    if (row.status === 'ready') return metadata(row);
    if (row.status !== 'uploading' && row.status !== 'completing') throw busy();
    // A completion already attempted before expiration may recover from HEAD.
    if (row.status === 'uploading' && expired(row)) throw this.expiredError();
    const claimed = await this.db.claim(row, 'completing');
    if (!claimed) throw busy();

    let object = await this.storage.head(id);
    if (!object) {
      if (expired(claimed)) {
        await this.db.change(claimed, { status: 'uploading', busy_until: null });
        throw this.expiredError();
      }
      const parts = await this.storage.parts(id, uploadId(claimed));
      const usable = verifiedParts(claimed, parts);
      if (parts.length !== Math.ceil(claimed.size_bytes / partBytes) || usable.length !== parts.length ||
          !usable.every((part, index) => part.number === index + 1)) {
        await this.db.change(claimed, { status: 'uploading', busy_until: null });
        throw new VideoError(409, 'PARTS_INCOMPLETE', 'R2 does not have every part at the expected size. Reselect the original file and resume.');
      }
      await this.storage.complete(id, uploadId(claimed), usable);
      object = await this.storage.head(id);
    }
    return this.finish(claimed, object);
  }

  async playback(id: string) {
    const row = await this.requireRow(id);
    if (row.status !== 'ready') throw new VideoError(409, 'NOT_PLAYABLE', 'Complete the upload before requesting playback.');
    return this.storage.signPlayback(id);
  }

  async delete(id: string) {
    const row = await this.db.get(id);
    if (!row) return;
    const claimed = await this.db.claim(row, 'deleting');
    if (!claimed) throw busy();
    try {
      if (row.status !== 'ready') {
        if (claimed.upload_id) await this.storage.abort(id, claimed.upload_id);
        else await this.storage.abortUnknown(id);
      }
      await this.storage.delete(id);
      if (await this.storage.head(id)) throw new VideoError(502, 'DELETE_UNCONFIRMED', 'R2 still reports the recording. Retry deletion.');
    } catch (error) {
      await this.db.change(claimed, { busy_until: null });
      throw error;
    }
    await this.db.remove(claimed);
  }

  private async finish(row: VideoRow, object: R2Object | null) {
    if (!object) throw new VideoError(502, 'OBJECT_UNCONFIRMED', 'R2 has not confirmed the completed object. Retry completion after the operation timeout.');
    if (object.bytes !== row.size_bytes || object.type !== 'video/mp4') {
      await this.db.change(row, { status: 'deleting', busy_until: null });
      try {
        await this.delete(row.id);
      } catch {
        throw new VideoError(502, 'OBJECT_CLEANUP_FAILED', 'The R2 object has the wrong size or media type and is hidden. Retry deletion to release storage.');
      }
      throw new VideoError(422, 'OBJECT_MISMATCH', 'The R2 object had the wrong size or media type and was removed. Start again.');
    }
    return metadata(await this.db.change(row, { status: 'ready', busy_until: null }));
  }

  private async requireRow(id: string) {
    const row = await this.db.get(id);
    if (!row) throw new VideoError(404, 'RECORDING_NOT_FOUND', 'This recording was not found.');
    return row;
  }

  private async uploading(id: string) {
    const row = await this.requireRow(id);
    if (row.status !== 'uploading') throw new VideoError(409, 'UPLOAD_UNAVAILABLE', 'This recording is not accepting parts. Refresh the list.');
    if (expired(row)) throw this.expiredError();
    return row;
  }

  private expiredError() {
    return new VideoError(409, 'UPLOAD_EXPIRED', 'This upload expired. Delete it to release its reservation and start again.');
  }
}
