/**
 * XmlPreviewPanel.tsx — XML 实时预览、复制、校验和格式化入口
 *
 * @author pony
 * @date 2026-06-30
 * @version v1.3.0
 * @last_modified 2026-08-18
 * @changelog
 *   - v1.3.0 (2026-08-18): 增加 XML 下载和 XML + 黑板配置包导出
 *   - v1.2.0 (2026-08-18): 增加黑板初值摘要，区分 XML 重映射与运行前注入
 *   - v1.1.0 (2026-07-13): 预览工具条支持窄屏换行
 */
import type { BlackboardEntry } from '../types';

interface Props {
  xml: string;
  error: string | null;
  busy: boolean;
  connected: boolean;
  lastRunSummary: string | null;
  blackboardEntries: BlackboardEntry[];
  onCopy: () => void;
  onDownloadXml: () => void;
  onDownloadBundle: () => void;
  onValidate: () => void;
  onFormat: () => void;
}

export function XmlPreviewPanel({
  xml,
  error,
  busy,
  connected,
  lastRunSummary,
  blackboardEntries,
  onCopy,
  onDownloadXml,
  onDownloadBundle,
  onValidate,
  onFormat,
}: Props) {
  const disabled = busy || !connected || Boolean(error);
  return (
    <section
      className="bt-xml-preview"
      style={{
        borderTop: '1px solid #e5e7eb',
        background: '#0f172a',
        color: '#e5e7eb',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        className="bt-xml-toolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 12px',
          borderBottom: '1px solid rgba(255,255,255,0.12)',
        }}
      >
        <strong>XML 脚本预览</strong>
        <span style={{ fontSize: 12, color: error ? '#fca5a5' : '#94a3b8' }}>
          {error ?? '按当前画布结构实时生成'}
        </span>
        {lastRunSummary && (
          <span style={{ marginLeft: 8, fontSize: 12, color: '#93c5fd' }}>
            {lastRunSummary}
          </span>
        )}
        <span className="bt-xml-spacer" style={{ flex: 1 }} />
        <button type="button" disabled={Boolean(error)} onClick={onCopy}>
          复制
        </button>
        <button type="button" disabled={busy || Boolean(error)} onClick={onDownloadXml}>
          下载 XML
        </button>
        <button type="button" disabled={busy || Boolean(error)} onClick={onDownloadBundle}>
          导出树 + 黑板
        </button>
        <button type="button" disabled={disabled} onClick={onValidate}>
          后端校验
        </button>
        <button type="button" disabled={disabled} onClick={onFormat}>
          后端格式化
        </button>
      </div>
      <div className="bt-xml-blackboard-strip" aria-label="黑板初值摘要">
        <strong>黑板初值</strong>
        {blackboardEntries.length === 0 ? (
          <span>暂无；XML 中仍会保留端口的 {'{key}'} 重映射。</span>
        ) : (
          <>
            <span>
              {blackboardEntries.length} 项，XML 的 TreeNodesModel/Blackboard 区会保存初值；
              ROS 输入节点运行后可以覆盖运行时值。
            </span>
            <code>
              {blackboardEntries
                .map((entry) => `${entry.key || '<空键名>'} = ${entry.value} (${entry.type})`)
                .join(' · ')}
            </code>
          </>
        )}
      </div>
      <textarea
        readOnly
        value={error ? '' : xml}
        placeholder={error ?? '暂无 XML'}
        style={{
          flex: 1,
          resize: 'none',
          border: 0,
          outline: 'none',
          padding: 12,
          background: '#111827',
          color: '#d1fae5',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: 12,
          lineHeight: 1.45,
        }}
      />
    </section>
  );
}
