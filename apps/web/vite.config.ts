import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Ports come from the environment so parallel sessions can run a second pair of servers
// (.claude/launch.json, api-alt and web-alt); the defaults are the usual 5173 and 3001.
function port(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be a port number`);
  }
  return parsed;
}

// The api keeps the plain paths from docs/INTERFACES.md; the dev server exposes them under /api.
const API_URL = `http://localhost:${port('API_PORT', 3001)}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: port('WEB_PORT', 5173),
    strictPort: true,
    proxy: {
      '/api': { target: API_URL, rewrite: (path) => path.replace(/^\/api/, '') },
      // Socket.IO keeps its own path; the session cookie rides on the proxied handshake.
      '/socket.io': { target: API_URL, ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
});
