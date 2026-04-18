import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['bin/aok.ts'],
  format: ['cjs'],
  target: 'node18',
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
