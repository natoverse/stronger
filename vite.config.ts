import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

function offlineServiceWorker() {
  return {
    name: 'stronger-offline-service-worker',
    apply: 'build' as const,
    generateBundle(_: unknown, bundle: Record<string, unknown>) {
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
  event.respondWith(caches.match(event.request).then(cached => {
    const refresh = fetch(event.request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
      return response;
    });
    if (cached) {
      event.waitUntil(refresh.catch(() => undefined));
      return cached;
    }
    return refresh.catch(() => event.request.mode === 'navigate'
      ? caches.match('/stronger/index.html')
      : Response.error());
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
