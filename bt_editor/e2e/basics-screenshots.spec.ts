/**
 * basics-screenshots.spec.ts — 行为树基础文档页配图（可复现）
 *
 * 与 docs-screenshots.spec.ts 的分工：
 *   - docs-screenshots：编辑器通用工作区四态（01-04）。
 *   - 本 spec：docs/behavior_tree_basics.rst 需要的"四种基本节点类型"配图，
 *     用一棵同时含 Sequence / Fallback / Parallel / Decorator 的树，让概念页
 *     的文字描述有对应的真实界面证据。
 *
 * 为什么必须 mocked：文档配图要稳定，不能受本机端口、进程和真实 manifest
 * 波动影响。真实后端闭环由 live-backend.spec.ts 单独验证。
 *
 * @author pony
 * @date 2026-09-03
 * @version v1.0.0
 * @last_modified 2026-09-03
 * @changelog
 *   - v1.0.0 (2026-09-03): 初始创建，产出 15-17 三张基础概念配图
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { importTreeFile } from './tree-import-fixture';

const screenshotDir = path.resolve(
  process.cwd(),
  process.env.BT_SCREENSHOT_DIR ?? '../docs/blog/screenshots',
);

/**
 * 覆盖四种基本节点类型的演示树。
 * 刻意让每一类各出现一次，方便概念页逐一指认：
 *   Sequence（控制/与）、Fallback（控制/或）、Parallel（控制/阈值）、
 *   Inverter + Retry（装饰）、AlwaysSuccess/AlwaysFailure（条件）、
 *   PrintMessage（动作）。
 */
const BASICS_TREE_XML = `<root main_tree_to_execute="MainTree">
  <BehaviorTree ID="MainTree">
    <Sequence name="导航主流程">
      <AlwaysSuccess name="电量检查"/>
      <Fallback name="到达或恢复">
        <Retry num_attempts="3">
          <PrintMessage name="计算并执行路径" message="following path"/>
        </Retry>
        <PrintMessage name="恢复行为" message="clear costmap"/>
      </Fallback>
      <Parallel name="行进中并行监控" success_count="2" failure_count="1">
        <PrintMessage name="上报位置" message="pose reported"/>
        <Inverter name="无障碍物">
          <AlwaysFailure name="障碍物检测"/>
        </Inverter>
        <PrintMessage name="心跳" message="heartbeat"/>
      </Parallel>
    </Sequence>
  </BehaviorTree>
</root>`;

/** 概念页配图需要的 manifest，必须含 Parallel，否则四类节点凑不齐。 */
const manifests = [
  { registration_name: 'Sequence', type: 'Control', ports: [] },
  { registration_name: 'Fallback', type: 'Control', ports: [] },
  {
    registration_name: 'Parallel',
    type: 'Control',
    ports: [
      {
        name: 'success_count',
        direction: 'input',
        type_name: 'int',
        default_value: '-1',
        description: '需要成功的子节点数；-1 表示全部',
        enum_values: [],
      },
      {
        name: 'failure_count',
        direction: 'input',
        type_name: 'int',
        default_value: '1',
        description: '判定整体失败所需的失败子节点数',
        enum_values: [],
      },
    ],
    documentation: {
      summary: '逻辑上同时推进所有子节点，按阈值判定整体结果。',
      usage: 'success_count 设为需要成功的子节点数；-1 表示全部成功。',
      status_semantics:
        '成功数达阈值 SUCCESS；失败数达阈值或已不可能凑齐成功阈值 FAILURE；否则 RUNNING。',
      failure_conditions:
        '单线程逻辑并行，不是多线程；成功与失败阈值同时满足时成功优先。',
      example_xml:
        '<Parallel success_count="2" failure_count="1"><AlwaysSuccess/></Parallel>',
    },
  },
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
        description: '最大尝试次数（含首次）；-1 表示无限重试',
        enum_values: [],
      },
    ],
    documentation: {
      summary: '子节点失败时最多重试 N 次，任一次成功即成功。',
      usage: '把耗时且可能失败的动作包起来，num_attempts 设为最大尝试次数。',
      status_semantics:
        '子节点 SUCCESS 即 SUCCESS；失败且未耗尽次数时返回 RUNNING 下一拍重试。',
      failure_conditions: 'RUNNING 不消耗次数；num_attempts=0 仍执行一次。',
      example_xml: '<Retry num_attempts="3"><AlwaysFailure/></Retry>',
    },
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
        description: '要输出的文本',
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
      body: JSON.stringify({ ok: true, node_count: 11 }),
    });
  });

  // tick 结果刻意混合四种状态，让概念页的"运行态上色"有真实对照：
  // Sequence 成功、Parallel 运行中、被 Inverter 反转的条件失败。
  await page.route('**/api/tree/tick', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'RUNNING',
        nodes: [
          { id: '1', status: 'RUNNING' },
          { id: '2', status: 'SUCCESS' },
          { id: '3', status: 'SUCCESS' },
          { id: '4', status: 'SUCCESS' },
          { id: '5', status: 'SUCCESS' },
          { id: '6', status: 'IDLE' },
          { id: '7', status: 'RUNNING' },
          { id: '8', status: 'SUCCESS' },
          { id: '9', status: 'FAILURE' },
          { id: '10', status: 'FAILURE' },
          { id: '11', status: 'SUCCESS' },
        ],
      }),
    });
  });
}

test('capture behavior tree basics screenshots', async ({ page }) => {
  await mkdir(screenshotDir, { recursive: true });
  await mockBackend(page);

  await page.goto('/');
  await expect(page.getByText('BT Editor')).toBeVisible();
  await expect(page.getByText('后端：')).toContainText('已连接 v0.1.0-docs');

  // ① 节点面板按四类分组：概念页"节点分两大类"的界面证据。
  // 面板分组标题渲染为 "Control（3）" 形式，用前缀匹配避免耦合具体计数。
  await expect(page.getByText(/^Control（\d+）$/)).toBeVisible();
  await expect(page.getByText(/^Decorator（\d+）$/)).toBeVisible();
  await expect(page.getByText(/^Action（\d+）$/)).toBeVisible();
  await expect(page.getByText(/^Condition（\d+）$/)).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotDir, '15_basics_node_categories.png'),
    clip: { x: 0, y: 0, width: 320, height: 664 },
  });

  // ② 四种基本节点组成的完整树结构。
  await importTreeFile(page, BASICS_TREE_XML, 'basics.xml');
  await expect(page.getByText('导航主流程').first()).toBeVisible();
  await expect(
    page.locator('[data-testid="bt-node"][data-registration="Parallel"]').first(),
  ).toBeVisible();
  await expect(page.locator('.react-flow__minimap')).toBeHidden();
  await page.screenshot({
    path: path.join(screenshotDir, '16_basics_four_node_types.png'),
    fullPage: true,
  });

  // ③ Tick 后运行态上色：SUCCESS 绿 / RUNNING 黄 / FAILURE 红 / IDLE 灰。
  await page.getByRole('button', { name: '▶ Tick', exact: true }).click();
  await expect(
    page.locator('[data-testid="bt-node"][data-status="RUNNING"]').first(),
  ).toBeVisible();
  await expect(
    page.locator('[data-testid="bt-node"][data-status="FAILURE"]').first(),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(screenshotDir, '17_basics_tick_status.png'),
    fullPage: true,
  });
});
