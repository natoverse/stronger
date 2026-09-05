import { expect, test } from '@playwright/test'

const views = [
	{ name: 'workouts', hash: '#/', selector: '.workout-select' },
	{ name: 'calendar', hash: '#/calendar', selector: '.calendar-view' },
	{ name: 'exercises', hash: '#/exercises', selector: '.exercise-library' },
	{ name: 'progress', hash: '#/progress', selector: '.progress-view' },
	{ name: 'wellness', hash: '#/garmin', selector: '.garmin-wellness-view' },
	{ name: 'activities', hash: '#/garmin-activities', selector: '.garmin-activities-list' },
	{ name: 'settings', hash: '#/settings', selector: '.settings-view' },
]

for (const view of views) {
	test(`capture ${view.name}`, async ({ page }, testInfo) => {
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await page.goto(`/stronger/?mock=true${view.hash}`)
		await expect(page.locator(view.selector)).toBeVisible()
		await page.screenshot({
			path: testInfo.outputPath(`${view.name}.png`),
			fullPage: true,
		})
	})
}
