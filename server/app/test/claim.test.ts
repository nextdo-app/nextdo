import { runInNewContext } from 'node:vm';
import { createApp } from '../src/app.js';
import { ServerClaimManager } from '../src/claim.js';
import {
  createMockPool,
  JWT_SECRET,
  NOW,
  OWNER_TOKEN,
  SYNC_ENDPOINT,
} from './helpers.js';

describe('server claim and pairing protocol', () => {
  describe('homepage connection string copy', () => {
    async function setupCopy(writeText: (text: string) => Promise<void>) {
      const { pool } = createMockPool();
      const app = createApp({ pool, jwtSecret: JWT_SECRET, syncEndpoint: SYNC_ENDPOINT });
      const response = await app.request('/', { headers: { accept: 'text/html' } });
      const script = (await response.text()).match(/<script>([\s\S]*?)<\/script>/)?.[1];
      expect(script).toBeDefined();
      const elements = {
        srvUrl: { value: '', focus: jest.fn(), select: jest.fn() },
        deepLinkBtn: {},
        claimBtn: {},
        copyBtn: { innerText: '复制' },
        claimError: { hidden: true, textContent: '' },
      };
      const copy = runInNewContext(`${script}\nhandleCopy`, {
        document: { getElementById: (id: keyof typeof elements) => elements[id] },
        window: { location: { origin: 'https://nextdo.example.test' } },
        navigator: { clipboard: { writeText } },
        setTimeout: jest.fn(),
      }) as () => Promise<void>;
      elements.srvUrl.value = `https://nextdo.example.test|${OWNER_TOKEN}`;
      return { copy, elements };
    }

    it('reports success only after the clipboard write completes', async () => {
      let finishWrite!: () => void;
      const write = new Promise<void>((resolve) => { finishWrite = resolve; });
      const writeText = jest.fn(() => write);
      const { copy, elements } = await setupCopy(writeText);
      const copying = copy();
      expect(elements.copyBtn.innerText).toBe('复制');
      expect(writeText).toHaveBeenCalledWith(elements.srvUrl.value);
      finishWrite();
      await copying;
      expect(elements.copyBtn.innerText).toBe('已复制');
      expect(elements.claimError.hidden).toBe(true);
    });

    it('handles clipboard denial and selects the connection string for manual copy', async () => {
      const write = Promise.reject(new Error('Clipboard permission denied'));
      // Keep the pre-fix test from leaking a rejection before asserting its UI failure.
      void write.catch(() => {});
      const { copy, elements } = await setupCopy(() => write);
      await copy();
      expect(elements.copyBtn.innerText).toBe('复制');
      expect(elements.claimError.hidden).toBe(false);
      expect(elements.claimError.textContent).toContain('手动复制');
      expect(elements.srvUrl.focus).toHaveBeenCalled();
      expect(elements.srvUrl.select).toHaveBeenCalled();
      expect(elements.srvUrl.value).toContain(OWNER_TOKEN);
    });
  });

  describe.each(['static', 'persisted'] as const)('%s token confidentiality', (mode) => {
    it.each(['/', '/api'])('does not disclose the owner token through %s', async (path) => {
      const { pool } = createMockPool();
      const app = createApp({
        pool,
        ...(mode === 'static'
          ? { ownerToken: OWNER_TOKEN }
          : {
              claimState: new ServerClaimManager({
                pool,
                initialDynamicToken: OWNER_TOKEN,
              }),
            }),
        jwtSecret: JWT_SECRET,
        syncEndpoint: SYNC_ENDPOINT,
        now: () => NOW,
      });

      for (const accept of ['text/html', 'application/json']) {
        for (const authorization of ['', `Bearer ${OWNER_TOKEN}`]) {
          const response = await app.request(path, { headers: { accept, authorization } });
          expect(response.status).toBe(200);
          expect(await response.text()).not.toContain(OWNER_TOKEN);
          expect(response.headers.get('cache-control')).toBe('no-store');
        }
      }
    });
  });

  describe('static mode (NEXTDO_OWNER_TOKEN configured)', () => {
    it('GET /claim/status reports claimed=true', async () => {
      const { pool } = createMockPool();
      const app = createApp({
        pool,
        ownerToken: OWNER_TOKEN,
        jwtSecret: JWT_SECRET,
        syncEndpoint: SYNC_ENDPOINT,
        now: () => NOW,
      });

      const res = await app.request('/claim/status');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ claimed: true, requiresSecret: false });
    });

    it('POST /claim returns 409 already_claimed', async () => {
      const { pool } = createMockPool();
      const app = createApp({
        pool,
        ownerToken: OWNER_TOKEN,
        jwtSecret: JWT_SECRET,
        syncEndpoint: SYNC_ENDPOINT,
        now: () => NOW,
      });

      const res = await app.request('/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ownerToken: 'attempted-token' }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body).toEqual({
        error: 'already_claimed',
        code: 'claim.already_claimed',
      });
    });
  });

  describe('unclaimed mode -> claim -> authenticated transition', () => {
    it('starts unclaimed, claims with auto-generated token, and authenticates subsequent requests', async () => {
      // In-memory mock pool with custom query handling for system_settings table
      const storedSettings = new Map<string, string>();
      const customPool = {
        async query(text: string, values?: readonly unknown[]) {
          const upper = text.trim().toUpperCase();
          if (upper.startsWith('SELECT VALUE FROM SYSTEM_SETTINGS')) {
            const key = values?.[0] as string;
            const val = storedSettings.get(key);
            return { rows: val ? [{ value: val }] : [] };
          }
          if (upper.startsWith('INSERT INTO SYSTEM_SETTINGS')) {
            const key = values?.[0] as string;
            const val = values?.[1] as string;
            if (storedSettings.has(key)) {
              return { rows: [] }; // conflict
            }
            storedSettings.set(key, val);
            return { rows: [{ key }] };
          }
          return { rows: [] };
        },
        async connect() {
          return {
            query: this.query,
            release() {},
          };
        },
        async end() {},
      };

      const claimState = new ServerClaimManager({
        pool: customPool,
        staticToken: null,
        initialDynamicToken: null,
        now: () => NOW,
      });

      const app = createApp({
        pool: customPool,
        claimState,
        jwtSecret: JWT_SECRET,
        syncEndpoint: SYNC_ENDPOINT,
        now: () => NOW,
      });

      // 1. Initial status is unclaimed
      const statusRes1 = await app.request('/claim/status');
      expect(statusRes1.status).toBe(200);
      expect(await statusRes1.json()).toEqual({ claimed: false, requiresSecret: false });

      // 2. Before claiming, requests to /credentials with any token are unauthorized (401)
      const credsBefore = await app.request('/credentials', {
        headers: { authorization: 'Bearer any-token' },
      });
      expect(credsBefore.status).toBe(401);

      // 3. POST /claim generates a secure 64-hex token
      const claimRes = await app.request('/claim', { method: 'POST' });
      expect(claimRes.status).toBe(200);
      expect(claimRes.headers.get('cache-control')).toBe('no-store');
      const claimBody = (await claimRes.json()) as { ok: boolean; ownerToken: string };
      expect(claimBody.ok).toBe(true);
      expect(typeof claimBody.ownerToken).toBe('string');
      expect(claimBody.ownerToken).toMatch(/^[0-9a-f]{64}$/);

      for (const path of ['/', '/api']) {
        const homepage = await app.request(path, { headers: { accept: 'text/html' } });
        expect(homepage.status).toBe(200);
        expect(await homepage.text()).not.toContain(claimBody.ownerToken);
        expect(homepage.headers.get('cache-control')).toBe('no-store');
      }

      // 4. Status is now claimed
      const statusRes2 = await app.request('/claim/status');
      expect(statusRes2.status).toBe(200);
      expect(await statusRes2.json()).toEqual({ claimed: true, requiresSecret: false });

      // 5. Subsequent POST /claim is rejected with 409
      const secondClaim = await app.request('/claim', { method: 'POST' });
      expect(secondClaim.status).toBe(409);
      expect(secondClaim.headers.get('cache-control')).toBe('no-store');
      expect(await secondClaim.json()).toEqual({
        error: 'already_claimed',
        code: 'claim.already_claimed',
      });

      // 6. /credentials now succeeds with the claimed token
      const credsAfter = await app.request('/credentials', {
        headers: { authorization: `Bearer ${claimBody.ownerToken}` },
      });
      expect(credsAfter.status).toBe(200);
      const credsBody = (await credsAfter.json()) as { token: string; endpoint: string };
      expect(typeof credsBody.token).toBe('string');
      expect(credsBody.endpoint).toBe(SYNC_ENDPOINT);

      // 7. Wrong token is still 401
      const credsWrong = await app.request('/credentials', {
        headers: { authorization: 'Bearer wrong-token' },
      });
      expect(credsWrong.status).toBe(401);
    });
  });

  describe('protected mode (NEXTDO_CLAIM_SECRET configured)', () => {
    function setupProtectedApp(claimSecret = 'my-claim-secret') {
      const storedSettings = new Map<string, string>();
      const customPool = {
        async query(text: string, values?: readonly unknown[]) {
          const upper = text.trim().toUpperCase();
          if (upper.startsWith('SELECT VALUE FROM SYSTEM_SETTINGS')) {
            const key = values?.[0] as string;
            const val = storedSettings.get(key);
            return { rows: val ? [{ value: val }] : [] };
          }
          if (upper.startsWith('INSERT INTO SYSTEM_SETTINGS')) {
            const key = values?.[0] as string;
            const val = values?.[1] as string;
            if (storedSettings.has(key)) {
              return { rows: [] };
            }
            storedSettings.set(key, val);
            return { rows: [{ key }] };
          }
          return { rows: [] };
        },
        async connect() {
          return {
            query: this.query,
            release() {},
          };
        },
        async end() {},
      };

      const claimState = new ServerClaimManager({
        pool: customPool,
        staticToken: null,
        initialDynamicToken: null,
        now: () => NOW,
      });

      const app = createApp({
        pool: customPool,
        claimState,
        claimSecret,
        jwtSecret: JWT_SECRET,
        syncEndpoint: SYNC_ENDPOINT,
        now: () => NOW,
      });

      return { app, claimState };
    }

    it('reports requiresSecret=true when unclaimed', async () => {
      const { app } = setupProtectedApp();
      const res = await app.request('/claim/status');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ claimed: false, requiresSecret: true });
    });

    it('refuses POST /claim without secret with 403 forbidden', async () => {
      const { app } = setupProtectedApp();
      const res = await app.request('/claim', { method: 'POST' });
      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({
        error: 'forbidden',
        code: 'claim.invalid_secret',
        message: 'A valid claim secret is required to claim this server.',
      });
    });

    it('refuses POST /claim with invalid secret with 403 forbidden', async () => {
      const { app } = setupProtectedApp();
      const res = await app.request('/claim', {
        method: 'POST',
        headers: { 'x-claim-secret': 'wrong-secret' },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: 'forbidden',
        code: 'claim.invalid_secret',
        message: 'A valid claim secret is required to claim this server.',
      });
    });

    it('allows POST /claim with correct secret in x-claim-secret header', async () => {
      const { app } = setupProtectedApp('valid-token-123');
      const res = await app.request('/claim', {
        method: 'POST',
        headers: { 'x-claim-secret': 'valid-token-123' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; ownerToken: string };
      expect(body.ok).toBe(true);
      expect(typeof body.ownerToken).toBe('string');
    });

    it('allows POST /claim with correct secret in Authorization: Bearer header', async () => {
      const { app } = setupProtectedApp('bearer-secret');
      const res = await app.request('/claim', {
        method: 'POST',
        headers: { authorization: 'Bearer bearer-secret' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; ownerToken: string };
      expect(body.ok).toBe(true);
    });

    it('allows POST /claim with correct secret in json body', async () => {
      const { app } = setupProtectedApp('body-secret');
      const res = await app.request('/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claimSecret: 'body-secret' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; ownerToken: string };
      expect(body.ok).toBe(true);
    });
  });
});
