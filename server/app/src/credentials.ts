/**
 * PowerSync service JWT minting (spec: app/database-guidelines.md
 * "App backend": `GET /credentials` mints a short-TTL (15 min) PowerSync
 * JWT on request; the old `powersync-jwt` package was removed in the SDK
 * v2 revamp — `jose` signs directly).
 *
 * The JWT is verified by the PowerSync Service (server/powersync/
 * service.yaml `client_auth`), NOT by this app. The claims therefore must
 * satisfy the service's requirements
 * (docs.powersync.com/configuration/auth/custom):
 *   - alg HS256 + kid `nextdo-dev`  → matches the JWK in service.yaml
 *   - aud `nextdo`                  → in the service's `client_auth.audience`
 *   - sub = the single v1 user id   → `owner` (single-user, no accounts)
 *   - iat + exp present, exp − iat ≤ 24h (15 min here — the PowerSync
 *     recommended 5–60 min band)
 *
 * Shared-secret coordination: `JWT_SECRET` (this app's env) and
 * `PS_JWT_SECRET` (the service's env, via server/powersync/.env) are the
 * SAME base64url string. The service uses it verbatim as the HS256 JWK
 * `k`; this app decodes it to the signing bytes. One value, one form —
 * no second copy to keep in sync.
 *
 * `now` is INJECTED (the app passes its clock) so the 15-min TTL is
 * testable without real time.
 */
import { SignJWT } from 'jose';

/** 15 minutes — the spec's minted-TTL (PowerSync recommends 5–60 min). */
export const POWER_SYNC_JWT_TTL_SECONDS = 15 * 60;

/** Must match the `kid` in server/powersync/service.yaml `client_auth`. */
export const POWER_SYNC_JWT_KID = 'nextdo-dev';

/** Must be in the service's `client_auth.audience`. */
export const POWER_SYNC_JWT_AUDIENCE = 'nextdo';

/**
 * The `aud` a PowerSync **Cloud** instance requires: the instance URL itself.
 *
 * PowerSync's rule (docs.powersync.com/configuration/auth/custom): “The `aud`
 * of the JWT must match the PowerSync instance URL (for Cloud) or one of the
 * audiences configured in `client_auth.audience` (for self-hosted).” A
 * self-hosted `service.yaml` lists `nextdo`, so that path keeps the default;
 * a Cloud deployment runs THIS helper instead, because no Cloud instance
 * accepts `nextdo`.
 *
 * The instance URL is already the value the operator pasted as
 * `NEXTDO_SYNC_ENDPOINT`, so deriving the audience from it keeps a second
 * setting from having to agree with the first. The origin is used because the
 * console shows the instance URL without a path; the fallback only exists so
 * a malformed value degrades to a trailing-slash trim instead of throwing
 * inside token minting.
 */
export function cloudJwtAudience(syncEndpoint: string): string {
  try {
    return new URL(syncEndpoint).origin;
  } catch {
    return syncEndpoint.trim().replace(/\/+$/, '');
  }
}

/** v1 single user: the one subject, no account model. */
export const POWER_SYNC_JWT_SUBJECT = 'owner';

/**
 * Decode a base64url (no padding) shared secret to signing bytes, failing
 * fast on an unusable value (empty / padded / not base64url).
 */
export function decodeJwtSecret(secret: string): Uint8Array {
  const bytes = Uint8Array.from(Buffer.from(secret, 'base64url'));
  // Round-trip check: catches padding ('='), non-base64url characters, and
  // empty input. Node's decoder is lenient about stray characters, so the
  // re-encode must be byte-identical to accept the value.
  if (bytes.length === 0 || Buffer.from(bytes).toString('base64url') !== secret) {
    throw new Error(
      'JWT_SECRET must be a non-empty base64url string without padding ' +
        '(generate: openssl rand -base64 32 | tr \'+/\' \'-_\' | tr -d \'=\')',
    );
  }
  return bytes;
}

export interface MintJwtOptions {
  /** base64url (no padding) shared secret — same value as the service's JWK `k`. */
  secret: string;
  /** Injectable clock (testability of the TTL). */
  now: Date;
  kid?: string;
  audience?: string;
  subject?: string;
  ttlSeconds?: number;
}

/** Mint the 15-min PowerSync service JWT the client presents to the service. */
export async function mintPowerSyncJwt(options: MintJwtOptions): Promise<string> {
  const key = decodeJwtSecret(options.secret);
  const iat = Math.floor(options.now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', kid: options.kid ?? POWER_SYNC_JWT_KID })
    .setSubject(options.subject ?? POWER_SYNC_JWT_SUBJECT)
    .setAudience(options.audience ?? POWER_SYNC_JWT_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + (options.ttlSeconds ?? POWER_SYNC_JWT_TTL_SECONDS))
    .sign(key);
}
