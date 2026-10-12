import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.js',
  fullyParallel: true,
  workers: 2,
  use: { baseURL: 'http://127.0.0.1:4318', viewport: { width: 1440, height: 960 }, headless: true,
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {},
  },
  webServer: { command: 'node server.js', url: 'http://127.0.0.1:4318', env: { PORT: '4318' }, reuseExistingServer: false },
});
