import { expect, it } from 'vitest'
import { isPreviewEnabled } from '../preview/isPreviewEnabled'

it('keeps the announcement as default and permits the explicit test path only when enabled', () => {
  expect(isPreviewEnabled('/', true, true)).toBe(false)
  expect(isPreviewEnabled('/preview', true, false)).toBe(true)
  expect(isPreviewEnabled('/preview/', false, true)).toBe(true)
  expect(isPreviewEnabled('/preview/admin', false, true)).toBe(false)
  expect(isPreviewEnabled('/preview', false, false)).toBe(false)
  expect(isPreviewEnabled('/previewish', true, true)).toBe(false)
})
