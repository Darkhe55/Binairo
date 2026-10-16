/**
 * 黑白逻辑解谜器
 * ==========================
 *
 * 已实现的规则（往 RULES 里加即可，主循环已就绪）：
 *   1. 同色两端 / 夹心：连续两个同色 → 两端必须填异色；间隔一个的同色 → 中间必须填异色
 *   2. 半额锁定：某行/列某颜色已达半数 → 剩余空格只能填另一种颜色
 *
 * 后续可加：行/列查重逼步、假设推演（配合 solver 反证）。
 *
 * 所有推论都从「当前盘面」出发，只把未定格推成确定值；
 * 推得的值与盘面已有格冲突时记入 conflicts（说明当前填法有矛盾）。
 */
import type { CellState, LogicStep, Puzzle } from './types'
import { CellState as CS } from './types'

export interface LogicPlan {
  supported: boolean
  reason: string
  steps: LogicStep[]
  complete: boolean
  ms: number
  cells: CellState[]
  conflicts: string[]
}

export interface RuleCtx {
  puzzle: Puzzle
  cells: CellState[]
  conflicts: string[]
}

export type RuleFn = (ctx: RuleCtx) => LogicStep[]

export interface RuleMeta {
  id: string
  name: string
  fn: RuleFn
}

/** 不动点迭代上界：每轮至少推一格，总格数就是轮数上限 */
const MAX_ROUNDS = 512

function colorName(v: CellState): string {
  return v === CS.Black ? '黑' : v === CS.White ? '白' : '空'
}

function otherColor(v: CellState): CellState {
  return v === CS.Black ? CS.White : CS.Black
}

/** 记录一条推论：写入盘面并生成步骤；与已知格冲突时只记 conflict */
function deduce(
  ctx: RuleCtx,
  steps: LogicStep[],
  index: number,
  value: CellState,
  reason: string,
): void {
  const cur = ctx.cells[index] ?? CS.Unknown
  if (cur === value) return
  if (cur !== CS.Unknown) {
    ctx.conflicts.push(`第 ${index + 1} 格推得${colorName(value)}，但盘面上已是${colorName(cur)}`)
    return
  }
  ctx.cells[index] = value
  steps.push({ index, value, reason })
}

/** 第 k 行/列的格子索引（row-major） */
function lineOf(puzzle: Puzzle, kind: 'row' | 'col', k: number): number[] {
  const n = puzzle.size
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(kind === 'row' ? k * n + i : i * n + k)
  return out
}

function lineLabel(kind: 'row' | 'col', k: number): string {
  return `第 ${k + 1} ${kind === 'row' ? '行' : '列'}`
}

function allLines(puzzle: Puzzle): Array<{ kind: 'row' | 'col'; k: number; cells: number[] }> {
  const out: Array<{ kind: 'row' | 'col'; k: number; cells: number[] }> = []
  for (let k = 0; k < puzzle.size; k++) {
    out.push({ kind: 'row', k, cells: lineOf(puzzle, 'row', k) })
    out.push({ kind: 'col', k, cells: lineOf(puzzle, 'col', k) })
  }
  return out
}

/* ———————————————————— 规则 1：同色两端 / 夹心填异色 ———————————————————— */

const pairEndsRule: RuleMeta = {
  id: 'pair-ends',
  name: '同色两端 / 夹心填异色',
  fn: (ctx) => {
    const steps: LogicStep[] = []
    for (const line of allLines(ctx.puzzle)) {
      const cells = line.cells
      const n = cells.length
      const at = (i: number): CellState => ctx.cells[cells[i]!] ?? CS.Unknown
      const label = lineLabel(line.kind, line.k)
      const p = (i: number): number => i + 1

      // 连续两个同色 X X → 两端（在盘面内的那一侧）必须异色，否则三连
      for (let i = 0; i + 1 < n; i++) {
        const a = at(i)
        if (a === CS.Unknown || a !== at(i + 1)) continue
        const need = otherColor(a)
        if (i - 1 >= 0) {
          deduce(
            ctx,
            steps,
            cells[i - 1]!,
            need,
            `${label}第 ${p(i)}、${p(i + 1)} 格连续两个${colorName(a)}，第 ${p(i - 1)} 格只能是${colorName(need)}`,
          )
        }
        if (i + 2 < n) {
          deduce(
            ctx,
            steps,
            cells[i + 2]!,
            need,
            `${label}第 ${p(i)}、${p(i + 1)} 格连续两个${colorName(a)}，第 ${p(i + 2)} 格只能是${colorName(need)}`,
          )
        }
      }

      // 间隔一个的同色 X _ X → 中间必须异色，否则三连
      for (let i = 0; i + 2 < n; i++) {
        const a = at(i)
        if (a === CS.Unknown || a !== at(i + 2)) continue
        const need = otherColor(a)
        deduce(
          ctx,
          steps,
          cells[i + 1]!,
          need,
          `${label}第 ${p(i)}、${p(i + 2)} 格中间隔着一个${colorName(a)}，第 ${p(i + 1)} 格只能是${colorName(need)}`,
        )
      }
    }
    return steps
  },
}

/* ———————————————————— 规则 2：半额锁定 ———————————————————— */

const halfLockRule: RuleMeta = {
  id: 'half-lock',
  name: '半数后剩余填异色',
  fn: (ctx) => {
    const steps: LogicStep[] = []
    const half = ctx.puzzle.size / 2
    for (const line of allLines(ctx.puzzle)) {
      let black = 0
      let white = 0
      const unknown: number[] = []
      for (const idx of line.cells) {
        const v = ctx.cells[idx] ?? CS.Unknown
        if (v === CS.Black) black++
        else if (v === CS.White) white++
        else unknown.push(idx)
      }
      if (!unknown.length) continue
      const label = lineLabel(line.kind, line.k)
      // 每行/列黑白各占一半，所以某色一到半数，剩下只能全填另一种
      if (black === half) {
        for (const idx of unknown) {
          deduce(
            ctx,
            steps,
            idx,
            CS.White,
            `${label}黑子已达半数 ${half} 个，剩余 ${unknown.length} 格只能是白`,
          )
        }
      } else if (white === half) {
        for (const idx of unknown) {
          deduce(
            ctx,
            steps,
            idx,
            CS.Black,
            `${label}白子已达半数 ${half} 个，剩余 ${unknown.length} 格只能是黑`,
          )
        }
      }
    }
    return steps
  },
}

export const RULES: RuleMeta[] = [pairEndsRule, halfLockRule]

export function planLogicSolve(puzzle: Puzzle, start?: CellState[]): LogicPlan {
  const t0 = Date.now()
  const total = puzzle.size * puzzle.size
  const base = (start ?? puzzle.givens).slice()
  if (base.length !== total) {
    return {
      supported: false,
      reason: '盘面数据长度与题目尺寸不符，无法逻辑解题。',
      steps: [],
      complete: false,
      ms: 0,
      cells: [],
      conflicts: [],
    }
  }

  // 给定格必须并入推理起点：调用方传来的盘面可能只记了玩家自己填的格，
  // 漏掉题面信息会让推论凭空少一大批
  for (let i = 0; i < puzzle.givens.length; i++) {
    const g = puzzle.givens[i]
    if (g !== CS.Unknown) base[i] = g
  }

  const ctx: RuleCtx = { puzzle, cells: base, conflicts: [] }
  const steps: LogicStep[] = []

  // 规则之间会互相触发，迭代到不动点
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const before = steps.length
    for (const rule of RULES) {
      for (const s of rule.fn(ctx)) steps.push(s)
    }
    if (steps.length === before) break
  }

  return {
    supported: true,
    reason: '',
    steps,
    complete: ctx.cells.every((c) => c !== CS.Unknown),
    ms: Date.now() - t0,
    cells: ctx.cells,
    conflicts: ctx.conflicts,
  }
}
