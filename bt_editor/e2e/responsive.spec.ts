/**
 * responsive.spec.ts — 窄屏可达性、触控添加与画布遮挡回归
 *
 * @author pony
 * @date 2026-07-13
 * @version v1.2.0
 * @last_modified 2026-08-21
 * @changelog
 *   - v1.2.0 (2026-08-21): 窄屏与桌面流程改为真实树文件导入
 *   - v1.1.0 (2026-08-18): 覆盖窄屏黑板面板、初值摘要与横向溢出
 *   - v1.0.1 (2026-07-13): 使用真实 tap 并验证窄屏属性/XML 面板可达
 *   - v1.0.0 (2026-07-13): 初始覆盖平板与手机纵向视口
 */
import { expect, type Page, test } from '@playwright/test';
import { importTreeFile } from './tree-import-fixture';

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
        default_value: '1',
        description: '最大尝试次数',
        enum_values: [],
      },
    ],
  },
  { registration_name: 'AlwaysSuccess', type: 'Condition', ports: [] },
  { registration_name: 'AlwaysFailure', type: 'Condition', ports: [] },
  {
    registration_name: 'PrintMessage',
    type: 'Action',
    ports: [
      {
        name: 'message',
        direction: 'input',
        type_name: 'string',
        default_value: 'hello bt',
        description: '消息',
        enum_values: [],
      },
    ],
  },
];

const canvasOverlaySelectors = [
  '.react-flow__minimap',
  '.bt-canvas-legend',
  '.react-flow__controls',
] as const;

async function countNodeOverlayIntersections(page: Page): Promise<number> {
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[data-testid="bt-node"]')];
    const overlays = [
      document.querySelector('.react-flow__minimap'),
      document.querySelector('.bt-canvas-legend'),
      document.querySelector('.react-flow__controls'),
    ].filter(
      (element): element is Element =>
        Boolean(element) && getComputedStyle(element!).display !== 'none',
    );
    const intersects = (left: DOMRect, right: DOMRect) =>
      left.left < right.right &&
      left.right > right.left &&
      left.top < right.bottom &&
      left.bottom > right.top;
    return overlays.reduce(
      (count, overlay) =>
        count + nodes.filter((node) => intersects(
          node.getBoundingClientRect(),
          overlay.getBoundingClientRect(),
        )).length,
      0,
    );
  });
}

async function mockBackend(page: Page) {
  await page.route('**/api/health', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, version: '0.1.0-responsive' }),
    });
  });
  await page.route('**/api/nodes', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(manifests),
    });
  });
  await page.route('**/api/v1/bt/capabilities', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ available: false, capabilities: null }),
    });
  });
}

test.describe('desktop workstation', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('keeps React Flow overlays clear of the imported tree', async ({ page }) => {
    await mockBackend(page);
    await page.goto('/');
    await importTreeFile(page);
    await expect(page.getByText('巡逻序列').first()).toBeVisible();

    const geometry = await page.evaluate(() => {
      const root = document.documentElement;
      const canvas = document.querySelector('[data-testid="bt-canvas"]');
      return {
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        canvasWidth: canvas?.getBoundingClientRect().width ?? 0,
      };
    });

    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.canvasWidth).toBeGreaterThan(700);
    // fitView 有 CSS 过渡；等真实几何稳定后再判断，避免采到动画中间帧。
    await expect.poll(() => countNodeOverlayIntersections(page)).toBe(0);
  });
});

for (const viewport of [
  { label: 'tablet portrait', width: 768, height: 1024 },
  { label: 'mobile portrait', width: 390, height: 844 },
]) {
  test.describe(viewport.label, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: true,
      isMobile: true,
    });

    test('keeps every editor surface reachable without horizontal overflow or node overlays', async ({
      page,
    }) => {
      const runtimeErrors: string[] = [];
      page.on('pageerror', (error) => runtimeErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') runtimeErrors.push(message.text());
      });
      await mockBackend(page);

      await page.goto('/');
      await expect(page.getByText('后端：')).toContainText('已连接 v0.1.0-responsive');

      const initialGeometry = await page.evaluate(() => {
        const root = document.documentElement;
        const canvas = document.querySelector('[data-testid="bt-canvas"]');
        const canvasRect = canvas?.getBoundingClientRect();
        const buttons = [...document.querySelectorAll('header button')].map((button) => {
          const rect = button.getBoundingClientRect();
          return { left: rect.left, right: rect.right, width: rect.width };
        });
        return {
          clientWidth: root.clientWidth,
          scrollWidth: root.scrollWidth,
          canvasWidth: canvasRect?.width ?? 0,
          toolbarInsideViewport: buttons.every(
            (rect) => rect.width > 0 && rect.left >= 0 && rect.right <= root.clientWidth,
          ),
        };
      });
      expect(initialGeometry.scrollWidth).toBeLessThanOrEqual(initialGeometry.clientWidth);
      expect(initialGeometry.canvasWidth).toBeGreaterThan(viewport.width * 0.9);
      expect(initialGeometry.toolbarInsideViewport).toBe(true);
      await importTreeFile(page);
      await expect(page.getByText('巡逻序列').first()).toBeVisible();

      for (const selector of canvasOverlaySelectors) {
        await expect(page.locator(selector)).toBeHidden();
      }

      await expect.poll(() => countNodeOverlayIntersections(page)).toBe(0);
      expect(runtimeErrors).toEqual([]);
    });

    test('uses touch to add a node and reach property and XML editing', async ({ page }, testInfo) => {
      await mockBackend(page);
      await page.goto('/');

      const paletteEntry = page.getByRole('button', { name: '添加 PrintMessage 节点' });
      await paletteEntry.scrollIntoViewIfNeeded();
      await expect(paletteEntry).toBeInViewport();
      await paletteEntry.tap();

      const node = page.locator(
        '[data-testid="bt-node"][data-registration="PrintMessage"]',
      );
      await expect(node).toBeVisible();
      await node.tap();

      const instanceName = page.getByLabel('实例名');
      await instanceName.scrollIntoViewIfNeeded();
      await expect(instanceName).toBeInViewport();
      await instanceName.fill('touch_notice');

      const xml = page.locator('textarea');
      await xml.scrollIntoViewIfNeeded();
      await expect(xml).toBeInViewport();
      await expect(xml).toContainText(
        '<PrintMessage name="touch_notice" message="hello bt"/>',
      );

      await page.getByRole('button', { name: '黑板参数' }).tap();
      await page.getByRole('button', { name: '新增黑板参数' }).tap();
      const blackboardKey = page.getByLabel('黑板键名 1');
      await blackboardKey.scrollIntoViewIfNeeded();
      await expect(blackboardKey).toBeInViewport();
      await blackboardKey.fill('touch_value');
      await expect(page.getByText('1 个参数')).toBeVisible();
      await expect(page.getByLabel('黑板初值摘要')).toContainText('touch_value =  (string)');

      const horizontalGeometry = await page.evaluate(() => {
        const root = document.documentElement;
        const selectors = [
          '.bt-editor-app',
          '.bt-blackboard-panel',
          '.bt-blackboard-table-wrap',
          '.bt-blackboard-table',
          '.bt-xml-preview',
          '.bt-xml-blackboard-strip',
        ];
        return {
          clientWidth: root.clientWidth,
          scrollWidth: root.scrollWidth,
          surfaces: selectors.map((selector) => {
            const element = document.querySelector<HTMLElement>(selector);
            const rect = element?.getBoundingClientRect();
            return {
              selector,
              clientWidth: element?.clientWidth ?? 0,
              scrollWidth: element?.scrollWidth ?? 0,
              left: rect?.left ?? 0,
              right: rect?.right ?? 0,
              overflowX: element ? getComputedStyle(element).overflowX : '',
            };
          }),
        };
      });
      expect(
        horizontalGeometry.scrollWidth,
        JSON.stringify(horizontalGeometry, null, 2),
      ).toBeLessThanOrEqual(horizontalGeometry.clientWidth);
      await page.screenshot({
        path: testInfo.outputPath(`blackboard-responsive-${viewport.label.replace(' ', '-')}.png`),
        fullPage: true,
      });
    });
  });
}
