import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const screenshotDir = path.resolve(process.cwd(), '../docs/blog/screenshots');

const manifests = [
  { registration_name: 'Sequence', type: 'Control', ports: [] },
  { registration_name: 'Fallback', type: 'Control', ports: [] },
  { registration_name: 'Inverter', type: 'Decorator', ports: [] },
  {
    registration_name: 'Retry',
    type: 'Decorator',
    ports: [
      {
        name: 'num_attempts',
        direction: 'input',
        type_name: 'int',
        default_value: '2',
        description: '最大尝试次数',
        enum_values: [],
      },
    ],
  },
  { registration_name: 'AlwaysSuccess', type: 'Action', ports: [] },
  { registration_name: 'AlwaysFailure', type: 'Action', ports: [] },
  {
    registration_name: 'PrintMessage',
    type: 'Action',
    ports: [
      {
        name: 'message',
        direction: 'input',
        type_name: 'string',
        default_value: 'hello',
        description: '消息',
        enum_values: [],
      },
    ],
  },
];

test.use({
  viewport: { width: 1200, height: 664 },
  deviceScaleFactor: 2,
});

async function mockBackend(page: Page) {
  await page.route('**/api/health', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, version: '0.1.0-docs' }),
    });
  });

  await page.route('**/api/nodes', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(manifests),
    });
  });

  await page.route('**/api/tree/load', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, node_count: 6 }),
    });
  });

  await page.route('**/api/tree/tick', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'SUCCESS',
        nodes: [
          { id: '1', status: 'SUCCESS' },
          { id: '2', status: 'RUNNING' },
          { id: '3', status: 'FAILURE' },
          { id: '4', status: 'SUCCESS' },
          { id: '5', status: 'FAILURE' },
          { id: '6', status: 'SUCCESS' },
          { id: '7', status: 'RUNNING' },
          { id: '8', status: 'SUCCESS' },
        ],
      }),
    });
  });
}

test('capture documentation screenshots', async ({ page }) => {
  await mkdir(screenshotDir, { recursive: true });
  await mockBackend(page);

  await page.goto('/');
  await expect(page.getByText('BT Editor')).toBeVisible();
  await expect(page.getByText('后端：')).toContainText('已连接 v0.1.0-docs');
  await page.screenshot({
    path: path.join(screenshotDir, '01_editor_loaded.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: '载入示例' }).first().click();
  await expect(page.getByText('巡逻序列').first()).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotDir, '02_sample_tree.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: /Tick/ }).click();
  await expect(page.getByText('Tick 完成，根状态：SUCCESS')).toBeVisible();
  await expect(page.locator('[data-testid="bt-node"][data-status="SUCCESS"]').first()).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotDir, '03_tick_colored.png'),
    fullPage: true,
  });
  await page.screenshot({
    path: path.join(screenshotDir, '04_tick_highlight_fixed.png'),
    fullPage: true,
  });
});
