import { describe, expect, it } from 'vitest'
import { resolveApiBase } from '../desktop/desktop-api'

describe('desktop API base', () => {
  it('uses the Pages origin in production so WebSockets stay same-origin', () => {
    expect(resolveApiBase(undefined, false, 'https://screenol.pages.dev/')).toBe('https://screenol.pages.dev')
  })

  it('keeps explicit deployments and the local Worker override', () => {
    expect(resolveApiBase('https://stage.example.test/', false, 'https://screenol.pages.dev')).toBe('https://stage.example.test')
    expect(resolveApiBase(undefined, true, 'http://localhost:5173')).toBe('http://127.0.0.1:8787')
  })
})
