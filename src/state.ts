import type { CellState, GameState, Move, Puzzle } from './types'
import { CellState as CS } from './types'

/* ———————————————————— 索引 ———————————————————— */

export function idx(size: number, x: number, y: number): number {
  return y * size + x
}

export function inBoard(size: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < size && y < size
}

/* ———————————————————— 状态读写 ———————————————————— */

export function createEmptyState(puzzle: Puzzle): GameState {
  return {
    puzzleId: puzzle.id,
    size: puzzle.size,
    cells: new Array<CellState>(puzzle.size * puzzle.size).fill(CS.Unknown),
  }
}

/** 把题面给定格并入棋盘状态。
 *  给定格只存在 puzzle.givens 里（渲染层会叠加显示），但校验、推理都读 state.cells，
 *  所以载入题目时必须把它们写进状态盘，否则盘面永远少一半信息。 */
export function applyGivens(puzzle: Puzzle, state: GameState): GameState {
  for (let i = 0; i < puzzle.givens.length; i++) {
    const g = puzzle.givens[i]
    if (g !== CS.Unknown) state.cells[i] = g
  }
  return state
}

export function cellValue(state: GameState, index: number): CellState {
  return state.cells[index] ?? CS.Unknown
}

export function setCell(state: GameState, index: number, value: CellState): void {
  state.cells[index] = value
}

/** 点击循环：未定 → 黑 → 白 → 未定 */
export function cycleCell(current: CellState, dir: 1 | -1 = 1): CellState {
  if (current === CS.Unknown) return dir === 1 ? CS.Black : CS.White
  if (current === CS.Black) return dir === 1 ? CS.White : CS.Unknown
  return dir === 1 ? CS.Unknown : CS.Black
}

export function applyMove(state: GameState, move: Move): void {
  setCell(state, move.index, move.to)
}

export function invertMove(move: Move): Move {
  return { ...move, from: move.to, to: move.from }
}

export function cloneState(state: GameState): GameState {
  return { puzzleId: state.puzzleId, size: state.size, cells: state.cells.slice() }
}

/* ———————————————————— 存档 ———————————————————— */

export function serializeState(state: GameState) {
  return {
    version: 1 as const,
    puzzleId: state.puzzleId,
    size: state.size,
    cells: state.cells.map((c) => c as number),
    updatedAt: Date.now(),
  }
}

export function deserializeState(data: {
  version: number
  puzzleId: string
  size: number
  cells: number[]
}): GameState {
  return {
    puzzleId: data.puzzleId,
    size: data.size,
    cells: data.cells.map((n) => n as CellState),
  }
}

/** 题面固定格（玩家不可改） */
export function isGiven(puzzle: Puzzle, index: number): boolean {
  return puzzle.givens[index] !== CS.Unknown
}

/* ———————————————————— 行/列工具 ———————————————————— */

/** 取出第 y 行 */
export function rowOf(state: GameState, y: number): CellState[] {
  const s = state.size
  return state.cells.slice(y * s, y * s + s)
}

/** 取出第 x 列 */
export function colOf(state: GameState, x: number): CellState[] {
  const s = state.size
  const out: CellState[] = []
  for (let y = 0; y < s; y++) out.push(state.cells[y * s + x]!)
  return out
}
