/**
 * PropertyPanel.tsx — 节点契约、端口模式和 XML 配置预览
 *
 * @author pony
 * @date 2026-06-30
 * @version v1.7.0
 * @last_modified 2026-08-21
 * @changelog
 *   - v1.6.0 (2026-08-21): 自动连接本机 ROS2 图并移除用户可编辑的 bridge URL
 *   - v1.7.0 (2026-08-24): 为未注册 Yuyi/ROS 节点增加可持久化的 typed 端口契约编辑器
 *   - v1.5.0 (2026-08-19): 根据 manifest hint 动态选择 ROS node/topic/service/action
 *   - v1.4.0 (2026-08-18): 支持自定义 XML 属性和 Yuyi 类扩展节点设计
 *   - v1.3.0 (2026-08-18): 增加可配置 ROS2 能力来源、刷新和连接诊断
 *   - v1.2.0 (2026-08-18): 增加节点说明、黑板键名模式和逐节点 XML 预览
 *   - v1.1.0 (2026-07-13): 接入窄屏纵向工作区布局
 *
 * 节点元数据来自后端 manifest。普通输入的“固定值/读取黑板”、输出的“写入黑板”
 * 以及 key/output_key 的“键名本身/动态键名”在这里显式区分，避免把 `{key}`
 * 误填到需要键名本身的端口。
 */

import { useState } from 'react';
import type {
  BtNode,
  NodeKind,
  NodeManifest,
  PortManifest,
  PortDirection,
  RosCapabilities,
  RosCapabilitiesStatus,
} from '../types';
import { isValidXmlName } from '../utils/xml';

interface Props {
  node: BtNode | null;
  manifest: NodeManifest | null;
  rosCapabilities: RosCapabilities | null;
  rosCapabilitiesStatus: RosCapabilitiesStatus;
  rosCapabilitiesError: string | null;
  rosCapabilitiesUpdatedAt: number | null;
  rosCapabilitiesRefreshing: boolean;
  onRefreshRosCapabilities: () => void;
  treeIds: string[];
  /** True when the selected manifest came from a portable editor-only bundle. */
  allowCustomContract: boolean;
  onChangeInstanceName: (id: string, name: string) => void;
  onChangeKind: (id: string, kind: NodeKind) => void;
  onChangePortValue: (id: string, port: string, value: string) => void;
  onChangePortManifests: (id: string, ports: PortManifest[]) => void;
  onDelete: (id: string) => void;
}

/** 根据 PortManifest.type_name 推断该端口适合的输入控件类型。 */
export type Widget = 'enum' | 'bool' | 'int' | 'float' | 'text';
export function inferWidget(port: PortManifest): Widget {
  if (port.enum_values && port.enum_values.length > 0) return 'enum';
  const t = port.type_name;
  if (t === 'bool') return 'bool';
  if (/\b(int|long|short)\b/.test(t)) return 'int';
  if (/\b(double|float)\b/.test(t)) return 'float';
  return 'text';
}

export type PortValueMode = 'literal' | 'blackboard' | 'key_name';

/** 严格识别 `{key}` 重映射，避免把半截花括号当成合法黑板引用。 */
export function isBlackboardRemap(value: string): boolean {
  return /^\{[^{}]+\}$/.test(value.trim());
}

export function unwrapBlackboardKey(value: string): string {
  return isBlackboardRemap(value) ? value.trim().slice(1, -1) : '';
}

/** `key`/`output_key` 是“键名参数”，不是普通的黑板重映射端口。 */
export function isBlackboardKeyNamePort(port: PortManifest): boolean {
  return port.direction === 'input' &&
    (port.name === 'key' || port.name === 'output_key' || port.name.endsWith('_key'));
}

export function inferPortValueMode(
  port: PortManifest,
  value: string,
): PortValueMode {
  if (isBlackboardKeyNamePort(port) && !isBlackboardRemap(value)) return 'key_name';
  if (port.direction === 'output' || port.direction === 'inout') return 'blackboard';
  return isBlackboardRemap(value) ? 'blackboard' : 'literal';
}

type RosGraphEntityType = 'node' | 'topic' | 'service' | 'action';

interface RosGraphOptionSource {
  entityType: RosGraphEntityType;
  label: string;
  options: Array<{ name: string; types: string[] }>;
}

/** Resolve ROS candidates from manifest metadata, never from business port names. */
export function resolveRosGraphOptionSource(
  port: PortManifest,
  portValues: Record<string, string>,
  capabilities: RosCapabilities | null,
): RosGraphOptionSource | null {
  let entityType: RosGraphEntityType | null = null;
  if (port.editor_hint === 'ros_topic') entityType = 'topic';
  else if (port.editor_hint === 'ros_node') entityType = 'node';
  else if (port.editor_hint === 'ros_service') entityType = 'service';
  else if (port.editor_hint === 'ros_action') entityType = 'action';
  else if (port.editor_hint === 'ros_graph_entity') {
    const selected = portValues.entity_type;
    if (['node', 'topic', 'service', 'action'].includes(selected)) {
      entityType = selected as RosGraphEntityType;
    }
  }
  if (!entityType) return null;

  const labels: Record<RosGraphEntityType, string> = {
    node: 'node',
    topic: 'topic',
    service: 'service',
    action: 'action',
  };
  const options = entityType === 'node'
    ? (capabilities?.ros_nodes ?? []).map((name) => ({ name, types: [] }))
    : capabilities?.[`${entityType}s` as 'topics' | 'services' | 'actions'] ?? [];
  return { entityType, label: labels[entityType], options };
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 用当前面板值生成单节点 XML，帮助用户理解“属性最终长什么样”。 */
export function buildNodeXmlPreview(node: BtNode): string {
  const attrs: string[] = [];
  if (node.data.instanceName.trim()) {
    attrs.push(`name="${escapeXmlAttribute(node.data.instanceName.trim())}"`);
  }
  for (const port of node.data.portManifests) {
    const value = node.data.portValues[port.name] ?? '';
    if (value !== '') attrs.push(`${port.name}="${escapeXmlAttribute(value)}"`);
  }
  const declared = new Set(node.data.portManifests.map((port) => port.name));
  for (const [name, value] of Object.entries(node.data.portValues)) {
    if (!declared.has(name) && value !== '' && name !== 'name') {
      attrs.push(`${name}="${escapeXmlAttribute(value)}"`);
    }
  }
  const attrText = attrs.length > 0 ? ` ${attrs.join(' ')}` : '';
  return `<${node.data.registrationName}${attrText}/>`;
}

function kindFallback(kind: NodeKind): string {
  switch (kind) {
    case 'Control': return '编排多个子节点，决定它们的选择、顺序或并行策略。';
    case 'Decorator': return '包装一个子节点，改变它的 tick、状态或执行次数。';
    case 'Action': return '执行一次动作；长任务应在未完成时返回 RUNNING。';
    case 'Condition': return '读取状态并返回 SUCCESS 或 FAILURE，不应返回 RUNNING。';
  }
}

function statusFallback(kind: NodeKind): string {
  if (kind === 'Condition') return '条件成立返回 SUCCESS；不成立或数据不可用返回 FAILURE。';
  if (kind === 'Action') return '同步动作完成返回 SUCCESS；业务失败返回 FAILURE；异步动作等待期间返回 RUNNING。';
  if (kind === 'Decorator') return '通常透传子节点的 RUNNING，并按装饰器规则转换终态。';
  return '根据子节点状态返回 RUNNING、SUCCESS 或 FAILURE；具体规则见节点说明。';
}

function directionLabel(direction: PortManifest['direction']): string {
  if (direction === 'output') return '输出';
  if (direction === 'inout') return '双向';
  return '输入';
}

function ModeButton({
  active,
  children,
  onClick,
  disabled = false,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      style={{
        flex: 1,
        minHeight: 28,
        padding: '4px 6px',
        border: `1px solid ${active ? '#2563eb' : '#d1d5db'}`,
        borderRadius: 4,
        background: active ? '#eff6ff' : '#fff',
        color: active ? '#1d4ed8' : '#4b5563',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 11,
        fontWeight: active ? 700 : 500,
      }}
    >
      {children}
    </button>
  );
}

function PortRow({
  port,
  value,
  onChange,
  rosCapabilities,
  rosCapabilitiesStatus,
  portValues,
  treeIds,
  treeReference,
}: {
  port: PortManifest;
  value: string;
  onChange: (v: string) => void;
  rosCapabilities: RosCapabilities | null;
  rosCapabilitiesStatus: RosCapabilitiesStatus;
  portValues: Record<string, string>;
  treeIds: string[];
  treeReference: boolean;
}) {
  const widget = inferWidget(port);
  const mode = inferPortValueMode(port, value);
  const keyNamePort = isBlackboardKeyNamePort(port);
  const hasInvalidBraces = value.includes('{') || value.includes('}');
  const blackboardKey = unwrapBlackboardKey(value);
  const setBlackboardMode = () =>
    onChange(isBlackboardRemap(value) ? value : `{${port.name}}`);
  const setLiteralMode = () => onChange(port.default_value || '');
  const updateKey = (key: string) => onChange(key ? `{${key.replace(/[{}]/g, '')}}` : '');
  const rosOptionSource = resolveRosGraphOptionSource(
    port, portValues, rosCapabilities,
  );

  const renderLiteralControl = () => {
    if (treeReference && port.name === 'ID') {
      const listId = 'bt-tree-id-options';
      return (
        <>
          <input
            aria-label="目标 BehaviorTree ID"
            list={listId}
            type="text"
            value={value}
            placeholder="选择或输入目标树 ID"
            onChange={(event) => onChange(event.target.value)}
            style={controlStyle}
          />
          <datalist id={listId}>
            {treeIds.map((treeId) => <option key={treeId} value={treeId} />)}
          </datalist>
          <div style={helpStyle}>
            选择树定义栏中的目标；目标不存在时，后端校验会拒绝载入。
          </div>
        </>
      );
    }
    if (widget === 'enum') {
      const values = port.enum_values ?? [];
      return (
        <select
          aria-label={`${port.name} 固定值`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={controlStyle}
        >
          {value && !values.includes(value) && <option value={value}>{value}</option>}
          {values.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      );
    }
    if (widget === 'bool') {
      const checked = value === 'true' || value === '1';
      return (
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 28, fontSize: 12 }}>
          <input
            aria-label={`${port.name} 固定值`}
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
          />
          <span style={{ color: checked ? '#15803d' : '#6b7280' }}>{checked ? 'true' : 'false'}</span>
        </label>
      );
    }
    if (widget === 'int' || widget === 'float') {
      return (
        <input
          aria-label={`${port.name} 固定值`}
          type="number"
          step={widget === 'int' ? '1' : 'any'}
          value={value}
          placeholder={port.default_value ? `默认 ${port.default_value}` : ''}
          onChange={(e) => onChange(e.target.value)}
          style={controlStyle}
        />
      );
    }
    if (rosOptionSource) {
      const listId = `ros-${rosOptionSource.entityType}-options-${port.name}`;
      const optionCount = rosOptionSource.options.length;
      return (
        <>
          <input
            aria-label={`${port.name} 固定值`}
            list={listId}
            type="text"
            value={value}
            placeholder={port.default_value || `从运行时 ROS ${rosOptionSource.label} 选择或手填`}
            onChange={(e) => onChange(e.target.value)}
            style={controlStyle}
          />
          <datalist id={listId}>
            {rosOptionSource.options.map((option) => (
              <option key={option.name} value={option.name}>
                {option.types.join(', ')}
              </option>
            ))}
          </datalist>
          <div style={helpStyle}>
            {rosCapabilitiesStatus === 'available'
              ? `已从 ${rosCapabilities?.executor_node ?? 'ROS2'} 发现 ${optionCount} 个 ${rosOptionSource.label}；输入框仍支持手填。`
              : rosCapabilitiesStatus === 'empty'
                ? `ROS2 网关已连接，但当前没有可用 ${rosOptionSource.label}；可以先手填名称，运行时再校验。`
                : rosCapabilitiesStatus === 'loading'
                  ? `正在读取 ROS2 运行时能力；候选加载完成前可以手填 ${rosOptionSource.label}。`
                  : `未连接 ROS-aware ROS2 网关；候选不可用，但手填 ${rosOptionSource.label} 不受限制。`}
          </div>
        </>
      );
    }
    return (
      <input
        aria-label={`${port.name} 固定值`}
        type="text"
        value={value}
        placeholder={port.default_value ? `默认 ${port.default_value}` : '输入固定值'}
        onChange={(e) => onChange(e.target.value)}
        style={controlStyle}
      />
    );
  };

  const renderValueControl = () => {
    if (mode === 'blackboard') {
      return (
        <>
          <input
            aria-label={`${port.name} 黑板键`}
            type="text"
            value={blackboardKey || (value && !isBlackboardRemap(value) ? value : '')}
            placeholder="例如 battery_level"
            onChange={(e) => updateKey(e.target.value)}
            style={{ ...controlStyle, borderColor: '#2563eb' }}
          />
          {hasInvalidBraces && !isBlackboardRemap(value) && (
            <div style={warningStyle}>黑板模式会自动生成 {'{键名}'}，不要手写半截花括号。</div>
          )}
        </>
      );
    }
    return renderLiteralControl();
  };

  return (
    <section style={{ borderBottom: '1px solid #e5e7eb', padding: '10px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <strong style={{ fontSize: 12 }}>{port.name}</strong>
        <span style={{ fontSize: 10, color: port.direction === 'output' ? '#047857' : '#6b7280' }}>
          {directionLabel(port.direction)} · {port.type_name}
        </span>
      </div>
      {port.description && <div style={descriptionStyle}>{port.description}</div>}
      <div style={{ fontSize: 10, color: '#9ca3af', margin: '3px 0 6px' }}>
        默认值：{port.default_value || '无'}
      </div>

      {port.direction === 'output' || port.direction === 'inout' ? (
        <>
          <div style={modeLabelStyle}>写入模式（XML 使用 {'{黑板键}'}）</div>
          {renderValueControl()}
          <div style={helpStyle}>
            {value
              ? `运行时将 ${port.name} 写入黑板键 ${blackboardKey || value}。`
              : `留空时使用默认黑板键 ${port.name}；建议显式填写，便于复用和审查。`}
          </div>
        </>
      ) : keyNamePort ? (
        <>
          <div style={modeLabelStyle}>键名模式</div>
          <div style={modeGroupStyle}>
            <ModeButton active={mode === 'key_name'} onClick={setLiteralMode}>固定键名</ModeButton>
            <ModeButton active={mode === 'blackboard'} onClick={setBlackboardMode}>动态键名</ModeButton>
          </div>
          {mode === 'blackboard' ? renderValueControl() : (
            <input
              aria-label={`${port.name} 固定键名`}
              type="text"
              value={value}
              placeholder="例如 mission_count（不加 {}）"
              onChange={(e) => onChange(e.target.value)}
              style={controlStyle}
            />
          )}
          <div style={helpStyle}>
            {mode === 'key_name'
              ? '这里保存的是要操作的黑板键名本身，通常直接写 mission_count，不加花括号。'
              : '动态键名会先读取黑板中的字符串，再把该字符串当作真正的目标键名。'}
          </div>
          {mode === 'key_name' && hasInvalidBraces && (
            <div style={warningStyle}>此端口需要键名本身；普通用法请去掉花括号。</div>
          )}
        </>
      ) : (
        <>
          <div style={modeGroupStyle}>
            <ModeButton active={mode === 'literal'} onClick={setLiteralMode}>固定值</ModeButton>
            <ModeButton active={mode === 'blackboard'} onClick={setBlackboardMode}>读取黑板</ModeButton>
          </div>
          {renderValueControl()}
          <div style={helpStyle}>
            {mode === 'literal'
              ? '固定值只属于当前节点，不会自动写入共享黑板。'
              : '读取黑板时，XML 会保存为 {key}，运行时按端口类型转换。'}
          </div>
        </>
      )}
    </section>
  );
}

const controlStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  minHeight: 28,
  padding: '4px 7px',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  background: '#fff',
  fontSize: 12,
};
const descriptionStyle = { fontSize: 11, color: '#4b5563', margin: '4px 0' };
const helpStyle = { fontSize: 10, color: '#6b7280', lineHeight: 1.45, marginTop: 5 };
const warningStyle = { fontSize: 10, color: '#b45309', lineHeight: 1.4, marginTop: 4 };
const modeLabelStyle = { fontSize: 10, color: '#6b7280', margin: '5px 0 4px' };
const modeGroupStyle = { display: 'flex', gap: 5, marginBottom: 6 };

export function PropertyPanel({
  node,
  manifest,
  rosCapabilities,
  rosCapabilitiesStatus,
  rosCapabilitiesError,
  rosCapabilitiesUpdatedAt,
  rosCapabilitiesRefreshing,
  onRefreshRosCapabilities,
  treeIds,
  allowCustomContract,
  onChangeInstanceName,
  onChangeKind,
  onChangePortValue,
  onChangePortManifests,
  onDelete,
}: Props) {
  const [newAttributeName, setNewAttributeName] = useState('');
  const [newPortName, setNewPortName] = useState('');
  const [newPortType, setNewPortType] = useState('string');
  const [newPortDirection, setNewPortDirection] = useState<PortDirection>('input');
  const [newPortDefault, setNewPortDefault] = useState('');
  const [newPortDescription, setNewPortDescription] = useState('');

  const addCustomPort = () => {
    if (!node) return;
    const name = newPortName.trim();
    if (!name || name === 'name' || !isValidXmlName(name)) return;
    const ports = node.data.portManifests.filter((port) => port.name !== name);
    const port: PortManifest = {
      name,
      direction: newPortDirection,
      type_name: newPortType.trim() || 'string',
      default_value: newPortDefault,
      description: newPortDescription.trim() || '自定义端口；运行时节点应在 providedPorts() 中声明。',
      enum_values: [],
    };
    onChangePortManifests(node.id, [...ports, port]);
    // A declaration may replace an already-created dynamic XML attribute. Keep
    // its value; otherwise seed the attribute with the declared default.
    if (!(name in node.data.portValues) || node.data.portValues[name] === '') {
      onChangePortValue(node.id, name, newPortDefault);
    }
    setNewPortName('');
    setNewPortDefault('');
    setNewPortDescription('');
  };
  return (
    <aside
      className="bt-property-panel"
      style={{
        borderLeft: '1px solid #e5e7eb',
        background: '#fafafa',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb' }}>
        <strong>属性面板</strong>
        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 3 }}>
          先看节点契约，再配置端口；面板值会直接生成 XML。
        </div>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, padding: 12 }}>
        <section
          aria-label="ROS2 运行时能力"
          style={{
            marginBottom: 10,
            padding: '8px 9px',
            border: '1px solid #dbeafe',
            borderRadius: 4,
            background: '#eff6ff',
            fontSize: 11,
            color: '#1e3a8a',
            lineHeight: 1.45,
          }}
        >
          <strong>ROS2 运行时能力</strong>
          <div style={{ marginTop: 6, color: '#1e40af' }}>
            通过本机 ROS2 bridge 直接读取当前 ROS graph：node、topic、service、action、接口类型和已注册行为树节点。树的载入/Tick/Run
            仍发送到顶部显示的执行后端。
          </div>
          <button
            type="button"
            onClick={onRefreshRosCapabilities}
            disabled={rosCapabilitiesRefreshing}
            style={{
              marginTop: 6,
              minHeight: 27,
              padding: '4px 8px',
              border: '1px solid #93c5fd',
              borderRadius: 4,
              background: '#fff',
              color: '#1d4ed8',
              cursor: rosCapabilitiesRefreshing
                ? 'not-allowed'
                : 'pointer',
              fontSize: 11,
              opacity: rosCapabilitiesRefreshing ? 0.55 : 1,
            }}
          >
            {rosCapabilitiesRefreshing ? '读取 ROS2 图…' : '连接 / 刷新 ROS2 图'}
          </button>
          <div>
            {rosCapabilitiesStatus === 'available'
              ? `已连接 ${rosCapabilities?.executor_node ?? 'ROS-aware backend'}：${rosCapabilities?.ros_nodes.length ?? 0} 个 ROS node、${rosCapabilities?.topics.length ?? 0} 个 topic、${rosCapabilities?.services.length ?? 0} 个 service、${rosCapabilities?.actions.length ?? 0} 个 action、${rosCapabilities?.manifests.length ?? 0} 个节点 manifest。`
              : rosCapabilitiesStatus === 'empty'
                ? `已连接 ${rosCapabilities?.executor_node ?? 'ROS-aware backend'}，但 graph 资源为空；所有 ROS 端口仍可手填。`
                : rosCapabilitiesStatus === 'loading'
                  ? '正在发现 ROS2 node、topic、service、action 和接口类型。'
                  : '当前没有 ROS2 图快照。推荐运行 ./scripts/dev.sh 自动托管本机 ROS2 bridge；只有单独运行 Vite 时才需要手动启动 ros2 launch bt_ros2 bt_web.launch.py。'}
          </div>
          {rosCapabilitiesUpdatedAt && (
            <div style={{ marginTop: 3, color: '#64748b' }}>
              最近刷新：{new Date(rosCapabilitiesUpdatedAt).toLocaleTimeString()}
            </div>
          )}
          {rosCapabilitiesError && (
            <div role="alert" style={{ marginTop: 4, color: '#b91c1c', overflowWrap: 'anywhere' }}>
              连接诊断：{rosCapabilitiesError}
            </div>
          )}
        </section>
        {!node && <div style={{ color: '#9ca3af', fontSize: 13 }}>在画布上选中一个节点以编辑其属性。</div>}

        {node && (
          <>
            <section style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: 12, marginBottom: 4 }}>
              <div style={{ fontSize: 11, color: '#6b7280' }}>注册名 · {node.data.kind}</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#111827', marginTop: 2 }}>
                {node.data.registrationName}
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 12, lineHeight: 1.5, color: '#374151' }}>
                {manifest?.documentation?.summary || kindFallback(node.data.kind)}
              </p>
            </section>

            <section style={{ borderBottom: '1px solid #e5e7eb', padding: '10px 0' }}>
              <div style={sectionTitleStyle}>怎么使用</div>
              <div style={bodyStyle}>
                {manifest?.documentation?.usage || '先配置下方端口，再把节点接入控制节点；长任务必须允许 RUNNING 跨拍推进。'}
              </div>
              <div style={{ ...sectionTitleStyle, marginTop: 8 }}>状态语义</div>
              <div style={bodyStyle}>
                {manifest?.documentation?.status_semantics || statusFallback(node.data.kind)}
              </div>
              <div style={{ ...sectionTitleStyle, marginTop: 8 }}>失败与边界</div>
              <div style={bodyStyle}>
                {manifest?.documentation?.failure_conditions || '未提供专用边界说明；请结合端口描述和节点源码确认输入缺失、超时与 halt 行为。'}
              </div>
            </section>

            <section style={{ borderBottom: '1px solid #e5e7eb', padding: '10px 0' }}>
              <div style={sectionTitleStyle}>实例名（XML name，可选）</div>
              <input
                aria-label="实例名"
                type="text"
                value={node.data.instanceName}
                placeholder="例如 monitor_planner"
                onChange={(e) => onChangeInstanceName(node.id, e.target.value)}
                style={controlStyle}
              />
            </section>

            {!manifest && (
              <section style={{ borderBottom: '1px solid #e5e7eb', padding: '10px 0' }}>
                <div style={sectionTitleStyle}>连接类型（未注册节点）</div>
                <select
                  aria-label="未注册节点连接类型"
                  value={node.data.kind}
                  onChange={(event) => onChangeKind(node.id, event.target.value as NodeKind)}
                  style={controlStyle}
                >
                  <option value="Control">Control：可连接多个子节点</option>
                  <option value="Decorator">Decorator：只能连接一个子节点</option>
                  <option value="Action">Action：叶子节点</option>
                  <option value="Condition">Condition：叶子节点</option>
                </select>
                <div style={helpStyle}>
                  这是编辑器的结构提示，不会写入 XML；运行时仍以插件注册的 NodeType 为准。
                  导入未知 Yuyi 节点后，可在这里修正其子节点连接策略。
                </div>
              </section>
            )}

            {(!manifest || allowCustomContract) && (
              <section style={{ borderBottom: '1px solid #e5e7eb', padding: '10px 0' }}>
                <div style={sectionTitleStyle}>自定义端口契约（Yuyi / ROS 插件）</div>
                <div style={helpStyle}>
                  这里声明的是编辑器契约：端口名、方向和类型会决定属性控件及黑板提示，
                  XML 仍只保存属性值。运行前请让对应 C++/ROS2 节点的 providedPorts()
                  使用完全相同的端口名和方向。
                </div>
                <div style={{ display: 'grid', gap: 5, marginTop: 7 }}>
                  <input
                    aria-label="新建端口名"
                    type="text"
                    value={newPortName}
                    placeholder="例如 path_file、result、path_progress"
                    onChange={(event) => setNewPortName(event.target.value)}
                    style={controlStyle}
                  />
                  <input
                    aria-label="新建端口类型"
                    type="text"
                    list="bt-custom-port-types"
                    value={newPortType}
                    placeholder="string / double / geometry_msgs/msg/PoseStamped"
                    onChange={(event) => setNewPortType(event.target.value)}
                    style={controlStyle}
                  />
                  <datalist id="bt-custom-port-types">
                    {['string', 'bool', 'int', 'double', 'float'].map((type) => (
                      <option key={type} value={type} />
                    ))}
                  </datalist>
                  <div style={{ display: 'flex', gap: 5 }}>
                    <select
                      aria-label="新建端口方向"
                      value={newPortDirection}
                      onChange={(event) => setNewPortDirection(event.target.value as PortDirection)}
                      style={{ ...controlStyle, flex: 1 }}
                    >
                      <option value="input">输入：节点读取</option>
                      <option value="output">输出：节点写入黑板</option>
                      <option value="inout">双向：读写黑板</option>
                    </select>
                    <input
                      aria-label="新建端口默认值"
                      type="text"
                      value={newPortDefault}
                      placeholder="默认值（可空）"
                      onChange={(event) => setNewPortDefault(event.target.value)}
                      style={{ ...controlStyle, flex: 1 }}
                    />
                  </div>
                  <input
                    aria-label="新建端口说明"
                    type="text"
                    value={newPortDescription}
                    placeholder="例如输出当前路径，建议绑定 {route_path}"
                    onChange={(event) => setNewPortDescription(event.target.value)}
                    style={controlStyle}
                  />
                  <button
                    type="button"
                    onClick={addCustomPort}
                    disabled={!newPortName.trim() || newPortName.trim() === 'name' || !isValidXmlName(newPortName)}
                    title="把端口加入当前自定义节点的编辑器契约"
                  >
                    声明端口
                  </button>
                </div>
                <div style={helpStyle}>
                  可重复声明同名端口以修改契约；已有 XML 属性值会保留。ROS 消息类型可以直接填写
                  完整接口名，候选发现仍来自本机 ROS graph。
                </div>
              </section>
            )}

            <section>
              {(() => {
                const declared = new Set(node.data.portManifests.map((port) => port.name));
                const dynamicPorts = Object.keys(node.data.portValues)
                  .filter((name) => !declared.has(name) && name !== 'name')
                  .map((name): PortManifest => ({
                    name,
                    direction: 'input',
                    type_name: 'string',
                    default_value: '',
                    description: '自定义 XML 属性；必须由运行时节点声明。',
                  }));
                const allPorts = [...node.data.portManifests, ...dynamicPorts];
                return (
                  <>
                    <div style={{ ...sectionTitleStyle, marginTop: 10 }}>端口/属性（{allPorts.length}）</div>
                    {allPorts.length === 0 && (
                      <div style={{ fontSize: 12, color: '#9ca3af', padding: '8px 0' }}>该节点暂无属性；可以在下方添加自定义 XML 属性。</div>
                    )}
                    {allPorts.map((port) => (
                      <PortRow
                        key={port.name}
                        port={port}
                        value={node.data.portValues[port.name] ?? ''}
                        rosCapabilities={rosCapabilities}
                        rosCapabilitiesStatus={rosCapabilitiesStatus}
                        portValues={node.data.portValues}
                        treeIds={treeIds}
                        treeReference={['SubTree', 'SubTreePlus'].includes(node.data.registrationName)}
                        onChange={(v) => onChangePortValue(node.id, port.name, v)}
                      />
                    ))}
                    <div style={{ marginTop: 10, paddingTop: 9, borderTop: '1px dashed #cbd5e1' }}>
                      <div style={sectionTitleStyle}>新增自定义 XML 属性</div>
                      <div style={{ display: 'flex', gap: 5 }}>
                        <input
                          aria-label="新建 XML 属性名"
                          type="text"
                          value={newAttributeName}
                          placeholder="例如 path_file、ID、service_name"
                          onChange={(event) => setNewAttributeName(event.target.value)}
                          style={{ ...controlStyle, flex: 1 }}
                        />
                        <button
                          type="button"
                          disabled={
                            !newAttributeName.trim() ||
                            newAttributeName.trim() === 'name' ||
                            !isValidXmlName(newAttributeName) ||
                            declared.has(newAttributeName.trim())
                          }
                          onClick={() => {
                            const name = newAttributeName.trim();
                            if (!name || name === 'name' || declared.has(name)) return;
                            onChangePortValue(node.id, name, '');
                            setNewAttributeName('');
                          }}
                        >
                          添加
                        </button>
                      </div>
                      <div style={{ ...helpStyle, marginTop: 5 }}>
                        未在 manifest 中声明的属性只用于设计和 XML 导出；名称必须是合法 XML 属性，
                        后端严格校验时还必须由自定义节点的 providedPorts() 声明。
                      </div>
                    </div>
                  </>
                );
              })()}
            </section>

            <section style={{ borderBottom: '1px solid #e5e7eb', padding: '10px 0' }}>
              <div style={sectionTitleStyle}>当前 XML 属性</div>
              <pre style={xmlPreviewStyle}>{buildNodeXmlPreview(node)}</pre>
              {manifest?.documentation?.example_xml && (
                <details style={{ marginTop: 7 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 11, color: '#1d4ed8' }}>查看节点最小示例</summary>
                  <pre style={xmlPreviewStyle}>{manifest.documentation.example_xml}</pre>
                </details>
              )}
            </section>

            <div style={{ marginTop: 10, fontSize: 11, color: '#6b7280' }}>
              最近运行态：<strong style={{ color: '#111827' }}>{node.data.runStatus}</strong>
            </div>
            <button
              type="button"
              onClick={() => onDelete(node.id)}
              style={{
                marginTop: 12,
                width: '100%',
                minHeight: 32,
                padding: '6px 8px',
                background: '#fff1f2',
                color: '#be123c',
                border: '1px solid #fda4af',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              删除该节点
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

const sectionTitleStyle = { fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 5 };
const bodyStyle = { fontSize: 11, lineHeight: 1.5, color: '#4b5563' };
const xmlPreviewStyle = {
  margin: '6px 0 0',
  padding: 7,
  background: '#f3f4f6',
  border: '1px solid #e5e7eb',
  borderRadius: 4,
  fontSize: 10,
  lineHeight: 1.45,
  whiteSpace: 'pre-wrap' as const,
  overflowWrap: 'anywhere' as const,
};
