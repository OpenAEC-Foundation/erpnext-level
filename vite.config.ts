import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import dashboardPlugin from './vite-plugin-dashboard'

// All API requests go through the backend server
export default defineConfig({
  plugins: [react(), tailwindcss(), dashboardPlugin()],
  server: {
    proxy: {
      "/api": { target: "http://localhost:3001", changeOrigin: true },
      "/ws": { target: "http://localhost:3001", changeOrigin: true, ws: true },
      "/erpnext-proxy": { target: "http://localhost:3001", changeOrigin: true },
    },
  },
})
