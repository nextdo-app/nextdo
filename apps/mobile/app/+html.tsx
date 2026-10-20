import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

// Nextdo PWA + iOS Web Root HTML Template
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1.00001, viewport-fit=cover, user-scalable=no"
        />
        <title>Nextdo - 极简下一步清单</title>

        {/* PWA Web Manifest */}
        <link rel="manifest" href="/manifest.json" />

        {/* Apple iOS PWA Meta Tags */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Nextdo" />
        {/* Icon URLs carry ?v= so a changed icon bypasses the browser favicon
            cache; keep in sync with ICON_VERSION in public/sw.js and
            scripts/post-export-web.mjs. */}
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png?v=2" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png?v=2" />

        {/* Browser & OS Theme Color */}
        <meta name="theme-color" content="#171412" media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content="#faf9f6" media="(prefers-color-scheme: light)" />

        {/* Apple Mobile Web App Splash Screen / Touch Styling */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="format-detection" content="telephone=no" />

        <ScrollViewStyleReset />

        {/* Global style reset & safe area handling */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              html, body {
                height: 100%;
                width: 100%;
                margin: 0;
                padding: 0;
                overflow: hidden;
                overscroll-behavior: none;
                background-color: #faf9f6;
              }
              html.dark, html.dark body {
                background-color: #171412;
              }
              #root {
                display: flex;
                height: 100%;
                width: 100%;
                flex: 1;
              }
            `,
          }}
        />

        {/* PWA Service Worker Registration */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof window !== 'undefined' && 'serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').then(function(reg) {
                    // Update check periodically
                    if (reg && reg.update) {
                      setInterval(function() { reg.update(); }, 60 * 60 * 1000);
                    }
                  }).catch(function(err) {
                    console.warn('[PWA] ServiceWorker registration error:', err);
                  });
                });
              }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
