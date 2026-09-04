/**
 * @author lovelyyoshino
 * @date 2026-07-13
 * @version v1.3.0
 * @last_modified 2026-08-21
 * @changelog
 *   - v1.3.0 (2026-08-21): 真实后端闭环改为导入本地 XML
 *   - v1.2.0 (2026-08-18): 覆盖 PrioritySelector 与 TickRate 真实 manifest
 *   - v1.1.0 (2026-07-13): 增加真实 load-clear-import-run 闭环并把截图纳入用例产物
 *   - v1.0.0 (2026-07-13): 覆盖生产预览到真实 bt_server 的完整编辑闭环
 *   - v1.0.1 (2026-07-13): 锁定真实插件的节点分类与默认端口契约
 */
import { expect, test } from '@playwright/test';
import { importTreeFile } from './tree-import-fixture';

test('real backend completes a load-import-run round trip and rejects an undeclared port', async ({
  page,
}, testInfo) => {
  await page.goto('/');

  await expect(page.getByText('后端：')).toContainText('已连接 v0.1.0');
  await expect(page.getByText('节点面板', { exact: true })).toBeVisible();
  // 34 server manifests + editor-native SubTree/SubTreePlus structural entries.
  await expect(page.locator('[draggable="true"]')).toHaveCount(36);

  const manifestResponse = await page.request.get('/api/nodes');
  expect(manifestResponse.ok()).toBe(true);
  const manifests = (await manifestResponse.json()) as Array<{
    registration_name: string;
    type: string;
    ports: Array<{ name: string; default_value: string }>;
  }>;
  expect(manifests).toHaveLength(34);
  expect(
    manifests.find((item) => item.registration_name === 'AlwaysSuccess')?.type,
  ).toBe('Condition');
  expect(
    manifests.find((item) => item.registration_name === 'AlwaysFailure')?.type,
  ).toBe('Condition');
  expect(
    manifests
      .find((item) => item.registration_name === 'PrintMessage')
      ?.ports.find((port) => port.name === 'message')?.default_value,
  ).toBe('hello bt');
  expect(
    manifests.find((item) => item.registration_name === 'PrioritySelector')?.type,
  ).toBe('Control');
  expect(
    manifests
      .find((item) => item.registration_name === 'TickRate')
      ?.ports.find((port) => port.name === 'tier')?.default_value,
  ).toBe('normal');

  await importTreeFile(page);
  await expect(page.getByText('巡逻序列').first()).toBeVisible();

  await page.getByRole('button', { name: '载入到服务器' }).click();
  await expect(page.getByText('载入成功，节点数：8')).toBeVisible();

  await page.getByRole('button', { name: '后端校验' }).click();
  await expect(page.getByText('XML 校验通过，节点数：8')).toBeVisible();

  await page.getByRole('button', { name: '▶ Tick', exact: true }).click();
  await expect(page.getByText('Tick 完成，根状态：SUCCESS')).toBeVisible();
  await expect(
    page.locator('[data-testid="bt-node"][data-status="SUCCESS"]').first(),
  ).toBeVisible();

  await page.getByRole('button', { name: '清空' }).click();
  await expect(page.getByTestId('bt-node')).toHaveCount(0);
  await page.getByRole('button', { name: '从服务器导入' }).click();
  await expect(page.getByText('已从服务器导入 8 个节点')).toBeVisible();
  await expect(page.getByTestId('bt-node')).toHaveCount(8);
  await expect(page.locator('textarea')).toContainText('<Sequence name="巡逻序列">');

  await page.getByRole('button', { name: '▶ Run', exact: true }).click();
  await expect(page.getByText(/Run 完成：SUCCESS/).first()).toBeVisible();
  await expect(
    page.locator('[data-testid="bt-node"][data-status="SUCCESS"]').first(),
  ).toBeVisible();

  const invalid = await page.request.post('/api/tree/validate', {
    data: {
      xml: [
        '<root main_tree_to_execute="MainTree">',
        '  <BehaviorTree ID="MainTree">',
        '    <PrintMessage name="notice" messsage="typo"/>',
        '  </BehaviorTree>',
        '</root>',
      ].join('\n'),
    },
  });
  expect(invalid.status()).toBe(400);
  const body = (await invalid.json()) as { ok: boolean; error: string };
  expect(body.ok).toBe(false);
  expect(body.error).toContain('PrintMessage');
  expect(body.error).toContain('notice');
  expect(body.error).toContain('messsage');
  expect(body.error).toContain('未声明端口');

  await page.screenshot({
    path: testInfo.outputPath('live-backend-final.png'),
    fullPage: true,
  });
});
