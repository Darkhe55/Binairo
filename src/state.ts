import type { CellState, GameState, Move, Puzzle } from './types'
import { CellState as CS } from './types'

/* ———————————————————— 索引 ———————————————————— */

export function idx(width: number, x: number, y: number): number {
  return y * width + x
}

export function inBoard(width: number, height: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height
}

/* ———————————————————— 状态读写 ———————————————————— */

export function createEmptyState(puzzle: Puzzle): GameState {
  return {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    cells: new Array<CellState>(puzzle.width * puzzle.height).fill(CS.Unknown),
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
  return {
    puzzleId: state.puzzleId,
    width: state.width,
    height: state.height,
    cells: state.cells.slice(),
  }
}

/* ———————————————————— 存档 ———————————————————— */

export function serializeState(state: GameState) {
  return {
    version: 1 as const,
    puzzleId: state.puzzleId,
    width: state.width,
    height: state.height,
    cells: state.cells.map((c) => c as number),
    updatedAt: Date.now(),
  }
}

export function deserializeState(data: {
  version: number
  puzzleId: string
  width?: number
  height?: number
  /** 旧存档的边长（正方形） */
  size?: number
  cells: number[]
}): GameState {
  const legacy = typeof data.size === 'number' && data.size > 0 ? data.size : 0
  const width =
    typeof data.width === 'number' && data.width > 0
      ? data.width
      : legacy || Math.round(Math.sqrt(data.cells.length))
  const height =
    typeof data.height === 'number' && data.height > 0
      ? data.height
      : legacy || width
  return {
    puzzleId: data.puzzleId,
    width,
    height,
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
  const w = state.width
  return state.cells.slice(y * w, y * w + w)
}

/** 取出第 x 列 */
export function colOf(state: GameState, x: number): CellState[] {
  const w = state.width
  const h = state.height
  const out: CellState[] = []
  for (let y = 0; y < h; y++) out.push(state.cells[y * w + x]!)
  return out
}
