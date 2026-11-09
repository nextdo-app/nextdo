import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

let fixtureDir: string;
let html: string;

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'nextdo-focus-html-'));
  mkdirSync(join(fixtureDir, 'scripts'));
  mkdirSync(join(fixtureDir, 'dist'));
  const script = join(fixtureDir, 'scripts/post-export-web.mjs');
  copyFileSync(join(__dirname, '../scripts/post-export-web.mjs'), script);
  // Match Expo's web.output="single" shell, which does not render +html.tsx.
  writeFileSync(
    join(fixtureDir, 'dist/index.html'),
    '<html><head></head><body><div id="root"></div><script src="/entry.js" defer></script></body></html>',
  );
  execFileSync(process.execPath, [script], { stdio: 'pipe' });
  html = readFileSync(join(fixtureDir, 'dist/index.html'), 'utf8');
});

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

function loadShell(island?: boolean) {
  const attributes = new Map<string, string>();
  const onLoad: Array<() => void> = [];
  const register = jest.fn().mockResolvedValue({ scope: '/' });
  const context = {
    window: {
      __NEXTDO_FOCUS_ISLAND__: island,
      location: { protocol: 'http:' },
      addEventListener: (name: string, callback: () => void) => {
        if (name === 'load') onLoad.push(callback);
      },
    },
    document: {
      documentElement: {
        setAttribute: (key: string, value: string) => attributes.set(key, value),
      },
    },
    navigator: { serviceWorker: { register } },
    console: { log: jest.fn(), warn: jest.fn() },
  };
  const head = html.slice(0, html.indexOf('</head>'));
  for (const [, script] of head.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    runInNewContext(script!, context);
  }
  onLoad.forEach((callback) => callback());
  return { attributes, register };
}

it('marks the native capsule before the app loads and keeps it out of PWA registration', () => {
  const capsule = loadShell(true);
  expect(capsule.attributes.get('data-focus-island')).toBe('true');
  expect(capsule.register).not.toHaveBeenCalled();
});

it('emits transparent HTML, body and React root backgrounds only for the capsule', () => {
  const rule = html.match(/([^{}]+)\{\s*background:\s*transparent\s*!important;\s*\}/);
  expect(rule).not.toBeNull();
  expect(rule![1]!.split(',').map((selector) => selector.trim())).toEqual([
    'html[data-focus-island]',
    'html[data-focus-island] body',
    'html[data-focus-island] #root',
  ]);
});

it('preserves main-window service worker registration without the capsule marker', () => {
  const main = loadShell();
  expect(main.attributes.has('data-focus-island')).toBe(false);
  expect(main.register).toHaveBeenCalledWith('/sw.js');
});
