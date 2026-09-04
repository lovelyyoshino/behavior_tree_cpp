/**
 * types.ts — 编辑器领域模型与后端协议 DTO
 *
 * @author pony
 * @date 2026-06-30
 * @version v1.4.0
 * @last_modified 2026-08-19
 * @changelog
 *   - v1.4.0 (2026-08-19): ROS capability 增加 service/action 动态资源
 *   - v1.3.0 (2026-08-18): 增加多 BehaviorTree 文档模型，支持主树与子树定义
 *   - v1.2.0 (2026-08-18): 增加 XML 黑板元数据与树配置包类型
 *   - v1.1.0 (2026-08-18): 节点清单增加属性面板使用说明元数据
 */

import type { Node, Edge } from 'reactflow';

// ---------------------------------------------------------------------------
// 后端协议 DTO（与 bt_server 约定，务必与 API_CONTRACT 一致）
// ---------------------------------------------------------------------------

/** 端口方向，对应 bt_core PortDirection 的字符串序列化值 */
export type PortDirection = 'input' | 'output' | 'inout';

/** 节点大类，对应 bt_core NodeType::toStr() 的输出 */
export type NodeKind = 'Control' | 'Decorator' | 'Action' | 'Condition';

/** GET /api/nodes 中单个端口的描述 */
export interface PortManifest {
  name: string;
  direction: PortDirection;
  type_name: string;
  default_value: string;
  description: string;
  /** 可选运行时能力来源，例如 ros_topic；未知提示必须可忽略。 */
  editor_hint?: string;
  /** 枚举可选值——非空时属性面板渲染下拉框，强制取值在该集合内。 */
  enum_values?: string[];
}

/** 节点级说明；由节点实现提供，编辑器只负责呈现，不复制业务规则。 */
export interface NodeDocumentation {
  summary: string;
  usage: string;
  status_semantics: string;
  failure_conditions: string;
  example_xml: string;
}

/** GET /api/nodes 返回数组的单项：一种已注册节点的 manifest */
export interface NodeManifest {
  registration_name: string;
  type: NodeKind;
  ports: PortManifest[];
  /** 旧后端可能没有该字段，前端必须保留兼容回退。 */
  documentation?: NodeDocumentation;
}

/** POST /api/tree/load 的响应 */
export interface LoadResult {
  ok: boolean;
  node_count?: number;
  error?: string;
}

/** GET /api/tree/export 的响应 */
export interface ExportResult {
  xml: string;
}

/** 单个节点的运行态状态 */
export type RunStatus = 'IDLE' | 'RUNNING' | 'SUCCESS' | 'FAILURE';

/** POST /api/tree/tick 返回的单节点状态 */
export interface TickNodeStatus {
  id: string;
  status: RunStatus;
}

/** POST /api/tree/tick 的响应 */
export interface TickResult {
  status: RunStatus;
  nodes: TickNodeStatus[];
}

export interface RunTransition {
  node_id: number;
  from: RunStatus;
  to: RunStatus;
  seq: number;
}

export interface RunResult {
  final_status: RunStatus;
  transitions: RunTransition[];
}

export interface ValidateResult {
  ok: boolean;
  node_count?: number;
  error?: string;
}

export interface FormatResult extends ValidateResult {
  xml?: string;
}

/** GET /api/health 的响应 */
export interface HealthResult {
  ok: boolean;
  version: string;
}

/** ROS 图在运行时发现的 topic；名称和消息类型来自真实 ROS graph。 */
export interface RosInterfaceCapability {
  name: string;
  types: string[];
}

export type RosTopicCapability = RosInterfaceCapability;

/** ROS-aware backend 发布的动态能力快照；不可用时编辑器仍允许手填。 */
export interface RosCapabilities {
  schema: 'bt_ros2.capabilities.v1';
  seq: number;
  executor_node: string;
  ros_nodes: string[];
  topics: RosTopicCapability[];
  services: RosInterfaceCapability[];
  actions: RosInterfaceCapability[];
  manifests: NodeManifest[];
}

/** ROS-aware Web 适配器的响应包装；快照尚未发布时 capabilities 为 null。 */
export interface RosCapabilitiesResponse {
  available: boolean;
  capabilities: RosCapabilities | null;
}

export type RosCapabilitiesStatus = 'loading' | 'available' | 'empty' | 'unavailable';

/** 可在载入/Run 前写入运行时黑板的初始化参数。 */
export type BlackboardValueType = 'string' | 'bool' | 'int' | 'double';

export interface BlackboardEntry {
  key: string;
  type: BlackboardValueType;
  value: string;
  description: string;
}

/** XML 与黑板绑定后的可迁移配置包。XML 保留端口重映射和黑板初值。 */
export interface TreeBundle {
  schema: 'bt_editor.tree_bundle.v1';
  exported_at: string;
  xml: string;
  blackboard: BlackboardEntry[];
  /** Optional design-time contracts for custom/Yuyi nodes absent from runtime manifests. */
  editor_manifests?: NodeManifest[];
}

/** XML 中一个可独立编辑的 <BehaviorTree ID="..."> 定义。 */
export interface BehaviorTreeDefinition {
  id: string;
  nodes: BtNode[];
  edges: BtEdge[];
}

/** 一份完整行为树 XML 文档；所有树共享同一个启动黑板。 */
export interface BehaviorTreeDocument {
  mainTreeId: string;
  trees: BehaviorTreeDefinition[];
  blackboardEntries: BlackboardEntry[];
}

/** A tree document plus optional design-time manifests restored from a bundle. */
export type ImportedTreeArtifact = BehaviorTreeDocument & {
  editorManifests?: NodeManifest[];
};

// ---------------------------------------------------------------------------
// 画布内部数据模型
// ---------------------------------------------------------------------------

/**
 * 挂在每个 React Flow Node 上的自定义数据。
 * - registrationName：节点注册名（XML 标签名，用于实例化）
 * - kind：节点大类，决定连线约束与图标
 * - instanceName：实例名（XML name 属性），可由用户编辑
 * - portValues：端口名 → 当前值（字面量或 "{key}" 重映射）
 * - portManifests：该节点声明的端口列表（来自 manifest，用于属性面板渲染）
 * - runStatus：最近一次 tick 的运行态，用于上色
 */
export interface BtNodeData {
  registrationName: string;
  kind: NodeKind;
  instanceName: string;
  portValues: Record<string, string>;
  portManifests: PortManifest[];
  runStatus: RunStatus;
  /** 仅用于编辑器视图的局部折叠状态，不参与 XML 序列化。 */
  collapsed?: boolean;
  hasChildren?: boolean;
  onToggleCollapse?: (id: string) => void;
}

/** 画布节点类型别名 */
export type BtNode = Node<BtNodeData>;
/** 画布连线类型别名 */
export type BtEdge = Edge;

/** 判断某个节点大类是否为叶子（不可有子节点） */
export function isLeafKind(kind: NodeKind): boolean {
  return kind === 'Action' || kind === 'Condition';
}

/** 判断某个节点大类是否为装饰（最多一个子节点） */
export function isDecoratorKind(kind: NodeKind): boolean {
  return kind === 'Decorator';
}

/** 判断某个节点大类是否为控制（可多个子节点） */
export function isControlKind(kind: NodeKind): boolean {
  return kind === 'Control';
}
