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
import './components/character-panel/character-panel.css'

const DEFAULT_CLOCKS: CountdownClock[] = [
  { id: 'c1', name: '援军抵达', value: 3, max: 4 },
  { id: 'c2', name: '仪式反噬', value: 5, max: 6 },
  { id: 'c3', name: '遗迹坍塌', value: 2, max: 8 }
]

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

  // 倒计时持久化
  const countdownsStorageKey = `dhol-countdowns-${session.roomId}`
  const [clocks, setClocks] = useState<CountdownClock[]>(() => {
    try {
      const saved = localStorage.getItem(countdownsStorageKey)
      return saved ? JSON.parse(saved) as CountdownClock[] : DEFAULT_CLOCKS
    } catch {
      return DEFAULT_CLOCKS
    }
  })

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
      setDetail(current => current?.character.name === character.name ? { character, state: { status: 'ready', ...payload } } : current)
    } catch (cause) {
      setDetail(current => current?.character.name === character.name ? { character, state: { status: 'error', message: cause instanceof Error ? cause.message : '读取角色资料失败。' } } : current)
    }
  }

  function closeDetail() { sync.ui.setDetail(null); setDetail(null) }

  function mark(character: CharacterSummary, resource: TrackResource, index: number, marked: boolean) {
    submit({ type: 'character.setMark', name: character.name, generation: character.generation, resource, index, marked })
    const label = resource === 'hp' ? '生命' : resource === 'stress' ? '压力' : '护甲'
    addRoomLog(`${character.name} ${marked ? '标记' : '清除'}${label}第 ${index + 1} 格`)
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
        onClose={closeDetail}
        onRetry={() => void openDetail(detail.character)}
      />
    )}

    {ui.dialog === 'backup' && (
      <BackupDialog onClose={() => sync.ui.setDialog(null)} onExport={exportBackup} />
    )}
  </main>
}
