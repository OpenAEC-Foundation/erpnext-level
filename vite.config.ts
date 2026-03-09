import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import dashboardPlugin from './vite-plugin-dashboard'

// Check if backend is intended to be used
const USE_BACKEND = process.env.USE_BACKEND === "true";

const backendProxy = {
  "/api/resource": { target: "http://localhost:3001", changeOrigin: true },
  "/api/method": { target: "http://localhost:3001", changeOrigin: true },
  "/api/status": { target: "http://localhost:3001", changeOrigin: true },
  "/erpnext-proxy": { target: "http://localhost:3001", changeOrigin: true },
};

const directProxy = {
  "/api/resource": { target: "https://3bm.prilk.cloud", changeOrigin: true, secure: true },
  "/api/method": { target: "https://3bm.prilk.cloud", changeOrigin: true, secure: true },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), dashboardPlugin()],
  server: {
    proxy: USE_BACKEND ? backendProxy : directProxy,
  },
})
