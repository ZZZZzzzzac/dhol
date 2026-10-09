import { memo, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { TrackResource } from '@dhgc/shared/desktop'
import { RoomSync } from './state/room-sync'
import type { DesktopSession } from './desktop-api'

const CharacterCard = memo(function CharacterCard({ name: characterName, sync, ready }: { name: string; sync: RoomSync; ready: boolean }) {
  const subscribe = useCallback((listener: () => void) => sync.subscribeCharacter(characterName, listener), [sync, characterName])
  const getSnapshot = useCallback(() => sync.character(characterName), [sync, characterName])
  const character = useSyncExternalStore(subscribe, getSnapshot)
  if (!character) return null
  const { name, generation, resources } = character
  function adjustHope(delta: 1 | -1) { try { sync.submit({ type: 'character.adjustHope', name, generation, delta }) } catch { /* status shows failure */ } }
  function track(resource: TrackResource, marks: boolean[]) {
    return <div className="desktop-track"><strong>{resource === 'hp' ? '生命' : resource === 'stress' ? '压力' : '护甲槽'}</strong>
      {marks.map((marked, index) => <button key={index} type="button" disabled={!ready} aria-pressed={marked}
        aria-label={`${resource} 第 ${index + 1} 格${marked ? '，已标记' : '，未标记'}`}
        onClick={() => { try { sync.submit({ type: 'character.setMark', name, generation, resource, index, marked: !marked }) } catch { /* status shows failure */ } }}>{marked ? '●' : '○'}</button>)}
    </div>
  }
  return <article className="desktop-character"><h2>{name}</h2>
    <div className="desktop-hope"><strong>希望</strong><button type="button" disabled={!ready} onClick={() => adjustHope(-1)}>−</button><span>{resources.hope} / {resources.hopeMax}</span><button type="button" disabled={!ready} onClick={() => adjustHope(1)}>+</button></div>
    {track('hp', resources.hp)}{track('stress', resources.stress)}{track('armor', resources.armor)}
  </article>
})

export default function DesktopRoom({ session, onLeave }: { session: DesktopSession; onLeave: () => void }) {
  const sync = useMemo(() => new RoomSync({ roomId: session.roomId, actorId: session.playerId, websocketUrl: session.websocketUrl, storage: localStorage, client: { visibilityTarget: document } }), [session])
  const lifecycle = useRef(0)
  useEffect(() => {
    const epoch = ++lifecycle.current
    sync.start()
    const disposeIfCurrent = () => { if (lifecycle.current === epoch) sync.destroy() }
    return () => { queueMicrotask(disposeIfCurrent) }
  }, [sync])
  const subscribe = useCallback((listener: () => void) => sync.subscribe(listener), [sync])
  const getSnapshot = useCallback(() => sync.getState(), [sync])
  const state = useSyncExternalStore(subscribe, getSnapshot)
  const room = state.room
  const ready = state.connection === 'ready'
  const saveText = state.save === 'saving' ? '保存中' : state.save === 'failed' ? '保存失败' : '已保存'
  function submit(command: Parameters<RoomSync['submit']>[0]) { try { sync.submit(command) } catch { /* status shows failure */ } }
  return <main className="desktop-shell">
    <header className="desktop-header"><div><h1>{room?.name ?? '正在同步房间'}</h1><p>邀请码 {session.inviteCode} · {session.nickname}</p></div><button type="button" onClick={onLeave}>离开房间</button></header>
    <p className="desktop-status" role="status">{ready ? '已连接' : state.connection === 'expired' ? '房间或会话已过期' : '正在连接'} · {saveText}{state.reason ? ` · ${state.reason}` : ''}</p>
    {sync.ui.getState().notice && <p className="desktop-error" role="alert">{sync.ui.getState().notice}</p>}
    {!room ? <p>正在读取房间状态…</p> : <>
      <section className="desktop-controls" aria-label="房间操作">
        <div><strong>恐惧 {room.fear.value} / {room.fear.max}</strong><button type="button" disabled={!ready} onClick={() => submit({ type: 'room.adjustFear', delta: -1 })}>−</button><button type="button" disabled={!ready} onClick={() => submit({ type: 'room.adjustFear', delta: 1 })}>+</button></div>
        <button type="button" disabled={!ready} onClick={() => submit({ type: 'dice.roll', payload: { mode: 'standard', modifier_mode: 'normal', repeat: 1, modifier: 0, dice: [{ sides: 20, count: 1 }] } })}>掷 d20</button>
        <button type="button" disabled={!ready} aria-pressed={room.xCard.active} onClick={() => submit({ type: 'xcard.set', active: !room.xCard.active })}>X 卡{room.xCard.active ? '已启用' : '未启用'}</button>
      </section>
      <p className="desktop-narrow">请使用桌面设备查看角色面板。</p>
      <section className="desktop-characters" aria-label="角色资源">{room.characters.length ? room.characters.map(character => <CharacterCard key={character.name} name={character.name} sync={sync} ready={ready} />) : <p>房间目前没有角色。请从车卡器发送角色卡。</p>}</section>
      <section className="desktop-dice" aria-label="掷骰记录"><h2>掷骰记录</h2>{room.dice.slice().reverse().map(roll => <p key={roll.id}>{roll.actor_name} · {roll.normalized_formula}：{roll.results[0]?.total ?? '—'}</p>)}</section>
    </>}
  </main>
}
