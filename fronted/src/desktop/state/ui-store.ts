import { createStore } from 'zustand/vanilla'

export interface DesktopUiState {
  page: number
  detailName: string | null
  dialog: 'backup' | null
  notice: string | null
}

export function createUiStore() {
  const store = createStore<DesktopUiState>(() => ({ page: 0, detailName: null, dialog: null, notice: null }))
  return {
    getState: store.getState,
    subscribe: store.subscribe,
    setPage(page: number) { store.setState({ page: Math.max(0, Math.floor(page)) }) },
    setDetail(name: string | null) { store.setState({ detailName: name }) },
    setDialog(dialog: DesktopUiState['dialog']) { store.setState({ dialog }) },
    setNotice(notice: string | null) { store.setState({ notice }) },
    destroy() { store.setState({ page: 0, detailName: null, dialog: null, notice: null }) },
  }
}
