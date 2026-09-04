/**
 * BlackboardPanel.tsx — 运行树黑板初始化参数编辑器
 *
 * @author pony
 * @date 2026-08-18
 * @version v1.0.3
 * @last_modified 2026-08-18
 * @changelog
 *   - v1.0.3 (2026-08-18): 明确黑板初值自动绑定到 XML 并由后端解析
 *   - v1.0.2 (2026-08-18): 为手机参数表单提供逐字段标签
 *   - v1.0.1 (2026-08-18): 明确展示标准 {key} 端口引用写法
 *   - v1.0.0 (2026-08-18): 支持 string/bool/int/double 参数和运行时初始化提示
 *
 * 这里编辑的是“载入前的初始值”，不是 ROS 回调的实时数据。ROS 输入节点仍应负责
 * 在 tick 期间把消息写入黑板；这样测试参数和真实传感器数据不会混为一谈。
 */

import type { BlackboardEntry, BlackboardValueType } from '../types';

interface Props {
  entries: BlackboardEntry[];
  onChange: (index: number, patch: Partial<BlackboardEntry>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}

const typeOptions: Array<{ value: BlackboardValueType; label: string }> = [
  { value: 'string', label: 'string 文本' },
  { value: 'bool', label: 'bool 布尔' },
  { value: 'int', label: 'int 整数' },
  { value: 'double', label: 'double 小数' },
];

const inputStyle: React.CSSProperties = {
  minHeight: 28,
  padding: '4px 7px',
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  background: '#fff',
  fontSize: 12,
};

export function BlackboardPanel({ entries, onChange, onAdd, onRemove }: Props) {
  const duplicateKeys = new Set(
    entries
      .map((entry) => entry.key.trim())
      .filter((key, index, all) => key && all.indexOf(key) !== index),
  );

  return (
    <section className="bt-blackboard-panel" aria-label="黑板参数">
      <div className="bt-blackboard-header">
        <div>
          <strong>黑板参数</strong>
          <span className="bt-blackboard-count">{entries.length} 个参数</span>
          <div className="bt-blackboard-help">
            初始值会自动写入 XML；载入或 Run 时由后端恢复，ROS 输入节点运行后可以覆盖运行时值。
          </div>
        </div>
        <button type="button" onClick={onAdd} aria-label="新增黑板参数">
          + 新增参数
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="bt-blackboard-empty">
          当前没有初始参数。可以直接使用节点的 <code>{'{key}'}</code> 端口，或新增一个测试/任务参数。
        </div>
      ) : (
        <div className="bt-blackboard-table-wrap">
          <table className="bt-blackboard-table">
            <thead>
              <tr>
                <th scope="col">键名</th>
                <th scope="col">类型</th>
                <th scope="col">初始值</th>
                <th scope="col">用途说明</th>
                <th scope="col"><span className="sr-only">操作</span></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => {
                const keyError = !entry.key.trim() || duplicateKeys.has(entry.key.trim());
                return (
                  <tr key={`${index}-${entry.key}`}>
                    <td data-label="键名">
                      <input
                        aria-label={`黑板键名 ${index + 1}`}
                        value={entry.key}
                        placeholder="例如 temperature"
                        onChange={(event) => onChange(index, { key: event.target.value })}
                        style={{ ...inputStyle, borderColor: keyError ? '#fca5a5' : '#cbd5e1' }}
                      />
                      {keyError && <div className="bt-blackboard-error">键名不能为空且不能重复</div>}
                    </td>
                    <td data-label="类型">
                      <select
                        aria-label={`黑板类型 ${index + 1}`}
                        value={entry.type}
                        onChange={(event) => onChange(index, { type: event.target.value as BlackboardValueType })}
                        style={inputStyle}
                      >
                        {typeOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </td>
                    <td data-label="初始值">
                      {entry.type === 'bool' ? (
                        <label className="bt-blackboard-bool">
                          <input
                            aria-label={`黑板值 ${index + 1}`}
                            type="checkbox"
                            checked={entry.value === 'true' || entry.value === '1'}
                            onChange={(event) => onChange(index, { value: event.target.checked ? 'true' : 'false' })}
                          />
                          {entry.value === 'true' || entry.value === '1' ? 'true' : 'false'}
                        </label>
                      ) : (
                        <input
                          aria-label={`黑板值 ${index + 1}`}
                          type={entry.type === 'string' ? 'text' : 'number'}
                          step={entry.type === 'double' ? 'any' : '1'}
                          value={entry.value}
                          placeholder={entry.type === 'string' ? '输入文本' : '输入数字'}
                          onChange={(event) => onChange(index, { value: event.target.value })}
                          style={inputStyle}
                        />
                      )}
                    </td>
                    <td data-label="用途说明">
                      <input
                        aria-label={`黑板说明 ${index + 1}`}
                        value={entry.description}
                        placeholder="例如由 ROS 温度节点更新"
                        onChange={(event) => onChange(index, { description: event.target.value })}
                        style={{ ...inputStyle, width: '100%' }}
                      />
                    </td>
                    <td data-label="操作">
                      <button
                        type="button"
                        aria-label={`删除黑板参数 ${index + 1}`}
                        onClick={() => onRemove(index)}
                        className="bt-blackboard-remove"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
