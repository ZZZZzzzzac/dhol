import { useEffect } from 'react'
import DesktopApp from '../desktop/DesktopApp'

export default function PreviewApp() {
  useEffect(() => {
    document.title = '在线面板测试版'
  }, [])
  return <DesktopApp />
}
