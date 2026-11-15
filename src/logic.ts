/**
 * 黑白逻辑解谜器
 * ==========================
 *
 * 已实现的规则（往 RULES 里加即可，主循环已就绪）：
 *   1. 同色两端 / 夹心：连续两个同色 → 两端必须填异色；间隔一个的同色 → 中间必须填异色
 *   2. 半额锁定：某行/列某颜色已达半数 → 剩余空格只能填另一种颜色
 *   3. 成对空格：某色相邻的两个连续空格至少含一颗异色；若互不重叠的此类区域
 *      最大数正好等于异色的剩余需求，则区域外的未定格只能是同色
 *   4. 双空格查重：某行/列只剩两个空格且为一黑一白时，与已完成的同向行/列比较，
 *      若除这两格外全都一致，则按对方的填法会撞车，只能反过来填
 *   5. 查重逼步：规则 4 的推广——枚举某行/列所有满足半数约束的补全，剔除会与
 *      已完成同向行/列重复的那些，剩余补全在某格上取值一致就逼定该格
 *   6. 假设推演反证：假设某空格为其一颜色，用规则推演 + solver 求解器反证；
 *      假设推出矛盾则只能填另一色。标记为 whenStalled，只在 1~5 都停滞时才试
 *
 * 所有推论都从「当前盘面」出发，只把未定格推成确定值；
 * 推得的值与盘面已有格冲突时记入 conflicts（说明当前填法有矛盾）。
 */
import type { CellState, LogicStep, Puzzle } from './types'
import { CellState as CS } from './types'
import { countSolutions } from './solver'
import { validate } from './validate'

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
  /** 假设推演的总时间预算（毫秒时间戳），超时后不再出动重规则 */
  deadline?: number
}

export type RuleFn = (ctx: RuleCtx) => LogicStep[]

export interface RuleMeta {
  id: string
  name: string
  fn: RuleFn
  /** 昂贵的规则：只在普通规则全部停滞时才执行，避免每轮都跑 */
  whenStalled?: boolean
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
  const w = puzzle.width
  const out: number[] = []
  const len = kind === 'row' ? puzzle.width : puzzle.height
  for (let i = 0; i < len; i++) out.push(kind === 'row' ? k * w + i : i * w + k)
  return out
}

function lineLabel(kind: 'row' | 'col', k: number): string {
  return `第 ${k + 1} ${kind === 'row' ? '行' : '列'}`
}

function allLines(puzzle: Puzzle): Array<{ kind: 'row' | 'col'; k: number; cells: number[] }> {
  const out: Array<{ kind: 'row' | 'col'; k: number; cells: number[] }> = []
  for (let k = 0; k < puzzle.height; k++) {
    out.push({ kind: 'row', k, cells: lineOf(puzzle, 'row', k) })
  }
  for (let k = 0; k < puzzle.width; k++) {
    out.push({ kind: 'col', k, cells: lineOf(puzzle, 'col', k) })
  }
  return out
}

interface LineShape {
  line: { kind: 'row' | 'col'; k: number; cells: number[] }
  vals: CellState[]
  /** 空格在行/列内的下标 */
  unknown: number[]
}

function lineShapes(ctx: RuleCtx): LineShape[] {
  return allLines(ctx.puzzle).map((line) => {
    const vals = line.cells.map((i) => ctx.cells[i] ?? CS.Unknown)
    const unknown: number[] = []
    vals.forEach((v, i) => {
      if (v === CS.Unknown) unknown.push(i)
    })
    return { line, vals, unknown }
  })
}

/** 组合数 C(n, k)，超过 cap 后不再精确计算（只用于判断要不要枚举） */
function combinationCount(n: number, k: number, cap = 1_000_000): number {
  if (k < 0 || k > n) return 0
  const kk = Math.min(k, n - k)
  let c = 1
  for (let i = 0; i < kk; i++) {
    c = (c * (n - i)) / (i + 1)
    if (c > cap) return cap + 1
  }
  return Math.round(c)
}

/** 枚举 0..n-1 中选 k 个的组合；visit 返回 false 可提前终止 */
function forEachCombination(n: number, k: number, visit: (pick: number[]) => boolean): void {
  if (k < 0 || k > n) return
  if (k === 0) {
    visit([])
    return
  }
  const pick: number[] = []
  for (let i = 0; i < k; i++) pick.push(i)
  for (;;) {
    if (!visit(pick)) return
    let i = k - 1
    while (i >= 0 && pick[i] === n - k + i) i--
    if (i < 0) return
    pick[i]!++
    for (let j = i + 1; j < k; j++) pick[j] = pick[j - 1]! + 1
  }
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
      const half = line.cells.length / 2
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

/* ———————————————————— 规则 3：成对空格 urgency ———————————————————— */

/**
 * 某色棋子 x 沿一个方向相邻两个连续空格（`x _ _` 或 `_ _ x`）时，这两格里至少
 * 有一颗异色 y——否则两颗都填 x 就成三连了。
 *
 * 把整行/整列里所有这样的「两连续空格」收集成一组多米诺，按右端点贪心取最大
 * 互不重叠子集。若这个最大数量正好等于 y 在该行/列的剩余需求数，说明还需的 y
 * 全被这些区域吃掉了（每区至少一颗、互不重叠所以正好一人一颗），那么多米诺
 * 没覆盖到的未定格就不再可能是 y，只能是 x。
 */
const pairUrgencyRule: RuleMeta = {
  id: 'pair-urgency',
  name: '成对空格约束',
  fn: (ctx) => {
    const steps: LogicStep[] = []
    const colors: CellState[] = [CS.Black, CS.White]

    for (const line of allLines(ctx.puzzle)) {
      const cells = line.cells
      const n = cells.length
      if (n % 2 !== 0) continue // 黑白各半要求边长为偶数
      const half = n / 2
      const at = (i: number): CellState => ctx.cells[cells[i]!] ?? CS.Unknown

      let black = 0
      let white = 0
      const unknown: number[] = []
      for (let i = 0; i < n; i++) {
        const v = at(i)
        if (v === CS.Black) black++
        else if (v === CS.White) white++
        else unknown.push(i)
      }
      if (!unknown.length) continue

      for (const x of colors) {
        const y = otherColor(x)
        // 这一行/列还要补几颗 y 才够半数
        const needY = half - (x === CS.Black ? white : black)
        if (needY <= 0) continue

        // 收集所有「两格皆空、且左邻或右邻是 x」的多米诺 [i, i+1]
        const dominoes: Array<[number, number]> = []
        for (let i = 0; i + 1 < n; i++) {
          if (at(i) !== CS.Unknown || at(i + 1) !== CS.Unknown) continue
          const touchesX =
            (i - 1 >= 0 && at(i - 1) === x) || (i + 2 < n && at(i + 2) === x)
          if (touchesX) dominoes.push([i, i + 1])
        }
        // 互不重叠的最多也就这么多个，凑不够需求就不用算了
        if (dominoes.length < needY) continue

        // 区间按右端点贪心，取最大互不重叠子集
        const picked: Array<[number, number]> = []
        let lastEnd = -1
        for (const d of [...dominoes].sort((a, b) => a[1] - b[1])) {
          if (d[0] > lastEnd) {
            picked.push(d)
            lastEnd = d[1]
          }
        }
        if (picked.length !== needY) continue

        const covered = new Set<number>()
        for (const [a, b] of picked) {
          covered.add(a)
          covered.add(b)
        }
        for (const i of unknown) {
          if (covered.has(i)) continue
          deduce(
            ctx,
            steps,
            cells[i]!,
            x,
            `${lineLabel(line.kind, line.k)}还需 ${needY} 颗${colorName(y)}，${
              picked.length
            } 处互不重叠的成对空格已各需一颗，覆盖外的未定格只能是${colorName(x)}`,
          )
        }
      }
    }
    return steps
  },
}

/* ———————————————————— 规则 4：双空格与已完成行/列查重 ———————————————————— */

/**
 * 某行/列只剩两个空格时，它最终不能和任何一条**已完成**的同向行/列完全相同
 * （任意两行/两列不得相同）。
 *
 * 若这两个空格在数量约束下是「一黑一白」（顺序未定），就可以拿已完成的行/列来卡：
 * 找到一条除这两个空格外全都一致的，按它的填法就会撞车，于是只能反过来填。
 *
 * 只处理一黑一白的情形——两格同色已被半额锁定规则覆盖，不必重复推论。
 */
const twinLineRule: RuleMeta = {
  id: 'twin-line',
  name: '双空格查重',
  fn: (ctx) => {
    const steps: LogicStep[] = []
    const shapes = lineShapes(ctx)

    for (const s of shapes) {
      if (s.unknown.length !== 2) continue
      const n = s.vals.length
      if (n % 2 !== 0) continue
      const half = n / 2

      let black = 0
      let white = 0
      for (const v of s.vals) {
        if (v === CS.Black) black++
        else if (v === CS.White) white++
      }
      // 只剩「一黑一白」没定顺序时才用得上查重；两格同色半额锁定已经覆盖
      if (half - black !== 1 || half - white !== 1) continue

      const p = s.unknown[0]!
      const q = s.unknown[1]!
      const label = lineLabel(s.line.kind, s.line.k)

      for (const t of shapes) {
        // 只和「同向且已完成」的行/列比（行与列相同是允许的，不能混比）
        if (t.line.kind !== s.line.kind || t.unknown.length !== 0) continue

        let twin = true
        for (let i = 0; i < n; i++) {
          if (i === p || i === q) continue
          if (t.vals[i] !== s.vals[i]) {
            twin = false
            break
          }
        }
        if (!twin) continue

        const a = t.vals[p]!
        const b = t.vals[q]!
        // 已完成那条在这两格同色 → 一黑一白天然撞不上，没有信息
        if (a === b) continue

        const reason = `${label}第 ${p + 1}、${q + 1} 格未定（一黑一白），若填${colorName(
          a,
        )}${colorName(b)} 就会和已完成的第 ${t.line.k + 1} ${
          s.line.kind === 'row' ? '行' : '列'
        }完全相同，只能反过来填`
        deduce(ctx, steps, s.line.cells[p]!, otherColor(a), reason)
        deduce(ctx, steps, s.line.cells[q]!, otherColor(b), reason)
      }
    }
    return steps
  },
}

/* ———————————————————— 规则 5：查重逼步 ———————————————————— */

/** 单行枚举补全的组合数上限，超过就跳过（大棋盘开局不至于爆量） */
const MAX_DUP_COMBOS = 4096

/**
 * 规则 4 的推广。
 *
 * 对一条还有 k 个空格的行/列 S：先枚举所有满足「黑白各半」的补全方式；再把凡是
 * 与某条**已完成、且除这些空格外与本行完全一致**的同向行/列相同的补全剔掉
 * （那种补全会造成两行/两列重复）。剩下还活着的补全里，某格若清一色都是黑
 * （或白），该格就被逼定。若一条补全都不剩，说明当前盘面已经无解。
 */
const dupForceRule: RuleMeta = {
  id: 'dup-force',
  name: '查重逼步',
  fn: (ctx) => {
    const steps: LogicStep[] = []
    const shapes = lineShapes(ctx)

    for (const s of shapes) {
      const k = s.unknown.length
      const n = s.vals.length
      if (!k || n % 2 !== 0) continue
      const half = n / 2

      let black = 0
      let white = 0
      for (const v of s.vals) {
        if (v === CS.Black) black++
        else if (v === CS.White) white++
      }
      const needB = half - black
      const needW = half - white
      if (needB < 0 || needW < 0 || needB + needW !== k) continue
      if (combinationCount(k, needB) > MAX_DUP_COMBOS) continue

      // 已完成且与 S 已知格全一致的同行/同列，把它们在空格处的黑位记成掩码
      const targets = new Set<number>()
      for (const t of shapes) {
        if (t.line.kind !== s.line.kind || t.unknown.length) continue
        let match = true
        for (let i = 0; i < n; i++) {
          if (s.vals[i] !== CS.Unknown && s.vals[i] !== t.vals[i]) {
            match = false
            break
          }
        }
        if (!match) continue
        let mask = 0
        for (let j = 0; j < k; j++) {
          if (t.vals[s.unknown[j]!] === CS.Black) mask |= 1 << j
        }
        targets.add(mask)
      }
      if (!targets.size) continue

      const canBlack = new Array<boolean>(k).fill(false)
      const canWhite = new Array<boolean>(k).fill(false)
      let settled = 0
      let survivors = 0

      forEachCombination(k, needB, (pick) => {
        let mask = 0
        for (const j of pick) mask |= 1 << j
        // 这种补全会和已完成的行/列完全相同，剔除
        if (targets.has(mask)) return true
        survivors++
        for (let j = 0; j < k; j++) {
          const isBlack = (mask & (1 << j)) !== 0
          if (isBlack) {
            if (!canBlack[j]) {
              canBlack[j] = true
              if (canWhite[j]) settled++
            }
          } else if (!canWhite[j]) {
            canWhite[j] = true
            if (canBlack[j]) settled++
          }
        }
        // 每格都还有两种可能，再枚举也不会逼出东西
        return settled < k
      })

      const label = lineLabel(s.line.kind, s.line.k)
      const kindName = s.line.kind === 'row' ? '行' : '列'
      if (!survivors) {
        const reason = `${label}无论怎么补都会与已完成的同${kindName}重复`
        if (!ctx.conflicts.includes(reason)) ctx.conflicts.push(reason)
        continue
      }

      for (let j = 0; j < k; j++) {
        const at = s.unknown[j]!
        const index = s.line.cells[at]!
        const tail = `${label}需补 ${needB} 黑 ${needW} 白，剔除会与已完成${kindName}重复的补法后`
        if (canBlack[j] && !canWhite[j]) {
          deduce(ctx, steps, index, CS.Black, `${tail}，第 ${at + 1} 格只能填黑`)
        } else if (canWhite[j] && !canBlack[j]) {
          deduce(ctx, steps, index, CS.White, `${tail}，第 ${at + 1} 格只能填白`)
        }
      }
    }
    return steps
  },
}

/* ———————————————————— 规则 6：假设推演（反证） ———————————————————— */

/** 假设推演总预算：超时就不再尝试，保证「逻辑解题」不会卡太久 */
const HYPOTHESIS_BUDGET_MS = 900
/** 单次反证的求解器预算 */
const HYPOTHESIS_SEARCH = { maxNodes: 20_000, timeBudgetMs: 40 }
/** 每次出动最多试几个格子（优先试所在行/列空格最少的） */
const HYPOTHESIS_TRIES = 8

/** 在给定盘面上只跑普通规则，迭代到不动点 */
function propagate(puzzle: Puzzle, cells: CellState[]): RuleCtx {
  const ctx: RuleCtx = { puzzle, cells: cells.slice(), conflicts: [] }
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let progressed = false
    for (const rule of RULES) {
      if (rule.whenStalled) continue
      if (rule.fn(ctx).length) progressed = true
    }
    if (!progressed || ctx.conflicts.length) break
  }
  return ctx
}

/** 盘面是否已经违反某条硬规则 */
function isContradiction(puzzle: Puzzle, cells: CellState[]): boolean {
  const v = validate({ puzzleId: puzzle.id, width: puzzle.width, height: puzzle.height, cells }, puzzle)
  return (
    v.triples.length > 0 ||
    v.badRows.length > 0 ||
    v.badCols.length > 0 ||
    v.dupRows.length > 0 ||
    v.dupCols.length > 0
  )
}

/** 假设 index 填 value 是否会推出矛盾：规则推演矛盾或求解器 0 解 */
function refutedBy(
  puzzle: Puzzle,
  cells: CellState[],
  index: number,
  value: CellState,
): boolean {
  const trial = cells.slice()
  trial[index] = value
  const sub = propagate(puzzle, trial)
  if (sub.conflicts.length || isContradiction(puzzle, sub.cells)) return true
  const r = countSolutions({ ...puzzle, givens: sub.cells }, 1, HYPOTHESIS_SEARCH)
  return !r.timedOut && r.count === 0
}

/**
 * 试填反证：挑一个空格假设它是黑，若推演或求解器证明这假设无解，就只能填白
 * （反之亦然）。一次只推一格，推完交回普通规则去连锁，步骤解释也更好读。
 */
const hypothesisRule: RuleMeta = {
  id: 'hypothesis',
  name: '假设推演反证',
  whenStalled: true,
  fn: (ctx) => {
    const steps: LogicStep[] = []
    const deadline = ctx.deadline ?? Infinity
    if (Date.now() > deadline) return steps

    const w = ctx.puzzle.width
    const h = ctx.puzzle.height
    const total = w * h
    if (ctx.cells.length !== total) return steps

    const rowBlank = new Array<number>(h).fill(0)
    const colBlank = new Array<number>(w).fill(0)
    const blanks: number[] = []
    for (let i = 0; i < total; i++) {
      if (ctx.cells[i] !== CS.Unknown) continue
      blanks.push(i)
      rowBlank[Math.floor(i / w)]!++
      colBlank[i % w]!++
    }
    if (!blanks.length) return steps
    blanks.sort((a, b) => {
      const sa = rowBlank[Math.floor(a / w)]! + colBlank[a % w]!
      const sb = rowBlank[Math.floor(b / w)]! + colBlank[b % w]!
      return sa - sb
    })

    let tries = 0
    for (const index of blanks) {
      if (tries >= HYPOTHESIS_TRIES || Date.now() > deadline) break
      tries++
      if (refutedBy(ctx.puzzle, ctx.cells, index, CS.Black)) {
        deduce(ctx, steps, index, CS.White, `假设第 ${index + 1} 格为黑会推出矛盾，故只能是白`)
        break
      }
      if (refutedBy(ctx.puzzle, ctx.cells, index, CS.White)) {
        deduce(ctx, steps, index, CS.Black, `假设第 ${index + 1} 格为白会推出矛盾，故只能是黑`)
        break
      }
    }
    return steps
  },
}

export const RULES: RuleMeta[] = [
  pairEndsRule,
  halfLockRule,
  pairUrgencyRule,
  twinLineRule,
  dupForceRule,
  hypothesisRule,
]

export function planLogicSolve(puzzle: Puzzle, start?: CellState[]): LogicPlan {
  const t0 = Date.now()
  const total = puzzle.width * puzzle.height
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

  const ctx: RuleCtx = {
    puzzle,
    cells: base,
    conflicts: [],
    deadline: Date.now() + HYPOTHESIS_BUDGET_MS,
  }
  const steps: LogicStep[] = []

  // 规则之间会互相触发，迭代到不动点；普通规则停滞时才出动假设推演
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let progressed = false
    for (const rule of RULES) {
      if (rule.whenStalled) continue
      for (const s of rule.fn(ctx)) {
        steps.push(s)
        progressed = true
      }
    }
    if (progressed) continue

    let advanced = false
    for (const rule of RULES) {
      if (!rule.whenStalled) continue
      for (const s of rule.fn(ctx)) {
        steps.push(s)
        advanced = true
      }
    }
    if (!advanced) break
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
