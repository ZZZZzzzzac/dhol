import { configDefaults, defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'src/__tests__/room-v2-workerd.test.ts'],
  },
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(new URL('./src/__tests__/cloudflare-workers-stub.ts', import.meta.url)),
    },
  },
})
