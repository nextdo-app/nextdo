#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mobileDir = path.resolve(__dirname, '..');
const distDir = path.resolve(mobileDir, 'dist');
const publicDir = path.resolve(mobileDir, 'public');

console.log('[post-export-web] Post-processing Expo Web output for PWA...');

// 1. Copy all assets from public/ to dist/
if (fs.existsSync(publicDir)) {
  fs.cpSync(publicDir, distDir, { recursive: true });
  console.log('[post-export-web] Copied public/ assets (manifest, sw.js, icons) into dist/');
}

// 2. Patch dist/index.html with PWA meta tags & Service Worker registration
const indexPath = path.join(distDir, 'index.html');
if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf-8');

  // Replace or augment viewport for safe-area-inset
  if (html.includes('<meta name="viewport"')) {
    html = html.replace(
      /<meta name="viewport"[^>]*>/,
      '<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1.00001, viewport-fit=cover, user-scalable=no" />'
    );
  } else {
    html = html.replace(
      '<head>',
      '<head>\n    <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1.00001, viewport-fit=cover, user-scalable=no" />'
    );
  }

  // Inject PWA and iOS tags before </head>
  const pwaTags = `
    <!-- Nextdo PWA & iOS Safari Configuration -->
    <link rel="manifest" href="/manifest.json" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Nextdo" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
    <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
    <meta name="theme-color" content="#0f202b" media="(prefers-color-scheme: dark)" />
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="format-detection" content="telephone=no" />
    <style>
      :root {
        --sat: env(safe-area-inset-top);
        --sar: env(safe-area-inset-right);
        --sab: env(safe-area-inset-bottom);
        --sal: env(safe-area-inset-left);
      }
      html, body {
        background-color: #0f202b;
        overscroll-behavior-y: none;
        -webkit-touch-callout: none;
      }
      /* Prevent iOS tap highlight and pull-down reload on standalone */
      * {
        -webkit-tap-highlight-color: transparent;
      }
    </style>
    <script>
      if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
        window.addEventListener('load', function() {
          navigator.serviceWorker.register('/sw.js').then(function(reg) {
            console.log('[Nextdo PWA] Service Worker registered:', reg.scope);
          }).catch(function(err) {
            console.warn('[Nextdo PWA] Service Worker registration failed:', err);
          });
        });
      }
    </script>
  `;

  if (!html.includes('rel="manifest"')) {
    html = html.replace('</head>', `${pwaTags}\n</head>`);
  }

  fs.writeFileSync(indexPath, html, 'utf-8');
  console.log('[post-export-web] Patched dist/index.html with PWA tags successfully.');
} else {
  console.warn('[post-export-web] dist/index.html not found, skipped patching.');
}

// 3. Prune unused wa-sqlite WASM variants.
// `public/@powersync/` vendors the full @powersync/web worker bundle, which
// ships FOUR SQLite wasm builds and picks one at runtime. This app opens
// WASQLiteOpenFactory with `{ dbFilename, worker }` only
// (packages/db/src/powersync.ts), so the SDK keeps its defaults:
// encryptionKey=undefined and vfs=IDBBatchAtomicVFS. That path loads
// `wa-sqlite-async` and nothing else — on every browser, since neither the
// vfs nor the encryption key is feature-dependent. Drop the `mc-` (encryption)
// builds and the sync `wa-sqlite` (OPFS-vfs) build plus their loader chunks:
// ~4.7 MB of dead weight. Order matters — `mc-wa-sqlite-async` also contains
// the `wa-sqlite-async` substring, so exclude `mc-` first.
function pruneUnusedWasm(dir) {
  if (!fs.existsSync(dir)) return;
  const walk = (d) =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
    );
  const isWaSqlite = (base) => /^(mc-)?wa-sqlite/.test(base) && /\.(wasm|js|mjs)$/.test(base);
  const shouldKeep = (base) => !base.startsWith('mc-wa-sqlite') && base.includes('wa-sqlite-async');
  let bytes = 0;
  let count = 0;
  for (const file of walk(dir)) {
    const base = path.basename(file);
    if (!isWaSqlite(base) || shouldKeep(base)) continue;
    try {
      if (!fs.existsSync(file)) continue;
      bytes += fs.statSync(file).size;
      fs.rmSync(file, { force: true });
      count += 1;
    } catch {
      // Ignore if file was already removed
    }
  }
  if (count > 0) {
    console.log(
      `[post-export-web] Pruned ${count} unused wa-sqlite files (${(bytes / 1048576).toFixed(1)} MB); kept wa-sqlite-async.`
    );
  }
}
pruneUnusedWasm(path.join(distDir, '@powersync'));
pruneUnusedWasm(path.join(distDir, '_expo'));

console.log('[post-export-web] Finished PWA post-processing.');
