/**
 * 黑白逻辑解谜器（预留位置）
 * ==========================
 *
 * 计划实现的规则（往 RULES 里加即可，主循环已就绪）：
 *   1. 某格填某色会三连 → 只能填另一种
 *   2. 某行/列黑（或白）已到半数 → 其余格子只能填另一种
 *   3. 某行/列「已填 + 未定」凑不满半数 → 未定的必须补这种色
 *   4. 夹心：_ X X _ 或 X _ _ X 型 → 空格被逼出答案
 *   5. 行/列查重：某行只剩一种填法才不至于和已满行重复
 *   6. 假设推演（配合 solver 反证）
 */
import type { CellState, LogicStep, Puzzle } from './types'

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

export const RULES: RuleMeta[] = []

export function planLogicSolve(_puzzle: Puzzle): LogicPlan {
  return {
    supported: false,
    reason: '逻辑解谜器尚未实现：已预留 src/logic.ts（返回可播放的推理步骤）。',
    steps: [],
    complete: false,
    ms: 0,
    cells: [],
    conflicts: [],
  }
}
