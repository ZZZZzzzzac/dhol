import assert from 'node:assert/strict'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'tmp/room-v2-sync-smoke.mjs')
await mkdir(resolve(root, 'tmp'), { recursive: true })
await build({ entryPoints: [resolve(root, 'fronted/src/desktop/state/room-sync.ts')], bundle: true, platform: 'node', format: 'esm', outfile: output })
const { RoomSync } = await import(pathToFileURL(output).href)
const base = process.env.ROOM_V2_BASE ?? 'http://127.0.0.1:8791'
const sheet = JSON.parse(await readFile(resolve(root, 'packages/shared/src/__tests__/fixtures/daggerheart-sheet.json'), 'utf8'))

async function api(path, init) {
  const response = await fetch(`${base}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  const result = await response.json()
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(result)}`)
  return result
}
async function until(check, label) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const result = check()
    if (result) return result
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out: ${label}`)
}
function memory() {
  const data = new Map()
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) }, removeItem: key => { data.delete(key) } }
}

const created = await api('/api/v2/rooms', { method: 'POST', body: JSON.stringify({ room_name: 'Client smoke', nickname: '甲' }) })
const code = created.room.inviteCode
await api(`/api/v2/rooms/${code}/characters`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ schemaVersion: 1, sheet }) })
const joined = await api('/api/v2/rooms/join', { method: 'POST', body: JSON.stringify({ invite_code: code, nickname: '乙' }) })
const storage = memory()
let dropRequestId = null
const sockets = []
function trackedSocket(url) {
  const socket = new WebSocket(url)
  const wrapper = {
    get readyState() { return socket.readyState },
    onopen: null, onmessage: null, onclose: null, onerror: null,
    send: data => socket.send(data), close: (...args) => socket.close(...args),
  }
  socket.addEventListener('open', event => wrapper.onopen?.(event))
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.requestId === dropRequestId) return
    wrapper.onmessage?.(event)
  })
  socket.addEventListener('close', event => wrapper.onclose?.(event))
  socket.addEventListener('error', event => wrapper.onerror?.(event))
  sockets.push(wrapper)
  return wrapper
}
const a = new RoomSync({ roomId: created.room.roomId, actorId: created.session.playerId, websocketUrl: created.session.websocketUrl, storage, client: { socketFactory: trackedSocket } })
const b = new RoomSync({ roomId: joined.room.roomId, actorId: joined.session.playerId, websocketUrl: joined.session.websocketUrl, storage: memory() })
a.start(); b.start()
await until(() => a.getState().connection === 'ready' && b.getState().connection === 'ready', 'both clients ready')
const lostId = a.submit({ type: 'room.adjustFear', delta: 1 })
dropRequestId = lostId
await until(() => b.getState().room?.fear.value === 1, 'observer sees lost ACK operation')
assert.equal(a.pending().length, 1)
assert.equal(a.getState().room.fear.value, 1)
sockets.at(-1).close(1000, 'test reconnect')
try { await until(() => a.getState().connection === 'ready' && a.pending().length === 0, 'reconnect receipt reconciliation') }
catch (error) { console.error({ connection: a.getState().connection, pending: a.pending().length, reason: a.getState().reason, socketCount: sockets.length }); throw error }
assert.equal(a.getState().room.fear.value, 1)
dropRequestId = null
const initial = a.getState().room.characters[0]
const markId = a.submit({ type: 'character.setMark', name: initial.name, generation: initial.generation, resource: 'stress', index: 0, marked: true })
await until(() => a.getState().save === 'saved' && b.getState().room?.characters[0].resources.stress[0], 'mark broadcast and saved')
assert.equal(a.pending().some(entry => entry.command.requestId === markId), false)
const rollId = a.submit({ type: 'dice.roll', payload: { mode: 'standard', modifier_mode: 'normal', repeat: 1, modifier: 0, dice: [{ sides: 20, count: 1 }] } })
await until(() => a.getState().save === 'saved' && b.getState().room?.dice.length === 1, 'dice broadcast and saved')
assert.equal(a.getState().room.dice[0].id, b.getState().room.dice[0].id)
assert.equal(a.pending().some(entry => entry.command.requestId === rollId), false)
a.destroy(); b.destroy()

const refreshed = new RoomSync({ roomId: created.room.roomId, actorId: created.session.playerId, websocketUrl: created.session.websocketUrl, storage })
refreshed.start()
await until(() => refreshed.getState().connection === 'ready', 'refreshed ready')
assert.equal(refreshed.getState().room.characters[0].resources.stress[0], true)
assert.equal(refreshed.getState().room.dice.length, 1)
refreshed.destroy()
await rm(output)
console.log(JSON.stringify({ ok: true, roomId: created.room.roomId, mark: true, dice: 1 }))
