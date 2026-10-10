import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CharacterResources, CharacterSheetJson, CharacterSummary, DiceRollRequest, TrackResource } from '@dhgc/shared/desktop'
import { RoomSync } from './state/room-sync'
import type { DesktopSession } from './desktop-api'
import { apiBase } from './desktop-api'
import CharacterPanelBoard from './components/character-panel/CharacterPanelBoard'
import { pageCount } from './components/character-panel/pagination'
import CharacterDetailDialog, { type DetailState } from './components/character-panel/CharacterDetailDialog'
import FearTracker from './components/FearTracker'
import XCard from './components/XCard'
import DicePanel from './components/DicePanel'
import RoomToolbar from './components/RoomToolbar'
import BackupDialog from './components/BackupDialog'
import './components/character-panel/character-panel.css'

export default function DesktopRoom({ session, onLeave }: { session: DesktopSession; onLeave: () => void }) {
  const sync = useMemo(() => new RoomSync({ roomId: session.roomId, actorId: session.playerId, websocketUrl: session.websocketUrl, storage: localStorage, client: { visibilityTarget: document } }), [session])
  const lifecycle = useRef(0)
  const [detail, setDetail] = useState<{ character: CharacterSummary; state: DetailState } | null>(null)
  // The microtask guard keeps React StrictMode's development probe from destroying the live second mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const epoch = ++lifecycle.current; sync.start(); return () => { queueMicrotask(() => { if (lifecycle.current === epoch) sync.destroy() }) } }, [sync])
  const subscribe = useCallback((listener: () => void) => sync.subscribe(listener), [sync])
  const state = useSyncExternalStore(subscribe, () => sync.getState())
  const ui = useSyncExternalStore(sync.ui.subscribe, sync.ui.getState)
  const room = state.room
  const ready = state.connection === 'ready'
  const saveText = state.save === 'saving' ? '保存中' : state.save === 'failed' ? '保存失败' : '已保存'
  const submit = (command: Parameters<RoomSync['submit']>[0]) => { try { sync.submit(command) } catch { /* status explains the failure */ } }
  useEffect(() => { if (room && ui.page >= pageCount(room.characters.length)) sync.ui.setPage(pageCount(room.characters.length) - 1) }, [room, ui.page, sync])

  async function openDetail(character: CharacterSummary) {
    sync.ui.setDetail(character.name); setDetail({ character, state: { status: 'loading' } })
    try {
      const payload = await sync.detail(character.name, character.generation, async (name, generation) => {
        const response = await fetch(`${apiBase()}/api/v2/rooms/${session.inviteCode}/characters/${encodeURIComponent(name)}?generation=${generation}`, { headers: { Authorization: `Bearer ${session.token}` } })
        const result = await response.json() as { sheet?: CharacterSheetJson; resources?: CharacterResources; code?: string }
        if (!response.ok || !result.sheet || !result.resources) throw new Error(result.code === 'CHARACTER_REPLACED' ? '角色已重新投递，请重新打开。' : '读取角色资料失败。')
        return { sheet: result.sheet, resources: result.resources }
      }) as { sheet: CharacterSheetJson; resources: CharacterResources }
      setDetail(current => current?.character.name === character.name ? { character, state: { status: 'ready', ...payload } } : current)
    } catch (cause) { setDetail(current => current?.character.name === character.name ? { character, state: { status: 'error', message: cause instanceof Error ? cause.message : '读取角色资料失败。' } } : current) }
  }
  function closeDetail() { sync.ui.setDetail(null); setDetail(null) }
  function mark(character: CharacterSummary, resource: TrackResource, index: number, marked: boolean) { submit({ type: 'character.setMark', name: character.name, generation: character.generation, resource, index, marked }) }
  function remove(character: CharacterSummary) { if (window.confirm(`确定删除“${character.name}”吗？此操作会同步到所有房间成员。`)) submit({ type: 'character.delete', name: character.name, generation: character.generation }) }
  async function exportBackup() {
    const response = await fetch(`${apiBase()}/api/v2/rooms/${session.inviteCode}/export`, { headers: { Authorization: `Bearer ${session.token}` } })
    if (!response.ok) throw new Error('无法导出房间备份。')
    const blob = await response.blob(); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `dhol-${session.inviteCode}-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href)
  }
  const liveDetail = detail && room ? room.characters.find(item => item.name === detail.character.name && item.generation === detail.character.generation) : null
  const detailState = detail?.state.status === 'ready' && liveDetail ? { ...detail.state, resources: liveDetail.resources } : detail?.state
  return <main className="desktop-app">
    <RoomToolbar roomName={room?.name ?? '正在同步房间'} inviteCode={session.inviteCode} nickname={session.nickname} status={state.connection} save={saveText} reason={state.reason} onBackup={() => sync.ui.setDialog('backup')} onLeave={onLeave} />
    <div className="desktop-workspace">
      {ui.notice && <div className="notice" role="alert"><span>{ui.notice}</span><button type="button" onClick={() => sync.ui.setNotice(null)}>知道了</button></div>}
      {state.connection === 'expired' && <div className="expired-state" role="alert"><h2>房间或会话已过期</h2><p>请返回首页重新加入；未确认操作不会被当成已保存。</p><button className="button button--primary" onClick={onLeave}>返回首页</button></div>}
      {!room && state.connection !== 'expired' ? <div className="loading-state" role="status"><span /><p>正在建立安全连接并同步房间…</p></div> : room && <><p className="desktop-only-message">此面板按桌面设备设计，请在宽度至少 900px 的屏幕上使用。</p><div className="desktop-content">
        <section className="room-overview"><FearTracker value={room.fear.value} max={room.fear.max} ready={ready} onChange={delta => submit({ type: 'room.adjustFear', delta })} /><XCard active={room.xCard.active} ready={ready} onChange={active => submit({ type: 'xcard.set', active })} /><div className="utility-card member-card"><div><p>房间成员</p><h2>{room.members.filter(member => member.online).length} 在线</h2></div><span>{room.members.map(member => member.nickname).join(' · ')}</span></div></section>
        <CharacterPanelBoard characters={room.characters} page={ui.page} ready={ready} onPage={sync.ui.setPage} onHope={(character, delta) => submit({ type: 'character.adjustHope', name: character.name, generation: character.generation, delta })} onMark={mark} onDetail={character => void openDetail(character)} onDelete={remove} />
        <DicePanel dice={room.dice} ready={ready} pending={sync.pending().some(entry => entry.command.type === 'dice.roll')} onRoll={(request: DiceRollRequest) => submit({ type: 'dice.roll', payload: request })} onClear={() => submit({ type: 'dice.clearHistory' })} />
      </div></>}
    </div>
    {detail && detailState && <CharacterDetailDialog name={detail.character.name} state={detailState} onClose={closeDetail} onRetry={() => void openDetail(detail.character)} />}
    {ui.dialog === 'backup' && <BackupDialog onClose={() => sync.ui.setDialog(null)} onExport={exportBackup} />}
  </main>
}
