import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: './src/index.ts',
    constants: './src/constants.ts',
    pairing: './src/pairing.ts',
    stdio: './src/stdio.ts',
    serve: './src/serve.ts'
  },
  platform: 'node',
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: './dist',
  treeshake: false,
  deps: {
    neverBundle: [/^@ai-sdk\//, /^@open-pencil\/mcp/, /^node:/, /^ws$/],
    onlyBundle: false
  }
})
