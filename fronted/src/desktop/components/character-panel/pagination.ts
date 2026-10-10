import type { CharacterSummary } from '@dhgc/shared/desktop'

export const CHARACTERS_PER_PAGE = 4
export function pageCount(count: number): number { return Math.max(1, Math.ceil(count / CHARACTERS_PER_PAGE)) }
export function charactersOnPage(characters: CharacterSummary[], page: number): CharacterSummary[] {
  return [...characters].sort((a, b) => a.position - b.position).slice(page * CHARACTERS_PER_PAGE, (page + 1) * CHARACTERS_PER_PAGE)
}
