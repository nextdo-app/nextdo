/* global fetch, WebSocket, setTimeout */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const PORT = 4190;
const CDP_PORT = 9222;
const VERIFY_DIR = path.resolve('.verify/app-ui-optimization');
mkdirSync(VERIFY_DIR, { recursive: true });

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

function createStaticServer() {
  const DIST = path.resolve('apps/mobile/dist');
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    let filePath = path.join(DIST, pathname);
    if (!filePath.startsWith(DIST)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    if (!existsSync(filePath)) filePath = path.join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCdpReady() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (res.ok) return;
    } catch {
      await sleep(200);
    }
  }
  throw new Error('CDP not reachable');
}

async function capture(pageRoute, filename, { width, height, mobile }) {
  const targetRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?http://localhost:${PORT}${pageRoute}`, {
    method: 'PUT',
  });
  const targetData = await targetRes.json();
  const wsUrl = targetData.webSocketDebuggerUrl;

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let messageId = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };

  function send(method, params = {}) {
    const id = messageId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: Boolean(mobile),
  });

  // Suppress notification opt-in prompt
  await send('Runtime.evaluate', {
    expression: `
      localStorage.setItem('nextdo.settings.notifications', JSON.stringify({ masterEnabled: true }));
    `,
  });

  // Reload with the setting present
  await send('Page.reload');
  await sleep(1500);

  // Take screenshot
  const screenshotRes = await send('Page.captureScreenshot', { format: 'png' });
  if (screenshotRes.result?.data) {
    const buffer = Buffer.from(screenshotRes.result.data, 'base64');
    const outPath = path.join(VERIFY_DIR, filename);
    writeFileSync(outPath, buffer);
    console.log(`Saved screenshot: ${outPath} (${buffer.length} bytes)`);
  }

  ws.close();
}

async function main() {
  console.log(`Starting static server on port ${PORT}...`);
  const server = await createStaticServer();

  console.log('Starting headless Chrome for verification screenshots...');
  const chrome = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      '--user-data-dir=/tmp/nextdo-chrome-verify-profile',
      '--disable-gpu',
      '--no-sandbox',
    ],
    { stdio: 'ignore' }
  );

  try {
    await waitForCdpReady();
    console.log('CDP ready. Capturing screenshots...');

    const targets = [
      { route: '/now', name: 'now-desktop.png', viewport: { width: 1280, height: 900, mobile: false } },
      { route: '/now', name: 'now-mobile.png', viewport: { width: 390, height: 844, mobile: true } },
      { route: '/inbox', name: 'inbox-desktop.png', viewport: { width: 1280, height: 900, mobile: false } },
      { route: '/inbox', name: 'inbox-mobile.png', viewport: { width: 390, height: 844, mobile: true } },
      { route: '/projects', name: 'projects-desktop.png', viewport: { width: 1280, height: 900, mobile: false } },
      { route: '/projects', name: 'projects-mobile.png', viewport: { width: 390, height: 844, mobile: true } },
    ];

    for (const item of targets) {
      console.log(`Capturing ${item.route} (${item.name})...`);
      await capture(item.route, item.name, item.viewport);
    }

    console.log('All verification screenshots captured successfully!');
  } finally {
    chrome.kill();
    server.close();
  }
}

main().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
