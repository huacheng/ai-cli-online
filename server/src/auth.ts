import { createHmac, timingSafeEqual } from 'crypto';

/** Constant-time string comparison using HMAC to prevent timing side-channel attacks.
 *  HMAC digests are always 32 bytes, so comparison is constant-time regardless of input lengths. */
export function safeTokenCompare(a: string, b: string): boolean {
  const key = 'ai-cli-online-token-compare';
  const hmacA = createHmac('sha256', key).update(a).digest();
  const hmacB = createHmac('sha256', key).update(b).digest();
  return timingSafeEqual(hmacA as Uint8Array, hmacB as Uint8Array);
}
