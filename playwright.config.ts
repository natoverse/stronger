import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
	testDir: './e2e',
	outputDir: './test-results',
	fullyParallel: true,
	retries: process.env.CI ? 1 : 0,
	reporter: [
		['list'],
		['html', { outputFolder: 'playwright-report', open: 'never' }],
	],
	use: {
		baseURL: 'http://127.0.0.1:4173/stronger/',
		colorScheme: 'dark',
		trace: 'retain-on-failure',
		...devices['Desktop Chrome'],
		viewport: { width: 1440, height: 1000 },
	},
	webServer: {
		command: 'npm run dev -- --host 127.0.0.1 --port 4173',
		url: 'http://127.0.0.1:4173/stronger/',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
})
