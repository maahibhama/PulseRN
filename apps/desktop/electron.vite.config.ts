import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    define: {
      'process.env.PULSERN_POSTHOG_KEY': JSON.stringify(process.env['PULSERN_POSTHOG_KEY'] ?? ''),
      'process.env.PULSERN_POSTHOG_HOST': JSON.stringify(process.env['PULSERN_POSTHOG_HOST'] ?? ''),
    },
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@pulse-rn/api-contract',
          '@pulse-rn/mcp',
          '@pulse-rn/protocol',
          '@pulse-rn/shared',
        ],
      }),
    ],
  },
  preload: {
    build: {
      rollupOptions: {
        output: {
          entryFileNames: 'index.cjs',
          format: 'cjs',
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
      },
    },
    plugins: [react()],
  },
});
