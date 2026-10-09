import assert from 'node:assert/strict'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const base = process.env.ROOM_V2_BASE ?? 'http://127.0.0.1:8791'
const statePath = resolve(import.meta.dirname, '../tmp/room-v2-restart-state.json')
const fixturePath = resolve(import.meta.dirname, '../packages/shared/src/__tests__/fixtures/daggerheart-sheet.json')
const mode = process.argv[2]

async function api(path, init) {
  const response = await fetch(`${base}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  const body = await response.json()
  assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(body)}`)
  return body
}
async function socket(url) {
  const ws = new WebSocket(url)
  const messages = []
  ws.addEventListener('message', event => messages.push(JSON.parse(event.data)))
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  return { ws, send: value => ws.send(JSON.stringify(value)), async wait(predicate) {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      const match = messages.find(predicate)
      if (match) return match
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw new Error('WebSocket timeout')
  } }
}

if (mode === 'setup') {
  const sheet = JSON.parse(await readFile(fixturePath, 'utf8'))
  const created = await api('/api/v2/rooms', { method: 'POST', body: JSON.stringify({ room_name: 'restart check', nickname: '测试' }) })
  const code = created.room.inviteCode
  const delivery = await api(`/api/v2/rooms/${code}/characters`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ schemaVersion: 1, sheet }) })
  const connection = await socket(created.session.websocketUrl)
  connection.send({ type: 'room.sync', protocolVersion: 2, afterSeq: 0, pendingRequestIds: [] })
  await connection.wait(message => message.type === 'room.snapshot')
  const requestId = crypto.randomUUID()
  connection.send({ type: 'character.setMark', protocolVersion: 2, requestId, name: sheet.name, generation: delivery.generation, resource: 'stress', index: 1, marked: true })
  const ack = await connection.wait(message => message.type === 'operation.ack' && message.requestId === requestId)
  connection.ws.close()
  await writeFile(statePath, JSON.stringify({ code, token: created.session.token, websocketUrl: created.session.websocketUrl, roomId: created.room.roomId, requestId, seq: ack.seq, name: sheet.name }), 'utf8')
  console.log(JSON.stringify({ ok: true, phase: 'setup', seq: ack.seq }))
} else if (mode === 'check') {
  const state = JSON.parse(await readFile(statePath, 'utf8'))
  const snapshot = await api(`/api/v2/rooms/${state.code}/snapshot`, { headers: { Authorization: `Bearer ${state.token}` } })
  assert.equal(snapshot.room.roomId, state.roomId)
  assert.equal(snapshot.room.seq, state.seq)
  assert.equal(snapshot.room.characters[0].resources.stress[1], true)
  const connection = await socket(state.websocketUrl)
  connection.send({ type: 'room.sync', protocolVersion: 2, afterSeq: 0, pendingRequestIds: [state.requestId] })
  const recovered = await connection.wait(message => message.type === 'room.snapshot')
  assert.equal(recovered.receipts[0].seq, state.seq)
  connection.ws.close()
  await rm(statePath)
  console.log(JSON.stringify({ ok: true, phase: 'check', seq: state.seq }))
} else throw new Error('Use setup or check')
