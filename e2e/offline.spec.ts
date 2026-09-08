import { expect, test } from '@playwright/test'

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
