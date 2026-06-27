import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    include: ['tests/unit/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    environment: 'node',
    setupFiles: ['tests/setup/electron-stub.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/main/**/*.{ts,tsx}', 'src/shared/**/*.ts'],
      exclude: [
        '**/*.test.*',
        '**/*.spec.*',
        'src/main/index.ts',
        'src/main/window.ts',
        'src/main/database/migrations.ts',
        'src/main/**/migrations/**'
      ]
    }
  }
})
