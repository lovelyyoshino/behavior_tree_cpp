/**
 * NodePalette.tsx — 可拖拽、可点击的节点清单
 *
 * @author pony
 * @date 2026-06-30
 * @version v1.2.0
 * @last_modified 2026-07-13
 * @changelog
 *   - v1.2.0 (2026-08-18): 增加不依赖前端白名单的自定义 XML 节点入口
 *   - v1.1.0 (2026-07-13): 增加触控和键盘可用的点击添加入口
 *
 * 启动时由父组件从 GET /api/nodes 拉取的 manifest 渲染。
 * 按节点大类(Control/Decorator/Action/Condition)分组，每个条目可拖拽到画布。
 *
 * 拖拽实现：HTML5 原生 drag。dragstart 时把 manifest 的注册名写入 dataTransfer，
 * 画布在 drop 时读取并据此创建节点（见 Canvas.tsx 的 onDrop）。
 */

import { useState } from 'react';
import type { NodeManifest, NodeKind } from '../types';
import { KIND_COLORS } from '../theme';
import { isValidXmlName } from '../utils/xml';
import { NODE_TEMPLATES, type NodeTemplate } from '../utils/node_templates';

/** 拖拽时使用的自定义 MIME 类型 */
export const DND_MIME = 'application/bt-node';

interface Props {
  manifests: NodeManifest[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onAdd: (manifest: NodeManifest) => void;
  onAddCustom: (registrationName: string, kind: NodeKind) => void;
  /** 一次插入一个通用节点组合模板（多节点 + 连线）。 */
  onAddTemplate: (template: NodeTemplate) => void;
}

/** 分组顺序固定，保证面板布局稳定 */
const GROUP_ORDER: NodeKind[] = ['Control', 'Decorator', 'Action', 'Condition'];

/** 分组配色复用全局主题色，避免与画布节点配色漂移 */
const GROUP_COLORS = KIND_COLORS;

export function NodePalette({ manifests, loading, error, onReload, onAdd, onAddCustom, onAddTemplate }: Props) {
  const [customName, setCustomName] = useState('');
  const [customKind, setCustomKind] = useState<NodeKind>('Action');
  // 按大类分组
  const grouped: Record<NodeKind, NodeManifest[]> = {
    Control: [],
    Decorator: [],
    Action: [],
    Condition: [],
  };
  for (const m of manifests) {
    // 防御：未知 type 归入 Action，避免漏渲染
    const k = (GROUP_COLORS[m.type] ? m.type : 'Action') as NodeKind;
    grouped[k].push(m);
  }

  /** 拖拽开始：把注册名放进 dataTransfer */
  function handleDragStart(e: React.DragEvent, regName: string) {
    e.dataTransfer.setData(DND_MIME, regName);
    e.dataTransfer.effectAllowed = 'move';
  }

  return (
    <aside
      className="bt-node-palette"
      style={{
        borderRight: '1px solid #e5e7eb',
        background: '#fafafa',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <strong>节点面板</strong>
        <button onClick={onReload} disabled={loading} title="重新拉取 /api/nodes">
          刷新
        </button>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const name = customName.trim();
          if (!name || name === 'name') return;
          onAddCustom(name, customKind);
          setCustomName('');
        }}
        style={{ padding: '8px', borderBottom: '1px solid #e5e7eb', background: '#fff' }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 5 }}>
          自定义 XML 节点
        </div>
        <input
          aria-label="自定义节点注册名"
          value={customName}
          onChange={(event) => setCustomName(event.target.value)}
          placeholder="例如 LoadYuyiPath"
          style={{ width: '100%', boxSizing: 'border-box', minHeight: 27, padding: '4px 6px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 11 }}
        />
        <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
          <select
            aria-label="自定义节点类别"
            value={customKind}
            onChange={(event) => setCustomKind(event.target.value as NodeKind)}
            style={{ flex: 1, minHeight: 27, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 11 }}
          >
            {GROUP_ORDER.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </select>
          <button
            type="submit"
            disabled={!customName.trim() || customName.trim() === 'name' || !isValidXmlName(customName)}
          >
            添加
          </button>
        </div>
        <div style={{ marginTop: 4, fontSize: 10, lineHeight: 1.4, color: '#6b7280' }}>
          {customName.trim() && !isValidXmlName(customName)
            ? '注册名必须以字母或下划线开头，只能包含字母、数字、_、-、.'
            : '只创建编辑器节点和 XML 属性；执行前仍需后端注册同名 C++ 节点。'}
        </div>
      </form>

      <div
        style={{
          padding: '8px',
          borderBottom: '1px solid #e5e7eb',
          background: '#fff',
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 5 }}>
          通用模板库
        </div>
        {NODE_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => onAddTemplate(template)}
            title={template.description}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '6px 8px',
              marginBottom: 4,
              background: '#fff',
              border: '1px solid #c7d2fe',
              borderLeft: '4px solid #6366f1',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 12,
              color: 'inherit',
              fontFamily: 'inherit',
            }}
          >
            <span style={{ fontWeight: 700 }}>{template.label}</span>
            <span style={{ color: '#9ca3af', marginLeft: 4 }}>
              · {template.nodes.length} 节点
            </span>
          </button>
        ))}
      </div>

      <div style={{ overflowY: 'auto', flex: 1, padding: 8 }}>
        {loading && <div style={{ color: '#6b7280' }}>加载节点中…</div>}
        {error && (
          <div
            role="status"
            style={{
              color: '#92400e',
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: 4,
              padding: 7,
              marginBottom: 8,
              fontSize: 11,
              lineHeight: 1.4,
            }}
          >
            节点清单暂不可用：{error}
            <div style={{ marginTop: 3 }}>
              当前显示编辑器内置结构节点；自定义节点仍可手动添加，执行前请连接对应后端。
            </div>
          </div>
        )}
        {!loading &&
          GROUP_ORDER.map((group) => {
            const items = grouped[group];
            if (items.length === 0) return null;
            return (
              <div key={group} style={{ marginBottom: 12 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: GROUP_COLORS[group],
                    margin: '4px 2px',
                  }}
                >
                  {group}（{items.length}）
                </div>
                {items.map((m) => (
                  <button
                    key={m.registration_name}
                    type="button"
                    draggable
                    onDragStart={(e) => handleDragStart(e, m.registration_name)}
                    onClick={() => onAdd(m)}
                    aria-label={`添加 ${m.registration_name} 节点`}
                    title={m.ports
                      .map((p) => `${p.name}(${p.direction}): ${p.description}`)
                      .concat('点击添加；桌面端也可拖到画布')
                      .join('\n')}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '6px 8px',
                      marginBottom: 4,
                      background: '#fff',
                      border: `1px solid ${GROUP_COLORS[group]}55`,
                      borderLeft: `4px solid ${GROUP_COLORS[group]}`,
                      borderRadius: 6,
                      cursor: 'grab',
                      fontSize: 13,
                      color: 'inherit',
                      fontFamily: 'inherit',
                      touchAction: 'manipulation',
                    }}
                  >
                    {m.registration_name}
                    {m.ports.length > 0 && (
                      <span style={{ color: '#9ca3af', marginLeft: 4 }}>
                        · {m.ports.length} 端口
                      </span>
                    )}
                  </button>
                ))}
              </div>
            );
          })}
      </div>
    </aside>
  );
}
