import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('boundary self-test rejects non-literal dynamic imports', () => {
  const result = spawnSync(process.execPath, ['scripts/check-desktop-boundaries.mjs', '--self-test'], { cwd: process.cwd(), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(result.stdout.match(/非字面量动态依赖/g)?.length, 2, result.stdout)
})

test('boundary graph includes every production entrypoint', () => {
  const result = spawnSync(process.execPath, ['scripts/check-desktop-boundaries.mjs', '--show-entries'], { cwd: process.cwd(), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  for (const entry of ['fronted/src/main.tsx', 'fronted/src/desktop/DesktopApp.tsx', 'apps/realtime/src/room-v2-stage8-worker.ts', 'apps/realtime/src/room-v2.ts', 'apps/realtime/src/room-v2-http.ts', 'apps/realtime/src/character-ingest.ts', 'packages/shared/src/desktop.ts']) assert.match(result.stdout, new RegExp(entry.replaceAll('/', '\\/').replaceAll('.', '\\.')))
})

test('root scripts expose one non-recursive desktop boundary check', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.equal(pkg.scripts['check:desktop-boundaries'], 'node scripts/check-desktop-boundaries.mjs && node --test scripts/__tests__/check-desktop-boundaries.test.mjs')
  assert.equal(pkg.scripts.check, 'npm run check:desktop-boundaries && npm run build')
})
