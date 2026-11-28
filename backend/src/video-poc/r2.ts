import { AwsClient } from 'aws4fetch';
import { XMLParser } from 'fast-xml-parser';
import type { SignedVideoUrl } from '../../../shared/contracts/video-poc';
import type { VideoConfig } from './config';
import { VideoError } from './error';

export type R2Part = { number: number; bytes: number; etag: string };
export type R2Object = { bytes: number; type: string | null };
const parser = new XMLParser({ parseTagValue: false });
const repeated = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const keyFor = (id: string) => `video-poc/${id}.mp4`;

class R2Failure extends VideoError {
  constructor(readonly providerCode?: string) {
    super(502, 'R2_FAILED', 'Private R2 could not complete the operation. Check the DEV bucket configuration and try again.');
  }
}

export class R2VideoStore {
  private readonly signer: AwsClient;
  private readonly bucket: string;

  constructor(config: VideoConfig) {
    this.signer = new AwsClient({
      accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: 's3', region: 'auto', retries: 0,
    });
    this.bucket = `https://${config.account}.r2.cloudflarestorage.com/${config.bucket}`;
  }

  async start(id: string): Promise<string> {
    const response = await this.request(id, { uploads: '' }, {
      method: 'POST', headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, no-store' },
    });
    const uploadId = (await this.xml(response)).InitiateMultipartUploadResult?.UploadId;
    if (typeof uploadId !== 'string' || !uploadId || uploadId.length > 4096) throw new R2Failure();
    return uploadId;
  }

  async parts(id: string, uploadId: string): Promise<R2Part[]> {
    const response = await this.request(id, { uploadId, 'max-parts': '300' }, {});
    const list = (await this.xml(response)).ListPartsResult;
    if (!list || list.IsTruncated === 'true') throw new R2Failure();
    return repeated<{ PartNumber: string; Size: string; ETag: string }>(list.Part).map((part) => {
      const number = Number(part.PartNumber);
      const bytes = Number(part.Size);
      if (!Number.isSafeInteger(number) || number < 1 || !Number.isSafeInteger(bytes) || bytes < 1 ||
          typeof part.ETag !== 'string' || !/^"?[0-9a-f-]+"?$/i.test(part.ETag)) throw new R2Failure();
      return { number, bytes, etag: part.ETag };
    });
  }

  async complete(id: string, uploadId: string, parts: R2Part[]) {
    const entries = parts.map(({ number, etag }) => `<Part><PartNumber>${number}</PartNumber><ETag>${etag}</ETag></Part>`);
    const response = await this.request(id, { uploadId }, {
      method: 'POST', headers: { 'Content-Type': 'application/xml' },
      body: `<CompleteMultipartUpload>${entries.join('')}</CompleteMultipartUpload>`,
    });
    if (!(await this.xml(response)).CompleteMultipartUploadResult) throw new R2Failure();
  }

  async head(id: string): Promise<R2Object | null> {
    const response = await this.request(id, {}, { method: 'HEAD' }, true);
    if (response.status === 404) return null;
    const size = response.headers.get('Content-Length');
    const bytes = Number(size);
    if (!size || !Number.isSafeInteger(bytes) || bytes < 0) throw new R2Failure();
    return { bytes, type: response.headers.get('Content-Type') };
  }

  async delete(id: string) {
    await this.request(id, {}, { method: 'DELETE' });
  }

  async abort(id: string, uploadId: string) {
    try {
      await this.request(id, { uploadId }, { method: 'DELETE' });
    } catch (error) {
      if (!(error instanceof R2Failure) || error.providerCode !== 'NoSuchUpload') throw error;
    }
  }

  async abortUnknown(id: string) {
    const key = keyFor(id);
    const response = await this.request(null, { uploads: '', prefix: key, 'max-uploads': '20' }, {});
    const list = (await this.xml(response)).ListMultipartUploadsResult;
    if (!list || list.IsTruncated === 'true') throw new R2Failure();
    for (const upload of repeated<{ Key: string; UploadId: string }>(list.Upload)) {
      if (upload.Key === key && upload.UploadId) await this.abort(id, upload.UploadId);
    }
  }

  signPart(id: string, uploadId: string, partNumber: number, bytes: number, expiresIn = 900): Promise<SignedVideoUrl> {
    return this.sign(id, { uploadId, partNumber: String(partNumber) }, 'PUT', expiresIn, { 'Content-Length': String(bytes) });
  }

  signPlayback(id: string): Promise<SignedVideoUrl> {
    return this.sign(id, {}, 'GET', 1800);
  }

  private url(id: string | null, query: Record<string, string>) {
    const url = new URL(id ? `${this.bucket}/${keyFor(id)}` : this.bucket);
    url.search = new URLSearchParams(query).toString();
    return url;
  }

  private async sign(id: string, query: Record<string, string>, method: string, expiresIn: number, headers?: HeadersInit) {
    const url = this.url(id, { ...query, 'X-Amz-Expires': String(expiresIn) });
    const signed = await this.signer.sign(url, { method, ...(headers ? { headers } : {}), aws: { signQuery: true, allHeaders: true } });
    return { url: signed.url, expiresIn };
  }

  private async request(id: string | null, query: Record<string, string>, init: RequestInit, allowMissing = false) {
    let response: Response;
    try {
      response = await this.signer.fetch(this.url(id, query), {
        ...init, signal: AbortSignal.timeout(20_000), redirect: 'error',
      });
    } catch {
      throw new R2Failure();
    }
    if (!response.ok && !(allowMissing && response.status === 404)) {
      await this.xml(response);
      throw new R2Failure();
    }
    return response;
  }

  // Responses come from R2, and the request bounds the provider list size.
  // Disallow DTDs even in control-plane responses.
  private async xml(response: Response) {
    const text = await response.text();
    if (text.length > 200_000 || text.includes('<!DOCTYPE')) throw new R2Failure();
    const parsed = parser.parse(text);
    if (parsed.Error) throw new R2Failure(parsed.Error.Code);
    return parsed;
  }
}
