import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const views = [
	{ name: 'home', hash: '/' },
	{ name: 'calendar', hash: '/calendar' },
	{ name: 'exercises', hash: '/exercises' },
	{ name: 'progress', hash: '/progress' },
	{ name: 'garmin-wellness', hash: '/garmin' },
	{ name: 'garmin-activities', hash: '/garmin-activities' },
	{ name: 'settings', hash: '/settings' },
]

test.beforeEach(async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' })
})

for (const view of views) {
	test(`capture ${view.name}`, async ({ page }, testInfo) => {
		await page.goto(`?mock=1#${view.hash}`)
		await expect(page.locator('.mock-mode-badge')).toHaveText('Mock review data')
		await expect(page.getByText('Restoring session…')).toHaveCount(0)
		await expect(page.getByText('Loading workout data…')).toHaveCount(0)
		await expect(page.getByText('Something went wrong')).toHaveCount(0)
		await page.addStyleTag({
			content: `
				*, *::before, *::after {
					animation-duration: 0s !important;
					transition-duration: 0s !important;
					caret-color: transparent !important;
				}
			`,
		})

		const screenshotDir = path.resolve('artifacts/screenshots')
		await mkdir(screenshotDir, { recursive: true })
		const screenshotPath = path.join(screenshotDir, `${view.name}.png`)
		await page.screenshot({ path: screenshotPath, fullPage: true })
		await testInfo.attach(view.name, {
			path: screenshotPath,
			contentType: 'image/png',
		})
	})
}
