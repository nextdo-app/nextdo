/**
 * PowerSync JWT minting — 15-min TTL, valid HS256 signature under the
 * shared secret, and the header/claims the PowerSync service's JWK expects
 * (kid/aud/sub).
 *
 * Clock note: jose's `jwtVerify` validates `exp` against the WALL clock
 * and offers no way to pin it, so tokens that are verified here are minted
 * under a clock anchored to the real current time (the TTL assertion stays
 * exact — `exp − iat === 900` — and the token is valid for the full 15
 * minutes after mint). The fixed `NOW` clock from helpers.ts is NOT used
 * here: a JWT minted at a fixed past date would be expired by the time
 * `jwtVerify` runs. (The upload tests do use the fixed clock — they
 * compare SQL parameter values, which never touches the wall clock.)
 */
import { jwtVerify, type JWTPayload } from 'jose';
import {
  cloudJwtAudience,
  decodeJwtSecret,
  mintPowerSyncJwt,
  POWER_SYNC_JWT_AUDIENCE,
  POWER_SYNC_JWT_KID,
  POWER_SYNC_JWT_SUBJECT,
  POWER_SYNC_JWT_TTL_SECONDS,
} from '../src/credentials.js';
import { createApp } from '../src/app.js';
import { createMockPool, JWT_SECRET, OWNER_TOKEN, SYNC_ENDPOINT } from './helpers.js';

const OTHER_SECRET = Buffer.from('a-different-secret-of-enough-bytes!!', 'utf8').toString(
  'base64url',
);

function jwtHeader(token: string): { alg: string; kid: string } {
  const encoded = token.split('.')[0];
  if (encoded === undefined) {
    throw new Error('token has no header segment');
  }
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
    alg: string;
    kid: string;
  };
}

/** iat/exp as numbers (jose types the claims optional — assert they exist). */
function claimTimes(payload: JWTPayload): { iat: number; exp: number } {
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') {
    throw new Error(
      `expected numeric iat/exp claims, got iat=${String(payload.iat)} exp=${String(payload.exp)}`,
    );
  }
  return { iat: payload.iat, exp: payload.exp };
}

describe('mintPowerSyncJwt', () => {
  it('expires EXACTLY 15 minutes after issue (exp − iat = 900)', async () => {
    expect(POWER_SYNC_JWT_TTL_SECONDS).toBe(900);
    const now = new Date(); // wall-anchored so jwtVerify's exp check passes
    const token = await mintPowerSyncJwt({ secret: JWT_SECRET, now });
    const { payload } = await jwtVerify(token, decodeJwtSecret(JWT_SECRET), {
      audience: POWER_SYNC_JWT_AUDIENCE,
    });
    const { iat, exp } = claimTimes(payload);
    expect(iat).toBe(Math.floor(now.getTime() / 1000));
    expect(exp).toBe(iat + 900);
  });

  it('carries the header/claims the service JWK verifies (HS256, kid, aud, sub)', async () => {
    const token = await mintPowerSyncJwt({ secret: JWT_SECRET, now: new Date() });
    const header = jwtHeader(token);
    expect(header.alg).toBe('HS256');
    expect(header.kid).toBe(POWER_SYNC_JWT_KID);
    const { payload } = await jwtVerify(token, decodeJwtSecret(JWT_SECRET), {
      audience: POWER_SYNC_JWT_AUDIENCE,
    });
    expect(payload.sub).toBe(POWER_SYNC_JWT_SUBJECT);
    expect(payload.aud).toBe(POWER_SYNC_JWT_AUDIENCE);
  });

  it('verification FAILS under a different secret (the signature is real)', async () => {
    const token = await mintPowerSyncJwt({ secret: JWT_SECRET, now: new Date() });
    await expect(
      jwtVerify(token, decodeJwtSecret(OTHER_SECRET), { audience: POWER_SYNC_JWT_AUDIENCE }),
    ).rejects.toThrow();
  });

  it('honors an injected now (TTL math is clock-driven, not Date.now())', async () => {
    // 1 hour in the FUTURE: far enough ahead that the wall clock can never
    // have passed `exp`, yet different from any "just now" mint — so exact
    // iat/exp equality proves the claims came from the injected clock.
    const later = new Date(Date.now() + 60 * 60 * 1000);
    const token = await mintPowerSyncJwt({ secret: JWT_SECRET, now: later });
    const { payload } = await jwtVerify(token, decodeJwtSecret(JWT_SECRET), {
      audience: POWER_SYNC_JWT_AUDIENCE,
    });
    const { iat, exp } = claimTimes(payload);
    expect(iat).toBe(Math.floor(later.getTime() / 1000));
    expect(exp).toBe(iat + 900);
  });
});

describe('cloudJwtAudience', () => {
  it('is the instance origin — the aud a PowerSync Cloud instance requires', () => {
    expect(cloudJwtAudience('https://abc123.powersync.journeyapps.com')).toBe(
      'https://abc123.powersync.journeyapps.com',
    );
  });

  it('drops a trailing slash or path so a pasted URL still matches exactly', () => {
    expect(cloudJwtAudience('https://abc123.powersync.journeyapps.com/')).toBe(
      'https://abc123.powersync.journeyapps.com',
    );
    expect(cloudJwtAudience('https://abc123.powersync.journeyapps.com/sync')).toBe(
      'https://abc123.powersync.journeyapps.com',
    );
  });
});

describe('decodeJwtSecret', () => {
  it('round-trips a valid base64url secret', () => {
    const bytes = decodeJwtSecret(JWT_SECRET);
    expect(Buffer.from(bytes).toString('base64url')).toBe(JWT_SECRET);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('throws on empty, padded, and non-base64url input', () => {
    expect(() => decodeJwtSecret('')).toThrow();
    // 'YWJj' is valid base64url for "abc"; with padding it must be rejected.
    expect(() => decodeJwtSecret('YWJj==')).toThrow();
    expect(() => decodeJwtSecret('not base64!')).toThrow();
  });
});

describe('GET /credentials endpoint', () => {
  it('answers 200 { token } with a 15-min TTL under the valid owner token', async () => {
    const { pool } = createMockPool();
    const app = createApp({
      pool,
      ownerToken: OWNER_TOKEN,
      jwtSecret: JWT_SECRET,
      syncEndpoint: SYNC_ENDPOINT,
    });
    const t0 = Date.now();
    const res = await app.request('/credentials', {
      headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
    });
    const t1 = Date.now();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    // The client contract: data.token is a non-empty string.
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);
    const { payload } = await jwtVerify(body.token, decodeJwtSecret(JWT_SECRET), {
      audience: POWER_SYNC_JWT_AUDIENCE,
    });
    // iat is the mint time (the app's default clock) and exp is EXACTLY
    // 15 minutes after it.
    const { iat, exp } = claimTimes(payload);
    expect(iat).toBeGreaterThanOrEqual(Math.floor(t0 / 1000));
    expect(iat).toBeLessThanOrEqual(Math.floor(t1 / 1000));
    expect(exp).toBe(iat + 900);
  });

  it('carries the deployment syncEndpoint verbatim (10-02 — clients stop guessing the path)', async () => {
    const { pool } = createMockPool();
    const app = createApp({
      pool,
      ownerToken: OWNER_TOKEN,
      jwtSecret: JWT_SECRET,
      syncEndpoint: 'https://custom.example.com/stream',
    });
    const res = await app.request('/credentials', {
      headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; endpoint: string };
    expect(body.endpoint).toBe('https://custom.example.com/stream');
  });

  it('echoes whatever NEXTDO_SYNC_ENDPOINT resolved to — no path rewriting', async () => {
    const { pool } = createMockPool();
    // A subdomain deployment has no /sync suffix at all: the server must
    // hand back EXACTLY what the operator configured, never a derived URL.
    const endpoint = 'https://sync.example.test';
    const app = createApp({
      pool,
      ownerToken: OWNER_TOKEN,
      jwtSecret: JWT_SECRET,
      syncEndpoint: endpoint,
    });
    const res = await app.request('/credentials', {
      headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
    });
    const body = (await res.json()) as { endpoint: string };
    expect(body.endpoint).toBe(endpoint);
  });

  it('mints the Cloud instance URL as aud when the deployment supplies one', async () => {
    const { pool } = createMockPool();
    const instance = 'https://abc123.powersync.journeyapps.com';
    const app = createApp({
      pool,
      ownerToken: OWNER_TOKEN,
      jwtSecret: JWT_SECRET,
      syncEndpoint: instance,
      audience: cloudJwtAudience(instance),
    });
    const res = await app.request('/credentials', {
      headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    // jwtVerify enforces the audience: a token minted with the wrong aud
    // rejects here, which is exactly the failure a Cloud instance reports.
    const { payload } = await jwtVerify(body.token, decodeJwtSecret(JWT_SECRET), {
      audience: instance,
    });
    expect(payload.aud).toBe(instance);
  });

  it('keeps the shared default aud when the deployment does not supply one (self-hosted)', async () => {
    const { pool } = createMockPool();
    const app = createApp({
      pool,
      ownerToken: OWNER_TOKEN,
      jwtSecret: JWT_SECRET,
      syncEndpoint: SYNC_ENDPOINT,
    });
    const res = await app.request('/credentials', {
      headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
    });
    const body = (await res.json()) as { token: string };
    const { payload } = await jwtVerify(body.token, decodeJwtSecret(JWT_SECRET), {
      audience: POWER_SYNC_JWT_AUDIENCE,
    });
    expect(payload.aud).toBe(POWER_SYNC_JWT_AUDIENCE);
  });

  it('mints the deployment-supplied kid when the keystore named its own key (Cloud)', async () => {
    const { pool } = createMockPool();
    const app = createApp({
      pool,
      ownerToken: OWNER_TOKEN,
      jwtSecret: JWT_SECRET,
      syncEndpoint: SYNC_ENDPOINT,
      kid: 'hs256-key-1',
    });
    const res = await app.request('/credentials', {
      headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    // The service looks the key up BY kid: a mismatch is precisely the
    // PSYNC_S2101 “no key matched the token KID” failure, so the header must
    // carry whatever name the deployment's keystore actually uses.
    expect(jwtHeader(body.token).kid).toBe('hs256-key-1');
  });

  it('keeps the shared default kid when the deployment does not supply one (self-hosted)', async () => {
    const { pool } = createMockPool();
    const app = createApp({
      pool,
      ownerToken: OWNER_TOKEN,
      jwtSecret: JWT_SECRET,
      syncEndpoint: SYNC_ENDPOINT,
    });
    const res = await app.request('/credentials', {
      headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
    });
    const body = (await res.json()) as { token: string };
    expect(jwtHeader(body.token).kid).toBe(POWER_SYNC_JWT_KID);
  });

  it('the endpoint is NOT leaked on a 401 (auth stays the whole gate)', async () => {
    const { pool } = createMockPool();
    const app = createApp({
      pool,
      ownerToken: OWNER_TOKEN,
      jwtSecret: JWT_SECRET,
      syncEndpoint: SYNC_ENDPOINT,
    });
    const res = await app.request('/credentials', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { endpoint?: unknown };
    expect(body.endpoint).toBeUndefined();
  });
});
