import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const sharedAlias = { '@shared': resolve('src/shared') }

// The Chat SDK and channel adapters are ESM-only or ESM-first. The main-process bundle is
// emitted as CJS, so the bridge loads them with runtime `import()` and lets Node resolve their
// ESM exports directly. Do not bundle them: Rollup's CJS interop can turn unified/remark default
// plugins into empty objects, which breaks message parsing in adapters such as QQ.

// Optional native/perf modules that `discord.js` / `@discordjs/ws` / `ws` probe with a
// conditional `require()` (transport compression, faster (de)serialisation, voice). They are
// NOT installed and are not needed for text bots, but because we bundle the Discord adapter
// (ESM) into the CJS main bundle, Rolldown tries to resolve these bare requires at build time
// and fails. Keep them external so the bundled `require()` survives and throws only if a code
// path actually needs them — which our text-only bridge never hits.
const optionalNativeDeps = [
  'zlib-sync',
  'bufferutil',
  'utf-8-validate',
  'erlpack',
  '@discordjs/opus',
  'sodium-native',
  'libsodium-wrappers',
  'node-opus',
  'opusscript'
]

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: optionalNativeDeps
      }
    }
  },
  preload: {
    resolve: { alias: sharedAlias },
    plugins: [externalizeDepsPlugin({ exclude: ['electron-log'] })]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src'),
        ...sharedAlias
      }
    },
    plugins: [tailwindcss(), react()],
    build: {
      rollupOptions: {
        input: {
          main: resolve('src/renderer/index.html'),
          pet: resolve('src/renderer/pet.html')
        }
      }
    }
  }
})
