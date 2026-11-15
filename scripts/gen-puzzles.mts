/**
 * 一次性生成静态题库 → src/puzzles-data.ts
 * 用法：npm run gen
 *
 * 流程：
 *   1. 用求解器 + 随机颜色顺序，随机生成一个合法满盘（三条规则全满足）
 *   2. 随机挖空：每挖一个都用 countSolutions 校验「仍唯一解」，否则填回去
 *   3. 达到目标给定格数（或挖不动了）就收工，落盘
 */
import { countSolutions } from '../src/solver.ts'
import type { CellState, Puzzle } from '../src/types.ts'
import { CellState as CS } from '../src/types.ts'
import { writeFileSync } from 'node:fs'

function mulberry32(seed: number) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = a[i]!
    a[i] = a[j]!
    a[j] = tmp
  }
  return a
}

const emptyPuzzle = (size: number, givens: CellState[]): Puzzle => ({
  id: 'gen',
  name: 'gen',
  width: size,
  height: size,
  givens,
  difficulty: 'custom',
})

/** 随机合法满盘 */
function randomSolution(size: number, rng: () => number): CellState[] | null {
  const p = emptyPuzzle(size, new Array<CellState>(size * size).fill(CS.Unknown))
  const r = countSolutions(p, 1, { rng, maxNodes: 400_000, timeBudgetMs: 8000 })
  return r.first ? r.first.cells : null
}

interface Spec {
  id: string
  name: string
  size: number
  difficulty: 'easy' | 'medium' | 'hard'
  series: string
  seed: number
  /** 目标给定格数 */
  keep: number
}

const SPECS: Spec[] = [
  { id: 'starter-6x6', name: '入门 · 6×6', size: 6, difficulty: 'easy', series: 'starter', seed: 20260401, keep: 18 },
  { id: 'classic-8x8-A', name: '经典 · 8×8 A', size: 8, difficulty: 'medium', series: 'classic', seed: 20260402, keep: 26 },
  { id: 'classic-8x8-B', name: '经典 · 8×8 B', size: 8, difficulty: 'medium', series: 'classic', seed: 20260403, keep: 24 },
  { id: 'challenge-10x10', name: '挑战 · 10×10', size: 10, difficulty: 'hard', series: 'challenge', seed: 20260404, keep: 34 },
  { id: 'challenge-12x12', name: '挑战 · 12×12', size: 12, difficulty: 'hard', series: 'challenge', seed: 20260405, keep: 44 },
]

function generate(spec: Spec) {
  const size = spec.size
  const total = size * size
  const t0 = Date.now()

  const rng = mulberry32(spec.seed)
  const solution = randomSolution(size, rng)
  if (!solution) throw new Error(`${spec.id}: 造不出合法满盘`)

  // 挖空保唯一解
  const givens = solution.slice()
  let kept = total
  for (const i of shuffled(
    Array.from({ length: total }, (_, i) => i),
    rng,
  )) {
    if (kept <= spec.keep) break
    const backup = givens[i]!
    givens[i] = CS.Unknown
    const r = countSolutions(emptyPuzzle(size, givens.slice()), 2, {
      maxNodes: 800_000,
      timeBudgetMs: 8000,
    })
    if (r.count !== 1 || r.timedOut) givens[i] = backup
    else kept--
  }

  // 最终校验
  const finalPuzzle = emptyPuzzle(size, givens.slice())
  const check = countSolutions(finalPuzzle, 2, { maxNodes: 2_000_000, timeBudgetMs: 30_000 })
  if (check.count !== 1) {
    throw new Error(`${spec.id}: 最终唯一解校验失败 count=${check.count}`)
  }

  console.log(
    `${spec.id.padEnd(16)} ${size}x${size}  给定 ${kept}/${total} (${((kept / total) * 100).toFixed(0)}%)  唯一解 ✓  ${Date.now() - t0}ms`,
  )

  const sym = (v: CellState) => (v === CS.Black ? 'B' : v === CS.White ? 'W' : '.')
  return {
    id: spec.id,
    name: spec.name,
    size,
    difficulty: spec.difficulty,
    series: spec.series,
    givens: givens.map(sym).join(''),
    solution: solution.map(sym).join(''),
  }
}

const rows = SPECS.map(generate)

const file = `/* 自动生成，勿手改。scripts/gen-puzzles.mts（npm run gen） */
export type RawPuzzle = {
  id: string
  name: string
  size: number
  difficulty: 'easy'|'medium'|'hard'|'custom'
  series: string
  /** 题面：'.' = 空白，'B' = 黑，'W' = 白；length = size*size，row-major */
  givens: string
  /** 参考解：'B' / 'W'；length = size*size，row-major */
  solution: string
}

export const RAW_PUZZLES: RawPuzzle[] = [
${rows
  .map(
    (r) =>
      `  { id: ${JSON.stringify(r.id)}, name: ${JSON.stringify(r.name)}, size: ${r.size}, difficulty: ${JSON.stringify(r.difficulty)}, series: ${JSON.stringify(r.series)}, givens: ${JSON.stringify(r.givens)}, solution: ${JSON.stringify(r.solution)} },`,
  )
  .join('\n')}
]
`

writeFileSync(new URL('../src/puzzles-data.ts', import.meta.url), file, 'utf8')
console.log('\n已写入 src/puzzles-data.ts')
