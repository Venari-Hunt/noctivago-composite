// Bundles src/index.js into one self-contained ES module, main.js, at the
// top of the repo. That's the file manifest.json names and the release
// attaches. The app import()s it as-is over plugin://.
import { defineConfig } from 'vite'

export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: '.',
    emptyOutDir: false,
    minify: true,
    lib: {
      entry: 'src/index.js',
      formats: ['es'],
      fileName: () => 'main.js'
    }
  }
})
