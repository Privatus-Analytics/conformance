import { defineConfig } from '@playwright/test'

// BASE_URL is the example app, MOCK_URL the mock collector, both as the browser
// reaches them. The hostnames must not be localhost or 127.x: the real tracker
// sends nothing from those.
const BASE_URL = process.env.BASE_URL || 'http://example-app:8080'

export default defineConfig({
  testDir: './tests',
  // One page at a time: every test shares the mock collector's list of hits.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  globalSetup: './tests/global-setup.ts',
  outputDir: './reports/artifacts',
  reporter: [
    ['list'],
    ['junit', { outputFile: './reports/junit.xml' }],
    ['html', { outputFolder: './reports/html', open: 'never' }]
  ],
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    // Leaves navigator.webdriver false, like a person's browser. The real
    // tracker drops hits from automated browsers (see tests/support.ts).
    launchOptions: { args: ['--disable-blink-features=AutomationControlled'] },
    trace: 'retain-on-failure'
  }
})
