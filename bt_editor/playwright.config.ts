/**
 * @author lovelyyoshino
 * @date 2026-06-30
 * @version v1.1.0
 * @last_modified 2026-07-13
 * @changelog
 *   - v1.1.0 (2026-07-13): 增加 opt-in 真实 bt_server 浏览器项目
 */
import { defineConfig, devices } from '@playwright/test';

const updateScreenshots = process.env.BT_UPDATE_SCREENSHOTS === '1';
const liveBackend = process.env.BT_E2E_LIVE === '1';

export default defineConfig({
  testDir: './e2e',
  testIgnore: updateScreenshots
    ? ['**/live-backend.spec.ts']
    : liveBackend
      ? ['**/editor.spec.ts', '**/docs-screenshots.spec.ts']
      : ['**/docs-screenshots.spec.ts', '**/live-backend.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    ...(liveBackend
      ? [
          {
            command: 'bash e2e/start-live-backend.sh',
            url: 'http://127.0.0.1:18080/api/health',
            reuseExistingServer: false,
          },
        ]
      : []),
    {
      command: 'npm run preview -- --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI && !liveBackend,
    },
  ],
});
