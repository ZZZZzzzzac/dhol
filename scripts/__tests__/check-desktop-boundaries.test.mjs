import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

test('boundary self-test rejects legacy backend and shared modules through barrel and dynamic imports', () => {
  const result = spawnSync(process.execPath, ['scripts/check-desktop-boundaries.mjs', '--self-test'], { cwd: process.cwd(), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  for (const fragment of ['apps/realtime/src/legacy-room.ts', 'packages/shared/src/types.ts', 'packages/shared/src/protocol.ts', 'packages/shared/src/utils.ts']) {
    assert.match(result.stdout, new RegExp(fragment.replaceAll('/', '\\/').replaceAll('.', '\\.')))
  }
})
