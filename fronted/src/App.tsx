import { lazy, Suspense } from 'react'

const DesktopApp = lazy(() => import('./desktop/DesktopApp'))

export default function App() {
  return <Suspense fallback={<main>正在加载房间…</main>}><DesktopApp /></Suspense>
}
