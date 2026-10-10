import { useEffect, useRef, useState } from 'react'

export default function BackupDialog({ onClose, onExport }: { onClose: () => void; onExport: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close() }, [])
  async function download() { setBusy(true); setError(''); try { await onExport() } catch (cause) { setError(cause instanceof Error ? cause.message : '导出失败') } finally { setBusy(false) } }
  return <dialog ref={dialog} className="backup-dialog" onCancel={onClose} aria-labelledby="backup-title"><h2 id="backup-title">新版房间备份</h2><p>下载 JSON 备份，包含角色原始资料、当前资源、顺序、恐惧、骰子记录与 X 卡状态。不会包含会话凭据。</p>{error && <p className="desktop-error" role="alert">{error}</p>}<div><button type="button" className="button button--ghost" onClick={onClose}>关闭</button><button type="button" className="button button--primary" disabled={busy} onClick={() => void download()}>{busy ? '正在导出…' : '下载 JSON 备份'}</button></div></dialog>
}
