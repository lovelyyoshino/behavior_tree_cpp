/**
 * @author lovelyyoshino
 * @date 2026-06-30
 * @version v1.11.0
 * @last_modified 2026-08-21
 * @changelog
 *   - v1.11.0 (2026-08-21): 覆盖旧黑板草稿迁移和 ROS2 bridge 自动重连
 *   - v1.10.0 (2026-08-21): 覆盖文件导入、XML 黑板单一来源和自动 ROS2 图连接
 *   - v1.9.0 (2026-08-19): 覆盖 ROS graph 动态候选和通用 service 节点
 *   - v1.8.0 (2026-08-18): 覆盖自定义 Yuyi 类节点和动态 XML 属性
 *   - v1.8.1 (2026-08-24): 覆盖自定义 Yuyi 节点的 typed 输入/输出端口契约
 *   - v1.7.0 (2026-08-18): 覆盖 XML 黑板绑定与 XML/配置包下载
 *   - v1.7.0 (2026-08-21): 覆盖本地树+黑板导入和自动 ROS2 图连接
 *   - v1.5.0 (2026-08-18): 覆盖黑板参数刷新持久化和 XML 侧初值摘要
 *   - v1.4.0 (2026-08-18): 覆盖 Run 自动同步画布与后端错误详情
 *   - v1.3.0 (2026-08-18): 覆盖调度节点拖放、移动、连线与分级端口编辑
 *   - v1.2.0 (2026-07-13): 覆盖离线恢复、节点面板重试和编辑生命周期
 *   - v1.1.0 (2026-07-13): 对齐真实 manifest 类型并覆盖后端错误提示
 */
import { expect, type Locator, type Page, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { importTreeFile, SAMPLE_TREE_XML } from './tree-import-fixture';

const manifests = [
  { registration_name: 'Sequence', type: 'Control', ports: [] },
  { registration_name: 'Fallback', type: 'Control', ports: [] },
  { registration_name: 'PrioritySelector', type: 'Control', ports: [] },
  { registration_name: 'Inverter', type: 'Decorator', ports: [] },
  {
    registration_name: 'KeepRunningUntilFailure',
    type: 'Decorator',
    ports: [],
  },
  {
    registration_name: 'TickRate',
    type: 'Decorator',
    ports: [
      {
        name: 'tier',
        direction: 'input',
        type_name: 'string',
        default_value: 'normal',
        description: 'tick 分级',
        enum_values: ['critical', 'normal', 'background'],
      },
      {
        name: 'every_n_ticks',
        direction: 'input',
        type_name: 'int',
        default_value: '0',
        description: '自定义周期',
        enum_values: [],
      },
    ],
  },
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
  { registration_name: 'AlwaysSuccess', type: 'Action', ports: [] },
  { registration_name: 'AlwaysFailure', type: 'Action', ports: [] },
  {
    registration_name: 'BlackboardGate',
    type: 'Condition',
    ports: [
      { name: 'key', direction: 'input', type_name: 'string', default_value: '', description: '黑板键', enum_values: [] },
      { name: 'expected', direction: 'input', type_name: 'string', default_value: '', description: '期望值（可选）', enum_values: [] },
    ],
  },
  {
    registration_name: 'TimeCondition',
    type: 'Condition',
    ports: [
      { name: 'mode', direction: 'input', type_name: 'string', default_value: 'interval', description: '模式', enum_values: [] },
      { name: 'interval_sec', direction: 'input', type_name: 'double', default_value: '1800', description: '间隔秒数', enum_values: [] },
    ],
  },
  {
    registration_name: 'SubTreePlus',
    type: 'Action',
    ports: [
      { name: 'ID', direction: 'input', type_name: 'string', default_value: '', description: '子树名', enum_values: [] },
    ],
  },
  {
    registration_name: 'NonBlockingDelay',
    type: 'Action',
    ports: [
      { name: 'msec', direction: 'input', type_name: 'int', default_value: '1000', description: '延时毫秒', enum_values: [] },
    ],
  },
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
    documentation: {
      summary: '向日志输出一条文本通知。',
      usage: '把 message 设为固定值，或切换为读取黑板后绑定 {event_text}。',
      status_semantics: '写入日志后立即返回 SUCCESS。',
      failure_conditions: '输出通道不可用时返回 FAILURE。',
      example_xml: '<PrintMessage name="notice" message="{event_text}"/>',
    },
  },
  {
    registration_name: 'ReadScalar',
    type: 'Action',
    ports: [
      {
        name: 'topic',
        direction: 'input',
        type_name: 'string',
        default_value: '/telemetry/value',
        description: 'std_msgs/msg/Float64 topic',
        editor_hint: 'ros_topic',
        enum_values: [],
      },
      {
        name: 'timeout_ms',
        direction: 'input',
        type_name: 'int',
        default_value: '1000',
        description: '数据新鲜度窗口',
        enum_values: [],
      },
      {
        name: 'value',
        direction: 'output',
        type_name: 'double',
        default_value: '',
        description: '写入黑板的标量值',
        enum_values: [],
      },
    ],
    documentation: {
      summary: '订阅运行时 ROS2 Float64 topic，把 data 写入行为树黑板。',
      usage: 'topic 可从 ROS2 能力快照选择；value 用 {temperature} 绑定下游读取键。',
      status_semantics: '收到新鲜消息并写入黑板后返回 SUCCESS；等待消息时返回 RUNNING。',
      failure_conditions: 'topic 无效或消息持续过期时不会重复写入旧值。',
      example_xml: '<ReadScalar topic="/telemetry/value" timeout_ms="1000" value="{temperature}"/>',
    },
  },
  {
    registration_name: 'RosGraphCondition',
    type: 'Condition',
    ports: [
      {
        name: 'entity_type',
        direction: 'input',
        type_name: 'string',
        default_value: 'node',
        description: 'ROS graph 资源类型',
        enum_values: ['node', 'topic', 'service', 'action'],
      },
      {
        name: 'entity_name',
        direction: 'input',
        type_name: 'string',
        default_value: '',
        description: '完整 ROS 名称',
        editor_hint: 'ros_graph_entity',
        enum_values: [],
      },
    ],
    documentation: {
      summary: '检查 ROS graph 资源是否存在。',
      usage: '选择资源类型和运行时发现的名称；不存在判断用 Inverter。',
      status_semantics: '资源存在返回 SUCCESS，否则返回 FAILURE。',
      failure_conditions: 'DDS 发现延迟不等于业务故障。',
      example_xml: '<RosGraphCondition entity_type="node" entity_name="/planner"/>',
    },
  },
  {
    registration_name: 'CallTriggerService',
    type: 'Action',
    ports: [
      {
        name: 'service_name',
        direction: 'input',
        type_name: 'string',
        default_value: '',
        description: 'Trigger service',
        editor_hint: 'ros_service',
        enum_values: [],
      },
      {
        name: 'timeout_sec',
        direction: 'input',
        type_name: 'double',
        default_value: '2.0',
        description: '超时',
        enum_values: [],
      },
      {
        name: 'message',
        direction: 'output',
        type_name: 'string',
        default_value: '',
        description: '响应消息',
        enum_values: [],
      },
    ],
  },
  {
    registration_name: 'CallSetBoolService',
    type: 'Action',
    ports: [
      {
        name: 'service_name',
        direction: 'input',
        type_name: 'string',
        default_value: '',
        description: 'SetBool service',
        editor_hint: 'ros_service',
        enum_values: [],
      },
      {
        name: 'data',
        direction: 'input',
        type_name: 'bool',
        default_value: 'false',
        description: '目标值',
        enum_values: [],
      },
      {
        name: 'timeout_sec',
        direction: 'input',
        type_name: 'double',
        default_value: '2.0',
        description: '超时',
        enum_values: [],
      },
      {
        name: 'message',
        direction: 'output',
        type_name: 'string',
        default_value: '',
        description: '响应消息',
        enum_values: [],
      },
    ],
  },
];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/health', async (route) => {
    expect(route.request().method()).toBe('GET');
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, version: '0.1.0-test' }),
    });
  });

  await page.route('**/api/nodes', async (route) => {
    expect(route.request().method()).toBe('GET');
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(manifests),
    });
  });

  await page.route('**/api/v1/bt/capabilities', async (route) => {
    expect(route.request().method()).toBe('GET');
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        available: true,
        capabilities: {
          schema: 'bt_ros2.capabilities.v1',
          seq: 12,
          executor_node: '/bt_executor',
          ros_nodes: ['/telemetry_node'],
          topics: [
            { name: '/telemetry/value', types: ['std_msgs/msg/Float64'] },
            { name: '/robot/healthy', types: ['std_msgs/msg/Bool'] },
          ],
          services: [
            { name: '/planner/reset', types: ['std_srvs/srv/Trigger'] },
            { name: '/sweeper/up/enable', types: ['std_srvs/srv/SetBool'] },
          ],
          actions: [
            { name: '/navigate_to_pose', types: ['nav2_msgs/action/NavigateToPose'] },
          ],
          manifests,
        },
      }),
    });
  });

  await page.route('**/api/tree/load', async (route) => {
    expect(route.request().method()).toBe('POST');
    const body = route.request().postDataJSON() as { xml: string };
    expect(body.xml).toContain('<root main_tree_to_execute="MainTree">');
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, node_count: 8 }),
    });
  });

  await page.route('**/api/tree/blackboard', async (route) => {
    expect(route.request().method()).toBe('POST');
    const body = route.request().postDataJSON() as {
      key: string;
      type: string;
      value: string;
    };
    expect(body.key).toBeTruthy();
    expect(['string', 'bool', 'int', 'double']).toContain(body.type);
    expect(typeof body.value).toBe('string');
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.route('**/api/tree/tick', async (route) => {
    expect(route.request().method()).toBe('POST');
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'SUCCESS',
        nodes: [
          { id: '1', status: 'SUCCESS' },
          { id: '2', status: 'SUCCESS' },
          { id: '3', status: 'SUCCESS' },
          { id: '4', status: 'SUCCESS' },
          { id: '5', status: 'SUCCESS' },
          { id: '6', status: 'SUCCESS' },
        ],
      }),
    });
  });

  await page.route('**/api/tree/run', async (route) => {
    expect(route.request().method()).toBe('POST');
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        final_status: 'SUCCESS',
        transitions: [
          { node_id: 1, from: 'IDLE', to: 'RUNNING', seq: 0 },
          { node_id: 1, from: 'RUNNING', to: 'SUCCESS', seq: 1 },
          { node_id: 2, from: 'IDLE', to: 'SUCCESS', seq: 2 },
        ],
      }),
    });
  });

  await page.route('**/api/tree/validate', async (route) => {
    expect(route.request().method()).toBe('POST');
    const body = route.request().postDataJSON() as { xml: string };
    expect(body.xml).toContain('<root main_tree_to_execute="MainTree">');
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, node_count: 8 }),
    });
  });

  await page.route('**/api/tree/format', async (route) => {
    expect(route.request().method()).toBe('POST');
    const body = route.request().postDataJSON() as { xml: string };
    expect(body.xml).toContain('<root main_tree_to_execute="MainTree">');
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        node_count: 8,
        xml: '<root main_tree_to_execute="MainTree"><BehaviorTree ID="MainTree"><AlwaysSuccess/></BehaviorTree></root>',
      }),
    });
  });
});

const xmlPreview = (page: Page) => page.locator('textarea');

const btNode = (page: Page, registrationName: string) =>
  page.locator(`[data-testid="bt-node"][data-registration="${registrationName}"]`);

async function dragPaletteNode(
  page: Page,
  registrationName: string,
  offset = { x: 360, y: 180 },
) {
  const source = page.locator('[draggable="true"]').filter({ hasText: registrationName }).first();
  const canvas = page.getByTestId('bt-canvas').locator('.react-flow');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('BT canvas is not visible');

  const target = {
    x: box.x + Math.min(offset.x, box.width - 40),
    y: box.y + Math.min(offset.y, box.height - 40),
  };
  const dataTransfer = await page.evaluateHandle((name) => {
    const transfer = new DataTransfer();
    transfer.setData('application/bt-node', name);
    return transfer;
  }, registrationName);
  await source.dispatchEvent('dragstart', { dataTransfer });
  await canvas.dispatchEvent('dragover', { dataTransfer, clientX: target.x, clientY: target.y });
  await canvas.dispatchEvent('drop', { dataTransfer, clientX: target.x, clientY: target.y });
}

async function loadSample(page: Page) {
  await page.goto('/');
  await expect(page.getByText('后端：')).toContainText('已连接 v0.1.0-test');
  await importTreeFile(page);
  await expect(page.getByText('巡逻序列').first()).toBeVisible();
}

test('loads editor, imports sample tree, and talks to mocked backend', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByText('BT Editor')).toBeVisible();
  await expect(page.getByText('节点面板', { exact: true })).toBeVisible();
  await expect(page.getByText('Sequence').first()).toBeVisible();
  await expect(page.getByText('后端：')).toContainText('已连接 v0.1.0-test');

  await importTreeFile(page);
  await expect(page.getByText('巡逻序列').first()).toBeVisible();

  await page.getByRole('button', { name: '载入到服务器' }).click();
  await expect(page.getByText('载入成功，节点数：8')).toBeVisible();

  await page.getByRole('button', { name: '▶ Tick', exact: true }).click();
  await expect(page.getByText('Tick 完成，根状态：SUCCESS')).toBeVisible();

  await expect(page.getByText('XML 脚本预览')).toBeVisible();
  await expect(page.locator('textarea')).toContainText('<Sequence name="巡逻序列">');

  await page.getByRole('button', { name: '后端校验' }).click();
  await expect(page.getByText('XML 校验通过，节点数：8')).toBeVisible();

  await page.getByRole('button', { name: '后端格式化' }).click();
  await expect(page.locator('textarea')).toContainText('<AlwaysSuccess/>');

  await page.getByRole('button', { name: '▶ Run', exact: true }).click();
  await expect(page.getByText('Run 完成：SUCCESS，状态变化 3 次').first()).toBeVisible();

  await page.getByRole('button', { name: '整理布局' }).click();
  await expect(page.getByText('布局已整理')).toBeVisible();
});

test('collapses branches in the canvas without changing XML', async ({ page }) => {
  await loadSample(page);
  const xmlBefore = await xmlPreview(page).inputValue();
  const root = btNode(page, 'Sequence').first();
  const child = btNode(page, 'Fallback').first();

  await page.getByRole('button', { name: '折叠全部' }).click();
  await expect(page.locator('[data-testid="bt-node"]:visible')).toHaveCount(1);
  await expect(root).toBeVisible();
  await expect(child).toBeHidden();
  await expect(xmlPreview(page)).toHaveValue(xmlBefore);

  await page.getByRole('button', { name: '展开全部' }).click();
  await expect(page.locator('[data-testid="bt-node"]:visible')).toHaveCount(8);
  await expect(child).toBeVisible();

  await root.getByRole('button', { name: /折叠/ }).click();
  await expect(root.getByRole('button', { name: /展开/ })).toBeVisible();
  await expect(child).toBeHidden();
  await expect(xmlPreview(page)).toHaveValue(xmlBefore);
});

test('adds a palette node and edits instance and port properties in XML preview', async ({
  page,
}) => {
  await page.goto('/');

  await dragPaletteNode(page, 'PrintMessage');
  await expect(btNode(page, 'PrintMessage')).toBeVisible();
  await expect(xmlPreview(page)).toContainText('<PrintMessage message="hello bt"/>');

  await btNode(page, 'PrintMessage').click();
  await page.getByLabel('实例名').fill('announce');
  await page.getByLabel('message 固定值').fill('Watch mode armed');

  await expect(xmlPreview(page)).toContainText(
    '<PrintMessage name="announce" message="Watch mode armed"/>',
  );
});

test('creates a custom Yuyi-style node and serializes undeclared XML attributes', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('自定义节点注册名').fill('LoadYuyiPath');
  await page.getByLabel('自定义节点类别').selectOption('Action');
  await page.getByRole('button', { name: '添加', exact: true }).first().click();

  await btNode(page, 'LoadYuyiPath').click();
  await page.getByLabel('新建 XML 属性名').fill('path_file');
  await page.getByRole('button', { name: '添加', exact: true }).last().click();
  await page.getByLabel('path_file 固定值').fill('config/trajectories/reverseWork.yaml');
  await expect(page.getByText('未在 manifest 中声明的属性只用于设计和 XML 导出')).toBeVisible();
  await expect(xmlPreview(page)).toContainText(
    '<LoadYuyiPath path_file="config/trajectories/reverseWork.yaml"/>',
  );
});

test('declares typed Yuyi ports and persists their editor contract', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('自定义节点注册名').fill('LoadYuyiPath');
  await page.getByLabel('自定义节点类别').selectOption('Action');
  await page.getByRole('button', { name: '添加', exact: true }).first().click();

  const node = btNode(page, 'LoadYuyiPath');
  await node.click();
  await page.getByLabel('新建端口名').fill('path_file');
  await page.getByLabel('新建端口类型').fill('string');
  await page.getByLabel('新建端口默认值').fill('config/trajectories/work.yaml');
  await page.getByLabel('新建端口说明').fill('Yuyi 路径文件');
  await page.getByRole('button', { name: '声明端口' }).click();
  await expect(page.getByLabel('path_file 固定值')).toHaveValue('config/trajectories/work.yaml');
  await expect(page.getByText('输入 · string')).toBeVisible();

  await page.getByLabel('新建端口名').fill('path');
  await page.getByLabel('新建端口类型').fill('geometry_msgs/msg/PoseArray');
  await page.getByLabel('新建端口方向').selectOption('output');
  await page.getByLabel('新建端口说明').fill('输出加载后的路径');
  await page.getByRole('button', { name: '声明端口' }).click();
  await expect(page.getByLabel('path 黑板键')).toBeVisible();
  await page.getByLabel('path 黑板键').fill('reverse_route_path');
  await expect(page.getByText('输出 · geometry_msgs/msg/PoseArray')).toBeVisible();
  await expect(xmlPreview(page)).toContainText(
    'path="{reverse_route_path}"',
  );

  const bundleDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出树 + 黑板' }).click();
  const bundleDownload = await bundleDownloadPromise;
  const bundlePath = await bundleDownload.path();
  expect(bundlePath).not.toBeNull();
  const bundle = JSON.parse(await readFile(bundlePath!, 'utf8')) as {
    editor_manifests?: Array<{ registration_name: string; ports: Array<{ name: string; direction: string }> }>;
    xml: string;
  };
  expect(bundle.editor_manifests).toEqual([
    expect.objectContaining({
      registration_name: 'LoadYuyiPath',
      ports: expect.arrayContaining([
        expect.objectContaining({ name: 'path_file', direction: 'input' }),
        expect.objectContaining({ name: 'path', direction: 'output' }),
      ]),
    }),
  ]);

  // Re-import the portable package after removing the local draft. The typed
  // editor contract must come from editor_manifests, not from a runtime allowlist.
  await page.evaluate(() => window.localStorage.clear());
  await importTreeFile(page, JSON.stringify(bundle), 'yuyi-contract.bt.json');
  await btNode(page, 'LoadYuyiPath').click();
  await expect(page.getByLabel('path 黑板键')).toHaveValue('reverse_route_path');

  await page.reload();
  await btNode(page, 'LoadYuyiPath').click();
  await expect(page.getByLabel('path_file 固定值')).toHaveValue('config/trajectories/work.yaml');
  await expect(page.getByLabel('path 黑板键')).toHaveValue('reverse_route_path');
  await expect(xmlPreview(page)).toContainText('path="{reverse_route_path}"');
});

test('builds a custom Yuyi-style control wrapper with multiple children', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('自定义节点注册名').fill('RunOnZoneTransition');
  await page.getByLabel('自定义节点类别').selectOption('Control');
  await page.getByRole('button', { name: '添加', exact: true }).first().click();
  await dragPaletteNode(page, 'AlwaysSuccess', { x: 460, y: 260 });
  await dragPaletteNode(page, 'AlwaysFailure', { x: 460, y: 420 });

  const wrapper = btNode(page, 'RunOnZoneTransition');
  const firstChild = btNode(page, 'AlwaysSuccess');
  const secondChild = btNode(page, 'AlwaysFailure');
  await wrapper.click();
  await expect(page.getByLabel('未注册节点连接类型')).toHaveValue('Control');

  const connect = async (target: Locator, edgeCount: number) => {
    await wrapper.locator('.react-flow__handle-bottom').click();
    await target.locator('.react-flow__handle-top').click();
    await expect(page.locator('.react-flow__edge')).toHaveCount(edgeCount);
  };
  await connect(firstChild, 1);
  await connect(secondChild, 2);
  await expect(xmlPreview(page)).toContainText('<RunOnZoneTransition>');
  await expect(xmlPreview(page)).toContainText('  <AlwaysSuccess/>');
  await expect(xmlPreview(page)).toContainText('  <AlwaysFailure/>');
});

test('keeps the XML blackboard binding current after server formatting', async ({ page }) => {
  await loadSample(page);
  await page.getByRole('button', { name: '黑板参数' }).click();
  await page.getByRole('button', { name: '新增黑板参数' }).click();
  await page.getByLabel('黑板键名 1').fill('temperature');
  await page.getByLabel('黑板类型 1').selectOption('double');
  await page.getByLabel('黑板值 1').fill('25.5');
  await page.getByLabel('黑板说明 1').fill('启动温度');
  await page.getByRole('button', { name: '后端格式化' }).click();
  await expect(page.getByText(/已保留当前黑板绑定/)).toBeVisible();
  await expect(xmlPreview(page)).toContainText(
    '<Entry key="temperature" type="double" value="25.5" description="启动温度"/>',
  );
  await expect(xmlPreview(page)).toContainText('<Sequence name="巡逻序列">');

  await page.getByLabel('黑板值 1').fill('26.5');
  await expect(xmlPreview(page)).toContainText(
    '<Entry key="temperature" type="double" value="26.5" description="启动温度"/>',
  );
  await expect(xmlPreview(page)).toContainText('<Sequence name="巡逻序列">');
});

test('uses runtime ROS capabilities for topic ports and explains blackboard outputs', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText(/已连接 \/bt_executor：1 个 ROS node、2 个 topic/)).toBeVisible();

  await dragPaletteNode(page, 'ReadScalar');
  const readScalar = btNode(page, 'ReadScalar');
  await expect(readScalar).toBeVisible();
  await readScalar.click();

  await expect(page.getByText('订阅运行时 ROS2 Float64 topic，把 data 写入行为树黑板。')).toBeVisible();
  await expect(page.getByText(/已从 \/bt_executor 发现 2 个 topic/)).toBeVisible();
  await expect(
    page.locator('#ros-topic-options-topic option[value="/telemetry/value"]'),
  ).toHaveCount(1);

  await page.getByLabel('topic 固定值').fill('/telemetry/value');
  await expect(page.getByLabel('value 黑板键')).toBeVisible();
  await page.getByLabel('value 黑板键').fill('temperature');
  await expect(page.getByText(/运行时将 value 写入黑板键/)).toBeVisible();
  await expect(xmlPreview(page)).toContainText('topic="/telemetry/value"');
  await expect(xmlPreview(page)).toContainText('value="{temperature}"');
});

test('switches ROS graph candidates and configures non-blocking service actions', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(page.getByText(/2 个 service、1 个 action/)).toBeVisible();

  await dragPaletteNode(page, 'RosGraphCondition');
  const graphCondition = btNode(page, 'RosGraphCondition');
  await graphCondition.click();
  await expect(
    page.locator('#ros-node-options-entity_name option[value="/telemetry_node"]'),
  ).toHaveCount(1);

  await page.getByLabel('entity_type 固定值').selectOption('service');
  await expect(
    page.locator('#ros-service-options-entity_name option[value="/planner/reset"]'),
  ).toHaveCount(1);
  await page.getByLabel('entity_type 固定值').selectOption('action');
  await expect(
    page.locator('#ros-action-options-entity_name option[value="/navigate_to_pose"]'),
  ).toHaveCount(1);
  await page.getByLabel('entity_name 固定值').fill('/navigate_to_pose');
  await expect(xmlPreview(page)).toContainText(
    'entity_type="action" entity_name="/navigate_to_pose"',
  );

  await page.getByRole('button', { name: '删除该节点' }).click();
  await dragPaletteNode(page, 'CallSetBoolService');
  const setBool = btNode(page, 'CallSetBoolService');
  await setBool.click();
  await expect(
    page.locator('#ros-service-options-service_name option[value="/sweeper/up/enable"]'),
  ).toHaveCount(1);
  await page.getByLabel('service_name 固定值').fill('/sweeper/up/enable');
  await page.getByLabel('data 固定值').check();
  await page.getByLabel('message 黑板键').fill('enable_response');
  await expect(xmlPreview(page)).toContainText('service_name="/sweeper/up/enable"');
  await expect(xmlPreview(page)).toContainText('data="true"');
  await expect(xmlPreview(page)).toContainText('message="{enable_response}"');

  await page.screenshot({
    path: testInfo.outputPath('ros2-service-action-properties.png'),
    fullPage: true,
  });
});

test('adds ROS executor manifests to the palette without a frontend node allowlist', async ({
  page,
}) => {
  await page.route('**/api/nodes', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(
        manifests.filter((manifest) => manifest.registration_name !== 'ReadScalar'),
      ),
    });
  });

  await page.goto('/');
  await expect(
    page.locator('[draggable="true"]').filter({ hasText: 'ReadScalar' }).first(),
  ).toBeVisible();
  await expect(page.getByText(/个节点 manifest/)).toBeVisible();
});

test('imports a multi-tree XML and runs its bound blackboard without a second injection', async ({
  page,
}) => {
  const blackboardRequests: unknown[] = [];
  const loadedXml: string[] = [];
  await page.route('**/api/tree/blackboard', async (route) => {
    blackboardRequests.push(route.request().postDataJSON());
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route('**/api/tree/load', async (route) => {
    const body = route.request().postDataJSON() as { xml: string };
    loadedXml.push(body.xml);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, node_count: 3 }),
    });
  });

  await page.goto('/');
  const xml = `<root main_tree_to_execute="MainTree">
  <TreeNodesModel>
    <Blackboard>
      <Entry key="temperature" type="double" value="25.5" description="由 ROS 温度节点更新"/>
    </Blackboard>
  </TreeNodesModel>
  <BehaviorTree ID="MainTree">
    <Sequence name="root"><SubTreePlus ID="Worker" temperature="{temperature}"/></Sequence>
  </BehaviorTree>
  <BehaviorTree ID="Worker"><AlwaysSuccess/></BehaviorTree>
</root>`;
  await importTreeFile(page, xml, 'multi-tree-blackboard.xml');

  await expect(page.getByRole('tab', { name: 'MainTree' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Worker' })).toBeVisible();
  await expect(page.getByLabel('黑板键名 1')).toHaveValue('temperature');
  await expect(page.getByLabel('黑板类型 1')).toHaveValue('double');
  await expect(page.getByLabel('黑板值 1')).toHaveValue('25.5');
  await expect(xmlPreview(page)).toContainText('<TreeNodesModel>');
  await expect(xmlPreview(page)).toContainText(
    '<Entry key="temperature" type="double" value="25.5" description="由 ROS 温度节点更新"/>',
  );

  await page.getByRole('button', { name: '▶ Run', exact: true }).click();
  await expect(page.getByText(/Run 完成：SUCCESS/).first()).toBeVisible();
  expect(blackboardRequests).toEqual([]);
  expect(loadedXml).toHaveLength(1);
  expect(loadedXml[0]).toContain('<TreeNodesModel>');
  expect(loadedXml[0]).toContain('temperature="{temperature}"');
});

test('imports a bound tree bundle and rejects a mismatched blackboard copy', async ({ page }) => {
  await page.goto('/');
  const xml = SAMPLE_TREE_XML.replace(
    '  <BehaviorTree',
    '  <TreeNodesModel><Blackboard><Entry key="mode" type="string" value="auto"/></Blackboard></TreeNodesModel>\n  <BehaviorTree',
  );
  const bundle = {
    schema: 'bt_editor.tree_bundle.v1',
    exported_at: '2026-08-21T00:00:00.000Z',
    xml,
    blackboard: [{ key: 'mode', type: 'string', value: 'auto', description: '' }],
  };

  await importTreeFile(page, JSON.stringify(bundle), 'tree.bt.json');
  await expect(page.getByLabel('黑板键名 1')).toHaveValue('mode');
  await expect(page.getByLabel('黑板值 1')).toHaveValue('auto');
  await expect(page.getByText('巡逻序列').first()).toBeVisible();

  bundle.blackboard[0].value = 'manual';
  await importTreeFile(page, JSON.stringify(bundle), 'mismatched.bt.json');
  await expect(
    page.getByRole('alert').filter({ hasText: 'XML 黑板与 blackboard 数组不一致' }),
  ).toBeVisible();
  await expect(page.getByLabel('黑板值 1')).toHaveValue('auto');
});

test('persists typed blackboard parameters across reload and shows their XML-side summary', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: '黑板参数' }).click();
  await page.getByRole('button', { name: '新增黑板参数' }).click();
  await page.getByLabel('黑板键名 1').fill('duration_ms');
  await page.getByLabel('黑板类型 1').selectOption('int');
  await page.getByLabel('黑板值 1').fill('1000');
  await page.getByLabel('黑板说明 1').fill('等待节点的测试初值');

  const summary = page.getByLabel('黑板初值摘要');
  await expect(summary).toContainText('XML 的 TreeNodesModel/Blackboard 区会保存初值');
  await expect(summary).toContainText('duration_ms = 1000 (int)');
  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem('bt-editor.document.v1')),
    )
    .toContain('"duration_ms"');

  await page.reload();
  await expect(summary).toContainText('duration_ms = 1000 (int)');
  await page.getByRole('button', { name: '黑板参数' }).click();
  await expect(page.getByLabel('黑板键名 1')).toHaveValue('duration_ms');
  await expect(page.getByLabel('黑板类型 1')).toHaveValue('int');
  await expect(page.getByLabel('黑板值 1')).toHaveValue('1000');
  await expect(page.getByLabel('黑板说明 1')).toHaveValue('等待节点的测试初值');
  await expect.poll(
    () => page.evaluate(() => window.localStorage.getItem('bt-editor.blackboard.v1')),
  ).toBeNull();
  await page.screenshot({
    path: testInfo.outputPath('blackboard-persistence-summary.png'),
    fullPage: true,
  });
});

test('migrates a legacy blackboard draft into the single document draft', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('bt-editor.blackboard.v1', JSON.stringify([
      { key: 'legacy_mode', type: 'string', value: 'auto', description: '旧版本草稿' },
    ]));
  });

  await page.goto('/');
  await page.getByRole('button', { name: '黑板参数' }).click();
  await expect(page.getByLabel('黑板键名 1')).toHaveValue('legacy_mode');
  await expect(page.getByLabel('黑板值 1')).toHaveValue('auto');

  // A blackboard draft can be restored before a tree exists. Add a real root
  // before asserting the complete XML document, because an empty canvas must
  // keep showing the actionable missing-root error instead of inventing a
  // runnable placeholder tree.
  await dragPaletteNode(page, 'AlwaysSuccess');
  await expect(xmlPreview(page)).toContainText(
    '<Entry key="legacy_mode" type="string" value="auto" description="旧版本草稿"/>',
  );
  await expect.poll(
    () => page.evaluate(() => window.localStorage.getItem('bt-editor.document.v1')),
  ).toContain('legacy_mode');
});

test('downloads XML and tree bundle with the same bound blackboard parameters', async ({
  page,
}) => {
  await loadSample(page);
  await page.getByRole('button', { name: '黑板参数' }).click();
  await page.getByRole('button', { name: '新增黑板参数' }).click();
  await page.getByLabel('黑板键名 1').fill('temperature');
  await page.getByLabel('黑板类型 1').selectOption('double');
  await page.getByLabel('黑板值 1').fill('25.5');
  await page.getByLabel('黑板说明 1').fill('ROS 温度启动值');

  const xmlDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 XML' }).click();
  const xmlDownload = await xmlDownloadPromise;
  expect(xmlDownload.suggestedFilename()).toBe('behavior_tree.xml');
  const xmlPath = await xmlDownload.path();
  expect(xmlPath).not.toBeNull();
  const xml = await readFile(xmlPath!, 'utf8');
  expect(xml).toContain('<TreeNodesModel>');
  expect(xml).toContain(
    '<Entry key="temperature" type="double" value="25.5" description="ROS 温度启动值"/>',
  );

  const bundleDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出树 + 黑板' }).click();
  const bundleDownload = await bundleDownloadPromise;
  expect(bundleDownload.suggestedFilename()).toBe('behavior_tree.bt.json');
  const bundlePath = await bundleDownload.path();
  expect(bundlePath).not.toBeNull();
  const bundle = JSON.parse(await readFile(bundlePath!, 'utf8')) as {
    schema: string;
    xml: string;
    blackboard: Array<{ key: string; type: string; value: string }>;
  };
  expect(bundle.schema).toBe('bt_editor.tree_bundle.v1');
  expect(bundle.xml).toBe(xml);
  expect(bundle.blackboard).toEqual([
    expect.objectContaining({ key: 'temperature', type: 'double', value: '25.5' }),
  ]);
});

test('blocks loading when blackboard keys are empty or duplicated', async ({ page }) => {
  let loadRequests = 0;
  await page.route('**/api/tree/load', async (route) => {
    loadRequests += 1;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, node_count: 8 }),
    });
  });

  await loadSample(page);
  await page.getByRole('button', { name: '黑板参数' }).click();
  await page.getByRole('button', { name: '新增黑板参数' }).click();
  await page.getByRole('button', { name: '载入到服务器' }).click();
  await expect(page.getByText('黑板参数存在空键名')).toBeVisible();
  expect(loadRequests).toBe(0);

  await page.getByLabel('黑板键名 1').fill('mission_count');
  await page.getByRole('button', { name: '新增黑板参数' }).click();
  await page.getByLabel('黑板键名 2').fill('mission_count');
  await page.getByRole('button', { name: '载入到服务器' }).click();
  await expect(page.getByText('黑板键名重复：mission_count')).toBeVisible();
  expect(loadRequests).toBe(0);
});

test('keeps ROS topic ports editable when the optional capabilities endpoint is unavailable', async ({
  page,
}) => {
  await page.route('**/api/v1/bt/capabilities', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'runtime ROS capabilities are unavailable' }),
    });
  });

  await page.goto('/');
  await dragPaletteNode(page, 'ReadScalar');
  await btNode(page, 'ReadScalar').click();
  await expect(page.getByText(/当前没有 ROS2 图快照/)).toBeVisible();
  await expect(
    page.getByText(/当前没有 ROS2 图快照。推荐运行 \.\/scripts\/dev\.sh 自动托管/),
  ).toBeVisible();

  await page.getByLabel('topic 固定值').fill('/manual/topic');
  await expect(xmlPreview(page)).toContainText('topic="/manual/topic"');
});

test('automatically reads ROS2 graph through the fixed local bridge proxy', async ({
  page,
}, testInfo) => {
  let graphRequests = 0;
  await page.route('**/ros-api/api/v1/bt/capabilities', async (route) => {
    graphRequests += 1;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        available: true,
        capabilities: {
          schema: 'bt_ros2.capabilities.v1',
          seq: 21,
          executor_node: '/bt_executor',
          ros_nodes: ['/planner'],
          topics: [{ name: '/planner/healthy', types: ['std_msgs/msg/Bool'] }],
          manifests,
        },
      }),
    });
  });

  await page.goto('/');
  await expect.poll(() => graphRequests).toBeGreaterThan(0);
  await expect(page.getByText(/已连接 \/bt_executor：1 个 ROS node、1 个 topic/)).toBeVisible();
  await expect(page.getByLabel('ROS2 能力地址')).toHaveCount(0);
  const requestsBeforeRefresh = graphRequests;
  await page.getByRole('button', { name: '连接 / 刷新 ROS2 图' }).click();
  await expect.poll(() => graphRequests).toBeGreaterThan(requestsBeforeRefresh);
  await page.screenshot({
    path: testInfo.outputPath('ros2-graph-auto-connected.png'),
    fullPage: true,
  });
});

test('automatically reconnects when the ROS2 bridge starts after the editor', async ({ page }) => {
  let graphRequests = 0;
  await page.route('**/ros-api/api/v1/bt/capabilities', async (route) => {
    graphRequests += 1;
    if (graphRequests === 1) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'connect ECONNREFUSED 127.0.0.1:8088' }),
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        available: true,
        capabilities: {
          schema: 'bt_ros2.capabilities.v1',
          seq: 22,
          executor_node: '/bt_web',
          ros_nodes: ['/late_planner'],
          topics: [],
          services: [],
          actions: [],
          manifests: [],
        },
      }),
    });
  });

  await page.goto('/');
  await expect(page.getByRole('alert').filter({ hasText: '本机 ROS2 bridge 当前不可达' })).toBeVisible();
  await expect.poll(() => graphRequests, { timeout: 7000 }).toBeGreaterThan(1);
  await expect(page.getByText(/已连接 \/bt_web：1 个 ROS node/)).toBeVisible();
});

test('connects a parent and child node into a valid exported structure', async ({
  page,
}) => {
  await page.goto('/');

  await dragPaletteNode(page, 'Sequence', { x: 320, y: 120 });
  await dragPaletteNode(page, 'AlwaysSuccess', { x: 460, y: 300 });

  const sequence = btNode(page, 'Sequence');
  const success = btNode(page, 'AlwaysSuccess');
  await expect(sequence).toBeVisible();
  await expect(success).toBeVisible();

  const source = sequence.locator('.react-flow__handle-bottom');
  const target = success.locator('.react-flow__handle-top');
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('Connection handles are not visible');

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2);
  await page.mouse.up();

  await expect(xmlPreview(page)).toContainText('<Sequence>');
  await expect(xmlPreview(page)).toContainText('  <AlwaysSuccess/>');
  await expect(xmlPreview(page)).toContainText('</Sequence>');
});

test('drags and edits a priority scheduler with tiered branches', async ({
  page,
}, testInfo) => {
  await page.goto('/');

  await dragPaletteNode(page, 'PrioritySelector', { x: 300, y: 120 });
  await dragPaletteNode(page, 'TickRate', { x: 460, y: 300 });
  await dragPaletteNode(page, 'AlwaysSuccess', { x: 680, y: 300 });
  await dragPaletteNode(page, 'AlwaysSuccess', { x: 460, y: 480 });

  const selector = btNode(page, 'PrioritySelector');
  const tickRate = btNode(page, 'TickRate');
  const success = btNode(page, 'AlwaysSuccess').nth(0);
  const tickChild = btNode(page, 'AlwaysSuccess').nth(1);
  const tickRateNode = tickRate.locator('..');
  await expect(selector).toBeVisible();
  await expect(tickRate).toBeVisible();
  await expect(success).toBeVisible();
  await expect(tickChild).toBeVisible();

  // Move the scheduler node on the canvas and verify React Flow persists it.
  const before = await tickRateNode.boundingBox();
  if (!before) throw new Error('TickRate node is not measurable');
  const beforeTransform = await tickRateNode.getAttribute('style');
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x - 20, before.y + 60, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => tickRateNode.getAttribute('style')).not.toBe(beforeTransform);
  const after = await tickRateNode.boundingBox();
  if (!after) throw new Error('TickRate node disappeared after move');
  expect(after.x).toBeLessThan(before.x - 40);

  const selectorSource = selector.locator('.react-flow__handle-bottom');
  const tickSource = tickRate.locator('.react-flow__handle-bottom');
  const tickTarget = tickRate.locator('.react-flow__handle-top');
  const successTarget = success.locator('.react-flow__handle-top');
  const tickChildTarget = tickChild.locator('.react-flow__handle-top');
  const connect = async (source: Locator, target: Locator, edgeCount: number) => {
    await source.click();
    await target.click();
    await expect(page.locator('.react-flow__edge')).toHaveCount(edgeCount);
  };
  await connect(selectorSource, tickTarget, 1);
  await connect(selectorSource, successTarget, 2);
  await connect(tickSource, tickChildTarget, 3);

  await tickRate.click();
  await expect(page.getByText('TickRate', { exact: true }).last()).toBeVisible();
  await page.getByLabel('tier 固定值').selectOption('background');
  await page.getByLabel('every_n_ticks 固定值').fill('5');

  await expect(xmlPreview(page)).toContainText(
    '<PrioritySelector>',
  );
  await expect(xmlPreview(page)).toContainText(
    '<TickRate tier="background" every_n_ticks="5">',
  );
  const xml = await xmlPreview(page).inputValue();
  const tickStart = xml.indexOf('<TickRate tier="background" every_n_ticks="5">');
  const tickChildIndex = xml.indexOf('<AlwaysSuccess/>', tickStart);
  const tickEnd = xml.indexOf('</TickRate>', tickChildIndex);
  expect(tickStart).toBeGreaterThan(-1);
  expect(tickChildIndex).toBeGreaterThan(tickStart);
  expect(tickEnd).toBeGreaterThan(tickChildIndex);
  expect(tickEnd).toBeLessThan(xml.lastIndexOf('<AlwaysSuccess/>'));

  await page.screenshot({
    path: testInfo.outputPath('priority-scheduler-drag-edit.png'),
    fullPage: true,
  });
});

test('tick feedback updates node status and success coloring by preorder', async ({
  page,
}) => {
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

  await loadSample(page);
  await page.getByRole('button', { name: '▶ Tick', exact: true }).click();

  await expect(page.getByText('Tick 完成，根状态：SUCCESS')).toBeVisible();
  await expect(btNode(page, 'Sequence').first()).toHaveAttribute('data-status', 'SUCCESS');
  await expect(btNode(page, 'PrintMessage').first()).toHaveAttribute('data-status', 'RUNNING');
  await expect(btNode(page, 'Fallback').first()).toHaveAttribute('data-status', 'FAILURE');
  await expect(btNode(page, 'AlwaysSuccess').first()).toHaveAttribute('data-status', 'FAILURE');
  await expect(btNode(page, 'Sequence').first()).toHaveCSS('background-color', 'rgb(187, 247, 208)');
});

test('imports exported server XML into the editor with structural consistency', async ({
  page,
}) => {
  await page.route('**/api/tree/export', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        xml: [
          '<root main_tree_to_execute="MainTree">',
          '  <TreeNodesModel>',
          '    <Blackboard>',
          '      <Entry key="status_message" type="string" value="ready" description="server startup value"/>',
          '    </Blackboard>',
          '  </TreeNodesModel>',
          '  <BehaviorTree ID="MainTree">',
          '    <Sequence name="server_root">',
          '      <Retry num_attempts="3">',
          '        <PrintMessage message="{status_message}"/>',
          '      </Retry>',
          '      <AlwaysSuccess/>',
          '    </Sequence>',
          '  </BehaviorTree>',
          '</root>',
        ].join('\n'),
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '从服务器导入' }).click();

  await expect(page.getByText('已从服务器导入 4 个节点')).toBeVisible();
  await expect(btNode(page, 'Sequence')).toBeVisible();
  await expect(btNode(page, 'Retry')).toBeVisible();
  await expect(btNode(page, 'PrintMessage')).toBeVisible();
  await expect(btNode(page, 'AlwaysSuccess')).toBeVisible();
  await expect(xmlPreview(page)).toContainText('<Sequence name="server_root">');
  await expect(xmlPreview(page)).toContainText('<Retry num_attempts="3">');
  await expect(xmlPreview(page)).toContainText(
    '<PrintMessage message="{status_message}"/>',
  );
  await page.getByRole('button', { name: '黑板参数' }).click();
  await expect(page.getByLabel('黑板键名 1')).toHaveValue('status_message');
  await expect(page.getByLabel('黑板值 1')).toHaveValue('ready');
});

test('imports and edits multiple BehaviorTree definitions without losing SubTreePlus', async ({
  page,
}) => {
  await page.route('**/api/tree/export', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        xml: [
          '<root main_tree_to_execute="Main">',
          '  <TreeNodesModel><Blackboard><Entry key="message" type="string" value="hello"/></Blackboard></TreeNodesModel>',
          '  <BehaviorTree ID="Main"><SubTreePlus ID="Worker" message="{message}"/></BehaviorTree>',
          '  <BehaviorTree ID="Worker"><PrintMessage message="{message}"/></BehaviorTree>',
          '</root>',
        ].join('\n'),
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '从服务器导入' }).click();
  await expect(page.getByText('共 2 个树定义')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Main 主树/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Worker' })).toBeVisible();
  await page.getByRole('tab', { name: 'Worker' }).click();
  await expect(btNode(page, 'PrintMessage')).toBeVisible();
  await expect(xmlPreview(page)).toContainText('<BehaviorTree ID="Worker">');
  await expect(xmlPreview(page)).toContainText('<SubTreePlus ID="Worker" message="{message}"/>');
  await page.getByRole('tab', { name: /Main 主树/ }).click();
  await expect(btNode(page, 'SubTreePlus')).toBeVisible();
});

test('creates and renames a visual subtree definition for Yuyi-style composition', async ({
  page,
}, testInfo) => {
  await loadSample(page);
  await expect(
    page.locator('[draggable="true"]').filter({ hasText: 'SubTreePlus' }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: '新增子树' }).click();
  await expect(page.getByRole('tab', { name: 'SubTree1' })).toHaveAttribute('aria-selected', 'true');
  const treeIdInput = page.getByLabel('当前树定义 ID');
  await treeIdInput.fill('RouteWorker');
  await treeIdInput.press('Enter');
  await expect(page.getByRole('tab', { name: 'RouteWorker' })).toBeVisible();
  await dragPaletteNode(page, 'AlwaysSuccess', { x: 430, y: 220 });
  await expect(btNode(page, 'AlwaysSuccess')).toBeVisible();
  await expect(xmlPreview(page)).toContainText('<BehaviorTree ID="RouteWorker">');
  await expect(xmlPreview(page)).toContainText('<AlwaysSuccess/>');
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem('bt-editor.document.v1')))
    .toContain('RouteWorker');
  await page.reload();
  await expect(page.getByRole('tab', { name: 'RouteWorker' })).toHaveAttribute('aria-selected', 'true');
  await expect(btNode(page, 'AlwaysSuccess')).toBeVisible();
  await expect(xmlPreview(page)).toContainText('<BehaviorTree ID="RouteWorker">');
  await page.screenshot({
    path: testInfo.outputPath('multi-tree-yuyi-construction.png'),
    fullPage: true,
  });
});

test('surfaces a backend tick error as an accessible alert', async ({ page }) => {
  await page.route('**/api/tree/tick', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'tick failed' }),
    });
  });

  await loadSample(page);
  await page.getByRole('button', { name: '载入到服务器' }).click();
  await expect(page.getByText('载入成功，节点数：8')).toBeVisible();
  await page.getByRole('button', { name: '▶ Tick', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Tick 失败：HTTP 500' }),
  ).toContainText(
    'Tick 失败：HTTP 500 Internal Server Error @ /api/tree/tick：tick failed',
  );
});

test('loads the current canvas before Run when the backend has no tree', async ({
  page,
}) => {
  let backendHasTree = false;
  await page.route('**/api/tree/load', async (route) => {
    const body = route.request().postDataJSON() as { xml: string };
    expect(body.xml).toContain('<Sequence name="巡逻序列">');
    backendHasTree = true;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, node_count: 8 }),
    });
  });
  await page.route('**/api/tree/run', async (route) => {
    if (!backendHasTree) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          final_status: 'IDLE',
          transitions: [],
          error: '当前没有已加载的树',
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        final_status: 'SUCCESS',
        transitions: [
          { node_id: 1, from: 'IDLE', to: 'SUCCESS', seq: 0 },
        ],
      }),
    });
  });

  await loadSample(page);
  await page.getByRole('button', { name: '▶ Run', exact: true }).click();

  await expect(page.getByText(/Run 完成：SUCCESS/).first()).toBeVisible();
  expect(backendHasTree).toBe(true);
});

test('keeps local editing available offline and restores backend controls after reconnect', async ({
  page,
}) => {
  let backendOnline = false;
  await page.route('**/api/health', async (route) => {
    if (!backendOnline) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'offline' }),
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, version: '0.1.0-recovered' }),
    });
  });

  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('后端未连接');
  await expect(page.getByRole('button', { name: '载入到服务器' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '▶ Tick', exact: true })).toBeDisabled();

  await importTreeFile(page, SAMPLE_TREE_XML);
  await expect(page.getByText('巡逻序列').first()).toBeVisible();

  backendOnline = true;
  await page.getByRole('button', { name: '重新检测' }).click();
  await expect(page.getByText('后端：')).toContainText('已连接 v0.1.0-recovered');
  await expect(page.getByRole('button', { name: '载入到服务器' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '▶ Tick', exact: true })).toBeEnabled();
});

test('recovers the palette after a failed manifest request', async ({ page }) => {
  let manifestsAvailable = false;
  await page.route('**/api/nodes', async (route) => {
    if (!manifestsAvailable) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'manifest unavailable' }),
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(manifests),
    });
  });

  await page.goto('/');
  await expect(page.getByText(/节点清单暂不可用：HTTP 503/)).toBeVisible();
  // The editor must remain useful in offline/design-only mode. Structural
  // fallbacks are available even though runtime manifests are unavailable.
  await expect(page.getByRole('button', { name: '添加 Sequence 节点' })).toBeVisible();
  await expect(page.getByRole('button', { name: '添加 Parallel 节点' })).toBeVisible();
  await expect(page.getByRole('button', { name: '添加 SubTreePlus 节点' })).toBeVisible();

  manifestsAvailable = true;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  // The fallback palette contains five structural entries (Sequence, Fallback,
  // Parallel, SubTree and SubTreePlus); runtime manifests replace those entries
  // rather than adding a sixth duplicate.
  await expect(page.locator('[draggable="true"]')).toHaveCount(manifests.length + 5);
  await expect(page.getByText('PrintMessage').first()).toBeVisible();
});

test('resets status, deletes a connected node, and clears the editor lifecycle', async ({
  page,
}) => {
  await loadSample(page);
  await page.getByRole('button', { name: '▶ Tick', exact: true }).click();
  await expect(page.locator('[data-testid="bt-node"][data-status="SUCCESS"]')).not.toHaveCount(0);

  await page.getByRole('button', { name: '重置运行态' }).click();
  await expect(page.locator('[data-testid="bt-node"][data-status="IDLE"]')).toHaveCount(8);

  await btNode(page, 'PrintMessage').first().click();
  await page.getByRole('button', { name: '删除该节点' }).click();
  await expect(btNode(page, 'PrintMessage')).toHaveCount(1);
  await expect(xmlPreview(page)).not.toContainText('message="开始巡逻"');

  await page.getByRole('button', { name: '清空' }).click();
  await expect(page.getByTestId('bt-node')).toHaveCount(0);
  await expect(page.getByText('画布还是空的')).toBeVisible();
  await expect(page.getByText('在画布上选中一个节点以编辑其属性。')).toBeVisible();
  await expect(page.getByRole('button', { name: '复制' })).toBeDisabled();
});

test('inserts template nodes and edges correctly', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('后端：')).toContainText('已连接');

  // 等待节点面板加载完成（至少有一个可拖拽节点）
  await expect(page.locator('[draggable="true"]').first()).toBeVisible();

  // 等待模板库区块可见
  await expect(page.getByText('通用模板库')).toBeVisible();

  // 点击「黑板值门控」模板
  await page.locator('button:has-text("黑板值门控")').click();
  // 验证插入了 3 个节点（Sequence + BlackboardGate + AlwaysSuccess）
  await expect(page.getByTestId('bt-node')).toHaveCount(3);

  // 等待 XML 预览更新（包含新插入节点）
  const preview = xmlPreview(page);
  await expect(preview).toContainText('<BehaviorTree', { timeout: 10000 });
  await expect(preview).toContainText('<Sequence>');
  await expect(preview).toContainText('<BlackboardGate');
  await expect(preview).not.toContainText('必须有且仅有一个根节点');

  await page.getByRole('button', { name: '清空' }).click();
  // 点击「长驻调度器」模板
  await page.locator('button:has-text("长驻调度器")').click();
  // 验证插入了 6 个节点
  await expect(page.getByTestId('bt-node')).toHaveCount(6);
  await expect(preview).toContainText('<KeepRunningUntilFailure>');
  await expect(preview).toContainText('<Fallback>');
  await expect(preview).toContainText('<TimeCondition');
  await expect(preview).toContainText('interval_sec="1800"');
  await expect(preview).not.toContainText('必须有且仅有一个根节点');
});
