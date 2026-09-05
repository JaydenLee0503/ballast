import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { critiqueApi } from './plugins/critiqueApi.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Third argument '' disables the VITE_ prefix filter, so the server-side
  // credentials are readable here. They are passed to the plugin explicitly
  // and never into `define`, so they cannot reach the browser bundle.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      tailwindcss(),
      critiqueApi({
        apiKey: env['FEATHERLESS_API_KEY'],
        model: env['FEATHERLESS_MODEL'],
        baseUrl: env['FEATHERLESS_BASE_URL'],
      }),
    ],
    resolve: {
      // `@/engine` is the app's only sanctioned door into the simulation
      // module. The alias exists so that door is short enough that nobody is
      // tempted to reach past it with a relative path into engine/wind.ts.
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        // The engine and the AI plumbing are the parts that must not rot; the
        // UI is covered by eye.
        include: [
          'src/engine/**/*.ts',
          'src/ai/**/*.ts',
          'src/persistence/**/*.ts',
        ],
        exclude: ['src/**/*.test.ts', 'src/ai/client.ts'],
      },
    },
  }
})
