import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
// fileURLToPath (not .pathname) so the alias resolves on Windows too
export default defineConfig({ plugins: [react()], resolve: { alias: { '@stormroute/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) } }, envDir: fileURLToPath(new URL('../..', import.meta.url)) });

