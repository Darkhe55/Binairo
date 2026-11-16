/**
 * 黑白（Binairo / Takuzu）—— 从题面图片自动识别并导入题库
 *
 * 用法：
 *   node scripts/import-image.mjs <图片路径> [选项]
 *
 * 选项：
 *   --name 名称        题库中显示的名称（默认：识图 · W×H）
 *   --id ID            指定题目 id
 *   --series 系列      系列名（默认：图片导入）
 *   --difficulty 级别  easy / medium / hard / custom（默认 hard）
 *   --size N           正方形网格边长（自动识别失败时手动指定）
 *   --width N / --height N  矩形题图宽/高，可只给一边
 *   --map r,c=值       人工覆盖某格（行列从 1 开始；B/黑=1、W/白=2、./0=空）
 *   --append           写入 src/imported-puzzles.ts
 *   --verify           唯一性检查（默认自动做；大图可能超时，会给出警告）
 *   --dry              只识别网格与圆点，不求解、不写入
 *   --max-nodes N      唯一性搜索节点上限（默认 400000）
 *   --time-budget MS   唯一性搜索时间上限毫秒（默认 20000）
 *   --edge PATH        指定 Edge 可执行文件路径（默认自动探测）
 *
 * 识别原理（Playwright + Edge，无网络、无外部服务）：
 *   1. 取亮度众数作背景，多档阈值投影找网格线，取最长等距线序列；
 *   2. 每格中心暗度判断实心黑子；中心留白 + 深色圆环判断空心白子；
 *   3. 生成题面串（. 空 / B 黑 / W 白），预览；--append 写入题库。
 *
 * 题图预期：黑白圆子表示给定格的黑白题图；网格外的文字标签不会影响识别。
 * 注意：本项目 types.ts 使用了 const enum，Node 直接加载 .ts 需要
 * --experimental-transform-types；脚本会自动用它重新启动自己。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { register } from 'node:module'

// const enum 需要 transform 模式；用子进程带参数重新执行自身
if (!process.execArgv.includes('--experimental-transform-types')) {
  const result = spawnSync(
    process.execPath,
    ['--experimental-transform-types', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  )
  process.exit(result.status ?? 1)
}

// 让 Node 能解析项目里的无扩展名相对导入（Vite 可解析，Node 需要补 .ts）
const tsResolveLoader = `export async function resolve(specifier, context, next) {
  try { return await next(specifier, context) } catch (err) {
    if (specifier.startsWith('.') && !/\\.[cm]?[jt]s$/.test(specifier)) {
      try { return await next(specifier + '.ts', context) } catch {}
    }
    throw err
  }
}`
register('data:text/javascript;base64,' + Buffer.from(tsResolveLoader).toString('base64'))

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)

function resolveEdge() {
  for (const p of EDGE_CANDIDATES) if (existsSync(p)) return p
  throw new Error('找不到 Microsoft Edge，可用 --edge 或环境变量 EDGE_PATH 指定路径')
}

const DATA_FILE = path.resolve('src/imported-puzzles.ts')

function usage(message) {
  if (message) console.error(`[import] ${message}`)
  console.error(
    '用法: node scripts/import-image.mjs <图片路径> [--name 名称] [--series 系列] [--difficulty easy|medium|hard|custom]\n' +
      '       [--size N | --width N --height N] [--map r,c=值] [--append] [--verify] [--dry]\n' +
      '       [--max-nodes N] [--time-budget MS] [--id ID] [--edge PATH]',
  )
  process.exit(1)
}

function parseArgs(argv) {
  const opts = {
    positional: [],
    append: false,
    verify: false,
    dry: false,
    size: 0,
    width: 0,
    height: 0,
    maxNodes: 400_000,
    timeBudget: 20_000,
    map: [],
  }
  const valueFlags = new Set(['name', 'id', 'series', 'difficulty', 'size', 'width', 'height', 'max-nodes', 'time-budget', 'edge', 'map'])
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      opts.positional.push(arg)
      continue
    }
    const key = arg.slice(2)
    if (key === 'append') opts.append = true
    else if (key === 'verify') opts.verify = true
    else if (key === 'dry') opts.dry = true
    else if (valueFlags.has(key)) {
      const value = argv[i + 1]
      if (value === undefined) usage(`缺少 --${key} 的值`)
      i++
      if (key === 'max-nodes') opts.maxNodes = Number(value)
      else if (key === 'time-budget') opts.timeBudget = Number(value)
      else if (key === 'size') opts.size = Number(value)
      else if (key === 'width') opts.width = Number(value)
      else if (key === 'height') opts.height = Number(value)
      else if (key === 'map') opts.map.push(value)
      else opts[key] = value
    } else usage(`未知选项 --${key}`)
  }
  if (opts.positional.length !== 1) usage('需要且只需要一个图片路径')
  if (!Number.isFinite(opts.maxNodes) || opts.maxNodes <= 0) usage('--max-nodes 必须是正数')
  if (!Number.isFinite(opts.timeBudget) || opts.timeBudget <= 0) usage('--time-budget 必须是正数')
  return opts
}

function hashId(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 6)
}

const SYMBOL = (v) => (v === 1 ? 'B' : v === 2 ? 'W' : '.')

// ───────────────────────────── 图片识别 ─────────────────────────────

function dataUrlOf(file) {
  const ext = path.extname(file).toLowerCase()
  const mime =
    ext === '.png' ? 'image/png' : ext === '.bmp' ? 'image/bmp' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`
}

async function analyzeImage({ imageFile, edge, size, width, height }) {
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ headless: true, executablePath: edge })
  try {
    const page = await browser.newPage()
    return await page.evaluate(
      async ({ src, sizeOpt, widthOpt, heightOpt }) => {
        const img = new Image()
        img.src = src
        await img.decode()
        const W = img.naturalWidth
        const H = img.naturalHeight
        const canvas = document.createElement('canvas')
        canvas.width = W
        canvas.height = H
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0)
        const data = ctx.getImageData(0, 0, W, H).data
        const lum = new Float32Array(W * H)
        for (let p = 0, i = 0; p < lum.length; p++, i += 4) lum[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]

        const hist = new Int32Array(64)
        for (let p = 0; p < lum.length; p++) hist[Math.min(63, Math.floor(lum[p] / 4))]++
        let modeBin = 0
        for (let i = 0; i < 64; i++) if (hist[i] > hist[modeBin]) modeBin = i
        const bgLum = modeBin * 4 + 2

        const groupLines = (scores, min) => {
          const out = []
          let run = []
          for (let i = 0; i < scores.length; i++) {
            if (scores[i] >= min) run.push(i)
            else if (run.length) {
              out.push(run.reduce((a, b) => a + b, 0) / run.length)
              run = []
            }
          }
          if (run.length) out.push(run.reduce((a, b) => a + b, 0) / run.length)
          return out
        }
        const axisScores = (horizontal, threshold) => {
          const scores = horizontal ? new Int32Array(H) : new Int32Array(W)
          if (horizontal) {
            for (let y = 0; y < H; y++) {
              let n = 0
              for (let x = 0; x < W; x++) if (lum[y * W + x] < threshold) n++
              scores[y] = n
            }
          } else {
            for (let x = 0; x < W; x++) {
              let n = 0
              for (let y = 0; y < H; y++) if (lum[y * W + x] < threshold) n++
              scores[x] = n
            }
          }
          return scores
        }
        const findGrid = (horizontal) => {
          let best = null
          for (let delta = 100; delta >= 20; delta -= 10) {
            const threshold = Math.max(10, bgLum - delta)
            const scores = axisScores(horizontal, threshold)
            const lines = groupLines(scores, Math.max(20, Math.max(...scores) * 0.5))
            if (lines.length < 3) continue
            for (let i = 0; i < lines.length; i++) {
              for (let j = i + 1; j < lines.length; j++) {
                const step = (lines[j] - lines[i]) / (j - i)
                if (step < 6) continue
                const run = [lines[i]]
                let expected = lines[i] + step
                let k = i + 1
                while (k < lines.length && Math.abs(lines[k] - expected) <= step * 0.25) {
                  run.push(lines[k])
                  k++
                  expected += step
                }
                if (run.length < 3) continue
                const realStep = (run[run.length - 1] - run[0]) / (run.length - 1)
                let maxDev = 0
                for (let q = 0; q < run.length; q++) maxDev = Math.max(maxDev, Math.abs(run[q] - (run[0] + q * realStep)))
                if (maxDev > realStep * 0.1) continue
                if (!best || run.length > best.score) {
                  best = { score: run.length, first: run[0], last: run[run.length - 1], step: realStep, lines: run.length, threshold }
                }
              }
            }
            if (best && best.score >= 20) break
          }
          return best
        }
        const hLines = findGrid(true)
        const vLines = findGrid(false)
        if (!hLines || !vLines) {
          return { error: '未能定位网格线；请确认图片包含完整的题面网格，或先用 --size / --width / --height 指定尺寸' }
        }
        const autoW = vLines.lines - 1
        const autoH = hLines.lines - 1
        const w = widthOpt || sizeOpt || autoW
        const h = heightOpt || sizeOpt || autoH
        if (!(w >= 2) || !(h >= 2)) {
          return { error: `无法确定网格尺寸：竖线 ${vLines.lines} 条、横线 ${hLines.lines} 条（自动识别 ${autoW}×${autoH}）` }
        }
        if (vLines.lines !== w + 1 || hLines.lines !== h + 1) {
          return { error: `网格不匹配：识别到 ${vLines.lines} 条竖线 / ${hLines.lines} 条横线，但目标是 ${w}×${h}（需要 ${w + 1} / ${h + 1} 条线）` }
        }
        const x0 = vLines.first
        const y0 = hLines.first
        const cellW = vLines.step
        const cellH = hLines.step
        const cellMin = Math.min(cellW, cellH)

        const cells = new Array(w * h).fill(0)
        const stats = new Array(w * h)
        const ambiguous = []
        let black = 0
        let white = 0
        let empty = 0
        for (let r = 0; r < h; r++) {
          for (let c = 0; c < w; c++) {
            const cx = x0 + (c + 0.5) * cellW
            const cy = y0 + (r + 0.5) * cellH
            // 中心区暗度（黑子）
            const rad = cellMin * 0.28
            let dark = 0
            let total = 0
            for (let dy = -Math.ceil(rad); dy <= Math.ceil(rad); dy++) {
              for (let dx = -Math.ceil(rad); dx <= Math.ceil(rad); dx++) {
                if (dx * dx + dy * dy > rad * rad) continue
                const x = Math.round(cx + dx)
                const y = Math.round(cy + dy)
                if (x < 0 || y < 0 || x >= W || y >= H) continue
                total++
                if (lum[y * W + x] < 110) dark++
              }
            }
            const centerDark = total ? dark / total : 0
            // 圆环墨迹（空心白子 / 用户落子的虚线环）——半径按格宽比例
            const rIn = cellMin * 0.24
            const rOut = cellMin * 0.4
            let ringInk = 0
            let ringTotal = 0
            for (let dy = -Math.ceil(rOut); dy <= Math.ceil(rOut); dy++) {
              for (let dx = -Math.ceil(rOut); dx <= Math.ceil(rOut); dx++) {
                const dist = Math.hypot(dx, dy)
                if (dist < rIn || dist > rOut) continue
                const x = Math.round(cx + dx)
                const y = Math.round(cy + dy)
                if (x < 0 || y < 0 || x >= W || y >= H) continue
                ringTotal++
                if (lum[y * W + x] < 140) ringInk++
              }
            }
            const ringRatio = ringTotal ? ringInk / ringTotal : 0
            let value = 0
            if (centerDark > 0.4) value = 1
            else if (ringRatio > 0.1) value = 2
            const idx = r * w + c
            cells[idx] = value
            stats[idx] = { centerDark, ringRatio }
            if (value === 1) black++
            else if (value === 2) white++
            else empty++
            const nearBlack = Math.abs(centerDark - 0.4) < 0.1
            const nearWhite = value === 0 && ringRatio > 0.04 && ringRatio < 0.1
            if (nearBlack || nearWhite) ambiguous.push({ r, c, centerDark: +centerDark.toFixed(3), ringRatio: +ringRatio.toFixed(3), value })
          }
        }
        return {
          width: w,
          height: h,
          cells,
          black,
          white,
          empty,
          ambiguous,
          grid: { imageW: W, imageH: H, x0, y0, cellW, cellH, autoW, autoH, bgLum },
        }
      },
      { src: dataUrlOf(imageFile), sizeOpt: size, widthOpt: width, heightOpt: height },
    )
  } finally {
    await browser.close()
  }
}

// ───────────────────────────── 写入题库 ─────────────────────────────

function appendEntry(entry) {
  const line = `  { id: ${JSON.stringify(entry.id)}, name: ${JSON.stringify(entry.name)}, width: ${entry.width}, height: ${entry.height}, difficulty: ${JSON.stringify(entry.difficulty)}, series: ${JSON.stringify(entry.series)}, givens: ${JSON.stringify(entry.givens)}, solution: ${JSON.stringify(entry.solution ?? '')} },\n`
  if (!existsSync(DATA_FILE)) {
    writeFileSync(
      DATA_FILE,
      "import type { RawPuzzle } from './puzzles-data'\n\n/** 由 scripts/import-image.mjs 追加；不会在 npm run gen 时被覆盖 */\nexport const IMPORTED_PUZZLES: RawPuzzle[] = [\n" +
        line +
        ']\n',
      'utf8',
    )
    return
  }
  let text = readFileSync(DATA_FILE, 'utf8').replace(/\r\n/g, '\n')
  const close = text.lastIndexOf(']')
  if (close < 0) throw new Error('imported-puzzles.ts 格式异常：找不到数组结尾 ]')
  const before = text.slice(0, close)
  text = before + (before.endsWith('\n') ? '' : '\n') + line + text.slice(close)
  writeFileSync(DATA_FILE, text, 'utf8')
}

// ───────────────────────────── 主流程 ─────────────────────────────

const opts = parseArgs(process.argv.slice(2))
const imageFile = path.resolve(opts.positional[0])
if (!existsSync(imageFile)) usage(`找不到图片：${imageFile}`)
const edge = opts.edge || resolveEdge()

console.log(`[import] 识别 ${path.relative(process.cwd(), imageFile) || imageFile}`)
const detected = await analyzeImage({ imageFile, edge, size: opts.size, width: opts.width, height: opts.height })
if (detected.error) {
  console.error(`[import] ${detected.error}`)
  process.exit(1)
}
const { width, height, grid } = detected
// 黑白规则要求每行、每列黑白等量，因此宽高都必须是偶数；矩形题板（宽 ≠ 高）同样支持。
if (width % 2 !== 0 || height % 2 !== 0) {
  console.error(`[import] 黑白要求棋盘宽高都是偶数，识别到 ${width}×${height}`)
  process.exit(1)
}
const total = width * height
let cells = detected.cells.slice()

// --map 人工覆盖：r,c=值（行列从 1 开始；B/1=黑，W/2=白，./0=空）
for (const spec of opts.map) {
  for (const pair of spec.split(';')) {
    if (!pair.trim()) continue
    const m = pair.trim().match(/^(\d+)\s*,\s*(\d+)\s*=\s*([BWbw12.0])$/)
    if (!m) usage(`--map 格式应为 行,列=值（B/W/. 或 1/2/0），收到：${pair}`)
    const r = Number(m[1]) - 1
    const c = Number(m[2]) - 1
    if (r < 0 || r >= height || c < 0 || c >= width) usage(`--map 坐标越界：${pair}（网格 ${width}×${height}）`)
    const ch = m[3].toUpperCase()
    cells[r * width + c] = ch === 'B' || ch === '1' ? 1 : ch === 'W' || ch === '2' ? 2 : 0
  }
}
const black = cells.filter((v) => v === 1).length
const white = cells.filter((v) => v === 2).length
const empty = total - black - white
console.log(
  `[import] 网格 ${width}×${height}，格子 ${grid.cellW.toFixed(2)}×${grid.cellH.toFixed(2)}px，图片 ${grid.imageW}×${grid.imageH}；` +
    `黑子 ${black}、白子 ${white}、空格 ${empty}`,
)
if (detected.ambiguous.length) {
  console.warn(`[import] 有 ${detected.ambiguous.length} 个格子识别不确定（可用 --map 修正）：`)
  for (const a of detected.ambiguous.slice(0, 12)) {
    console.warn(`  第 ${a.r + 1} 行第 ${a.c + 1} 列：中心暗度 ${a.centerDark}，圆环墨迹 ${a.ringRatio} → ${a.value}`)
  }
}
console.log('[import] 题面（B = 黑，W = 白，. = 空）：')
for (let r = 0; r < height; r++) {
  let line = ''
  for (let c = 0; c < width; c++) line += SYMBOL(cells[r * width + c])
  console.log(String(r + 1).padStart(2) + ' ' + line)
}
const givens = cells.map(SYMBOL).join('')

const id = opts.id || `binairo-${width}x${height}-${hashId(givens)}`
const name = opts.name || `识图 · ${width}×${height}`
const difficulty = opts.difficulty || 'hard'
const series = opts.series || '图片导入'
const entry = { id, name, width, height, difficulty, series, givens, solution: '' }

if (opts.dry) {
  console.log('[import] --dry：仅识别，不求解、不写入。')
  process.exit(0)
}

let unique = null
if (opts.verify || opts.append) {
  const { countSolutions } = await import('../src/solver.ts')
  console.log('[import] 唯一性检查…')
  const t0 = Date.now()
  const puzzle = { id, name, width, height, difficulty, givens: cells }
  const counted = countSolutions(puzzle, 2, { maxNodes: opts.maxNodes, timeBudgetMs: opts.timeBudget })
  const ms = Date.now() - t0
  if (counted.timedOut) {
    console.warn(`[import] 唯一性检查超时（${counted.nodes} 节点 / ${ms}ms），无法确认唯一解；可放宽 --max-nodes / --time-budget。`)
  } else if (counted.count === 0) {
    console.error(`[import] 无解：识别出的题面在黑白规则下不成立，请检查圆点识别或使用 --map 修正（${ms}ms）。`)
    process.exit(1)
  } else if (counted.count === 1) {
    unique = true
    console.log(`[import] 唯一解确认（${counted.nodes} 节点 / ${ms}ms）`)
    if (counted.first) entry.solution = counted.first.cells.map((v) => SYMBOL(v)).join('')
  } else {
    unique = false
    console.warn(`[import] 警告：找到 ${counted.count} 个解（上限），题目可能不唯一。`)
    if (counted.first) entry.solution = counted.first.cells.map((v) => SYMBOL(v)).join('')
  }
}

if (!opts.append) {
  console.log('[import] 预览模式（未写入题库）。加 --append 写入 src/imported-puzzles.ts。')
  console.log(
    `[import] 题库条目：id=${id} name=${name} 尺寸=${width}×${height} 给定=${black + white} 格` +
      (entry.solution ? ` 参考解=${entry.solution.length} 格` : ''),
  )
  console.log(`[import] givens = ${givens}`)
} else {
  appendEntry(entry)
  console.log(`[import] 已写入 ${path.relative(process.cwd(), DATA_FILE)}：${id} ${name}`)
}
