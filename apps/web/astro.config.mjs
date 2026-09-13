import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'static',
  integrations: [react()],
  server: { port: 4321 },
  vite: {
    plugins: [tailwindcss()],
    server: {
      proxy: {
        '/api': { target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000', changeOrigin: true },
      },
    },
  },
});
