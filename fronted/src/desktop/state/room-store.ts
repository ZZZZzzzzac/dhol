import { createStore } from 'zustand/vanilla'
import type { RoomEvent, RoomV2Model } from '@dhgc/shared/desktop'

export interface ConfirmedRoomState { room: RoomV2Model | null }

export function applyRoomEvent(room: RoomV2Model, event: RoomEvent): RoomV2Model {
  const base = { ...room, seq: event.seq }
  switch (event.type) {
    case 'character.replaced': {
      const existing = room.characters.find(character => character.name === event.name)
      const characters = existing
        ? room.characters.map(character => character.name === event.name ? event.summary : character)
        : [...room.characters, event.summary]
      return { ...base, characters: characters.sort((a, b) => a.position - b.position) }
    }
    case 'character.resourcesChanged': return { ...base, characters: room.characters.map(character => character.name === event.name && character.generation === event.generation ? { ...character, resources: event.resources } : character) }
    case 'character.deleted': return { ...base, characters: room.characters.filter(character => character.name !== event.name) }
    case 'room.fearChanged': return { ...base, fear: event.fear }
    case 'dice.rolled': return { ...base, dice: [...room.dice, event.roll].slice(-50) }
    case 'dice.historyCleared': return { ...base, dice: [] }
    case 'xcard.changed': return { ...base, xCard: event.xCard }
  }
}

export function createRoomStore() {
  const store = createStore<ConfirmedRoomState>(() => ({ room: null }))
  return {
    getState: store.getState,
    subscribe: store.subscribe,
    setRoom(room: RoomV2Model | null) { store.setState({ room }) },
    apply(event: RoomEvent) {
      const room = store.getState().room
      if (room && event.seq === room.seq + 1) store.setState({ room: applyRoomEvent(room, event) })
    },
    destroy() { store.setState({ room: null }) },
  }
}

export type RoomStore = ReturnType<typeof createRoomStore>
