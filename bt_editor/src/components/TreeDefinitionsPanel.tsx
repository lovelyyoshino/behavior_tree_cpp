/**
 * TreeDefinitionsPanel.tsx - 主树/子树定义导航与生命周期管理。
 *
 * @author pony
 * @date 2026-08-18
 * @version v1.0.0
 * @last_modified 2026-08-18
 * @changelog
 *   - v1.0.0 (2026-08-18): 支持多 BehaviorTree 定义、主树切换和引用安全删除
 *
 * SubTreePlus 只保存 ID 映射，真正的子树定义在这里单独编辑。这样复杂的 Yuyi
 * XML 可以按定义拆成多个画布标签，同时导出时仍保留一份完整 XML 文档。
 */

import { useEffect, useState } from 'react';

interface Props {
  treeIds: string[];
  activeTreeId: string;
  mainTreeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string) => boolean;
  onSetMain: () => void;
  onDelete: () => void;
}

export function TreeDefinitionsPanel({
  treeIds,
  activeTreeId,
  mainTreeId,
  onSelect,
  onAdd,
  onRename,
  onSetMain,
  onDelete,
}: Props) {
  const [draftId, setDraftId] = useState(activeTreeId);

  useEffect(() => {
    setDraftId(activeTreeId);
  }, [activeTreeId]);

  const commitRename = () => {
    const nextId = draftId.trim();
    if (!nextId) {
      setDraftId(activeTreeId);
      return;
    }
    if (!onRename(nextId)) setDraftId(activeTreeId);
  };

  return (
    <section className="bt-tree-definitions" aria-label="行为树定义">
      <div className="bt-tree-definitions-title">
        <strong>树定义</strong>
        <span>SubTree / SubTreePlus 的目标在这里单独编辑，所有定义一起导出</span>
      </div>
      <div className="bt-tree-tabs" role="tablist" aria-label="BehaviorTree 定义列表">
        {treeIds.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === activeTreeId}
            className={id === activeTreeId ? 'bt-tree-tab active' : 'bt-tree-tab'}
            onClick={() => onSelect(id)}
            title={`编辑 ${id}`}
          >
            {id}
            {id === mainTreeId && <span className="bt-tree-main-badge">主树</span>}
          </button>
        ))}
      </div>
      <div className="bt-tree-definition-actions">
        <label>
          当前 ID
          <input
            aria-label="当前树定义 ID"
            value={draftId}
            onChange={(event) => setDraftId(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitRename();
              }
            }}
          />
        </label>
        <button type="button" onClick={onAdd} title="创建一个空的子树定义">
          + 新增子树
        </button>
        <button
          type="button"
          onClick={onSetMain}
          disabled={activeTreeId === mainTreeId}
          title="把当前定义作为 root main_tree_to_execute"
        >
          设为主树
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={treeIds.length <= 1}
          title="删除当前定义；仍被 SubTree 引用时会被阻止"
        >
          删除定义
        </button>
      </div>
    </section>
  );
}
