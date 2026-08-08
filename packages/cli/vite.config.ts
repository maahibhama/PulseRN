import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rendererRoot = fileURLToPath(new URL('../../apps/desktop/src/renderer', import.meta.url));

export default defineConfig({
  root: rendererRoot,
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./dist/public', import.meta.url)),
    emptyOutDir: true,
  },
});
