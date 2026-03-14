import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({

  // Pré-optimiza os módulos Three.js para evitar HMR reload no primeiro uso
  optimizeDeps: {
    include: [
      "three",
      "three/examples/jsm/controls/OrbitControls.js",
      "three/examples/jsm/controls/TransformControls.js",
    ],
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
