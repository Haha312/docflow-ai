import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  server: {
    port: 5175, // 临时:5174 被 FlowAI 占用,改 5175(已加入后端 CORS 白名单);测试完改回 5174
    host: '0.0.0.0',
    strictPort: true, // 端口被占就直接报错,不要自动 +1 — 避免 CORS 不匹配
  },
  plugins: [
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  }
});
