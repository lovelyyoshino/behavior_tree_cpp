import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 配置：开发期把 /api 代理到 bt_server (http://localhost:8080)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 所有 /api 请求转发到本地 bt_server，避免浏览器跨域
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        // 后端路由本身就是 /api/xxx，无需重写路径
      },
    },
  },
});
