import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // The browser calls /api on the Vite origin; Vite forwards it to the Fastify server.
    // Same origin in dev, so no CORS round-trip and mic access works on localhost.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});
