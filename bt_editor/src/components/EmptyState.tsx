/**
 * 空状态引导 EmptyState
 *
 * 画布没有任何节点时覆盖在画布上方，引导用户两条上手路径：
 * - 从左侧节点面板拖入节点
 * - 一键载入内置示例树
 *
 * 用 pointerEvents 控制：容器本身不拦截画布交互（便于拖放落点计算），
 * 仅"载入示例"按钮可点击。
 */

interface Props {
  /** 点击"载入示例"回调 */
  onLoadSample: () => void;
}

export function EmptyState({ onLoadSample }: Props) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        pointerEvents: 'none', // 不拦截画布拖放
        textAlign: 'center',
        color: '#6b7280',
        zIndex: 5,
      }}
    >
      <div style={{ fontSize: 40 }}>🌳</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#374151' }}>
        画布还是空的
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
        从左侧面板<strong>拖入节点</strong>开始搭建，
        <br />
        或点击下方按钮载入一棵示例树。
      </div>
      <button
        onClick={onLoadSample}
        style={{
          pointerEvents: 'auto', // 按钮可点击
          marginTop: 4,
          padding: '8px 18px',
          background: '#3b82f6',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          fontSize: 14,
          cursor: 'pointer',
          boxShadow: '0 2px 6px #3b82f655',
        }}
      >
        载入示例
      </button>
    </div>
  );
}
