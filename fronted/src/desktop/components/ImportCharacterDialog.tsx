import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { parseCharacterDelivery } from '@dhgc/shared/desktop'
import { apiBase, type DesktopSession } from '../desktop-api'

export default function ImportCharacterDialog({ session, onClose }: { session: DesktopSession; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { dialog.current?.showModal() }, [])

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) { setText(await file.text()); setError('') }
  }

  async function submit() {
    setBusy(true); setError('')
    try {
      const parsed = JSON.parse(text) as unknown
      const sheet = typeof parsed === 'object' && parsed !== null && 'sheet' in parsed ? parsed.sheet : parsed
      const delivery = parseCharacterDelivery(JSON.stringify({ schemaVersion: 1, sheet }))
      const response = await fetch(`${apiBase()}/api/v2/rooms/${session.inviteCode}/characters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(delivery),
      })
      if (!response.ok) {
        const result = await response.json() as { message?: string }
        throw new Error(result.message ?? '导入失败，请检查角色 JSON。')
      }
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导入失败') }
    finally { setBusy(false) }
  }

  return <dialog ref={dialog} className="backup-dialog" onCancel={onClose} aria-labelledby="import-title">
    <h2 id="import-title">导入角色</h2>
    <p>选择车卡器导出的 JSON 文件，或粘贴角色 JSON。相同名称的角色会更新。</p>
    <input type="file" accept=".json,application/json" onChange={event => void chooseFile(event)} />
    <textarea aria-label="角色 JSON" value={text} onChange={event => setText(event.target.value)} rows={10} style={{ width: '100%', marginTop: 12 }} />
    {error && <p className="desktop-error" role="alert">{error}</p>}
    <div><button type="button" className="button button--ghost" onClick={onClose}>取消</button><button type="button" className="button button--primary" disabled={busy || !text.trim()} onClick={() => void submit()}>{busy ? '正在导入…' : '导入'}</button></div>
  </dialog>
}
