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

test('copy default cycles as independent single-workout weeks', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto('?mock=1#/')
	const library = page.locator('.default-program-library')
	await expect(library).not.toHaveAttribute('open')
	await library.locator('summary').click()
	await library.getByRole('button', { name: 'Copy 5/3/1 — Bench Press to my library', exact: true }).click()
	await expect(page.getByLabel('Workout Name', { exact: true })).toHaveValue('5/3/1 — Bench Press')
	await expect(page.locator('.editor-id-input')).toHaveCount(0)
	await expect(page.getByLabel('Week to edit or preview').locator('option')).toHaveCount(4)
	await expect(page.getByRole('button', { name: /Add session|Duplicate session/ })).toHaveCount(0)
	await expect(page.locator('.editor-set-row')).toHaveCount(6)
	await page.getByRole('button', { name: 'Preview week', exact: true }).click()
	await expect(page.locator('.cycle-preview-sets li')).toHaveCount(6)
	await expect(page.locator('.cycle-preview-sets')).toContainText('5+ (AMRAP)')
	await page.getByLabel('Week to edit or preview').selectOption('week-4')
	await expect(page.locator('.cycle-preview-sets')).not.toContainText('AMRAP')
	await page.getByLabel('Week name', { exact: true }).fill('My recovery week')
	await page.getByRole('button', { name: 'Save', exact: true }).click()
	await page.getByRole('button', { name: 'More…', exact: true }).click()
	await expect(page.getByRole('button', { name: 'Actions for 5/3/1 — Bench Press', exact: true })).toBeVisible()
	await page.locator('.default-program-library summary').click()
	await page.getByRole('button', { name: 'Copy 5/3/1 — Bench Press to my library', exact: true }).click()
	await expect(page.getByLabel('Workout Name', { exact: true })).toHaveValue('5/3/1 — Bench Press copy')
	await expect(page.locator('.editor-id-input')).toHaveCount(0)
	await page.getByLabel('Week to edit or preview').selectOption('week-4')
	await expect(page.getByLabel('Week name', { exact: true })).toHaveValue('Deload')
	await page.getByRole('button', { name: 'Cancel', exact: true }).click()
	await page.getByRole('button', { name: 'More…', exact: true }).click()
	await expect(page.getByRole('button', { name: 'Actions for 5/3/1 — Bench Press copy', exact: true })).toHaveCount(0)
})

test('copy an assistance exercise to all weeks without linking subsequent edits', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto('?mock=1#/')
	await page.locator('.default-program-library summary').click()
	await page.getByRole('button', { name: 'Copy 5/3/1 — Bench Press to my library', exact: true }).click()
	await page.getByLabel('Week to edit or preview').selectOption('week-4')
	await page.getByRole('button', { name: 'Add Exercise', exact: true }).click()
	const assistance = page.locator('.editor-exercise').nth(1)
	await assistance.getByRole('combobox', { name: 'Lift', exact: true }).selectOption('bench-press')
	await assistance.getByLabel('Minimum reps for set 1', { exact: true }).fill('8')
	await assistance.getByLabel('Maximum reps for set 1', { exact: true }).fill('12')
	await assistance.getByRole('button', { name: 'Copy to all weeks', exact: true }).click()
	await assistance.getByRole('button', { name: 'Copy to all weeks', exact: true }).click()
	for (const week of ['week-1', 'week-2', 'week-3', 'week-4']) {
		await page.getByLabel('Week to edit or preview').selectOption(week)
		await expect(page.locator('.editor-exercise')).toHaveCount(2)
		await expect(page.locator('.editor-exercise').first().locator('.editor-set-row')).toHaveCount(6)
		await expect(assistance.getByRole('combobox', { name: 'Role', exact: true })).toHaveValue('assistance')
		await expect(assistance.getByLabel('Minimum reps for set 1', { exact: true })).toHaveValue('8')
		await expect(assistance.getByLabel('Maximum reps for set 1', { exact: true })).toHaveValue('12')
	}
	await assistance.getByLabel('Maximum reps for set 1', { exact: true }).fill('15')
	await page.getByLabel('Week to edit or preview').selectOption('week-1')
	await expect(assistance.getByLabel('Maximum reps for set 1', { exact: true })).toHaveValue('12')
	await page.getByRole('button', { name: 'Save', exact: true }).click()
	await page.getByRole('button', { name: 'More…', exact: true }).click()
	await page.getByRole('button', { name: 'Actions for 5/3/1 — Bench Press', exact: true }).click()
	await page.getByRole('button', { name: 'Edit', exact: true }).click()
	await expect(assistance.getByLabel('Maximum reps for set 1', { exact: true })).toHaveValue('12')
	await page.getByLabel('Week to edit or preview').selectOption('week-4')
	await expect(assistance.getByLabel('Maximum reps for set 1', { exact: true })).toHaveValue('15')
})

test('create same-named workouts with hidden random IDs and preserve identity when editing', async ({ page }) => {
	await page.goto('?mock=1#/')
	const ids: string[] = []
	for (const name of ['Repeated assistance', 'Repeated assistance']) {
		await page.getByRole('button', { name: 'New Workout', exact: true }).click()
		await expect(page.locator('.editor-id-input')).toHaveCount(0)
		await page.getByLabel('Workout Name', { exact: true }).fill(name)
		await page.getByRole('button', { name: 'Add Exercise', exact: true }).click()
		await expect(page.getByRole('button', { name: 'Copy to all weeks', exact: true })).toBeDisabled()
		await page.getByRole('button', { name: 'Save', exact: true }).click()
		await page.getByRole('button', { name: 'More…', exact: true }).click()
		await page.getByRole('button', { name: `Actions for ${name}`, exact: true }).last().click()
		await page.getByRole('button', { name: 'Edit', exact: true }).click()
		const id = new URL(page.url()).hash.replace('#/edit/', '')
		expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
		ids.push(id)
		await page.getByRole('button', { name: 'Cancel', exact: true }).click()
	}
	expect(ids[0]).not.toBe(ids[1])
	await page.getByRole('button', { name: 'More…', exact: true }).click()
	await expect(page.getByRole('button', { name: 'Actions for Repeated assistance', exact: true })).toHaveCount(2)
	await page.getByRole('button', { name: 'Actions for Repeated assistance', exact: true }).last().click()
	await page.getByRole('button', { name: 'Edit', exact: true }).click()
	await page.getByLabel('Workout Name', { exact: true }).fill('Renamed assistance')
	await page.getByRole('button', { name: 'Save', exact: true }).click()
	await page.getByRole('button', { name: 'More…', exact: true }).click()
	await page.getByRole('button', { name: 'Actions for Renamed assistance', exact: true }).click()
	await page.getByRole('button', { name: 'Edit', exact: true }).click()
	expect(new URL(page.url()).hash).toBe(`#/edit/${ids[1]}`)
	await expect(page.locator('.editor-id-input')).toHaveCount(0)
})

test('set starting TM to 90% of 1RM once and preview default work sets', async ({ page }) => {
	await page.goto('?mock=1#/exercise/bench-press')
	await expect(page.getByRole('heading', { name: 'Edit Bench Press', exact: true })).toBeVisible()
	const topSet = await page.getByLabel('Top Set Weight (lbs)', { exact: true }).inputValue()
	await page.locator('.tm-calculator summary').click()
	await expect(page.getByRole('button', { name: 'Use 90% as TM' })).toBeDisabled()
	await page.getByLabel('One-rep max (lbs)', { exact: true }).fill('200')
	await page.getByRole('button', { name: 'Use 90% as TM' }).click()
	await expect(page.getByLabel('Training Max (TM, lbs) — optional', { exact: true })).toHaveValue('180')
	await page.getByRole('button', { name: 'Use 90% as TM' }).click()
	await expect(page.getByLabel('Training Max (TM, lbs) — optional', { exact: true })).toHaveValue('180')
	await expect(page.getByLabel('Top Set Weight (lbs)', { exact: true })).toHaveValue(topSet)
	await page.getByRole('button', { name: 'Save', exact: true }).click()
	await page.getByRole('button', { name: 'Workouts', exact: true }).click()
	await page.locator('.default-program-library summary').click()
	await page.getByRole('button', { name: 'Copy 5/3/1 — Bench Press to my library', exact: true }).click()
	await page.getByRole('button', { name: 'Preview week', exact: true }).click()
	const weights = page.locator('.cycle-preview-sets strong')
	await expect(weights).toHaveText(['95 lbs', '95 lbs', '110 lbs', '115 lbs', '135 lbs', '155 lbs'])
})

for (const view of views) {
	test(`capture ${view.name}`, async ({ page }, testInfo) => {
		await page.goto(`?mock=1#${view.hash}`)
		await expect(page.locator('.mock-mode-badge')).toHaveText('Mock review data')
		await expect(page.getByText('Restoring session…')).toHaveCount(0)
		await expect(page.getByText('Loading workout data…')).toHaveCount(0)
		await expect(page.getByText('Something went wrong')).toHaveCount(0)
		if (view.name === 'garmin-wellness') {
			const sleepChart = page.locator('svg[aria-label="Sleep Schedule"]')
			await expect(sleepChart.getByText('9:00 PM', { exact: true })).toBeVisible()
			await expect(sleepChart.getByText('10:00 AM', { exact: true })).toBeVisible()
			await expect(sleepChart.locator('rect[fill^="url("]').first()).toBeVisible()
			await expect(sleepChart.locator('line.strava-goal-line')).toHaveCount(2)
		}
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
