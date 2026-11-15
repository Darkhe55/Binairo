/**
 * 黑白（Binairo / Takuzu）核心类型
 *
 * 规则：
 * 1. 每行、每列的黑子数 = 白子数（各占一半）
 * 2. 不能出现三个同色连排（横竖都一样）
 * 3. 任意两行不能完全相同，任意两列也不能完全相同
 *
 * 支持矩形题板：宽、高都为偶数即可；内置题都是正方形。
 */

/** 格子状态：未定 / 黑 / 白 */
export const enum CellState {
  Unknown = 0,
  Black = 1,
  White = 2,
}

export interface Puzzle {
  id: string
  name: string
  /** 棋盘宽（偶数） */
  width: number
  /** 棋盘高（偶数） */
  height: number
  /** row-major，length = width*height；0 = 空白，1 = 黑，2 = 白 */
  givens: CellState[]
  /** 参考解（提示用），row-major */
  solution?: CellState[]
  difficulty: 'easy' | 'medium' | 'hard' | 'custom'
}

export interface GameState {
  puzzleId: string
  width: number
  height: number
  /** row-major，length = width*height */
  cells: CellState[]
}

export interface Move {
  index: number
  from: CellState
  to: CellState
}

export interface ValidationResult {
  /** 三连所在的行/列（人类可读，供状态栏） */
  triples: string[]
  /** 三连涉及的具体格子索引（供渲染高亮） */
  tripleCells: number[]
  /** 黑白数量不符的行号 */
  badRows: number[]
  /** 黑白数量不符的列号 */
  badCols: number[]
  /** 与其他行重复的行号 */
  dupRows: number[]
  /** 与其他列重复的列号 */
  dupCols: number[]
  filled: number
  unknown: number
  solved: boolean
}

/** 逻辑解谜器的一条推理结论 */
export interface LogicStep {
  index: number
  value: CellState
  reason: string
}
