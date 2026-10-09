// Local-only legacy transport baseline. Never point this at a production Worker.
import { writeFile } from 'node:fs/promises'

const base = 'http://127.0.0.1:8787'
const json = async (path, data) => {
  const response = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`)
  return response.json()
}
const room = await json('/api/rooms', { room_name: '合成基线房间', nickname: '测试甲', room_type: 'gm-panel' })
const joined = await json('/api/rooms/join', { invite_code: room.session.invite_code, nickname: '测试乙' })
const connect = session => new Promise((resolve, reject) => {
  const url = session.websocket_url.startsWith('http') ? new URL(session.websocket_url) : new URL(session.websocket_url, base)
  url.protocol = 'ws:'
  const socket = new WebSocket(url)
  socket.addEventListener('open', () => resolve(socket), { once: true })
  socket.addEventListener('error', reject, { once: true })
})
const [a, b] = await Promise.all([connect(room.session), connect(joined.session)])
const waitMessage = (socket, predicate) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.removeEventListener('message', handler); reject(new Error('timeout')) }, 10000)
  const handler = event => {
    const message = JSON.parse(event.data)
    if (!predicate(message)) return
    clearTimeout(timer)
    socket.removeEventListener('message', handler)
    resolve({ message, time: performance.now() })
  }
  socket.addEventListener('message', handler)
})
for (let i = 0; i < 4; i++) {
  const data = { name: `合成角色${i + 1}`, ruleSetId: 'daggerheart', hope: 0, hp: Array(6).fill(false), stress: Array(6).fill(false), armorBoxes: Array(3).fill(false), cards: [] }
  const html = `<html data-version="1.0" data-exporter="daggerheart-character-sheet"><head><meta name="generator" content="Daggerheart Character Sheet Exporter v1.0"></head><body><h1>${data.name}</h1><script>window.characterData = ${JSON.stringify(data)};</script></body></html>`
  const requestId = `import-${i}`
  const ack = waitMessage(a, message => message.requestId === requestId && (message.type === 'ack' || message.type === 'error'))
  a.send(JSON.stringify({ type: 'gm.importHtmlCharacter', requestId, payload: { fileName: `${data.name}.html`, html } }))
  const result = (await ack).message
  if (result.type !== 'ack') throw new Error(JSON.stringify(result))
}
const rows = []
for (let i = 0; i < 30; i++) {
  if (i) await new Promise(resolve => setTimeout(resolve, 2600))
  const requestId = `roll-${i}`
  const fromA = waitMessage(a, message => message.type === 'dice.rolled' && message.payload?.roll?.id)
  const fromB = waitMessage(b, message => message.type === 'dice.rolled' && message.payload?.roll?.id)
  const start = performance.now()
  a.send(JSON.stringify({ type: 'dice.roll', requestId, payload: { mode: 'dual', modifier_mode: 'normal', repeat: 1, modifier: 0, dice: [] } }))
  const [first, second] = await Promise.all([fromA, fromB])
  rows.push({ requestId, originMs: first.time - start, observerMs: second.time - start, sameRoll: first.message.payload.roll.id === second.message.payload.roll.id })
}
const percentile = (key, p) => { const values = rows.map(row => row[key]).sort((x, y) => x - y); return Math.round(values[Math.ceil(p * values.length) - 1] * 10) / 10 }
const backupResponse = await fetch(`${base}/api/rooms/${room.session.invite_code}/export/dhroom`)
if (backupResponse.ok) await writeFile('tmp/phase1-synthetic-backup.dhroom', Buffer.from(await backupResponse.arrayBuffer()))
console.log(JSON.stringify({ sampleSize: rows.length, originP50Ms: percentile('originMs', .5), originP95Ms: percentile('originMs', .95), originMaxMs: Math.max(...rows.map(row => row.originMs)), observerP50Ms: percentile('observerMs', .5), observerP95Ms: percentile('observerMs', .95), observerMaxMs: Math.max(...rows.map(row => row.observerMs)), inconsistentResults: rows.filter(row => !row.sameRoll).length }, null, 2))
a.close(); b.close()
