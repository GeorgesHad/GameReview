import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const baseURL = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './tests/e2e',
  forbidOnly: Boolean(process.env.CI),
  use: {
    baseURL,
    trace: 'retain-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium-emulation', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run build && npm run start -- --ip 127.0.0.1 --port 4173',
    env: {
      VITE_VIDEO_POC_SUPABASE_URL: 'https://project-fixture.supabase.co',
      VITE_VIDEO_POC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture_only',
    },
    url: `${baseURL}/api/v1/health`,
    timeout: 60_000,
  },
});
