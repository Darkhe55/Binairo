/**
 * 黑白冒烟测试：先 `npm run build && npx vite preview --port 5176`，再 `node scripts/ui-check.mjs`
 */
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const HOOK = '__heibai'
const BASE = 'http://127.0.0.1:5176/'

/**
 * 解析 Chromium 可执行文件：CHROME_PATH > 本机 ms-playwright 里已安装的最高版本 > playwright 默认注册表。
 * playwright-core 的注册表版本未必和实际下载的浏览器一致，所以先扫本地安装目录。
 */
function resolveChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  if (process.platform === 'win32') {
    const root = path.join(
      process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local'),
      'ms-playwright',
    )
    if (existsSync(root)) {
      const versions = readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^chromium-\d+$/.test(e.name))
        .map((e) => Number(e.name.slice('chromium-'.length)))
        .sort((a, b) => b - a)
      for (const v of versions) {
        const exe = path.join(root, `chromium-${v}`, 'chrome-win64', 'chrome.exe')
        if (existsSync(exe)) return exe
      }
    }
  }
  return chromium.executablePath()
}

const EXE = resolveChrome()

async function waitForServer(url, timeoutMs = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('preview server 没起来')
}

const results = []
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond })
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? '  ' + extra : ''}`)
}

try {
  await waitForServer(BASE)
  const browser = await chromium.launch({ headless: true, executablePath: EXE })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  await page.goto(BASE, { waitUntil: 'networkidle' })
  ok('无 JS 报错', errors.length === 0, errors.join(' | '))
  ok('题库渲染', (await page.locator('.puzzle-item').count()) === 5)
  ok('棋盘 SVG 渲染', (await page.locator('svg.board-svg').count()) === 1)
  ok('给定格渲染', (await page.locator('.board-svg .cell.given').count()) === 18)
  ok('棋子渲染', (await page.locator('.board-svg .disc').count()) === 18)

  // 按参考解填 → 判定完成
  const solved = await page.evaluate(async () => {
    const api = window.__heibai
    const s = api.session
    const sol = s.puzzle.solution
    for (let i = 0; i < sol.length; i++) api.setCell(i, sol[i])
    await new Promise((r) => setTimeout(r, 50))
    const v = api.validate()
    return { solved: v.solved, status: document.querySelector('#status').textContent }
  })
  ok('按参考解填满 → 判定完成', solved.solved === true, solved.status)

  // 撤销 / 重做
  const undoInfo = await page.evaluate(async () => {
    const before = window.__heibai.session.state.cells.filter((c) => c !== 0).length
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
    const after = window.__heibai.session.state.cells.filter((c) => c !== 0).length
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', shiftKey: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
    return { before, after, redo: window.__heibai.session.state.cells.filter((c) => c !== 0).length }
  })
  ok('Z 撤销生效', undoInfo.after < undoInfo.before, `${undoInfo.before} → ${undoInfo.after}`)
  ok('Shift+Z 重做生效', undoInfo.redo === undoInfo.before, `${undoInfo.redo}`)

  // 逻辑解题预留提示
  await page.click('#btn-logic')
  const logicMsg = await page.locator('#status').textContent()
  ok('逻辑解谜器预留提示', /尚未实现/.test(logicMsg || ''), logicMsg)

  // 随机抽题
  await page.click('#btn-random')
  const randomName = await page.locator('.puzzle-item.active .title').textContent()
  ok('随机抽题', !!randomName, randomName || '')

  // 三连高亮：故意在一行里填三个黑
  await page.evaluate(() => {
    const api = window.__heibai
    const s = api.session
    for (let i = 0; i < s.puzzle.givens.length; i++) api.setCell(i, 0)
    // 找一行连续三个非给定格
    const n = s.puzzle.size
    outer: for (let y = 0; y < n; y++) {
      for (let x = 0; x + 2 < n; x++) {
        const a = y * n + x
        const b = a + 1
        const c = a + 2
        if (!s.puzzle.givens[a] && !s.puzzle.givens[b] && !s.puzzle.givens[c]) {
          api.setCell(a, 1)
          api.setCell(b, 1)
          api.setCell(c, 1)
          break outer
        }
      }
    }
  })
  const tripleInfo = await page.evaluate(() => {
    const v = window.__heibai.validate()
    return { triples: v.triples.length, cells: v.tripleCells.length }
  })
  ok('三连被检出并高亮', tripleInfo.triples > 0 && tripleInfo.cells >= 3, JSON.stringify(tripleInfo))

  // 真实鼠标点击
  await page.evaluate(() => {
    const api = window.__heibai
    const s = api.session
    for (let i = 0; i < s.puzzle.givens.length; i++) api.setCell(i, 0)
  })
  const target = await page.evaluate(() => {
    const s = window.__heibai.session
    for (let i = 0; i < s.puzzle.givens.length; i++) if (!s.puzzle.givens[i]) return i
    return -1
  })
  const n = await page.evaluate(() => window.__heibai.session.puzzle.size)
  const svgBox = await page.locator('svg.board-svg').boundingBox()
  const vb = await page.evaluate(() => {
    const v = document.querySelector('svg.board-svg').viewBox.baseVal
    return { x: v.x, y: v.y, w: v.width, h: v.height }
  })
  const cx = target % n
  const cy = Math.floor(target / n)
  const px = svgBox.x + ((48 * 0.18 + (cx + 0.5) * 48) / vb.w) * svgBox.width
  const py = svgBox.y + ((48 * 0.18 + (cy + 0.5) * 48) / vb.h) * svgBox.height
  const beforeClick = await page.evaluate((t) => window.__heibai.session.state.cells[t], target)
  await page.mouse.click(px, py)
  const afterClick = await page.evaluate((t) => window.__heibai.session.state.cells[t], target)
  ok('鼠标点击空格可落子', afterClick !== beforeClick, `${beforeClick} → ${afterClick}`)

  // 左键循环必须能走完：填上 → 标记 → 清除（ historically 清除那步被守卫挡住过）
  // 先把目标格子清空，保证从「未定」开始
  await page.evaluate((h) => {
    const s = window[h].session
    for (let i = 0; i < s.puzzle.trees ? s.puzzle.trees.length : s.puzzle.givens.length; i++) {
      const fixed = s.puzzle.trees ? s.puzzle.trees[i] : s.puzzle.givens[i]
      if (!fixed) { window[h].setCell(i, 0); break }
    }
  }, HOOK)
  const cycleSeq = []
  for (let k = 0; k < 3; k++) {
    const pt = await page.evaluate((h) => {
      const s = window[h].session
      let idx = -1
      for (let i = 0; i < s.puzzle.givens.length; i++) if (!s.puzzle.givens[i]) { idx = i; break }
      const svg = document.querySelector('svg.board-svg')
      const m = svg.getScreenCTM()
      const p = svg.createSVGPoint()
      p.x = 48 * 0.18 + ((idx % s.puzzle.size) + 0.5) * 48
      p.y = 48 * 0.18 + (Math.floor(idx / s.puzzle.size) + 0.5) * 48
      const q = p.matrixTransform(m)
      return { x: q.x, y: q.y, idx }
    }, HOOK)
    await page.mouse.click(pt.x, pt.y)
    await page.waitForTimeout(80)
    const v = await page.evaluate((t) => window[t.h].session.state.cells[t.idx], { h: HOOK, idx: pt.idx })
    cycleSeq.push(v)
  }
  ok('左键循环可走完（含清除）', JSON.stringify(cycleSeq) === '[1,2,0]', JSON.stringify(cycleSeq))

  // 自定义题板 + 唯一解校验
  await page.click('#btn-custom')
  ok('自定义编辑器打开', await page.locator('#custom-editor').isVisible())
  const customCells = await page.locator('.custom-cell').count()
  ok('自定义网格 6×6', customCells === 36, String(customCells))
  await page.locator('.custom-cell').nth(0).click()
  await page.locator('.custom-cell').nth(7).click()
  await page.click('#custom-unique')
  const uniqueMsg = await page.locator('#custom-msg').textContent()
  ok('自定义唯一解校验有响应', !!uniqueMsg && uniqueMsg.length > 0, uniqueMsg || '')
  await page.click('#custom-close')

  await page.screenshot({ path: 'output/ui-check.png', fullPage: true })
  await browser.close()
} catch (err) {
  console.error('运行异常：', err)
  process.exitCode = 1
}

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length) process.exit(1)
