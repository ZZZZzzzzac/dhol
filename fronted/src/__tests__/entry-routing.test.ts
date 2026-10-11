import { describe, expect, it } from 'vitest'
import { selectEntry } from '../entry-routing'

describe('frontend entry routing', () => {
  it('always keeps the root path on maintenance', () => {
    expect(selectEntry('/', true, true)).toBe('maintenance')
  })

  it('opens preview only in development or when explicitly enabled', () => {
    expect(selectEntry('/preview', true, false)).toBe('preview')
    expect(selectEntry('/preview/', false, true)).toBe('preview')
    expect(selectEntry('/preview', false, false)).toBe('maintenance')
  })

  it('does not accept near-match or deeper preview paths', () => {
    expect(selectEntry('/preview-room', true, true)).toBe('maintenance')
    expect(selectEntry('/preview/room', true, true)).toBe('maintenance')
  })

  it('shows the retired notice for explicit old room URLs', () => {
    expect(selectEntry('/room/ABC123', true, true)).toBe('legacy-retired')
    expect(selectEntry('/rooms/ABC123', true, true)).toBe('legacy-retired')
  })

  it('retires only the exact historical admin route', () => {
    expect(selectEntry('/admin', true, true)).toBe('legacy-retired')
    expect(selectEntry('/admin/', true, true)).toBe('legacy-retired')
    expect(selectEntry('/admin/settings', true, true)).toBe('maintenance')
    expect(selectEntry('/administrator', true, true)).toBe('maintenance')
  })
})
