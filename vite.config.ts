import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      // 管理 API
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      // 微信接入端点：开发时通过 5173 端口即可被微信服务器访问（需配合内网穿透）。
      // 使用正则精确匹配 /wechat 本身，避免前缀匹配吞掉前端路由 /wechat-config。
      '^/wechat(\\?|$)': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  css: {
    preprocessorOptions: {
      less: {
        javascriptEnabled: true
      }
    }
  }
});
