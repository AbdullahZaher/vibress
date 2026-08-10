import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/portal/',
  server: {
    port: process.env.PORTAL_PORT ? parseInt(process.env.PORTAL_PORT) : 7781,
    host: '0.0.0.0'
  }
})
