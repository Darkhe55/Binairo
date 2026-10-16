/**
 * 黑白求解器（回溯 + 剪枝），用于题库生成的唯一解校验。
 *
 * 剪枝：
 *  - 三连：落子后横竖出现三连 → 回退
 *  - 等量：某行/列黑（或白）已到 size/2 → 该行/列其余格子只能填另一种
 *  - 可达性：某行/列「已填黑 + 未定」< size/2 → 永远凑不齐 → 回退
 *  - 行/列重复：填满一行时若与已填满的行相同 → 回退（列同理）
 */
import { cellValue, colOf, createEmptyState, idx, rowOf } from './state'
import type { CellState, GameState, Puzzle } from './types'
import { CellState as CS } from './types'

export interface CountResult {
  count: number
  capped: boolean
  nodes: number
  timedOut: boolean
  first: GameState | null
  second: GameState | null
}

export interface SearchOptions {
  maxNodes?: number
  timeBudgetMs?: number
  /** 传入后每格的颜色尝试顺序随机化（题库生成用） */
  rng?: () => number
}

const COLORS: readonly CellState[] = [CS.Black, CS.White]

class Searcher {
  readonly size: number
  private readonly puzzle: Puzzle
  private readonly cells: CellState[]
  private readonly blackInRow: Int32Array
  private readonly whiteInRow: Int32Array
  private readonly blackInCol: Int32Array
  private readonly whiteInCol: Int32Array
  private readonly freeInRow: Int32Array
  private readonly freeInCol: Int32Array
  /** 已填满的行（用于查重） */
  private readonly fullRows: CellState[][] = []
  private readonly fullCols: CellState[][] = []
  private readonly maxNodes: number
  private readonly deadline: number
  private readonly rng?: () => number
  nodes = 0
  timedOut = false

  constructor(puzzle: Puzzle, opts: SearchOptions = {}) {
    this.size = puzzle.size
    this.puzzle = puzzle
    this.cells = new Array<CellState>(this.size * this.size).fill(CS.Unknown)
    this.blackInRow = new Int32Array(this.size)
    this.whiteInRow = new Int32Array(this.size)
    this.blackInCol = new Int32Array(this.size)
    this.whiteInCol = new Int32Array(this.size)
    this.freeInRow = new Int32Array(this.size).fill(this.size)
    this.freeInCol = new Int32Array(this.size).fill(this.size)

    // 题面固定格直接落座
    for (let i = 0; i < puzzle.givens.length; i++) {
      const g = puzzle.givens[i]
      if (g === CS.Unknown) continue
      this.cells[i] = g
      this.book(i, g, 1)
    }

    this.maxNodes = opts.maxNodes ?? 400_000
    this.deadline = opts.timeBudgetMs ? Date.now() + opts.timeBudgetMs : 0
    this.rng = opts.rng

    // 题面固定格可能已经让某些行/列填满，先登记进去（givens 永不被撤销）
    for (let y = 0; y < this.size; y++) {
      if (this.freeInRow[y] === 0) this.fullRows.push(rowOf(this.asState(), y))
    }
    for (let x = 0; x < this.size; x++) {
      if (this.freeInCol[x] === 0) this.fullCols.push(colOf(this.asState(), x))
    }
  }
  private book(index: number, value: CellState, sign: 1 | -1): void {
    const x = index % this.size
    const y = Math.floor(index / this.size)
    this.freeInRow[y]! -= sign
    this.freeInCol[x]! -= sign
    if (value === CS.Black) {
      this.blackInRow[y]! += sign
      this.blackInCol[x]! += sign
    } else {
      this.whiteInRow[y]! += sign
      this.whiteInCol[x]! += sign
    }
  }

  private checkBudget(): boolean {
    if (this.nodes > this.maxNodes) {
      this.timedOut = true
      return false
    }
    if (this.deadline && (this.nodes & 2047) === 0 && Date.now() > this.deadline) {
      this.timedOut = true
      return false
    }
    return true
  }

  /** 落子后是否仍自洽 */
  private okAfter(index: number, value: CellState): boolean {
    const x = index % this.size
    const y = Math.floor(index / this.size)
    const half = this.size / 2

    // 三连（只看包含本格的那三段）
    const row = rowOf(this.asState(), y)
    const col = colOf(this.asState(), x)
    const checkLine = (line: CellState[], at: number) => {
      for (let i = Math.max(0, at - 2); i <= Math.min(line.length - 3, at); i++) {
        const v = line[i]!
        if (v === CS.Unknown) continue
        if (v === line[i + 1] && v === line[i + 2]) return false
      }
      return true
    }
    if (!checkLine(row, x)) return false
    if (!checkLine(col, y)) return false

    // 等量上限 + 可达性
    const black = value === CS.Black ? this.blackInRow[y]! : this.whiteInRow[y]!
    const white = value === CS.White ? this.whiteInRow[y]! : this.blackInRow[y]!
    if (black > half || white > half) return false
    if (black + this.freeInRow[y]! < half) return false
    const blackC = value === CS.Black ? this.blackInCol[x]! : this.whiteInCol[x]!
    const whiteC = value === CS.White ? this.whiteInCol[x]! : this.blackInCol[x]!
    if (blackC > half || whiteC > half) return false
    if (blackC + this.freeInCol[x]! < half) return false

    return true
  }

  private asState(): GameState {
    return { puzzleId: this.puzzle.id, size: this.size, cells: this.cells }
  }

  /** 行/列刚被填满时，查是否与已登记的行/列重复 */
  private duplicateCheck(x: number, y: number): boolean {
    if (this.freeInRow[y] === 0) {
      const row = rowOf(this.asState(), y)
      if (this.fullRows.some((other) => sameLine(other, row))) return false
    }
    if (this.freeInCol[x] === 0) {
      const col = colOf(this.asState(), x)
      if (this.fullCols.some((other) => sameLine(other, col))) return false
    }
    return true
  }

  search(onFound: (cells: CellState[]) => boolean): boolean {
    const total = this.size * this.size
    // 待定格子（题面固定格已排除）
    const order: number[] = []
    for (let i = 0; i < total; i++) if (this.cells[i] === CS.Unknown) order.push(i)

    const dfs = (k: number): boolean => {
      if (k === order.length) return onFound(this.cells.slice())
      this.nodes++
      if (!this.checkBudget()) return true
      const i = order[k]!
      const x = i % this.size
      const y = Math.floor(i / this.size)
      const colors = this.rng
        ? this.rng() < 0.5
          ? [CS.Black, CS.White]
          : [CS.White, CS.Black]
        : COLORS
      for (const v of colors) {
        this.cells[i] = v
        this.book(i, v, 1)

        const okCounts =
          (v === CS.Black ? this.blackInRow[y]! : this.whiteInRow[y]!) <= this.size / 2 &&
          (v === CS.Black ? this.blackInCol[x]! : this.whiteInCol[x]!) <= this.size / 2

        // 行/列刚填满：先查重，通过后再登记（撤销时弹出）
        const rowJustFilled = this.freeInRow[y] === 0
        const colJustFilled = this.freeInCol[x] === 0
        const dupOk = okCounts && this.duplicateCheck(x, y)

        if (dupOk) {
          if (rowJustFilled) this.fullRows.push(rowOf(this.asState(), y))
          if (colJustFilled) this.fullCols.push(colOf(this.asState(), x))
          if (this.okAfter(i, v) && dfs(k + 1)) return true
          if (colJustFilled) this.fullCols.pop()
          if (rowJustFilled) this.fullRows.pop()
        }

        this.book(i, v, -1)
        this.cells[i] = CS.Unknown
      }
      return false
    }
    return dfs(0)
  }

  toState(puzzle: Puzzle, cells: CellState[]): GameState {
    const st = createEmptyState(puzzle)
    for (let i = 0; i < cells.length; i++) st.cells[i] = cells[i]!
    return st
  }
}

function sameLine(a: CellState[], b: CellState[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] === CS.Unknown || b[i] === CS.Unknown) return false
    if (a[i] !== b[i]) return false
  }
  return true
}

/** 统计解的个数（上限 limit） */
export function countSolutions(
  puzzle: Puzzle,
  limit = 2,
  opts: SearchOptions = {},
): CountResult {
  const s = new Searcher(puzzle, opts)
  let count = 0
  let first: GameState | null = null
  let second: GameState | null = null
  s.search((cells) => {
    count++
    if (!first) first = s.toState(puzzle, cells)
    else if (!second) second = s.toState(puzzle, cells)
    return count >= limit
  })
  return { count, capped: count >= limit, nodes: s.nodes, timedOut: s.timedOut, first, second }
}

export { cellValue, idx }
