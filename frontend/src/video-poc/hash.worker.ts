import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

type HashResult = { digest: string } | { bytes: number } | { error: true };
const send = (result: HashResult) => globalThis.postMessage(result);

globalThis.addEventListener('message', async ({ data }: MessageEvent<File>) => {
  const hash = sha256.create();
  const reader = data.stream().getReader();
  let bytes = 0;
  let reported = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      hash.update(chunk.value);
      bytes += chunk.value.byteLength;
      if (bytes - reported >= 8 * 1024 * 1024) {
        send({ bytes });
        reported = bytes;
      }
    }
    send({ digest: bytesToHex(hash.digest()) });
  } catch {
    send({ error: true });
  } finally {
    reader.releaseLock();
  }
});
