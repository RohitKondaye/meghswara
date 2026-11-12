import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    preserveSymlinks: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'zustand'],
          db: ['dexie', 'dexie-react-hooks'],
          icons: ['lucide-react'],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
