import { defineConfig } from 'tsup';
// Bundles the API + worker to plain ESM so `node dist/index.js` works (inlines @stormroute/shared; node_modules stay external).
export default defineConfig({ entry: { index: 'src/index.ts', 'workers/index': 'src/workers/index.ts', 'db/migrate': 'src/db/migrate.ts' }, format: ['esm'], target: 'node22', platform: 'node', splitting: false, sourcemap: true, clean: true, noExternal: ['@stormroute/shared'] });
