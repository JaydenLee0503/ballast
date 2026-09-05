import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
