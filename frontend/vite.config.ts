import path from 'path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import os from 'os'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 从项目根目录（frontend 的上一级）加载 .env 文件
  const env = loadEnv(mode, path.resolve(process.cwd(), '..'), '')

  let apiPort = env.API_PORT || '18321'
  let apiHost = env.API_HOST || '127.0.0.1'
  let webPort = parseInt(env.WEB_PORT || '1420', 10)

  // 从 app.json 读取配置（最高优先级）
  try {
    const configPath = path.join(os.homedir(), '.datation/config/app.json');
    if (fs.existsSync(configPath)) {
      const appConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (appConfig.api_host) apiHost = String(appConfig.api_host);
      if (appConfig.api_port) apiPort = String(appConfig.api_port);
      if (appConfig.web_port) webPort = parseInt(appConfig.web_port, 10);
    }
  } catch (e) {
    // ignore
  }

  // 0.0.0.0 是服务器监听地址，前端客户端应使用 127.0.0.1
  const formattedHost = apiHost === '0.0.0.0' ? '127.0.0.1' : apiHost
  const apiBaseUrl = `http://${formattedHost}:${apiPort}`

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    define: {
      // In production (vite build), frontend is served by FastAPI on the same
      // origin, so API calls should use relative URLs (empty base).
      // In development, resolve to the computed backend address.
      'import.meta.env.VITE_API_BASE_URL': mode === 'production'
        ? JSON.stringify('')
        : JSON.stringify(apiBaseUrl)
    },
    clearScreen: false,
    server: {
      port: webPort,
      strictPort: false,
    },
  }
})
