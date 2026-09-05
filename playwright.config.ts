import { defineConfig } from '@playwright/test'

export default defineConfig({
	testDir: './tests/e2e',
	testMatch: '**/*.pw.ts',
	outputDir: 'test-results',
	fullyParallel: true,
	retries: process.env.CI ? 2 : 0,
	reporter: 'list',
	use: {
		baseURL: 'http://127.0.0.1:4173',
		screenshot: 'only-on-failure',
		trace: 'retain-on-failure',
		viewport: { width: 390, height: 844 },
	},
	webServer: {
		command: 'npm run build && npm run preview -- --host 127.0.0.1',
		url: 'http://127.0.0.1:4173/stronger/',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
})
