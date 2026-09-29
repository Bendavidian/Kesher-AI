import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The api keeps the plain paths from docs/INTERFACES.md; the dev server exposes them under /api.
const API_URL = 'http://localhost:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API_URL, rewrite: (path) => path.replace(/^\/api/, '') },
      // Socket.IO keeps its own path; the session cookie rides on the proxied handshake.
      '/socket.io': { target: API_URL, ws: true },
    },
  },
  test: {
    environment: 'jsdom',
  },
});
