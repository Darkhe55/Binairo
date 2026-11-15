import { cellValue, colOf, idx, rowOf } from './state'
import type { CellState, GameState, Puzzle, ValidationResult } from './types'
import { CellState as CS } from './types'

/** 一行/一列里有没有三连（返回起点下标，没有则 -1） */
function findTriple(line: CellState[]): number {
  for (let i = 0; i + 2 < line.length; i++) {
    const a = line[i]!
    if (a === CS.Unknown) continue
    if (a === line[i + 1] && a === line[i + 2]) return i
  }
  return -1
}

function countColor(line: CellState[], color: CellState): number {
  let n = 0
  for (const v of line) if (v === color) n++
  return n
}

/** 两行是否「完全相同」——只比较已填部分，且必须都已填满 */
function sameLine(a: CellState[], b: CellState[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] === CS.Unknown || b[i] === CS.Unknown) return false
    if (a[i] !== b[i]) return false
  }
  return true
}

export function validate(state: GameState, puzzle: Puzzle): ValidationResult {
  const w = puzzle.width
  const h = puzzle.height
  const halfRow = w / 2
  const halfCol = h / 2

  const triples: string[] = []
  const tripleCells: number[] = []
  const badRows: number[] = []
  const badCols: number[] = []
  const dupRows: number[] = []
  const dupCols: number[] = []
  let filled = 0

  const rows: CellState[][] = []
  const cols: CellState[][] = []

  for (let y = 0; y < h; y++) {
    const row = rowOf(state, y)
    rows.push(row)
    const t = findTriple(row)
    if (t >= 0) {
      triples.push(`第 ${y + 1} 行`)
      for (let i = t; i < t + 3; i++) tripleCells.push(idx(w, i, y))
    }
    const black = countColor(row, CS.Black)
    const white = countColor(row, CS.White)
    if (black > halfRow || white > halfRow) badRows.push(y)
  }

  for (let x = 0; x < w; x++) {
    const col = colOf(state, x)
    cols.push(col)
    const t = findTriple(col)
    if (t >= 0) {
      triples.push(`第 ${x + 1} 列`)
      for (let i = t; i < t + 3; i++) tripleCells.push(idx(w, x, i))
    }
    const black = countColor(col, CS.Black)
    const white = countColor(col, CS.White)
    if (black > halfCol || white > halfCol) badCols.push(x)
  }

  // 行列重复（只在该行/列已填满时才算）
  for (let y = 0; y < h; y++) {
    if (rows[y]!.some((v) => v === CS.Unknown)) continue
    for (let y2 = y + 1; y2 < h; y2++) {
      if (rows[y2]!.some((v) => v === CS.Unknown)) continue
      if (sameLine(rows[y]!, rows[y2]!)) {
        if (!dupRows.includes(y)) dupRows.push(y)
        if (!dupRows.includes(y2)) dupRows.push(y2)
      }
    }
  }
  for (let x = 0; x < w; x++) {
    if (cols[x]!.some((v) => v === CS.Unknown)) continue
    for (let x2 = x + 1; x2 < w; x2++) {
      if (cols[x2]!.some((v) => v === CS.Unknown)) continue
      if (sameLine(cols[x]!, cols[x2]!)) {
        if (!dupCols.includes(x)) dupCols.push(x)
        if (!dupCols.includes(x2)) dupCols.push(x2)
      }
    }
  }

  for (let i = 0; i < state.cells.length; i++) {
    if (state.cells[i] !== CS.Unknown) filled++
  }

  const unknown = w * h - filled
  const solved =
    unknown === 0 &&
    triples.length === 0 &&
    badRows.length === 0 &&
    badCols.length === 0 &&
    dupRows.length === 0 &&
    dupCols.length === 0

  return { triples, tripleCells, badRows, badCols, dupRows, dupCols, filled, unknown, solved }
}

/** 某格填某个颜色是否会立刻造成三连（供逻辑解谜器用） */
export function wouldTriple(
  state: GameState,
  width: number,
  height: number,
  index: number,
  value: CellState,
): boolean {
  const x = index % width
  const y = Math.floor(index / width)
  // 横向
  const row = rowOf(state, y)
  row[x] = value
  if (findTriple(row) >= 0) return true
  // 纵向
  const col = colOf(state, x)
  if (y < height) col[y] = value
  if (findTriple(col) >= 0) return true
  return false
}

/** 某行/列的黑（或白）是否已经到上限 */
export function colorFull(
  state: GameState,
  width: number,
  height: number,
  line: 'row' | 'col',
  at: number,
  value: CellState,
): boolean {
  const cells = line === 'row' ? rowOf(state, at) : colOf(state, at)
  const limit = line === 'row' ? width / 2 : height / 2
  return countColor(cells, value) >= limit
}

export { cellValue, idx }
