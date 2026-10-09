import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const base = process.env.ROOM_V2_BASE ?? 'http://127.0.0.1:8791'
const sheet = JSON.parse(await readFile(new URL('../packages/shared/src/__tests__/fixtures/daggerheart-sheet.json', import.meta.url), 'utf8'))

async function api(path, init) {
  const result = await fetch(`${base}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  const body = await result.json()
  assert.ok(result.ok, `${path}: ${result.status} ${JSON.stringify(body)}`)
  return body
}

async function connect(url) {
  const socket = new WebSocket(url)
  const messages = []
  const waiters = []
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    messages.push(message)
    for (const waiter of [...waiters]) if (waiter.predicate(message)) {
      waiters.splice(waiters.indexOf(waiter), 1)
      clearTimeout(waiter.timer)
      waiter.resolve(message)
    }
  })
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  return {
    socket, messages,
    send(message) { socket.send(JSON.stringify(message)) },
    wait(predicate) {
      const found = messages.find(predicate)
      if (found) return Promise.resolve(found)
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('Timed out waiting for WebSocket message')) }, 5000) }
        waiters.push(waiter)
      })
    },
  }
}

const created = await api('/api/v2/rooms', { method: 'POST', body: JSON.stringify({ room_name: 'V2 smoke', nickname: '甲' }) })
const code = created.room.inviteCode
const key = crypto.randomUUID()
const delivered = await api(`/api/v2/rooms/${code}/characters`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ schemaVersion: 1, sheet }) })
assert.equal(delivered.action, 'created')
const joined = await api('/api/v2/rooms/join', { method: 'POST', body: JSON.stringify({ invite_code: code, nickname: '乙' }) })
const a = await connect(created.session.websocketUrl)
const b = await connect(joined.session.websocketUrl)
a.send({ type: 'room.sync', protocolVersion: 2, afterSeq: 0, pendingRequestIds: [] })
b.send({ type: 'room.sync', protocolVersion: 2, afterSeq: 0, pendingRequestIds: [] })
const first = await a.wait(message => message.type === 'room.snapshot')
await b.wait(message => message.type === 'room.snapshot')
assert.equal(first.room.characters.length, 1)
const generation = first.room.characters[0].generation

const markA = { type: 'character.setMark', protocolVersion: 2, requestId: crypto.randomUUID(), name: sheet.name, generation, resource: 'hp', index: 0, marked: true }
const markB = { ...markA, requestId: crypto.randomUUID(), index: 2 }
a.send(markA); b.send(markB)
await a.wait(message => message.type === 'operation.ack' && message.requestId === markA.requestId)
await b.wait(message => message.type === 'operation.ack' && message.requestId === markB.requestId)
a.send(markA)
const duplicate = await a.wait(message => message.type === 'operation.ack' && message.requestId === markA.requestId)
assert.ok(duplicate.seq >= generation)

const roll = { type: 'dice.roll', protocolVersion: 2, requestId: crypto.randomUUID(), payload: { mode: 'standard', modifier_mode: 'normal', repeat: 1, modifier: 0, dice: [{ sides: 20, count: 1 }] } }
a.send(roll)
const rolledA = await a.wait(message => message.type === 'dice.rolled' && message.requestId === roll.requestId)
const rolledB = await b.wait(message => message.type === 'dice.rolled' && message.requestId === roll.requestId)
assert.equal(rolledA.roll.id, rolledB.roll.id)
await a.wait(message => message.type === 'operation.ack' && message.requestId === roll.requestId)

const fearA = { type: 'room.adjustFear', protocolVersion: 2, requestId: crypto.randomUUID(), delta: 1 }
const fearB = { ...fearA, requestId: crypto.randomUUID() }
a.send(fearA); b.send(fearB)
await a.wait(message => message.type === 'operation.ack' && message.requestId === fearA.requestId)
await b.wait(message => message.type === 'operation.ack' && message.requestId === fearB.requestId)

for (let index = 0; index < 50; index++) {
  const next = { ...roll, requestId: crypto.randomUUID() }
  a.send(next)
  await a.wait(message => message.type === 'operation.ack' && message.requestId === next.requestId)
}

const snapshot = await api(`/api/v2/rooms/${code}/snapshot`, { headers: { Authorization: `Bearer ${created.session.token}` } })
assert.equal(snapshot.room.characters[0].resources.hp[0], true)
assert.equal(snapshot.room.characters[0].resources.hp[2], true)
assert.equal(snapshot.room.fear.value, 2)
assert.equal(snapshot.room.dice.length, 50)
assert.equal(snapshot.room.dice.some(item => item.id === rolledA.roll.id), false)
const originalSeq = snapshot.room.seq
a.send(roll)
await a.wait(message => message.type === 'operation.ack' && message.requestId === roll.requestId)
const afterDiceReplay = await api(`/api/v2/rooms/${code}/snapshot`, { headers: { Authorization: `Bearer ${created.session.token}` } })
assert.equal(afterDiceReplay.room.seq, originalSeq)
const replay = await api(`/api/v2/rooms/${code}/characters`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ schemaVersion: 1, sheet }) })
assert.equal(replay.seq, delivered.seq)
const afterReplay = await api(`/api/v2/rooms/${code}/snapshot`, { headers: { Authorization: `Bearer ${created.session.token}` } })
assert.equal(afterReplay.room.seq, originalSeq)
assert.equal(afterReplay.room.characters[0].resources.hp[0], true)

a.socket.close(); b.socket.close()
const recovery = await connect(created.session.websocketUrl)
recovery.send({ type: 'room.sync', protocolVersion: 2, afterSeq: 0, pendingRequestIds: [roll.requestId] })
const recovered = await recovery.wait(message => message.type === 'room.snapshot')
assert.equal(recovered.room.seq, originalSeq)
assert.equal(recovered.receipts[0].requestId, roll.requestId)
assert.equal(recovered.room.dice.some(item => item.id === rolledA.roll.id), false)
const replacement = await api(`/api/v2/rooms/${code}/characters`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ schemaVersion: 1, sheet: { ...sheet, hope: 1, hp: sheet.hp.map(() => false), stress: sheet.stress.map(() => false), cards: [] } }) })
assert.equal(replacement.action, 'updated')
const oldOperation = { ...markA, requestId: crypto.randomUUID(), marked: false }
recovery.send(oldOperation)
await recovery.wait(message => message.type === 'operation.error' && message.requestId === oldOperation.requestId && message.code === 'CHARACTER_REPLACED')
const replaced = await api(`/api/v2/rooms/${code}/snapshot`, { headers: { Authorization: `Bearer ${created.session.token}` } })
assert.equal(replaced.room.characters[0].resources.hope, 1)
assert.equal(replaced.room.characters[0].resources.hp[0], false)
const deletion = { type: 'character.delete', protocolVersion: 2, requestId: crypto.randomUUID(), name: sheet.name, generation: replacement.generation }
recovery.send(deletion)
await recovery.wait(message => message.type === 'operation.ack' && message.requestId === deletion.requestId)
const recreated = await api(`/api/v2/rooms/${code}/characters`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ schemaVersion: 1, sheet }) })
assert.ok(recreated.generation > replacement.generation)
const staleAfterRecreate = { ...deletion, requestId: crypto.randomUUID() }
recovery.send(staleAfterRecreate)
await recovery.wait(message => message.type === 'operation.error' && message.requestId === staleAfterRecreate.requestId && message.code === 'CHARACTER_REPLACED')
recovery.socket.close()
console.log(JSON.stringify({ ok: true, seq: recreated.seq, characters: 1, dice: snapshot.room.dice.length }))
