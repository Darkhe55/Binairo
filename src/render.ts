import type { CellState, GameState, Puzzle, ValidationResult } from './types'
import { CellState as CS } from './types'
import { cellValue, idx } from './state'

/** 8×8 基准格距；描边/半径按此比例缩放 */
export const BASE_CELL = 48

export interface BoardMetrics {
  cell: number
  pad: number
  width: number
  height: number
  svgWidth: number
  svgHeight: number
  k: number
}

export function metricsFor(puzzle: Puzzle): BoardMetrics {
  const cell = BASE_CELL
  const pad = cell * 0.18
  return {
    cell,
    pad,
    width: puzzle.width,
    height: puzzle.height,
    svgWidth: pad * 2 + puzzle.width * cell,
    svgHeight: pad * 2 + puzzle.height * cell,
    k: cell / BASE_CELL,
  }
}

/** 格子左上角像素坐标 */
export function cellXY(m: BoardMetrics, x: number, y: number) {
  return { x: m.pad + x * m.cell, y: m.pad + y * m.cell }
}

export function cellCenter(m: BoardMetrics, x: number, y: number) {
  return { x: m.pad + (x + 0.5) * m.cell, y: m.pad + (y + 0.5) * m.cell }
}

export function clientToViewBox(svg: SVGSVGElement, clientX: number, clientY: number) {
  const ctm = svg.getScreenCTM()
  if (!ctm) return null
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const p = pt.matrixTransform(ctm.inverse())
  return { x: p.x, y: p.y }
}

/** viewBox 坐标 → 格子索引；越界返回 null */
export function hitTestCell(m: BoardMetrics, puzzle: Puzzle, x: number, y: number): number | null {
  const cx = Math.floor((x - m.pad) / m.cell)
  const cy = Math.floor((y - m.pad) / m.cell)
  if (cx < 0 || cy < 0 || cx >= puzzle.width || cy >= puzzle.height) return null
  return idx(puzzle.width, cx, cy)
}

function discMarkup(
  m: BoardMetrics,
  cx: number,
  cy: number,
  value: CellState,
  given: boolean,
  cell: number,
): string {
  const { x, y } = cellCenter(m, cx, cy)
  const r = m.cell * (given ? 0.32 : 0.34)
  const cls = value === CS.Black ? 'disc black' : 'disc white'
  const ring = given
    ? ''
    : `<circle class="ring" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(r + 2.4 * m.k).toFixed(2)}" />`
  return `<g class="${cls}" data-cell="${cell}">${ring}<circle class="face" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r.toFixed(2)}" /></g>`
}

export function renderBoard(
  puzzle: Puzzle,
  state: GameState,
  result: ValidationResult,
): string {
  const m = metricsFor(puzzle)
  const w = puzzle.width
  const h = puzzle.height

  const tripleSet = new Set(result.tripleCells)
  const badRowSet = new Set(result.badRows)
  const badColSet = new Set(result.badCols)
  const dupRowSet = new Set(result.dupRows)
  const dupColSet = new Set(result.dupCols)

  const parts: string[] = []
  parts.push(
    `<svg class="board-svg" viewBox="0 0 ${m.svgWidth} ${m.svgHeight}" width="${m.svgWidth}" height="${m.svgHeight}" xmlns="http://www.w3.org/2000/svg">`,
  )

  // 格子底 + 题面格淡色
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const { x: px, y: py } = cellXY(m, x, y)
      const i = idx(w, x, y)
      const given = puzzle.givens[i] !== CS.Unknown
      const cls = given ? 'cell given' : 'cell'
      parts.push(
        `<rect class="${cls}" x="${px.toFixed(2)}" y="${py.toFixed(2)}" width="${m.cell}" height="${m.cell}" />`,
      )
    }
  }

  // 行/列异常淡红底
  const tint = (x0: number, y0: number, tw: number, th: number) =>
    `<rect class="line-error" x="${x0.toFixed(2)}" y="${y0.toFixed(2)}" width="${tw.toFixed(2)}" height="${th.toFixed(2)}" />`
  for (const y of badRowSet) {
    const { x, y: py } = cellXY(m, 0, y)
    parts.push(tint(x, py, w * m.cell, m.cell))
  }
  for (const y of dupRowSet) {
    const { x, y: py } = cellXY(m, 0, y)
    parts.push(tint(x, py, w * m.cell, m.cell))
  }
  for (const x of badColSet) {
    const { x: px, y } = cellXY(m, x, 0)
    parts.push(tint(px, y, m.cell, h * m.cell))
  }
  for (const x of dupColSet) {
    const { x: px, y } = cellXY(m, x, 0)
    parts.push(tint(px, y, m.cell, h * m.cell))
  }

  // 悬停层 / 演示层
  parts.push('<g class="hover-layer"></g>')
  parts.push('<g class="flash-layer"></g>')

  // 棋子
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(w, x, y)
      const given = puzzle.givens[i]
      const v = given !== CS.Unknown ? given : cellValue(state, i)
      if (v === CS.Unknown) continue
      const triple = tripleSet.has(i)
      if (triple) {
        const { x: px, y: py } = cellXY(m, x, y)
        parts.push(
          `<rect class="cell-error" x="${(px + 1.5 * m.k).toFixed(2)}" y="${(py + 1.5 * m.k).toFixed(2)}" width="${(m.cell - 3 * m.k).toFixed(2)}" height="${(m.cell - 3 * m.k).toFixed(2)}" rx="${6 * m.k}" />`,
        )
      }
      parts.push(discMarkup(m, x, y, v, given !== CS.Unknown, i))
    }
  }

  parts.push('</svg>')
  return parts.join('\n')
}

/* ———————————————————— 悬停 / 演示高亮 ———————————————————— */

export function hoverMarkup(m: BoardMetrics, cell: number | null): string {
  if (cell === null) return ''
  const x = cell % m.width
  const y = Math.floor(cell / m.width)
  const { x: px, y: py } = cellXY(m, x, y)
  const inset = 1.5 * m.k
  return `<rect class="cell-hover" x="${(px + inset).toFixed(2)}" y="${(py + inset).toFixed(2)}" width="${(m.cell - inset * 2).toFixed(2)}" height="${(m.cell - inset * 2).toFixed(2)}" rx="${6 * m.k}" />`
}

export function updateHover(svg: SVGSVGElement, m: BoardMetrics, cell: number | null): void {
  const layer = svg.querySelector('.hover-layer')
  if (!layer) return
  layer.innerHTML = hoverMarkup(m, cell)
}

export function flashMarkup(m: BoardMetrics, cell: number | null): string {
  if (cell === null) return ''
  const x = cell % m.width
  const y = Math.floor(cell / m.width)
  const { x: px, y: py } = cellXY(m, x, y)
  const inset = 1 * m.k
  return `<rect class="cell-flash" x="${(px + inset).toFixed(2)}" y="${(py + inset).toFixed(2)}" width="${(m.cell - inset * 2).toFixed(2)}" height="${(m.cell - inset * 2).toFixed(2)}" rx="${6 * m.k}" />`
}

export function updateFlash(svg: SVGSVGElement, m: BoardMetrics, cell: number | null): void {
  const layer = svg.querySelector('.flash-layer')
  if (!layer) return
  layer.innerHTML = flashMarkup(m, cell)
}
