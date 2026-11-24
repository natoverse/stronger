import { expect, test } from '@playwright/test'

test('uses the current online page instead of a stale cached shell on reload', async ({ context, page }) => {
	await page.goto('?mock=1#/')
	await expect(page.locator('.mock-mode-badge')).toHaveText('Mock review data')
	await page.evaluate(() => navigator.serviceWorker.ready)
	await page.reload()
	await expect(page.locator('.mock-mode-badge')).toHaveText('Mock review data')
	await page.evaluate(async () => {
		const key = (await caches.keys()).find((key) => key.startsWith('stronger-shell-'))
		if (!key) throw new Error('Missing shell cache')
		const cache = await caches.open(key)
		const stalePage = new Response('<!doctype html><html><body>Old blocked-date UI</body></html>', {
			headers: { 'Content-Type': 'text/html' },
		})
		for (const request of await cache.keys()) {
			if (!new URL(request.url).pathname.includes('/assets/')) {
				await cache.put(request, stalePage.clone())
			}
		}
	})
	await page.reload()
	await expect(page.locator('.mock-mode-badge')).toHaveText('Mock review data')
	await context.setOffline(true)
	await page.reload()
	await expect(page.locator('.mock-mode-badge')).toHaveText('Mock review data')
})

test('reloads the cached application shell while offline', async ({ context, page }) => {
	await page.goto('?mock=1#/')
	await expect(page.locator('.mock-mode-badge')).toHaveText('Mock review data')
	await page.evaluate(() => navigator.serviceWorker.ready)

	await page.reload()
	await expect(page.locator('.mock-mode-badge')).toHaveText('Mock review data')
	await context.setOffline(true)
	await page.reload()

	await expect(page.locator('.mock-mode-badge')).toHaveText('Mock review data')
	await expect(page.getByText('Something went wrong')).toHaveCount(0)
})
