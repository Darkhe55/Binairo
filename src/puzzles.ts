import type { Puzzle } from './types'
import { RAW_PUZZLES, type RawPuzzle } from './puzzles-data'
import { IMPORTED_PUZZLES } from './imported-puzzles'

function parseCells(s: string) {
  return [...s].map((ch) => (ch === '.' ? 0 : ch === 'B' ? 1 : 2)) as Puzzle['givens']
}

function toPuzzle(r: RawPuzzle): Puzzle {
  return {
    id: r.id,
    name: r.name,
    width: r.size,
    height: r.size,
    difficulty: r.difficulty,
    givens: parseCells(r.givens),
    solution: parseCells(r.solution),
  }
}

/** 静态题库 + 图片识别导入的题（import 即用，无运行时生成） */
const ALL_RAW: RawPuzzle[] = [...RAW_PUZZLES, ...IMPORTED_PUZZLES]
export const puzzles: Puzzle[] = ALL_RAW.map(toPuzzle)

export function getPuzzle(id: string): Puzzle | undefined {
  return puzzles.find((p) => p.id === id)
}

export function randomPuzzle(avoidId?: string, pool: Puzzle[] = puzzles): Puzzle {
  const candidates = avoidId ? pool.filter((p) => p.id !== avoidId) : pool
  const list = candidates.length ? candidates : pool
  return list[Math.floor(Math.random() * list.length)]!
}

export function givenCount(p: Puzzle): number {
  return p.givens.filter((g) => g !== 0).length
}

export function listSeries(): string[] {
  return [...new Set(ALL_RAW.map((r) => r.series))]
}

export function bySeries(series: string): Puzzle[] {
  return ALL_RAW.filter((r) => r.series === series).map(toPuzzle)
}

