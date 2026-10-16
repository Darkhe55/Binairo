import type { Puzzle } from './types'
import { RAW_PUZZLES, type RawPuzzle } from './puzzles-data'

function parseCells(s: string) {
  return [...s].map((ch) => (ch === '.' ? 0 : ch === 'B' ? 1 : 2)) as Puzzle['givens']
}

function toPuzzle(r: RawPuzzle): Puzzle {
  return {
    id: r.id,
    name: r.name,
    size: r.size,
    difficulty: r.difficulty,
    givens: parseCells(r.givens),
    solution: parseCells(r.solution),
  }
}

/** 静态题库（import 即用，无运行时生成） */
export const puzzles: Puzzle[] = RAW_PUZZLES.map(toPuzzle)

export function getPuzzle(id: string): Puzzle | undefined {
  return puzzles.find((p) => p.id === id)
}

export function randomPuzzle(avoidId?: string): Puzzle {
  const pool = avoidId ? puzzles.filter((p) => p.id !== avoidId) : puzzles
  const list = pool.length ? pool : puzzles
  return list[Math.floor(Math.random() * list.length)]!
}

export function givenCount(p: Puzzle): number {
  return p.givens.filter((g) => g !== 0).length
}

export function listSeries(): string[] {
  return [...new Set(RAW_PUZZLES.map((r) => r.series))]
}

export function bySeries(series: string): Puzzle[] {
  return RAW_PUZZLES.filter((r) => r.series === series).map(toPuzzle)
}
