import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    include: ['src/__tests__/room-v2-workerd.test.ts'],
    testTimeout: 20_000,
    poolOptions: {
      workers: {
        singleWorker: true,
        isolatedStorage: false,
        wrangler: { configPath: './wrangler.toml' },
        miniflare: { bindings: { SESSION_SECRET: 'stage-eight-workerd-secret' } },
      },
    },
  },
})
