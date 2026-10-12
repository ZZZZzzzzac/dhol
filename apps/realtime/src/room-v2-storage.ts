import { displayedResourceMax, summaryFromSheet, type CharacterResources, type CharacterSheetJson, type CharacterSummary, type DiceRollRecord, type MutationAck, type RoomV2Model } from '@dhgc/shared/desktop'

export interface StoredMeta {
  roomId: string
  name: string
  inviteCode: string
  createdAt: string
  expiresAt: string
  players: { id: string; nickname: string }[]
  protocolVersion: 2
}

type MetaRow = { room_json: string; seq: number; fear: number; xcard_json: string | null }
type CharacterRow = { name: string; generation: number; position: number; source_json: string; summary_json: string }
type CharacterHeader = Pick<CharacterRow, 'name' | 'generation' | 'position'>
type ResourceRow = { resources_json: string }
type DiceRow = { record_json: string }
type ReceiptRow = { payload_hash: string; seq: number; result_json: string }
type SessionAccessRow = { room_id: string | null; invite_code: string | null; expires_at: string | null; member: number | null }
export interface RoomV2SessionAccess { roomId: string | null; inviteCode: string | null; expiresAt: string | null; member: boolean }

export function isExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return true
  const expiry = Date.parse(expiresAt)
  return !Number.isFinite(expiry) || expiry <= now
}

export class RoomV2Storage {
  private deleted = false
  constructor(private readonly storage: DurableObjectStorage) {}

  initialize(): void {
    this.deleted = false
    this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS panel_v2_meta (id INTEGER PRIMARY KEY CHECK (id = 1), room_json TEXT NOT NULL, seq INTEGER NOT NULL, fear INTEGER NOT NULL, xcard_json TEXT);
      CREATE TABLE IF NOT EXISTS panel_v2_characters (name TEXT PRIMARY KEY, generation INTEGER NOT NULL, position INTEGER NOT NULL, source_json TEXT NOT NULL, summary_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS panel_v2_resources (name TEXT PRIMARY KEY, resources_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS panel_v2_dice (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, record_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS panel_v2_receipts (actor TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL, seq INTEGER NOT NULL, result_json TEXT NOT NULL, PRIMARY KEY (actor, request_id));
    `)
  }

  metaRow(): MetaRow | null {
    if (this.deleted) return null
    return this.storage.sql.exec<MetaRow>('SELECT room_json, seq, fear, xcard_json FROM panel_v2_meta WHERE id = 1').toArray()[0] ?? null
  }

  resetAfterDelete(): void { this.deleted = true }

  meta(): StoredMeta | null {
    const row = this.metaRow()
    return row ? JSON.parse(row.room_json) as StoredMeta : null
  }

  roomExpiresAt(): string | null {
    if (this.deleted) return null
    const row = this.storage.sql.exec<{ expires_at: string | null }>("SELECT json_extract(room_json, '$.expiresAt') AS expires_at FROM panel_v2_meta WHERE id = 1").toArray()[0]
    return row?.expires_at ?? null
  }

  sessionAccess(playerId: string): RoomV2SessionAccess | null {
    if (this.deleted) return null
    const row = this.storage.sql.exec<SessionAccessRow>(`
      SELECT
        json_extract(room_json, '$.roomId') AS room_id,
        json_extract(room_json, '$.inviteCode') AS invite_code,
        json_extract(room_json, '$.expiresAt') AS expires_at,
        EXISTS (
          SELECT 1 FROM json_each(room_json, '$.players')
          WHERE json_extract(value, '$.id') = ?
        ) AS member
      FROM panel_v2_meta WHERE id = 1
    `, playerId).toArray()[0]
    return row ? { roomId: row.room_id, inviteCode: row.invite_code, expiresAt: row.expires_at, member: row.member === 1 } : null
  }

  create(meta: StoredMeta): boolean {
    if (this.deleted) this.initialize()
    if (this.metaRow()) return false
    this.storage.sql.exec('INSERT INTO panel_v2_meta (id, room_json, seq, fear, xcard_json) VALUES (1, ?, 0, 0, NULL)', JSON.stringify(meta))
    return true
  }

  restore(meta: StoredMeta, state: { fear: number; xCard: RoomV2Model['xCard']; dice: DiceRollRecord[]; characters: Array<{ sheet: CharacterSheetJson; resources: CharacterResources; position: number }> }): boolean {
    if (!this.create(meta)) return false
    this.transaction(() => {
      state.characters.forEach((item, index) => {
        const generation = index + 1
        const summary = summaryFromSheet(item.sheet, item.resources, generation, item.position)
        this.saveCharacter(summary.name, generation, item.position, item.sheet, summary, item.resources)
      })
      state.dice.slice(-50).forEach((roll, index) => this.saveDice(index + 1, roll))
      const seq = Math.max(1, state.characters.length, state.dice.length)
      this.storage.sql.exec('UPDATE panel_v2_meta SET seq = ?, fear = ?, xcard_json = ? WHERE id = 1', seq, state.fear, JSON.stringify(state.xCard))
    })
    return true
  }

  updateMeta(meta: StoredMeta): void {
    this.storage.sql.exec('UPDATE panel_v2_meta SET room_json = ? WHERE id = 1', JSON.stringify(meta))
  }

  receipt(actor: string, requestId: string): ReceiptRow | null {
    if (this.deleted) return null
    return this.storage.sql.exec<ReceiptRow>('SELECT payload_hash, seq, result_json FROM panel_v2_receipts WHERE actor = ? AND request_id = ?', actor, requestId).toArray()[0] ?? null
  }

  receipts(actor: string, requestIds: string[]): MutationAck[] {
    return requestIds.flatMap(requestId => {
      const row = this.receipt(actor, requestId)
      return row ? [{ type: 'operation.ack' as const, requestId, seq: row.seq }] : []
    })
  }

  character(name: string): CharacterRow | null {
    return this.storage.sql.exec<CharacterRow>('SELECT name, generation, position, source_json, summary_json FROM panel_v2_characters WHERE name = ?', name).toArray()[0] ?? null
  }

  characterHeader(name: string): CharacterHeader | null {
    return this.storage.sql.exec<CharacterHeader>('SELECT name, generation, position FROM panel_v2_characters WHERE name = ?', name).toArray()[0] ?? null
  }

  resources(name: string): CharacterResources | null {
    const row = this.storage.sql.exec<ResourceRow & { source_json: string }>('SELECT r.resources_json, c.source_json FROM panel_v2_resources r JOIN panel_v2_characters c ON c.name = r.name WHERE r.name = ?', name).toArray()[0]
    if (!row) return null
    const resources = JSON.parse(row.resources_json) as CharacterResources
    const sheet = JSON.parse(row.source_json) as CharacterSheetJson
    return {
      ...resources,
      hp: Array.from({ length: displayedResourceMax(sheet, 'hp') }, (_, index) => Boolean(resources.hp[index])),
      stress: Array.from({ length: displayedResourceMax(sheet, 'stress') }, (_, index) => Boolean(resources.stress[index])),
      armor: resources.armor.slice(0, sheet.desktopView?.armorMax ?? (typeof sheet.armorMax === 'number' ? sheet.armorMax : resources.armor.length)),
    }
  }

  nextPosition(): number {
    return this.storage.sql.exec<{ position: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM panel_v2_characters').one().position
  }

  transaction<T>(callback: () => T): T {
    return this.storage.transactionSync(callback)
  }

  advance(seq: number, fear?: number, xCard?: RoomV2Model['xCard']): void {
    if (fear !== undefined) this.storage.sql.exec('UPDATE panel_v2_meta SET seq = ?, fear = ? WHERE id = 1', seq, fear)
    else if (xCard !== undefined) this.storage.sql.exec('UPDATE panel_v2_meta SET seq = ?, xcard_json = ? WHERE id = 1', seq, JSON.stringify(xCard))
    else this.storage.sql.exec('UPDATE panel_v2_meta SET seq = ? WHERE id = 1', seq)
  }

  saveReceipt(actor: string, requestId: string, hash: string, seq: number, result: unknown): void {
    this.storage.sql.exec('INSERT INTO panel_v2_receipts (actor, request_id, payload_hash, seq, result_json) VALUES (?, ?, ?, ?, ?)', actor, requestId, hash, seq, JSON.stringify(result))
  }

  saveResources(name: string, resources: CharacterResources): void {
    this.storage.sql.exec('UPDATE panel_v2_resources SET resources_json = ? WHERE name = ?', JSON.stringify(resources), name)
  }

  saveCharacter(name: string, generation: number, position: number, sheet: CharacterSheetJson, summary: CharacterSummary, resources: CharacterResources): void {
    this.storage.sql.exec('INSERT INTO panel_v2_characters (name, generation, position, source_json, summary_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET generation = excluded.generation, source_json = excluded.source_json, summary_json = excluded.summary_json', name, generation, position, JSON.stringify(sheet), JSON.stringify(summary))
    this.storage.sql.exec('INSERT INTO panel_v2_resources (name, resources_json) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET resources_json = excluded.resources_json', name, JSON.stringify(resources))
  }

  deleteCharacter(name: string): void {
    this.storage.sql.exec('DELETE FROM panel_v2_resources WHERE name = ?', name)
    this.storage.sql.exec('DELETE FROM panel_v2_characters WHERE name = ?', name)
  }

  saveDice(seq: number, roll: DiceRollRecord): void {
    this.storage.sql.exec('INSERT INTO panel_v2_dice (seq, id, record_json) VALUES (?, ?, ?)', seq, roll.id, JSON.stringify(roll))
    this.storage.sql.exec('DELETE FROM panel_v2_dice WHERE seq NOT IN (SELECT seq FROM panel_v2_dice ORDER BY seq DESC LIMIT 50)')
  }

  clearDice(): void {
    this.storage.sql.exec('DELETE FROM panel_v2_dice')
  }

  snapshot(actor: string, pendingRequestIds: string[], onlineIds: ReadonlySet<string> = new Set()): { room: RoomV2Model; receipts: MutationAck[] } | null {
    return this.transaction(() => {
      const row = this.metaRow()
      if (!row) return null
      const meta = JSON.parse(row.room_json) as StoredMeta
      const characters = this.storage.sql.exec<CharacterRow>('SELECT name, generation, position, source_json, summary_json FROM panel_v2_characters ORDER BY position').toArray().map(item => {
        const resources = this.resources(item.name)!
        return summaryFromSheet(JSON.parse(item.source_json) as CharacterSheetJson, resources, item.generation, item.position)
      })
      const dice = this.storage.sql.exec<DiceRow>('SELECT record_json FROM panel_v2_dice ORDER BY seq DESC LIMIT 50').toArray().reverse().map(item => JSON.parse(item.record_json) as DiceRollRecord)
      return {
        room: {
          protocolVersion: 2, roomId: meta.roomId, name: meta.name, inviteCode: meta.inviteCode,
          expiresAt: meta.expiresAt, seq: row.seq,
          members: meta.players.map(player => ({ ...player, online: onlineIds.has(player.id) })),
          characters, fear: { value: row.fear, max: 12 }, dice,
          xCard: row.xcard_json ? JSON.parse(row.xcard_json) as RoomV2Model['xCard'] : { active: false, updatedAt: null },
        },
        receipts: this.receipts(actor, pendingRequestIds),
      }
    })
  }

  sheet(name: string): { generation: number; sheet: CharacterSheetJson; resources: CharacterResources } | null {
    const row = this.character(name)
    const resources = this.resources(name)
    return row && resources ? { generation: row.generation, sheet: JSON.parse(row.source_json) as CharacterSheetJson, resources } : null
  }

  export(): unknown {
    const snapshot = this.snapshot('', [])
    if (!snapshot) return null
    return { schemaVersion: 2, room: snapshot.room, characters: snapshot.room.characters.map(summary => ({ name: summary.name, sheet: this.sheet(summary.name)?.sheet })) }
  }
}
