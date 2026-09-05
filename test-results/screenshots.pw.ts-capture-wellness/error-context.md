# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: screenshots.pw.ts >> capture wellness
- Location: tests/e2e/screenshots.pw.ts:14:2

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.strava-subview')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" locator('.strava-subview') with timeout 5000ms
  - waiting for locator('.strava-subview')

```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test'
  2  | 
  3  | const views = [
  4  | 	{ name: 'workouts', hash: '#/', selector: '.workout-select' },
  5  | 	{ name: 'calendar', hash: '#/calendar', selector: '.calendar-view' },
  6  | 	{ name: 'exercises', hash: '#/exercises', selector: '.exercise-library' },
  7  | 	{ name: 'progress', hash: '#/progress', selector: '.progress-view' },
  8  | 	{ name: 'wellness', hash: '#/garmin', selector: '.strava-subview' },
  9  | 	{ name: 'activities', hash: '#/garmin-activities', selector: '.activity-list-view' },
  10 | 	{ name: 'settings', hash: '#/settings', selector: '.settings-view' },
  11 | ]
  12 | 
  13 | for (const view of views) {
  14 | 	test(`capture ${view.name}`, async ({ page }, testInfo) => {
  15 | 		await page.emulateMedia({ reducedMotion: 'reduce' })
  16 | 		await page.goto(`/stronger/?mock=true${view.hash}`)
> 17 | 		await expect(page.locator(view.selector)).toBeVisible()
     |                                             ^ Error: expect(locator).toBeVisible() failed
  18 | 		await page.screenshot({
  19 | 			path: testInfo.outputPath(`${view.name}.png`),
  20 | 			fullPage: true,
  21 | 		})
  22 | 	})
  23 | }
  24 | 
```