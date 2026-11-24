import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

function offlineServiceWorker(): Plugin {
  return {
    name: 'stronger-offline-service-worker',
    apply: 'build' as const,
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).sort()
      const version = files.join('|').split('').reduce((hash, value) =>
        ((hash << 5) - hash + value.charCodeAt(0)) | 0, 0).toString(36)
      const urls = ['/', '/index.html', ...files.map((file) => `/${file}`)]
        .map((path) => `/stronger${path}`)
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `
const CACHE = ${JSON.stringify(`stronger-shell-${version}`)};
const SHELL = ${JSON.stringify(urls)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('stronger-shell-') && key !== CACHE)
      .map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  const url = new URL(event.request.url);
  event.respondWith(caches.open(CACHE).then(cache =>
    cache.match(url.pathname, { ignoreSearch: true })).then(cached => {
    if (cached && url.pathname.includes('/assets/')) return cached;
    const controller = new AbortController();
    const timeout = event.request.mode === 'navigate'
      ? setTimeout(() => controller.abort(), 3000) : null;
    const refresh = fetch(event.request, { cache: 'no-cache', signal: controller.signal }).then(async response => {
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request.mode === 'navigate' ? url.pathname : event.request, response.clone());
      }
      return response;
    }).finally(() => {
      if (timeout !== null) clearTimeout(timeout);
    });
    if (event.request.mode === 'navigate') {
      return refresh.catch(async () => cached
        || await caches.match('/stronger/index.html')
        || Response.error());
    }
    if (cached) {
      event.waitUntil(refresh.catch(() => undefined));
      return cached;
    }
    return refresh.catch(() => Response.error());
  }));
});`,
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), offlineServiceWorker()],
  base: '/stronger/',
  test: {
    exclude: [...configDefaults.exclude, '**/.worktrees/**', 'e2e/**'],
  },
})
