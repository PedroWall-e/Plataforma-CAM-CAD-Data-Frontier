import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  optimizeDeps: {
    exclude: ['opencascade.js']
  },
  build: {
    rollupOptions: {
      // Keep opencascade.js out of the Rollup bundle entirely.
      // The worker loads it at runtime via a CDN/public path import.
      external: ['opencascade.js'],
    }
  },
  server: {
    port: 3060,
    strictPort: false,
  }
})

