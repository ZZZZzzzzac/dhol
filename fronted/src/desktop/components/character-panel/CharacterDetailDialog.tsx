import { useEffect, useRef } from 'react'
import type { CharacterResources, CharacterSheetJson } from '@dhgc/shared/desktop'
import ReadOnlyCharacterSheet from './ReadOnlyCharacterSheet'

export type DetailState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; sheet: CharacterSheetJson; resources: CharacterResources }

export default function CharacterDetailDialog({ name, state, ready, onClose, onRetry, onGoldChange }: { name: string; state: DetailState; ready: boolean; onClose: () => void; onRetry: () => void; onGoldChange: (index: number, marked: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close() }, [])
  return <dialog ref={dialog} className="detail-dialog" onCancel={onClose} aria-labelledby="detail-title">
    <div className="detail-dialog__bar"><div><p>角色详情</p><h2 id="detail-title">{name}</h2></div><button type="button" onClick={onClose} aria-label="关闭完整角色卡">关闭</button></div>
    <div className="detail-dialog__body">{state.status === 'loading' ? <div className="detail-state" role="status">正在读取最新角色资料…</div> : state.status === 'error' ? <div className="detail-state" role="alert"><p>{state.message}</p><button type="button" className="button button--primary" onClick={onRetry}>重试</button></div> : <ReadOnlyCharacterSheet sheet={state.sheet} resources={state.resources} onGoldChange={onGoldChange} disabled={!ready} />}</div>
  </dialog>
}
