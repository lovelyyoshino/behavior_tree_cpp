/**
 * App.tsx — 编辑器顶层状态与交互编排
 *
 * @author pony
 * @date 2026-06-30
 * @version v1.11.0
 * @last_modified 2026-08-21
 * @changelog
 *   - v1.11.0 (2026-08-21): 黑板草稿收敛到完整文档存储，ROS2 bridge 离线后自动重连
 *   - v1.10.0 (2026-08-21): 本地导入 XML/树黑板包，ROS2 图自动发现且不暴露桥接 URL
 *   - v1.9.0 (2026-08-18): 统一黑板参数校验与 XML 序列化边界
 *   - v1.8.0 (2026-08-18): 支持多 BehaviorTree 定义和 SubTreePlus 目标子树编辑
 *   - v1.7.0 (2026-08-18): XML 导出绑定黑板初值，并支持树配置包下载/导入恢复
 *   - v1.6.0 (2026-08-18): ROS2 能力来源可配置、持久化并合并动态节点 manifest
 *   - v1.5.0 (2026-08-18): 黑板初值持久化，并在浏览器存储不可用时保持内存编辑
 *   - v1.4.0 (2026-08-18): 可选读取 ROS2 运行时能力，属性面板不再绑定固定 topic
 *   - v1.3.0 (2026-08-18): 把节点清单文档传给详细属性面板
 *   - v1.2.0 (2026-08-18): Run 前自动同步当前画布，执行错误保留后端原因
 *   - v1.1.0 (2026-07-13): 增加窄屏布局入口和无需拖拽的节点创建路径
 *
 * 统一持有画布状态(nodes/edges)、节点 manifest、选中节点、后端健康状态，
 * 并把文件导入/导出/Tick/Run 等动作串起来。子组件全部受控。
 *
 * 健壮性设计：
 * - 所有后端请求统一 try/catch，失败通过全局 Toast 给出明确中文提示，绝不静默吞掉。
 * - 后端健康状态可手动「重新检测」，连接后自动恢复相关操作。
 * - 非法连线由 Canvas 上报原因，这里转成 toast 告知用户。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from 'reactflow';

import { Toolbar } from './components/Toolbar';
import { NodePalette } from './components/NodePalette';
import { Canvas } from './components/Canvas';
import { PropertyPanel } from './components/PropertyPanel';
import { ToastStack, type ToastItem, type ToastKind } from './components/Toast';
import { TreeDefinitionsPanel } from './components/TreeDefinitionsPanel';
import {
  fetchNodes,
  loadTree,
  validateTree,
  formatTree,
  exportTree,
  tickTree,
  runTree,
  checkHealth,
  fetchRosCapabilities,
} from './api/client';
import {
  exportDocumentToXml,
  importDocumentFromXml,
  importTreeArtifact,
  dfsPreorderIds,
  normalizeBlackboardEntries,
} from './utils/xml';
import { downloadTextFile } from './utils/download';
import { layoutTree } from './utils/layout';
import type { NodeTemplate } from './utils/node_templates';
import { XmlPreviewPanel } from './components/XmlPreviewPanel';
import { BlackboardPanel } from './components/BlackboardPanel';
import type {
  BtNode,
  BtEdge,
  BtNodeData,
  NodeManifest,
  PortManifest,
  RosCapabilities,
  RosCapabilitiesStatus,
  BlackboardEntry,
  TreeBundle,
  RunStatus,
  NodeKind,
  BehaviorTreeDefinition,
  BehaviorTreeDocument,
} from './types';

let nodeIdSeq = 0;
/** 生成画布内唯一节点 id */
function nextNodeId(): string {
  return `node_${nodeIdSeq++}`;
}

let toastIdSeq = 0;

const TREE_DOCUMENT_DRAFT_KEY = 'bt-editor.document.v1';
const LEGACY_BLACKBOARD_DRAFT_KEY = 'bt-editor.blackboard.v1';
const ROS_GRAPH_ENDPOINT = '/ros-api/api/v1/bt/capabilities';
const MAX_TREE_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * 编辑器结构节点的离线清单。/api/nodes 暂时不可用时仍允许搭建树；后端恢复后，
 * 同名运行时 manifest 会替换这里的端口和说明，避免离线定义冒充真实执行契约。
 */
const EDITOR_STRUCTURAL_MANIFESTS: NodeManifest[] = [
  {
    registration_name: 'Sequence',
    type: 'Control',
    ports: [],
    documentation: {
      summary: '按从左到右的顺序执行所有子节点。',
      usage: '把条件、输入和动作按依赖顺序连接；一个失败会停止后续子节点。',
      status_semantics: '全部子节点 SUCCESS 才 SUCCESS；当前子节点 RUNNING 时保持 RUNNING。',
      failure_conditions: '任一子节点 FAILURE 会使 Sequence FAILURE。',
      example_xml: '<Sequence><AlwaysSuccess/><AlwaysSuccess/></Sequence>',
    },
  },
  {
    registration_name: 'Fallback',
    type: 'Control',
    ports: [],
    documentation: {
      summary: '按从左到右尝试候选分支。',
      usage: '把高优先级或主路径放左侧，把降级/恢复路径放右侧。',
      status_semantics: '任一子节点 SUCCESS 即 SUCCESS；全部 FAILURE 才 FAILURE。',
      failure_conditions: '所有候选分支都 FAILURE 时返回 FAILURE。',
      example_xml: '<Fallback><PrimaryAction/><RecoveryAction/></Fallback>',
    },
  },
  {
    registration_name: 'Parallel',
    type: 'Control',
    ports: [
      {
        name: 'success_threshold',
        direction: 'input',
        type_name: 'int',
        default_value: '1',
        description: '达到该成功子节点数后返回 SUCCESS',
      },
      {
        name: 'failure_threshold',
        direction: 'input',
        type_name: 'int',
        default_value: '1',
        description: '达到该失败子节点数后返回 FAILURE',
      },
    ],
    documentation: {
      summary: '在同一拍 tick 多个独立子任务，并按阈值汇总结果。',
      usage: '只并行放置互不争抢同一资源的策略或监控；为资源动作指定唯一所有者。',
      status_semantics: '达到成功阈值返回 SUCCESS；达到失败阈值返回 FAILURE；否则 RUNNING。',
      failure_conditions: '失败阈值被达到，或阈值配置非法时返回 FAILURE。',
      example_xml: '<Parallel success_threshold="1" failure_threshold="1"><Watchdog/><Work/></Parallel>',
    },
  },
  {
    registration_name: 'Inverter',
    type: 'Decorator',
    ports: [],
    documentation: {
      summary: '反转唯一子节点的 SUCCESS/FAILURE。',
      usage: '只连接一个子节点，常用于把条件取反。',
      status_semantics: 'SUCCESS 与 FAILURE 互换；RUNNING 原样传递。',
      failure_conditions: '缺少或多于一个子节点时载入失败。',
      example_xml: '<Inverter><CompareBlackboard key="ready" op="==" value="true"/></Inverter>',
    },
  },
  {
    registration_name: 'Retry',
    type: 'Decorator',
    ports: [],
    documentation: {
      summary: '失败后重新尝试唯一子节点。',
      usage: '适合可重试的瞬时操作；外部资源动作要保证 halt 后可重新开始。',
      status_semantics: '子节点成功即成功，达到重试上限后失败，等待中的子节点保持 RUNNING。',
      failure_conditions: '所有尝试都失败时返回 FAILURE。',
      example_xml: '<Retry num_attempts="3"><ConnectAction/></Retry>',
    },
  },
  {
    registration_name: 'Repeat',
    type: 'Decorator',
    ports: [],
    documentation: {
      summary: '重复执行唯一子节点。',
      usage: '为周期任务使用明确次数或配合外层调度节点。',
      status_semantics: '达到重复次数返回 SUCCESS；子节点 RUNNING 时保持 RUNNING。',
      failure_conditions: '子节点 FAILURE 会使本装饰器 FAILURE。',
      example_xml: '<Repeat num_cycles="3"><PublishAction/></Repeat>',
    },
  },
  {
    registration_name: 'ForceSuccess',
    type: 'Decorator',
    ports: [],
    documentation: {
      summary: '把唯一子节点的终态强制转换为 SUCCESS。',
      usage: '只包裹可选的清理或诊断动作，并保留日志记录。',
      status_semantics: 'RUNNING 原样传递，终态统一返回 SUCCESS。',
      failure_conditions: '结构不合法时载入失败；子节点业务失败不会向上传播。',
      example_xml: '<ForceSuccess><CleanupAction/></ForceSuccess>',
    },
  },
  {
    registration_name: 'ForceFailure',
    type: 'Decorator',
    ports: [],
    documentation: {
      summary: '把唯一子节点的终态强制转换为 FAILURE。',
      usage: '主要用于测试和显式触发 Fallback 分支。',
      status_semantics: 'RUNNING 原样传递，终态统一返回 FAILURE。',
      failure_conditions: '结构不合法时载入失败。',
      example_xml: '<ForceFailure><AlwaysSuccess/></ForceFailure>',
    },
  },
  {
    registration_name: 'PrioritySelector',
    type: 'Control',
    ports: [],
    documentation: {
      summary: '按优先级重新检查候选分支，并可抢占低优先级运行分支。',
      usage: '每个子分支建议使用“条件 + 动作”的 Sequence，左侧优先级最高。',
      status_semantics: '第一个未失败的分支决定当前状态；高优先级分支可打断低优先级分支。',
      failure_conditions: '所有候选分支都 FAILURE 时返回 FAILURE。',
      example_xml: '<PrioritySelector><EmergencyBranch/><NormalBranch/></PrioritySelector>',
    },
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
        description: '自定义 tick 周期，0 使用 tier 默认值',
      },
    ],
    documentation: {
      summary: '降低唯一子树的 tick 频率。',
      usage: '把低优先级监控和通知包在 background，关键安全策略保持 critical。',
      status_semantics: '子树终态按装饰器规则传递；未到调度拍时保持上一次状态。',
      failure_conditions: '周期参数非法或子节点结构不合法时载入失败。',
      example_xml: '<TickRate tier="background"><RosTopicAction/></TickRate>',
    },
  },
  {
    registration_name: 'SubTree',
    type: 'Action',
    ports: [{
      name: 'ID',
      direction: 'input',
      type_name: 'string',
      default_value: '',
      description: '要调用的 BehaviorTree 定义 ID',
    }],
    documentation: {
      summary: '调用另一个 BehaviorTree 定义，不传递额外端口映射。',
      usage: '先在树定义栏创建目标子树，再把 ID 设置为该定义名称。',
      status_semantics: '返回目标子树根节点的状态。',
      failure_conditions: '目标 ID 不存在、循环引用或目标结构无效时 XML 载入失败。',
      example_xml: '<SubTree ID="Worker"/>',
    },
  },
  {
    registration_name: 'SubTreePlus',
    type: 'Action',
    ports: [{
      name: 'ID',
      direction: 'input',
      type_name: 'string',
      default_value: '',
      description: '要调用的 BehaviorTree 定义 ID',
    }],
    documentation: {
      summary: '调用另一个 BehaviorTree，并把父黑板键映射到子树端口名。',
      usage: '设置 ID 后，用“新增自定义 XML 属性”添加 message、path 等映射，值使用 {parent_key}。',
      status_semantics: '返回映射后目标子树根节点的状态。',
      failure_conditions: '目标 ID 不存在、循环引用、映射格式或目标结构无效时载入失败。',
      example_xml: '<SubTreePlus ID="Worker" message="{parent_message}"/>',
    },
  },
];

/** 按 manifest 构造节点，点击添加与画布拖放必须共享同一端口默认值契约。 */
function createNodeFromManifest(
  manifest: NodeManifest,
  position: { x: number; y: number },
): BtNode {
  const portValues: Record<string, string> = {};
  for (const port of manifest.ports) {
    portValues[port.name] = port.default_value ?? '';
  }
  return {
    id: nextNodeId(),
    type: 'btNode',
    position,
    data: {
      registrationName: manifest.registration_name,
      kind: manifest.type,
      instanceName: '',
      portValues,
      portManifests: manifest.ports,
      runStatus: 'IDLE',
    },
  };
}

function remapSubTreeReferences(nodes: BtNode[], fromId: string, toId: string): BtNode[] {
  return nodes.map((node) => {
    if (!['SubTree', 'SubTreePlus'].includes(node.data.registrationName)) return node;
    if (node.data.portValues.ID !== fromId) return node;
    return {
      ...node,
      data: {
        ...node.data,
        portValues: { ...node.data.portValues, ID: toId },
      },
    };
  });
}

function referencedTreeIds(definition: BehaviorTreeDefinition): string[] {
  return definition.nodes
    .filter((node) => ['SubTree', 'SubTreePlus'].includes(node.data.registrationName))
    .map((node) => node.data.portValues.ID?.trim() ?? '')
    .filter(Boolean);
}

type TreeDocumentDraft = BehaviorTreeDocument & { activeTreeId?: string };

function isTreeDocumentDraft(value: unknown): value is TreeDocumentDraft {
  if (!value || typeof value !== 'object') return false;
  const document = value as Partial<TreeDocumentDraft>;
  if (typeof document.mainTreeId !== 'string' || !Array.isArray(document.trees)) return false;
  if (!Array.isArray(document.blackboardEntries) || document.trees.length === 0) return false;
  return document.trees.every((tree) => (
    tree && typeof tree.id === 'string' && Array.isArray(tree.nodes) && Array.isArray(tree.edges)
  ));
}

/**
 * 只比较可迁移的黑板快照，不比较编辑顺序。C++ 序列化按键名排序，而编辑器保留
 * 用户填写顺序；两者不应因此被误判为不同配置。
 */
function blackboardSignature(entries: BlackboardEntry[]): string {
  return normalizeBlackboardEntries(entries)
    .map(({ key, type, value, description }) => `${key}\u0000${type}\u0000${value}\u0000${description}`)
    .sort()
    .join('\u0001');
}

/** Collect only design-time contracts that are not supplied by the current runtime. */
function collectEditorManifests(
  document: BehaviorTreeDocument,
  runtimeManifests: NodeManifest[],
): NodeManifest[] {
  const runtimeNames = new Set(runtimeManifests.map((manifest) => manifest.registration_name));
  const collected = new Map<string, NodeManifest>();
  for (const tree of document.trees) {
    for (const node of tree.nodes) {
      if (runtimeNames.has(node.data.registrationName) || node.data.portManifests.length === 0) {
        continue;
      }
      if (!collected.has(node.data.registrationName)) {
        collected.set(node.data.registrationName, {
          registration_name: node.data.registrationName,
          type: node.data.kind,
          ports: node.data.portManifests,
          documentation: {
            summary: '编辑器自定义节点端口契约；运行时实现由外部插件提供。',
            usage: '用属性面板配置声明端口，并确保 ROS2/Yuyi 插件 providedPorts() 完全匹配。',
            status_semantics: '由运行时插件决定。',
            failure_conditions: '由运行时插件决定；编辑器声明不会伪造执行能力。',
            example_xml: `<${node.data.registrationName}/>`,
          },
        });
      }
    }
  }
  return [...collected.values()];
}

export default function App() {
  // 画布数据
  const [nodes, setNodes] = useState<BtNode[]>([]);
  const [edges, setEdges] = useState<BtEdge[]>([]);
  // 当前画布只显示 activeTreeId；其它 BehaviorTree 定义保存在 inactiveTrees 中。
  const [activeTreeId, setActiveTreeId] = useState('MainTree');
  const [mainTreeId, setMainTreeId] = useState('MainTree');
  const [treeOrder, setTreeOrder] = useState<string[]>(['MainTree']);
  const [inactiveTrees, setInactiveTrees] = useState<BehaviorTreeDefinition[]>([]);
  const [treeDocumentHydrated, setTreeDocumentHydrated] = useState(false);
  // 仅影响画布显示；折叠不会改变树结构或 XML。
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(new Set());
  // 节点 manifest（来自 /api/nodes）
  const [manifests, setManifests] = useState<NodeManifest[]>([]);
  const [serverManifests, setServerManifests] = useState<NodeManifest[]>([]);
  const [editorManifests, setEditorManifests] = useState<NodeManifest[]>([]);
  const [rosCapabilities, setRosCapabilities] = useState<RosCapabilities | null>(null);
  const [rosCapabilitiesStatus, setRosCapabilitiesStatus] =
    useState<RosCapabilitiesStatus>('loading');
  const [rosCapabilitiesError, setRosCapabilitiesError] = useState<string | null>(null);
  const [rosCapabilitiesUpdatedAt, setRosCapabilitiesUpdatedAt] = useState<number | null>(null);
  const [rosCapabilitiesRefreshing, setRosCapabilitiesRefreshing] = useState(false);
  const [blackboardOpen, setBlackboardOpen] = useState(false);
  const [blackboardEntries, setBlackboardEntries] = useState<BlackboardEntry[]>([]);
  const [paletteLoading, setPaletteLoading] = useState(false);
  const [paletteError, setPaletteError] = useState<string | null>(null);
  // 选中节点 id
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 后端版本（null = 未连接） / 健康检测中 / 忙碌锁
  const [health, setHealth] = useState<string | null>(null);
  const [healthChecking, setHealthChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverFormattedXml, setServerFormattedXml] = useState<string | null>(null);
  const [lastRunSummary, setLastRunSummary] = useState<string | null>(null);
  const treeImportInputRef = useRef<HTMLInputElement>(null);
  const rosRefreshInFlightRef = useRef(false);
  // 全局 toast 列表
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // 记录每条 toast 的定时器，便于卸载时清理
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // -------------------------------------------------------------------------
  // Toast 管理
  // -------------------------------------------------------------------------
  const dismissToast = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  /** 弹出一条 toast，error 停留更久，其余自动消失 */
  const pushToast = useCallback(
    (kind: ToastKind, text: string) => {
      const id = toastIdSeq++;
      setToasts((ts) => [...ts, { id, kind, text }]);
      const ttl = kind === 'error' ? 6000 : 3000;
      const timer = setTimeout(() => dismissToast(id), ttl);
      timersRef.current.set(id, timer);
    },
    [dismissToast],
  );

  // 卸载时清理所有定时器
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  // -------------------------------------------------------------------------
  // 启动：拉节点 + 健康检查
  // -------------------------------------------------------------------------
  const reloadNodes = useCallback(async () => {
    setPaletteLoading(true);
    setPaletteError(null);
    try {
      const list = await fetchNodes();
      setServerManifests(list);
      setManifests(list);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPaletteError(msg);
      pushToast('error', `拉取节点列表失败：${msg}`);
    } finally {
      setPaletteLoading(false);
    }
  }, [pushToast]);

  /** 检测后端健康；toastOnResult 为 true 时把结果以 toast 告知（手动重检用） */
  const recheckHealth = useCallback(
    async (toastOnResult: boolean) => {
      setHealthChecking(true);
      try {
        const h = await checkHealth();
        setHealth(h.version);
        if (toastOnResult) pushToast('success', `后端已连接 v${h.version}`);
      } catch {
        setHealth(null);
        if (toastOnResult) pushToast('error', '后端仍不可达，请确认 bt_server 已启动');
      } finally {
        setHealthChecking(false);
      }
    },
    [pushToast],
  );

  useEffect(() => {
    void reloadNodes();
    // 首次健康检查静默（不弹 toast，未连接由顶部提示条体现）
    void recheckHealth(false);
  }, [reloadNodes, recheckHealth]);

  // 能力快照中的 manifest 是 ROS executor 实际注册的节点，和普通后端清单合并后即可拖入画布。
  // 运行前仍需确认树后端本身注册了这些节点；能力发现不会伪造执行能力。
  useEffect(() => {
    const merged = [...EDITOR_STRUCTURAL_MANIFESTS];
    // Bundle metadata is a design-time fallback. Runtime manifests below it
    // always win once the actual executor advertises the same registration.
    for (const manifest of editorManifests) {
      const index = merged.findIndex((item) => item.registration_name === manifest.registration_name);
      if (index >= 0) merged[index] = manifest;
      else merged.push(manifest);
    }
    for (const manifest of serverManifests) {
      const index = merged.findIndex((item) => item.registration_name === manifest.registration_name);
      if (index >= 0) merged[index] = manifest;
      else merged.push(manifest);
    }
    for (const manifest of rosCapabilities?.manifests ?? []) {
      if (!merged.some((item) => item.registration_name === manifest.registration_name)) {
        merged.push(manifest);
      }
    }
    setManifests(merged);
  }, [editorManifests, rosCapabilities, serverManifests]);

  const refreshRosCapabilities = useCallback(async (showLoading = true) => {
    if (rosRefreshInFlightRef.current) return;
    rosRefreshInFlightRef.current = true;
    if (showLoading) {
      setRosCapabilitiesRefreshing(true);
      setRosCapabilitiesStatus('loading');
      setRosCapabilitiesError(null);
    }
    try {
      const response = await fetchRosCapabilities(ROS_GRAPH_ENDPOINT);
      const capabilities = response.available ? response.capabilities : null;
      setRosCapabilities(capabilities);
      setRosCapabilitiesUpdatedAt(capabilities ? Date.now() : null);
      if (!capabilities) {
        setRosCapabilitiesStatus('unavailable');
        setRosCapabilitiesError(
          '本机 ROS2 bridge 已连接，但还没有完成 graph 快照。请确认 ROS_DOMAIN_ID 与目标系统一致。',
        );
      } else if (
        capabilities.ros_nodes.length === 0 &&
        capabilities.topics.length === 0 &&
        capabilities.services.length === 0 &&
        capabilities.actions.length === 0
      ) {
        setRosCapabilitiesStatus('empty');
        setRosCapabilitiesError(null);
      } else {
        setRosCapabilitiesStatus('available');
        setRosCapabilitiesError(null);
      }
    } catch (err) {
      setRosCapabilities(null);
      setRosCapabilitiesStatus('unavailable');
      setRosCapabilitiesUpdatedAt(null);
      const message = err instanceof Error ? err.message : String(err);
      const bridgeUnavailable =
        message.includes('HTTP 404') ||
        message.includes('HTTP 500') ||
        message.includes('ECONNREFUSED') ||
        message.includes('Failed to fetch') ||
        message.includes('NetworkError');
      const bridgeHint = bridgeUnavailable
        ? '本机 ROS2 bridge 当前不可达。推荐运行 ./scripts/dev.sh 自动托管；如果单独运行 Vite，请先运行 ros2 launch bt_ros2 bt_web.launch.py。网页会自动重连。'
        : message;
      setRosCapabilitiesError(bridgeHint);
    } finally {
      rosRefreshInFlightRef.current = false;
      if (showLoading) setRosCapabilitiesRefreshing(false);
    }
  }, []);

  // 页面启动时自动连接本机 ROS2 bridge；在线时刷新实时 graph，离线时自动重连。
  const rosInitialLoadRef = useRef(false);
  useEffect(() => {
    if (rosInitialLoadRef.current) return;
    rosInitialLoadRef.current = true;
    void refreshRosCapabilities();
  }, [refreshRosCapabilities]);

  useEffect(() => {
    if (rosCapabilitiesStatus === 'loading') return undefined;
    // 在线时保持 graph 新鲜；离线时低频重试，让用户稍后启动 bt_web 后无需再手动连接。
    const refreshPeriodMs = ['available', 'empty'].includes(rosCapabilitiesStatus)
      ? 3000
      : 5000;
    const timer = window.setInterval(
      () => void refreshRosCapabilities(false),
      refreshPeriodMs,
    );
    return () => window.clearInterval(timer);
  }, [refreshRosCapabilities, rosCapabilitiesStatus]);

  // -------------------------------------------------------------------------
  // React Flow 变更处理
  // -------------------------------------------------------------------------
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds) as BtNode[]);
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  const onConnect = useCallback((edge: Edge) => {
    setEdges((eds) => [...eds, edge]);
  }, []);

  /** 非法连线：把 Canvas 上报的原因转成 toast */
  const onInvalidConnection = useCallback(
    (reason: string) => pushToast('error', `连线被拒绝：${reason}`),
    [pushToast],
  );

  // -------------------------------------------------------------------------
  // 从面板拖拽创建节点
  // -------------------------------------------------------------------------
  const onCreateNode = useCallback(
    (manifest: NodeManifest, position: { x: number; y: number }) => {
      setNodes((current) => [...current, createNodeFromManifest(manifest, position)]);
    },
    [],
  );

  const updateBlackboardEntry = useCallback((index: number, patch: Partial<BlackboardEntry>) => {
    setBlackboardEntries((entries) => entries.map((entry, i) => i === index ? { ...entry, ...patch } : entry));
  }, []);

  const addBlackboardEntry = useCallback(() => {
    setBlackboardEntries((entries) => [
      ...entries,
      { key: '', type: 'string', value: '', description: '' },
    ]);
    setBlackboardOpen(true);
  }, []);

  const removeBlackboardEntry = useCallback((index: number) => {
    setBlackboardEntries((entries) => entries.filter((_, i) => i !== index));
  }, []);

  const validateBlackboard = useCallback(() => {
    normalizeBlackboardEntries(blackboardEntries);
  }, [blackboardEntries]);

  /** 触控设备无法可靠使用 HTML5 drag，点击时把节点放到可预测的网格位置。 */
  const onAddNode = useCallback((manifest: NodeManifest) => {
    setNodes((current) => {
      const index = current.length;
      const position = {
        x: 80 + (index % 3) * 200,
        y: 80 + Math.floor(index / 3) * 130,
      };
      return [...current, createNodeFromManifest(manifest, position)];
    });
  }, []);

  /** 创建只依赖 XML 注册名的设计节点；执行能力仍由运行时工厂决定。 */
  const onAddCustomNode = useCallback((registrationName: string, kind: NodeKind) => {
    const manifest: NodeManifest = {
      registration_name: registrationName,
      type: kind,
      ports: [],
      documentation: {
        summary: '自定义 XML 节点；用途由运行时插件提供。',
        usage: '在下方添加节点声明的 XML 属性；载入/运行前确认后端已注册该节点。',
        status_semantics: '由自定义节点实现决定。',
        failure_conditions: '由自定义节点实现决定。',
        example_xml: `<${registrationName}/>`,
      },
    };
    onAddNode(manifest);
  }, [onAddNode]);

  /** 一次插入模板里的多个节点 + 连线（与单节点添加共享同一端口契约）。 */
  const onAddTemplate = useCallback((template: NodeTemplate) => {
    const byName = new Map(
      manifests.map((m) => [m.registration_name, m] as const),
    );
    const created: BtNode[] = [];
    for (const [i, tpl] of template.nodes.entries()) {
      const manifest = byName.get(tpl.registrationName);
      if (!manifest) continue;
      const index = created.length + i;
      const position = {
        x: 80 + (index % 3) * 200,
        y: 80 + Math.floor(index / 3) * 130,
      };
      const node = createNodeFromManifest(manifest, position);
      if (tpl.portValues) {
        node.data.portValues = { ...node.data.portValues, ...tpl.portValues };
      }
      created.push(node);
    }
    const addedEdges: BtEdge[] = [];
    for (const link of template.edges) {
      const src = created[link.parentIndex];
      const tgt = created[link.childIndex];
      if (!src || !tgt) continue;
      // 复用 addEdge 补全 sourceHandle/targetHandle，与画布手动连线一致。
      const conn: Connection = {
        source: src.id,
        target: tgt.id,
        sourceHandle: null,
        targetHandle: null,
      };
      const edge = addEdge(conn, [])[0];
      if (edge) addedEdges.push(edge as BtEdge);
    }
    setNodes((current) => [...current, ...created]);
    setEdges((current) => [...current, ...addedEdges]);
  }, [manifests, setEdges, setNodes]);

  const treeDefinitions = useMemo<BehaviorTreeDefinition[]>(
    () => treeOrder.map((id) => (
      id === activeTreeId
        ? { id, nodes, edges }
        : inactiveTrees.find((tree) => tree.id === id) ?? { id, nodes: [], edges: [] }
    )),
    [activeTreeId, edges, inactiveTrees, nodes, treeOrder],
  );

  const treeDocument = useMemo<BehaviorTreeDocument>(
    () => ({ mainTreeId, trees: treeDefinitions, blackboardEntries }),
    [blackboardEntries, mainTreeId, treeDefinitions],
  );

  const applyImportedDocument = useCallback((
    document: BehaviorTreeDocument,
    keepBlackboard: boolean,
    preferredActiveTreeId?: string,
  ) => {
    const main = document.trees.find((tree) => tree.id === document.mainTreeId);
    if (!main) throw new Error(`XML 主树 ${document.mainTreeId} 不存在`);
    const active = document.trees.find((tree) => tree.id === preferredActiveTreeId) ?? main;
    setMainTreeId(document.mainTreeId);
    setTreeOrder(document.trees.map((tree) => tree.id));
    setInactiveTrees(document.trees.filter((tree) => tree.id !== active.id));
    setActiveTreeId(active.id);
    setNodes(active.nodes);
    setEdges(active.edges);
    if (!keepBlackboard) setBlackboardEntries(document.blackboardEntries);
    setSelectedId(null);
    setCollapsedNodeIds(new Set());
    nodeIdSeq += document.trees.reduce((count, tree) => count + tree.nodes.length, 0);
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TREE_DOCUMENT_DRAFT_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (isTreeDocumentDraft(parsed)) {
          applyImportedDocument(parsed, false, parsed.activeTreeId);
          return;
        }
      }

      // v1.10 以前黑板单独存储。只在没有完整文档草稿时迁移一次，避免两个来源竞争。
      const legacyBlackboard = window.localStorage.getItem(LEGACY_BLACKBOARD_DRAFT_KEY);
      if (legacyBlackboard) {
        const parsed: unknown = JSON.parse(legacyBlackboard);
        if (Array.isArray(parsed)) {
          setBlackboardEntries(normalizeBlackboardEntries(parsed as BlackboardEntry[]));
        }
      }
    } catch {
      // 草稿损坏或 localStorage 不可用时从空文档继续，不阻断编辑器。
    } finally {
      setTreeDocumentHydrated(true);
    }
  }, [applyImportedDocument]);

  useEffect(() => {
    if (!treeDocumentHydrated) return;
    try {
      window.localStorage.setItem(
        TREE_DOCUMENT_DRAFT_KEY,
        JSON.stringify({ ...treeDocument, activeTreeId }),
      );
    } catch {
      // 配额不足时仍允许内存编辑和 XML 下载。
    }
  }, [activeTreeId, treeDocument, treeDocumentHydrated]);

  const onSelectTree = useCallback((treeId: string) => {
    if (treeId === activeTreeId) return;
    const target = inactiveTrees.find((tree) => tree.id === treeId);
    if (!target) {
      pushToast('error', `找不到树定义：${treeId}`);
      return;
    }
    setInactiveTrees((current) => [
      ...current.filter((tree) => tree.id !== activeTreeId && tree.id !== treeId),
      { id: activeTreeId, nodes, edges },
    ]);
    setActiveTreeId(treeId);
    setNodes(target.nodes);
    setEdges(target.edges);
    setSelectedId(null);
    setCollapsedNodeIds(new Set());
  }, [activeTreeId, edges, inactiveTrees, nodes, pushToast]);

  const onAddTreeDefinition = useCallback(() => {
    let index = 1;
    let id = `SubTree${index}`;
    while (treeOrder.includes(id)) id = `SubTree${++index}`;
    setInactiveTrees((current) => [...current, { id: activeTreeId, nodes, edges }]);
    setTreeOrder((current) => [...current, id]);
    setActiveTreeId(id);
    setNodes([]);
    setEdges([]);
    setSelectedId(null);
    setCollapsedNodeIds(new Set());
    pushToast('info', `已创建空子树 ${id}，请放入一个根节点`);
  }, [activeTreeId, edges, nodes, pushToast, treeOrder]);

  const onRenameTreeDefinition = useCallback((requestedId: string): boolean => {
    const nextId = requestedId.trim();
    if (!nextId || nextId === activeTreeId) return Boolean(nextId);
    if (treeOrder.includes(nextId)) {
      pushToast('error', `树定义 ID 已存在：${nextId}`);
      return false;
    }
    setTreeOrder((current) => current.map((id) => id === activeTreeId ? nextId : id));
    setActiveTreeId(nextId);
    if (mainTreeId === activeTreeId) setMainTreeId(nextId);
    setNodes((current) => remapSubTreeReferences(current, activeTreeId, nextId));
    setInactiveTrees((current) => current.map((tree) => ({
      ...tree,
      nodes: remapSubTreeReferences(tree.nodes, activeTreeId, nextId),
    })));
    return true;
  }, [activeTreeId, mainTreeId, pushToast, treeOrder]);

  const onSetMainTree = useCallback(() => {
    setMainTreeId(activeTreeId);
    pushToast('success', `${activeTreeId} 已设为主树`);
  }, [activeTreeId, pushToast]);

  const onDeleteTreeDefinition = useCallback(() => {
    if (treeOrder.length <= 1) return;
    const allDefinitions = treeDefinitions;
    const referrers = allDefinitions
      .filter((tree) => tree.id !== activeTreeId && referencedTreeIds(tree).includes(activeTreeId))
      .map((tree) => tree.id);
    if (referrers.length > 0) {
      pushToast('error', `${activeTreeId} 仍被 ${referrers.join('、')} 引用，不能删除`);
      return;
    }
    const remaining = allDefinitions.filter((tree) => tree.id !== activeTreeId);
    const nextId = remaining[0].id;
    const next = remaining.find((tree) => tree.id === nextId)!;
    setTreeOrder(remaining.map((tree) => tree.id));
    setMainTreeId(mainTreeId === activeTreeId ? nextId : mainTreeId);
    setInactiveTrees(remaining.filter((tree) => tree.id !== nextId));
    setActiveTreeId(nextId);
    setNodes(next.nodes);
    setEdges(next.edges);
    setSelectedId(null);
    setCollapsedNodeIds(new Set());
    pushToast('info', `已删除树定义 ${activeTreeId}`);
  }, [activeTreeId, mainTreeId, pushToast, treeDefinitions, treeOrder.length]);

  useEffect(() => {
    setServerFormattedXml(null);
  }, [treeDocument]);

  // -------------------------------------------------------------------------
  // 属性面板编辑
  // -------------------------------------------------------------------------
  const updateNodeData = useCallback(
    (id: string, patch: Partial<BtNodeData>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...patch } } : n,
        ),
      );
    },
    [],
  );

  const onChangeInstanceName = useCallback(
    (id: string, name: string) => updateNodeData(id, { instanceName: name }),
    [updateNodeData],
  );

  const onChangeKind = useCallback(
    (id: string, kind: NodeKind) => updateNodeData(id, { kind }),
    [updateNodeData],
  );

  const onChangePortValue = useCallback(
    (id: string, port: string, value: string) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== id) return n;
          return {
            ...n,
            data: {
              ...n.data,
              portValues: { ...n.data.portValues, [port]: value },
            },
          };
        }),
      );
    },
    [],
  );

  /**
   * 更新未注册节点的编辑器端口契约。
   *
   * 端口声明是设计时元数据，不会被前端偷偷当成运行时实现；XML 仍只
   * 序列化真实属性值，最终是否可执行由 ROS/Yuyi 插件的 providedPorts()
   * 决定。把声明放进 BtNodeData 则会随本地文档草稿一起保存。
   */
  const onChangePortManifests = useCallback(
    (id: string, portManifests: PortManifest[]) => {
      setNodes((nds) => nds.map((node) => (
        node.id === id
          ? { ...node, data: { ...node.data, portManifests } }
          : node
      )));
    },
    [],
  );

  const onDeleteNode = useCallback((id: string) => {
    // 删除节点同时删掉相关连线
    setNodes((nds) => nds.filter((n) => n.id !== id));
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
    setCollapsedNodeIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const toggleNodeCollapse = useCallback((id: string) => {
    setCollapsedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const collapseAllNodes = useCallback(() => {
    setCollapsedNodeIds(new Set(edges.map((edge) => edge.source)));
  }, [edges]);

  const expandAllNodes = useCallback(() => {
    setCollapsedNodeIds(new Set());
  }, []);

  const visibleNodeIds = useMemo(() => {
    const childrenByParent = new Map<string, string[]>();
    for (const edge of edges) {
      const children = childrenByParent.get(edge.source) ?? [];
      children.push(edge.target);
      childrenByParent.set(edge.source, children);
    }
    const hidden = new Set<string>();
    const visit = (id: string) => {
      for (const child of childrenByParent.get(id) ?? []) {
        if (hidden.has(child)) continue;
        hidden.add(child);
        visit(child);
      }
    };
    for (const id of collapsedNodeIds) visit(id);
    return new Set(nodes.filter((node) => !hidden.has(node.id)).map((node) => node.id));
  }, [collapsedNodeIds, edges, nodes]);

  const renderedNodes = useMemo(
    () => nodes.map((node) => ({
      ...node,
      hidden: !visibleNodeIds.has(node.id),
      data: {
        ...node.data,
        collapsed: collapsedNodeIds.has(node.id),
        hasChildren: edges.some((edge) => edge.source === node.id),
        onToggleCollapse: toggleNodeCollapse,
      },
    })),
    [collapsedNodeIds, edges, nodes, toggleNodeCollapse, visibleNodeIds],
  );

  const renderedEdges = useMemo(
    () => edges.map((edge) => ({
      ...edge,
      hidden: !visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target),
    })),
    [edges, visibleNodeIds],
  );

  // -------------------------------------------------------------------------
  // 工具栏动作
  // -------------------------------------------------------------------------
  const requestTreeImport = useCallback(() => {
    treeImportInputRef.current?.click();
  }, []);

  /** 从本地 XML 或配置包恢复完整多树文档和绑定黑板。 */
  const onImportTreeArtifact = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_TREE_IMPORT_BYTES) {
      pushToast('error', '导入失败：文件超过 5 MiB 限制');
      return;
    }
    try {
      const imported = importTreeArtifact(await file.text(), manifests);
      setEditorManifests(imported.editorManifests ?? []);
      applyImportedDocument(imported, false);
      if (imported.blackboardEntries.length > 0) setBlackboardOpen(true);
      const main = imported.trees.find((tree) => tree.id === imported.mainTreeId);
      const registrations = new Set(manifests.map((manifest) => manifest.registration_name));
      const unknown = [...new Set(imported.trees.flatMap((tree) => tree.nodes)
        .map((node) => node.data.registrationName)
        .filter((name) => !registrations.has(name) && !['SubTree', 'SubTreePlus'].includes(name)))];
      pushToast(
        'success',
        `已导入 ${file.name}：${imported.trees.length} 棵树、${main?.nodes.length ?? 0} 个主树节点、${imported.blackboardEntries.length} 个黑板初值；可直接 Run`,
      );
      if (unknown.length > 0) {
        pushToast(
          'info',
          `当前运行时尚未注册 ${unknown.length} 种节点：${unknown.slice(0, 4).join('、')}${unknown.length > 4 ? '…' : ''}；可以继续设计，执行前需加载对应 ROS2/Yuyi 插件`,
        );
      }
    } catch (err) {
      pushToast(
        'error',
        `导入树 + 黑板失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [applyImportedDocument, manifests, pushToast]);

  /** 把画布序列化为 XML 并 POST /api/tree/load */
  const onLoad = useCallback(async () => {
    try {
      validateBlackboard();
    } catch {
      pushToast('error', '载入已取消：请先修正 XML 预览中的黑板参数');
      return;
    }
    // 先在前端做一次序列化，提前暴露"无唯一根节点"等结构问题
    let xml: string;
    try {
      xml = exportDocumentToXml(treeDocument);
    } catch (err) {
      pushToast(
        'error',
        err instanceof Error ? err.message : String(err),
      );
      return;
    }
    setBusy(true);
    try {
      const res = await loadTree(xml);
      if (res.ok) {
        pushToast('success', `载入成功，节点数：${res.node_count ?? '?'}，黑板参数：${blackboardEntries.length}`);
      } else {
        pushToast('error', `载入失败：${res.error ?? '未知错误'}`);
      }
    } catch (err) {
      pushToast('error', `载入请求失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [pushToast, treeDocument, validateBlackboard, blackboardEntries.length]);

  /** GET /api/tree/export 取 XML 并还原画布 */
  const onExport = useCallback(async () => {
    setBusy(true);
    try {
      const { xml } = await exportTree();
      const imported = importDocumentFromXml(xml, manifests);
      applyImportedDocument(imported, false);
      const main = imported.trees.find((tree) => tree.id === imported.mainTreeId);
      const treeSummary = imported.trees.length > 1
        ? `，共 ${imported.trees.length} 个树定义`
        : '';
      pushToast('success', `已从服务器导入 ${main?.nodes.length ?? 0} 个节点${treeSummary}`);
    } catch (err) {
      pushToast('error', `导入失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [applyImportedDocument, manifests, pushToast]);

  /** POST /api/tree/tick 执行一拍，按返回状态给节点上色 */
  const onTick = useCallback(async () => {
    setBusy(true);
    try {
      const res = await tickTree();
      // 关键：编辑器节点 id(nX) 与后端节点 id(数字) 是两套独立空间，不能直接比较。
      // 唯一稳定的对应是「DFS 前序位置」——编辑器导出 XML 与后端构树/遍历都用同一
      // 前序。因此把编辑器节点按前序排好，与后端有序返回的 nodes 按位置 zip 匹配。
      const canMapStatuses = activeTreeId === mainTreeId &&
        !nodes.some((node) => ['SubTree', 'SubTreePlus'].includes(node.data.registrationName));
      const preorder = canMapStatuses ? dfsPreorderIds(nodes, edges) : []; // 前序 id 序列
      const statusByEditorId = new Map<string, RunStatus>();
      preorder.forEach((editorId, i) => {
        const backend = res.nodes[i];
        if (backend) statusByEditorId.set(editorId, backend.status);
      });
      setNodes((nds) =>
        nds.map((n) => {
          const s = statusByEditorId.get(n.id) ?? n.data.runStatus;
          return { ...n, data: { ...n.data, runStatus: s } };
        }),
      );
      pushToast('info', `Tick 完成，根状态：${res.status}`);
    } catch (err) {
      pushToast('error', `Tick 失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [activeTreeId, edges, mainTreeId, nodes, pushToast]);

  const onRun = useCallback(async () => {
    try {
      validateBlackboard();
    } catch {
      pushToast('error', 'Run 已取消：请先修正 XML 预览中的黑板参数');
      return;
    }
    let xml: string;
    try {
      xml = exportDocumentToXml(treeDocument);
    } catch (err) {
      pushToast('error', `Run 前画布校验失败：${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setBusy(true);
    try {
      // Run 本身会从头执行到终态，先同步画布可避免运行空树或后端陈旧版本。
      const loaded = await loadTree(xml);
      if (!loaded.ok) {
        throw new Error(loaded.error ?? '后端未能载入当前画布');
      }
      const res = await runTree();
      const canMapStatuses = activeTreeId === mainTreeId &&
        !nodes.some((node) => ['SubTree', 'SubTreePlus'].includes(node.data.registrationName));
      const preorder = canMapStatuses ? dfsPreorderIds(nodes, edges) : [];
      const finalByBackendId = new Map<number, RunStatus>();
      for (const transition of res.transitions) {
        finalByBackendId.set(transition.node_id, transition.to);
      }
      const sortedBackendIds = [...finalByBackendId.keys()].sort((a, b) => a - b);
      const statusByEditorId = new Map<string, RunStatus>();
      sortedBackendIds.forEach((backendId, i) => {
        const editorId = preorder[i];
        const status = finalByBackendId.get(backendId);
        if (editorId && status) statusByEditorId.set(editorId, status);
      });
      setNodes((nds) =>
        nds.map((n) => {
          const s = statusByEditorId.get(n.id) ?? n.data.runStatus;
          return { ...n, data: { ...n.data, runStatus: s } };
        }),
      );
      const summary = `Run 完成：${res.final_status}，状态变化 ${res.transitions.length} 次`;
      setLastRunSummary(summary);
      pushToast('info', summary);
    } catch (err) {
      pushToast('error', `Run 失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [activeTreeId, edges, mainTreeId, nodes, pushToast, treeDocument, validateBlackboard]);

  const onLayout = useCallback(() => {
    try {
      setNodes((nds) => layoutTree(nds, edges));
      pushToast('success', '布局已整理');
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err));
    }
  }, [edges, pushToast]);

  /** 把所有节点运行态重置为 IDLE（清除上色，不改结构） */
  const onResetStatus = useCallback(() => {
    setNodes((nds) =>
      nds.map((n) =>
        n.data.runStatus === 'IDLE'
          ? n
          : { ...n, data: { ...n.data, runStatus: 'IDLE' } },
      ),
    );
  }, []);

  /** 清空画布 */
  const onClear = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setSelectedId(null);
    setCollapsedNodeIds(new Set());
  }, []);

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;
  const selectedManifest = selectedNode
    ? manifests.find(
        (manifest) => manifest.registration_name === selectedNode.data.registrationName,
      ) ?? null
    : null;
  const preview = useMemo(() => {
    try {
      return {
        xml: serverFormattedXml ?? exportDocumentToXml(treeDocument),
        error: null,
      };
    } catch (err) {
      return {
        xml: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [serverFormattedXml, treeDocument]);

  /** 下载带黑板初值元数据的 XML；无后端也可以导出当前画布。 */
  const onDownloadXml = useCallback(() => {
    try {
      validateBlackboard();
      const xml = exportDocumentToXml(treeDocument);
      downloadTextFile(xml, 'behavior_tree.xml', 'application/xml');
      pushToast('success', '行为树 XML 已下载（包含黑板初值元数据）');
    } catch (err) {
      pushToast('error', `导出 XML 失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [pushToast, treeDocument, validateBlackboard]);

  /** 下载 XML + 黑板参数的配置包，便于跨机器/项目完整迁移。 */
  const onDownloadBundle = useCallback(() => {
    try {
      const blackboard = normalizeBlackboardEntries(blackboardEntries);
      const xml = exportDocumentToXml({ ...treeDocument, blackboardEntries: blackboard });
      const bundle: TreeBundle = {
        schema: 'bt_editor.tree_bundle.v1',
        exported_at: new Date().toISOString(),
        xml,
        blackboard,
      };
      const runtimeManifestNames = [
        ...serverManifests,
        ...(rosCapabilities?.manifests ?? []),
      ];
      const exportedEditorManifests = new Map(
        [...editorManifests, ...collectEditorManifests(treeDocument, runtimeManifestNames)]
          .map((manifest) => [manifest.registration_name, manifest] as const),
      );
      if (exportedEditorManifests.size > 0) {
        bundle.editor_manifests = [...exportedEditorManifests.values()];
      }
      downloadTextFile(
        JSON.stringify(bundle, null, 2),
        'behavior_tree.bt.json',
        'application/json',
      );
      pushToast('success', '行为树配置包已下载（XML + 黑板）');
    } catch (err) {
      pushToast('error', `导出配置包失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [blackboardEntries, editorManifests, pushToast, rosCapabilities, serverManifests, treeDocument, validateBlackboard]);

  const onCopyXml = useCallback(() => {
    if (preview.error) return;
    void navigator.clipboard.writeText(preview.xml);
    pushToast('success', 'XML 已复制到剪贴板');
  }, [preview, pushToast]);

  const onValidateXml = useCallback(async () => {
    let currentXml: string;
    try {
      validateBlackboard();
      currentXml = exportDocumentToXml(treeDocument);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err));
      return;
    }
    setBusy(true);
    try {
      const result = await validateTree(currentXml);
      if (result.ok) {
        pushToast('success', `XML 校验通过，节点数：${result.node_count ?? '?'}`);
      } else {
        pushToast('error', `XML 校验失败：${result.error ?? '未知错误'}`);
      }
    } catch (err) {
      pushToast('error', `XML 校验请求失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [pushToast, treeDocument, validateBlackboard]);

  const onFormatXml = useCallback(async () => {
    let currentXml: string;
    try {
      validateBlackboard();
      currentXml = exportDocumentToXml(treeDocument);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err));
      return;
    }
    setBusy(true);
    try {
      const result = await formatTree(currentXml);
      if (result.ok && result.xml) {
        // The editor's blackboard table is the source of truth for the
        // document.  Older formatters may return valid XML while dropping the
        // optional TreeNodesModel/Blackboard metadata, so never let that
        // response hide a parameter that is still present in the editor.
        let formattedXml = result.xml;
        let usedLocalBinding = false;
        try {
          const formattedDocument = importDocumentFromXml(result.xml, manifests);
          if (blackboardSignature(formattedDocument.blackboardEntries) !==
              blackboardSignature(blackboardEntries)) {
            formattedXml = exportDocumentToXml({
              ...treeDocument,
              blackboardEntries: normalizeBlackboardEntries(blackboardEntries),
            });
            usedLocalBinding = true;
          }
        } catch {
          // A successful backend response should still be usable when an old
          // editor manifest cannot inspect one of its custom node tags.
          formattedXml = exportDocumentToXml({
            ...treeDocument,
            blackboardEntries: normalizeBlackboardEntries(blackboardEntries),
          });
          usedLocalBinding = true;
        }
        setServerFormattedXml(formattedXml);
        pushToast(
          usedLocalBinding ? 'info' : 'success',
          usedLocalBinding
            ? `后端格式化完成；已保留当前黑板绑定，节点数：${result.node_count ?? '?'}`
            : `XML 已格式化，节点数：${result.node_count ?? '?'}`,
        );
      } else {
        pushToast('error', `XML 格式化失败：${result.error ?? '未知错误'}`);
      }
    } catch (err) {
      pushToast('error', `XML 格式化请求失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [blackboardEntries, manifests, pushToast, treeDocument, validateBlackboard]);

  return (
    <div className="bt-editor-app">
      <input
        ref={treeImportInputRef}
        type="file"
        accept=".xml,.json,.bt.json,application/xml,text/xml,application/json"
        aria-label="选择行为树 XML 或树黑板配置包"
        onChange={(event) => void onImportTreeArtifact(event)}
        style={{ display: 'none' }}
      />
      <Toolbar
        health={health}
        healthChecking={healthChecking}
        busy={busy}
        onImportTreeBlackboard={requestTreeImport}
        onLoad={onLoad}
        onExport={onExport}
        onTick={onTick}
        onRun={onRun}
        onLayout={onLayout}
        onResetStatus={onResetStatus}
        onClear={onClear}
        onCollapseAll={collapseAllNodes}
        onExpandAll={expandAllNodes}
        blackboardOpen={blackboardOpen}
        onToggleBlackboard={() => setBlackboardOpen((open) => !open)}
        onRecheckHealth={() => void recheckHealth(true)}
      />
      <TreeDefinitionsPanel
        treeIds={treeOrder}
        activeTreeId={activeTreeId}
        mainTreeId={mainTreeId}
        onSelect={onSelectTree}
        onAdd={onAddTreeDefinition}
        onRename={onRenameTreeDefinition}
        onSetMain={onSetMainTree}
        onDelete={onDeleteTreeDefinition}
      />
      <div className="bt-editor-workspace">
        <NodePalette
          manifests={manifests}
          loading={paletteLoading}
          error={paletteError}
          onReload={() => void reloadNodes()}
          onAdd={onAddNode}
          onAddCustom={onAddCustomNode}
          onAddTemplate={onAddTemplate}
        />
        <Canvas
          nodes={renderedNodes}
          edges={renderedEdges}
          manifests={manifests}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectNode={setSelectedId}
          onCreateNode={onCreateNode}
          onInvalidConnection={onInvalidConnection}
          onImportTreeBlackboard={requestTreeImport}
        />
        <PropertyPanel
          node={selectedNode}
          manifest={selectedManifest}
          rosCapabilities={rosCapabilities}
          rosCapabilitiesStatus={rosCapabilitiesStatus}
          rosCapabilitiesError={rosCapabilitiesError}
          rosCapabilitiesUpdatedAt={rosCapabilitiesUpdatedAt}
          rosCapabilitiesRefreshing={rosCapabilitiesRefreshing}
          onRefreshRosCapabilities={() => void refreshRosCapabilities(true)}
          treeIds={treeOrder}
          allowCustomContract={Boolean(
            selectedNode && editorManifests.some(
              (item) => item.registration_name === selectedNode.data.registrationName,
            ) && ![
              ...serverManifests,
              ...(rosCapabilities?.manifests ?? []),
            ].some(
              (item) => item.registration_name === selectedNode.data.registrationName,
            ),
          )}
          onChangeInstanceName={onChangeInstanceName}
          onChangeKind={onChangeKind}
          onChangePortValue={onChangePortValue}
          onChangePortManifests={onChangePortManifests}
          onDelete={onDeleteNode}
        />
      </div>
      {blackboardOpen && (
        <BlackboardPanel
          entries={blackboardEntries}
          onChange={updateBlackboardEntry}
          onAdd={addBlackboardEntry}
          onRemove={removeBlackboardEntry}
        />
      )}
      <XmlPreviewPanel
        xml={preview.xml}
        error={preview.error}
        busy={busy}
        connected={health !== null}
        lastRunSummary={lastRunSummary}
        blackboardEntries={blackboardEntries}
        onCopy={onCopyXml}
        onDownloadXml={onDownloadXml}
        onDownloadBundle={onDownloadBundle}
        onValidate={onValidateXml}
        onFormat={onFormatXml}
      />
      {/* 全局通知浮层 */}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
