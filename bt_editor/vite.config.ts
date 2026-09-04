/**
 * @author lovelyyoshino
 * @date 2026-06-30
 * @version v1.2.1
 * @last_modified 2026-08-18
 * @changelog
 *   - v1.2.1 (2026-08-18): 默认代理固定 IPv4 回环地址，避免 localhost IPv6 解析导致连接失败
 *   - v1.2.0 (2026-08-18): 增加只读 ROS2 Web 网关代理，和树执行后端分离
 *   - v1.1.0 (2026-07-13): 让生产预览也可代理真实 bt_server，供 live E2E 使用
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 开发服务器与生产预览共用一个代理契约，避免 live E2E 验证到不同拓扑。
export default defineConfig(() => {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  const backendUrl =
    runtime.process?.env?.BT_BACKEND_URL || 'http://localhost:8080';
  const rosWebUrl =
    runtime.process?.env?.BT_ROS_WEB_URL || 'http://127.0.0.1:8088';
  const apiProxy = {
    '/api': {
      target: backendUrl,
      changeOrigin: true,
    },
  };
  // ROS2 能力是独立的只读来源，不能把 /api/tree/* 转到 bt_web。
  const rosProxy = {
    '/ros-api': {
      target: rosWebUrl,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/ros-api/, ''),
    },
  };

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: { ...apiProxy, ...rosProxy },
    },
    preview: {
      proxy: { ...apiProxy, ...rosProxy },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts'],
    },
  };
});
