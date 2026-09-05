import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // `@/engine` is the app's only sanctioned door into the simulation module.
    // The alias exists so that door is short enough that nobody is tempted to
    // reach past it with a relative path into engine/wind.ts.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // The engine is the part that must not rot; the UI is covered by eye.
      include: ['src/engine/**/*.ts'],
      exclude: ['src/engine/**/*.test.ts'],
    },
  },
})
