/**
 * 题库审计：校验 src/puzzles-data.ts 里每道题
 *   1. 串长度与棋盘尺寸吻合
 *   2. 参考解通过 validate（三条规则全满足）
 *   3. 题面给定格与参考解一致（不能自相矛盾）
 *   4. 解唯一（countSolutions === 1）
 *
 * 用法：npm run check
 */
import { puzzles } from '../src/puzzles.ts'
import { countSolutions } from '../src/solver.ts'
import { createEmptyState } from '../src/state.ts'
import { validate } from '../src/validate.ts'
import { CellState as CS } from '../src/types.ts'

let fail = 0
const failIf = (cond: boolean, msg: string) => {
  if (cond) {
    console.log(`  ✗ ${msg}`)
    fail++
    return true
  }
  return false
}

console.log(`共 ${puzzles.length} 道题\n`)

for (const p of puzzles) {
  const total = p.size * p.size
  console.log(`${p.id}  ${p.size}×${p.size}  ${p.difficulty}`)

  let bad = false
  bad ||= failIf(p.givens.length !== total, `givens 长度 ${p.givens.length} ≠ ${total}`)
  bad ||= failIf(!p.solution || p.solution.length !== total, 'solution 长度不对')
  bad ||= failIf(p.size % 2 !== 0, `尺寸 ${p.size} 不是偶数`)
  if (bad) continue

  // 题面不能和参考解冲突
  for (let i = 0; i < total; i++) {
    if (p.givens[i] !== CS.Unknown && p.givens[i] !== p.solution![i]) {
      failIf(true, `格子 ${i} 题面与参考解冲突`)
      bad = true
      break
    }
  }
  if (bad) continue

  // 参考解必须满足三条规则
  const st = createEmptyState(p)
  st.cells = p.solution!.slice()
  const v = validate(st, p)
  bad ||= failIf(
    !v.solved,
    `参考解不合法：三连=${v.triples.length} 行=${v.badRows.length} 列=${v.badCols.length} 重复行=${v.dupRows.length} 重复列=${v.dupCols.length}`,
  )

  const r = countSolutions(p, 2, { maxNodes: 2_000_000, timeBudgetMs: 30_000 })
  bad ||= failIf(r.timedOut, '唯一解校验超时')
  bad ||= failIf(r.count !== 1, `解数 = ${r.count}（应为 1）`)

  const givenCount = p.givens.filter((g) => g !== CS.Unknown).length
  console.log(`  ✓ 参考解合法 · 唯一解 · 给定 ${givenCount}/${total} (${((givenCount / total) * 100).toFixed(0)}%)`)
}

console.log('')
if (fail) {
  console.log(`失败 ${fail} 项`)
  process.exit(1)
}
console.log('全部通过')
