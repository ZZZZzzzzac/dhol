import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CharacterResources, CharacterSheetJson, CharacterSummary, DiceRollRequest, TrackResource } from '@dhgc/shared/desktop'
import { RoomSync } from './state/room-sync'
import type { DesktopSession } from './desktop-api'
import { apiBase } from './desktop-api'
import CharacterPanelBoard from './components/character-panel/CharacterPanelBoard'
import { pageCount } from './components/character-panel/pagination'
import CharacterDetailDialog, { type DetailState } from './components/character-panel/CharacterDetailDialog'
import FearTracker from './components/FearTracker'
import CountdownTracker, { type CountdownClock } from './components/CountdownTracker'
import XCard from './components/XCard'
import DicePanel, { type RoomLogItem } from './components/DicePanel'
import RoomToolbar from './components/RoomToolbar'
import BackupDialog from './components/BackupDialog'
import { clearRoomBrowserState, loadCountdowns } from './room-browser-state'
import './components/character-panel/character-panel.css'

export default function DesktopRoom({ session, onLeave }: { session: DesktopSession; onLeave: () => void }) {
  const sync = useMemo(() => new RoomSync({
    roomId: session.roomId,
    actorId: session.playerId,
    websocketUrl: session.websocketUrl,
    storage: localStorage,
    client: { visibilityTarget: document }
  }), [session])

  const lifecycle = useRef(0)
  const [detail, setDetail] = useState<{ character: CharacterSummary; state: DetailState } | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // 倒计时持久化
  const countdownsStorageKey = `dhol-countdowns-${session.roomId}`
  const [clocks, setClocks] = useState<CountdownClock[]>(() => loadCountdowns(localStorage, countdownsStorageKey))

  // 房间流水记录持久化
  const roomLogStorageKey = `dhol-roomlog-${session.roomId}`
  const [roomLog, setRoomLog] = useState<RoomLogItem[]>(() => {
    try {
      const saved = localStorage.getItem(roomLogStorageKey)
      return saved ? JSON.parse(saved) as RoomLogItem[] : []
    } catch {
      return []
    }
  })

  const addRoomLog = useCallback((text: string, tag?: string) => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setRoomLog(prev => {
      const next = [{ text, time, tag }, ...prev].slice(0, 50)
      try { localStorage.setItem(roomLogStorageKey, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [roomLogStorageKey])

  const handleClocksChange = (nextClocks: CountdownClock[]) => {
    setClocks(nextClocks)
    try { localStorage.setItem(countdownsStorageKey, JSON.stringify(nextClocks)) } catch { /* ignore */ }
  }

  const handleClearRoomLog = () => {
    setRoomLog([])
    try { localStorage.removeItem(roomLogStorageKey) } catch { /* ignore */ }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const epoch = ++lifecycle.current
    sync.start()
    return () => { queueMicrotask(() => { if (lifecycle.current === epoch) sync.destroy() }) }
  }, [sync])

  const subscribe = useCallback((listener: () => void) => sync.subscribe(listener), [sync])
  const state = useSyncExternalStore(subscribe, () => sync.getState())
  const ui = useSyncExternalStore(sync.ui.subscribe, sync.ui.getState)
  const room = state.room
  const ready = state.connection === 'ready'
  const submit = (command: Parameters<RoomSync['submit']>[0]) => { try { sync.submit(command) } catch { /* status explains the failure */ } }

  useEffect(() => {
    if (room && ui.page >= pageCount(room.characters.length)) sync.ui.setPage(pageCount(room.characters.length) - 1)
  }, [room, ui.page, sync])

  async function openDetail(character: CharacterSummary) {
    sync.ui.setDetail(character.name)
    setDetail({ character, state: { status: 'loading' } })
    try {
      const payload = await sync.detail(character.name, character.generation, async (name, generation) => {
        const response = await fetch(`${apiBase()}/api/v2/rooms/${session.inviteCode}/characters/${encodeURIComponent(name)}?generation=${generation}`, {
          headers: { Authorization: `Bearer ${session.token}` }
        })
        const result = await response.json() as { sheet?: CharacterSheetJson; resources?: CharacterResources; code?: string }
        if (!response.ok || !result.sheet || !result.resources) {
          throw new Error(result.code === 'CHARACTER_REPLACED' ? '角色已重新投递，请重新打开。' : '读取角色资料失败。')
        }
        return { sheet: result.sheet, resources: result.resources }
      }) as { sheet: CharacterSheetJson; resources: CharacterResources }
      setDetail(current => current?.character.name === character.name && current.character.generation === character.generation ? { character, state: { status: 'ready', ...payload } } : current)
    } catch (cause) {
      setDetail(current => current?.character.name === character.name && current.character.generation === character.generation ? { character, state: { status: 'error', message: cause instanceof Error ? cause.message : '读取角色资料失败。' } } : current)
    }
  }

  function closeDetail() { sync.ui.setDetail(null); setDetail(null) }

  useEffect(() => {
    if (!detail || !room) return
    const latest = room.characters.find(item => item.name === detail.character.name)
    if (latest && latest.generation !== detail.character.generation) void openDetail(latest)
    if (!latest) closeDetail()
  // The replacement generation is the only reason to reload the open sheet.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.characters, detail?.character.generation, detail?.character.name])

  function mark(character: CharacterSummary, resource: TrackResource, index: number, marked: boolean) {
    submit({ type: 'character.setMark', name: character.name, generation: character.generation, resource, index, marked })
    const label = resource === 'hp' ? '生命' : resource === 'stress' ? '压力' : resource === 'gold' ? '金币' : '护甲'
    addRoomLog(`${character.name} ${marked ? '标记' : '清除'}${label}${resource === 'gold' && index === 20 ? '箱' : `第 ${index + 1} 格`}`)
  }

  function remove(character: CharacterSummary) {
    submit({ type: 'character.delete', name: character.name, generation: character.generation })
    addRoomLog(`已移除角色【${character.name}】`)
  }

  const handleFearChange = (delta: 1 | -1) => {
    submit({ type: 'room.adjustFear', delta })
    addRoomLog(`恐惧点 ${room?.fear.value ?? 0} → ${(room?.fear.value ?? 0) + delta} (${delta > 0 ? '+1' : '-1'})`)
  }

  const handleHopeChange = (character: CharacterSummary, delta: 1 | -1) => {
    submit({ type: 'character.adjustHope', name: character.name, generation: character.generation, delta })
    addRoomLog(`${character.name} 希望点 ${character.resources.hope} → ${character.resources.hope + delta}`)
  }

  const handleXCardChange = (active: boolean) => {
    submit({ type: 'xcard.set', active })
    addRoomLog(active ? 'X卡已激活（战局暂停）' : 'X卡已解除')
  }

  function quickRollStat(character: CharacterSummary, statName: string, statVal: string) {
    const modifier = Number(statVal)
    if (!ready || !Number.isFinite(modifier)) return
    submit({ type: 'dice.roll', payload: { mode: 'dual', modifier_mode: 'normal', repeat: 1, modifier, dice: [] } })
    addRoomLog(`${character.name} 掷${statName}（${modifier >= 0 ? '+' : ''}${modifier}）`)
  }

  async function exportBackup() {
    const response = await fetch(`${apiBase()}/api/v2/rooms/${session.inviteCode}/export`, { headers: { Authorization: `Bearer ${session.token}` } })
    if (!response.ok) throw new Error('无法导出房间备份。')
    const blob = await response.blob()
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `dhol-${session.inviteCode}-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  function leaveDeletedRoom() {
    try { clearRoomBrowserState(localStorage, session.roomId) } catch { /* storage may be unavailable */ }
    onLeave()
  }

  async function deleteRoom() {
    setDeleting(true)
    setDeleteError('')
    try {
      const response = await fetch(`${apiBase()}/api/v2/rooms/${session.inviteCode}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.token}` }
      })
      const result = await response.json() as { code?: string }
      if (!response.ok) {
        if (result.code === 'ROOM_DELETE_FORBIDDEN') throw new Error('只有房间创建者可以删除房间。')
        throw new Error('删除失败，房间数据尚未清除，请稍后重试。')
      }
      leaveDeletedRoom()
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : '删除失败，房间数据尚未清除，请稍后重试。')
      setDeleting(false)
    }
  }

  useEffect(() => {
    if (state.connection === 'expired' && /deleted/i.test(state.reason ?? '')) leaveDeletedRoom()
  // Room deletion is terminal and should clear this browser's room data exactly once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.connection, state.reason])

  const liveDetail = detail && room ? room.characters.find(item => item.name === detail.character.name && item.generation === detail.character.generation) : null
  const detailState = detail?.state.status === 'ready' && liveDetail ? { ...detail.state, resources: liveDetail.resources } : detail?.state

  return <main className="desktop-app">
    {/* X卡全局暂停横幅 */}
    {room?.xCard.active && (
      <div className="xcard-alert-bar show">
        暂停中 · X卡已触发
      </div>
    )}

    <RoomToolbar
      roomName={room?.name ?? '正在同步房间'}
      inviteCode={session.inviteCode}
      status={state.connection}
      activeCount={room?.members.filter(m => m.online).length}
      xCardNode={<XCard active={Boolean(room?.xCard.active)} ready={ready} onChange={handleXCardChange} />}
      onExport={() => sync.ui.setDialog('backup')}
      onLeave={onLeave}
      onDelete={room?.members[0]?.id === session.playerId ? () => { setDeleteError(''); setDeleteOpen(true) } : undefined}
    />

    <div className="desktop-workspace">
      {ui.notice && (
        <div className="notice" role="alert">
          <span>{ui.notice}</span>
          <button type="button" onClick={() => sync.ui.setNotice(null)}>知道了</button>
        </div>
      )}

      {state.connection === 'expired' && (
        <div className="expired-state" role="alert">
          <h2>房间或会话已过期</h2>
          <p>请返回首页重新加入。</p>
          <button className="button button--primary" onClick={onLeave}>返回首页</button>
        </div>
      )}

      {!room && state.connection !== 'expired' ? (
        <div className="loading-state" role="status">
          <span />
          <p>正在建立安全连接并同步房间…</p>
        </div>
      ) : room && (
        <div className="desktop-content">
          {/* 模块一：状态 (恐惧点 + 倒计时) */}
          <section className="section-block">
            <div className="section-head">
              <h2 className="section-title">状态</h2>
            </div>
            <div className="status-grid">
              <FearTracker
                value={room.fear.value}
                max={room.fear.max}
                ready={ready}
                onChange={handleFearChange}
              />
              <CountdownTracker
                clocks={clocks}
                onChange={handleClocksChange}
                onLog={addRoomLog}
              />
            </div>
          </section>

          {/* 模块二：玩家 (一行四卡) */}
          <CharacterPanelBoard
            characters={room.characters}
            page={ui.page}
            ready={ready}
            onPage={sync.ui.setPage}
            onHope={handleHopeChange}
            onMark={mark}
            onDetail={character => void openDetail(character)}
            onDelete={remove}
            onQuickRollStat={quickRollStat}
          />

          {/* 模块三：掷骰 (对称三栏：房间记录 + 掷骰操作 + 掷骰记录) */}
          <DicePanel
            dice={room.dice}
            ready={ready}
            pending={sync.pending().some(entry => entry.command.type === 'dice.roll')}
            onRoll={(request: DiceRollRequest) => submit({ type: 'dice.roll', payload: request })}
            onClear={() => submit({ type: 'dice.clearHistory' })}
            roomLog={roomLog}
            onClearRoomLog={handleClearRoomLog}
          />
        </div>
      )}
    </div>

    {detail && detailState && (
      <CharacterDetailDialog
        name={detail.character.name}
        state={detailState}
        ready={ready}
        onClose={closeDetail}
        onRetry={() => void openDetail(detail.character)}
        onGoldChange={(index, marked) => mark(detail.character, 'gold', index, marked)}
      />
    )}

    {ui.dialog === 'backup' && (
      <BackupDialog onClose={() => sync.ui.setDialog(null)} onExport={exportBackup} />
    )}

    {deleteOpen && (
      <div className="modal-overlay show" role="dialog" aria-modal="true" aria-labelledby="delete-room-title">
        <div className="modal-box modal-box--sm">
          <div className="modal-bar">
            <h2 id="delete-room-title">彻底删除房间</h2>
            <button type="button" disabled={deleting} onClick={() => setDeleteOpen(false)}>关闭</button>
          </div>
          <div className="modal-content delete-room-confirmation">
            <p>确定删除房间“{room?.name}”吗？</p>
            <p>角色卡、资源状态、掷骰记录及所有房间数据都会被永久删除，无法恢复。</p>
            {deleteError && <p className="delete-room-error" role="alert">{deleteError}</p>}
            <div className="delete-room-actions">
              <button type="button" disabled={deleting} onClick={() => setDeleteOpen(false)}>取消</button>
              <button type="button" className="btn-alert-confirm" disabled={deleting} onClick={() => void deleteRoom()}>
                {deleting ? '正在删除…' : '确认彻底删除'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
  </main>
}
