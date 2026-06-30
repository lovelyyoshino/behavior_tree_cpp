/**
 * 属性面板 PropertyPanel
 *
 * 选中某个节点后，展示并允许编辑：
 * - 实例名(name 属性)
 * - 每个端口的值：可填字面量，也可用 "{黑板key}" 做端口重映射
 *
 * 端口列表来自该节点的 manifest（拖入时已写入 data.portManifests）。
 * 编辑通过回调 onChange 把更新后的 portValues / instanceName 提交给上层。
 */

import type { BtNode, PortManifest } from '../types';

interface Props {
  node: BtNode | null;
  onChangeInstanceName: (id: string, name: string) => void;
  onChangePortValue: (id: string, port: string, value: string) => void;
  onDelete: (id: string) => void;
}

/** 单个端口编辑行 */
function PortRow({
  port,
  value,
  onChange,
}: {
  port: PortManifest;
  value: string;
  onChange: (v: string) => void;
}) {
  // 是否处于黑板重映射模式（值形如 "{key}"）
  const isRemap = /^\{.*\}$/.test(value);
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600 }}>
        {port.name}
        <span style={{ color: '#9ca3af', fontWeight: 400, marginLeft: 4 }}>
          ({port.direction})
        </span>
        {isRemap && (
          <span style={{ color: '#a855f7', marginLeft: 4 }}>· 黑板重映射</span>
        )}
      </label>
      {port.description && (
        <div style={{ fontSize: 11, color: '#9ca3af', margin: '2px 0' }}>
          {port.description}
        </div>
      )}
      <input
        type="text"
        value={value}
        placeholder={
          port.default_value
            ? `默认: ${port.default_value}`
            : '字面量或 {黑板key}'
        }
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '4px 6px',
          border: `1px solid ${isRemap ? '#a855f7' : '#d1d5db'}`,
          borderRadius: 4,
          fontSize: 13,
        }}
      />
    </div>
  );
}

export function PropertyPanel({
  node,
  onChangeInstanceName,
  onChangePortValue,
  onDelete,
}: Props) {
  return (
    <aside
      style={{
        width: 280,
        borderLeft: '1px solid #e5e7eb',
        background: '#fafafa',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb' }}>
        <strong>属性面板</strong>
      </div>

      <div style={{ overflowY: 'auto', flex: 1, padding: 12 }}>
        {!node && (
          <div style={{ color: '#9ca3af', fontSize: 13 }}>
            在画布上选中一个节点以编辑其属性。
          </div>
        )}

        {node && (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>注册名</div>
              <div style={{ fontWeight: 700 }}>{node.data.registrationName}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                类型：{node.data.kind}
              </div>
            </div>

            {/* 实例名编辑 */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600 }}>
                实例名 (name)
              </label>
              <input
                type="text"
                value={node.data.instanceName}
                placeholder="可选，XML name 属性"
                onChange={(e) =>
                  onChangeInstanceName(node.id, e.target.value)
                }
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '4px 6px',
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  fontSize: 13,
                }}
              />
            </div>

            {/* 端口编辑 */}
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
              端口
            </div>
            {node.data.portManifests.length === 0 && (
              <div style={{ fontSize: 12, color: '#9ca3af' }}>该节点无端口。</div>
            )}
            {node.data.portManifests.map((port) => (
              <PortRow
                key={port.name}
                port={port}
                value={node.data.portValues[port.name] ?? ''}
                onChange={(v) => onChangePortValue(node.id, port.name, v)}
              />
            ))}

            {/* 当前运行态 */}
            <div style={{ marginTop: 14, fontSize: 12, color: '#6b7280' }}>
              运行态：<strong>{node.data.runStatus}</strong>
            </div>

            <button
              onClick={() => onDelete(node.id)}
              style={{
                marginTop: 16,
                width: '100%',
                padding: '6px 8px',
                background: '#fee2e2',
                color: '#dc2626',
                border: '1px solid #fca5a5',
                borderRadius: 6,
                cursor: 'pointer',
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
