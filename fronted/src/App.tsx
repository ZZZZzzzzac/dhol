import { lazy, Suspense } from 'react'
import { selectEntry } from './entry-routing'
import './maintenance.css'

const DesktopApp = lazy(() => import('./desktop/DesktopApp'))

function Notice({ retired = false }: { retired?: boolean }) {
  return (
    <main className="maintenance-page">
      <div className="maintenance-glow maintenance-glow--left" aria-hidden="true" />
      <div className="maintenance-glow maintenance-glow--right" aria-hidden="true" />
      <section className="maintenance-card" aria-labelledby="maintenance-title">
        <div className="maintenance-mark" aria-hidden="true"><span>匕</span></div>
        <p className="maintenance-eyebrow">SYSTEM NOTICE</p>
        <h1 id="maintenance-title">{retired ? '旧版房间已下线，请创建新房间' : '当前项目技术升级中'}</h1>
        <div className="maintenance-divider" aria-hidden="true"><span /><i /><span /></div>
        <p className="maintenance-message">{retired ? '旧版会话和待发操作不会转入新版房间。' : '给您造成的不便敬请谅解'}</p>
        <p className="maintenance-footnote">{retired ? '请返回首页，待新版正式开放后重新创建房间。' : '服务恢复后即可正常访问，感谢您的耐心等待。'}</p>
      </section>
    </main>
  )
}

export default function App() {
  const entry = selectEntry(window.location.pathname, import.meta.env.DEV, import.meta.env.VITE_ENABLE_PREVIEW === 'true')
  if (entry === 'preview') return <Suspense fallback={<main>正在加载测试版…</main>}><DesktopApp /></Suspense>
  return <Notice retired={entry === 'legacy-retired'} />
}
