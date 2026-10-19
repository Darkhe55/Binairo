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

  // 回归：题面给定格必须写进盘面状态，否则校验永远判不了完成、逻辑解题也会漏掉题面
  const givenState = await page.evaluate(async () => {
    const api = window.__heibai
    const s = api.session
    for (let i = 0; i < s.puzzle.givens.length; i++) {
      if (!s.puzzle.givens[i]) api.setCell(i, 0)
    }
    const givenInState = s.puzzle.givens.every((g, i) => g === 0 || s.state.cells[i] === g)
    const filledAtStart = s.state.cells.filter((c) => c !== 0).length
    for (let i = 0; i < s.puzzle.givens.length; i++) {
      if (!s.puzzle.givens[i]) api.setCell(i, s.puzzle.solution[i])
    }
    const v = api.validate()
    return {
      givenInState,
      filledAtStart,
      solved: v.solved,
      filled: v.filled,
      unknown: v.unknown,
    }
  })
  ok(
    '给定格进入盘面状态，只填非给定格即判定完成',
    givenState.givenInState && givenState.solved,
    `给定格在状态中=${givenState.givenInState} 开局已填=${givenState.filledAtStart} 填完 filled=${givenState.filled} unknown=${givenState.unknown}`,
  )

  // 逻辑解题：必须从当前盘面（给定格 + 玩家已填格）推理，不能冲掉已填格
  const logicFromCurrent = await page.evaluate(() => {
    const api = window.__heibai
    const s = api.session
    for (let i = 0; i < s.puzzle.givens.length; i++) {
      if (!s.puzzle.givens[i]) api.setCell(i, 0)
    }
    const free = []
    for (let i = 0; i < s.puzzle.givens.length; i++) if (!s.puzzle.givens[i]) free.push(i)
    const mine = free.slice(0, 3)
    for (const i of mine) api.setCell(i, s.puzzle.solution[i])
    return { mine, before: s.state.cells.filter((c) => c !== 0).length }
  })
  await page.click('#btn-logic')
  // 回放是异步的：按钮应立即切到「停止回放」，然后逐帧落子
  const stopLabel = await page.locator('#btn-logic').textContent()
  await page.waitForFunction(
    () =>
      /回放完毕|自相矛盾|推不出新格子/.test(
        document.querySelector('#status')?.textContent || '',
      ),
    null,
    { timeout: 30000 },
  )
  const logicMsg = await page.locator('#status').textContent()
  const logicAfter = await page.evaluate((mine) => {
    const s = window.__heibai.session
    const sol = s.puzzle.solution
    let addedCorrect = true
    for (let i = 0; i < s.state.cells.length; i++) {
      if (s.state.cells[i] !== 0 && s.state.cells[i] !== sol[i]) addedCorrect = false
    }
    return {
      filled: s.state.cells.filter((c) => c !== 0).length,
      mineKept: mine.every((i) => s.state.cells[i] === sol[i]),
      addedCorrect,
    }
  }, logicFromCurrent.mine)
  ok(
    '逻辑解题逐帧回放且不冲掉已填格',
    /回放完毕/.test(logicMsg || '') &&
      stopLabel === '停止回放' &&
      logicAfter.filled > logicFromCurrent.before &&
      logicAfter.mineKept &&
      logicAfter.addedCorrect,
    `${logicMsg}（按钮=${stopLabel}，已填 ${logicFromCurrent.before} → ${logicAfter.filled}，已填格保留=${logicAfter.mineKept}，推论全部正确=${logicAfter.addedCorrect}）`,
  )

  // 整段回放算一个撤销单元：按一次 Z 应整段收回
  await page.keyboard.press('z')
  await page.waitForTimeout(80)
  const afterUndo = await page.evaluate(
    () => window.__heibai.session.state.cells.filter((c) => c !== 0).length,
  )
  ok(
    '一次撤销收回整段回放',
    afterUndo === logicFromCurrent.before,
    `${logicAfter.filled} → ${afterUndo}（回放前 ${logicFromCurrent.before}）`,
  )
  await page.keyboard.press('Shift+z')
  await page.waitForTimeout(80)

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

  /* ———— 左右键拖拽填充 + 右键反向轮换 ———— */
  const screenOf = (idx) =>
    page.evaluate((i) => {
      const s = window.__heibai.session
      const n = s.puzzle.size
      const svg = document.querySelector('svg.board-svg')
      const m = svg.getScreenCTM()
      const p = svg.createSVGPoint()
      p.x = 48 * 0.18 + ((i % n) + 0.5) * 48
      p.y = 48 * 0.18 + (Math.floor(i / n) + 0.5) * 48
      const q = p.matrixTransform(m)
      return { x: q.x, y: q.y }
    }, idx)

  // 逐格移动，保证每一格都收到 pointermove
  const dragAcross = async (cells, button = 'left') => {
    const p0 = await screenOf(cells[0])
    await page.mouse.move(p0.x, p0.y)
    await page.mouse.down({ button })
    for (let i = 1; i < cells.length; i++) {
      const p = await screenOf(cells[i])
      await page.mouse.move(p.x, p.y)
    }
    await page.mouse.up({ button })
  }

  const clearFree = () =>
    page.evaluate(() => {
      const s = window.__heibai.session
      for (let i = 0; i < s.puzzle.givens.length; i++) {
        if (!s.puzzle.givens[i]) window.__heibai.setCell(i, 0)
      }
    })

  const cellsAt = (cells) =>
    page.evaluate(
      (cs) => cs.map((i) => window.__heibai.session.state.cells[i]),
      cells,
    )

  // 一行里连续 3 个以上非给定格
  const runRow = await page.evaluate(() => {
    const s = window.__heibai.session
    const n = s.puzzle.size
    for (let y = 0; y < n; y++) {
      const run = []
      for (let x = 0; x < n; x++) {
        const i = y * n + x
        if (s.puzzle.givens[i]) {
          if (run.length >= 3) return run.slice(0, 3)
          run.length = 0
        } else run.push(i)
      }
      if (run.length >= 3) return run.slice(0, 3)
    }
    return null
  })

  await clearFree()
  await dragAcross(runRow, 'left')
  const leftDrag = await cellsAt(runRow)
  ok('左键拖拽连续填黑', JSON.stringify(leftDrag) === '[1,1,1]', JSON.stringify(leftDrag))

  await clearFree()
  await dragAcross(runRow, 'right')
  const rightDrag = await cellsAt(runRow)
  ok('右键拖拽连续填白', JSON.stringify(rightDrag) === '[2,2,2]', JSON.stringify(rightDrag))

  // 右键点击：空 → 白 → 黑 → 空（反向轮换）
  await clearFree()
  const rightClicks = []
  for (let k = 0; k < 3; k++) {
    const p = await screenOf(runRow[0])
    await page.mouse.click(p.x, p.y, { button: 'right' })
    await page.waitForTimeout(60)
    rightClicks.push(await page.evaluate((i) => window.__heibai.session.state.cells[i], runRow[0]))
  }
  ok('右键点击反向轮换', JSON.stringify(rightClicks) === '[2,1,0]', JSON.stringify(rightClicks))

  // 拖拽经过给定格：给定格的值不能被改，非给定格照常涂色
  const mixRow = await page.evaluate(() => {
    const s = window.__heibai.session
    const n = s.puzzle.size
    for (let y = 0; y < n; y++) {
      const row = []
      for (let x = 0; x < n; x++) row.push(y * n + x)
      if (row.some((i) => s.puzzle.givens[i]) && row.some((i) => !s.puzzle.givens[i])) return row
    }
    return null
  })
  const givenBefore = await page.evaluate(() => {
    const s = window.__heibai.session
    return s.puzzle.givens.map((g, i) => (g ? s.state.cells[i] : -1))
  })
  await clearFree()
  await dragAcross(mixRow, 'left')
  const givenAfter = await page.evaluate(() => {
    const s = window.__heibai.session
    return s.puzzle.givens.map((g, i) => (g ? s.state.cells[i] : -1))
  })
  const freePainted = await page.evaluate(
    (row) =>
      row
        .filter((i) => !window.__heibai.session.puzzle.givens[i])
        .every((i) => window.__heibai.session.state.cells[i] === 1),
    mixRow,
  )
  ok(
    '拖拽经过给定格被锁定',
    JSON.stringify(givenBefore) === JSON.stringify(givenAfter) && freePainted,
    `给定格未变=${JSON.stringify(givenBefore) === JSON.stringify(givenAfter)} 非给定格已涂黑=${freePainted}`,
  )

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

  // 自定义题板键盘输入：1 填黑 / 2 填白 / 方向键移动 / . 清空 / Home-End
  await page.click('#btn-custom')
  await page.waitForTimeout(80)
  const selCell = () =>
    page.evaluate(() => {
      const el = document.querySelector('.custom-cell.selected')
      return el ? Number(el.dataset.i) : -1
    })
  const cellCls = (i) =>
    page.evaluate(
      (idx) => document.querySelector(`.custom-cell[data-i="${idx}"]`)?.className ?? '',
      i,
    )
  ok('打开编辑器后光标落在首格', (await selCell()) === 0, `cursor=${await selCell()}`)

  await page.keyboard.press('1')
  ok('按 1 填黑并右移光标', (await cellCls(0)).includes('black') && (await selCell()) === 1,
    `cell0=${await cellCls(0)} cursor=${await selCell()}`)
  await page.keyboard.press('2')
  ok('按 2 填白并右移光标', (await cellCls(1)).includes('white') && (await selCell()) === 2,
    `cell1=${await cellCls(1)} cursor=${await selCell()}`)

  await page.keyboard.press('ArrowDown')
  ok('方向键下移一行', (await selCell()) === 8, `cursor=${await selCell()}`)
  await page.keyboard.press('ArrowRight')
  ok('方向键右移一格', (await selCell()) === 9, `cursor=${await selCell()}`)

  // 在光标处填黑，退回该格，用 . 清空它并右移
  await page.keyboard.press('1') // cell9 填黑 → cursor 10
  ok('按 1 填黑并右移光标', (await cellCls(9)).includes('black') && (await selCell()) === 10,
    `cell9=${await cellCls(9)} cursor=${await selCell()}`)
  await page.keyboard.press('ArrowLeft') // 10 → 9（回到刚填黑那格）
  await page.keyboard.press('.') // 清空 cell9 → cursor 10
  ok('按 . 清空当前格并右移', !(await cellCls(9)).includes('black') && (await selCell()) === 10,
    `cell9=${await cellCls(9)} cursor=${await selCell()}`)

  await page.keyboard.press('Home')
  ok('Home 跳到行首', (await selCell()) === 6, `cursor=${await selCell()}`)
  await page.keyboard.press('End')
  ok('End 跳到行尾', (await selCell()) === 11, `cursor=${await selCell()}`)

  // 边界：行首再按左/上不应越界
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowUp')
  ok('边界处光标不越界', (await selCell()) === 0, `cursor=${await selCell()}`)

  // 全局快捷键隔离：编辑器开着时按 z/c/r 不应触发撤销/检查/抽题
  const puzzleBeforeKeys = await page.evaluate(() => window.__heibai.session.puzzle.id)
  await page.keyboard.press('z')
  await page.keyboard.press('c')
  await page.keyboard.press('r')
  await page.waitForTimeout(150)
  const puzzleAfterKeys = await page.evaluate(() => window.__heibai.session.puzzle.id)
  ok('编辑器开着时全局快捷键被屏蔽',
    puzzleBeforeKeys === puzzleAfterKeys,
    `${puzzleBeforeKeys} → ${puzzleAfterKeys}`)

  // 键盘摆的格能真的载入并保存
  await page.click('#custom-apply')
  await page.waitForTimeout(100)
  const kbdLoadedSize = await page.evaluate(() => window.__heibai.session.puzzle.size)
  ok('键盘摆的题板可载入', kbdLoadedSize === 6, `size=${kbdLoadedSize}`)
  await page.click('#custom-close')

  // 自定义题板：载入/保存后题板都要保持打开，只有点关闭才收起；保存要能熬过刷新
  await page.click('#btn-custom')
  await page.locator('.custom-cell').nth(0).click()
  await page.locator('.custom-cell').nth(1).click()
  await page.click('#custom-apply')
  ok('载入题板后编辑器不自动关闭', await page.locator('#custom-editor').isVisible())
  await page.click('#custom-save')
  ok('保存到题库后编辑器仍不关闭', await page.locator('#custom-editor').isVisible())
  const savedNow = await page.evaluate(() => {
    const raw = localStorage.getItem('heibai-saved-puzzles')
    return raw ? JSON.parse(raw).length : 0
  })
  ok('自定义题板已写入 localStorage', savedNow === 1, `saved=${savedNow}`)
  await page.click('#custom-close')
  ok('点关闭后编辑器收起', !(await page.locator('#custom-editor').isVisible()))

  await page.reload({ waitUntil: 'networkidle' })
  const savedAfterReload = await page.evaluate(() => {
    const raw = localStorage.getItem('heibai-saved-puzzles')
    return raw ? JSON.parse(raw).length : 0
  })
  ok('刷新后自定义题板仍在题库', savedAfterReload === 1, `saved=${savedAfterReload}`)
  ok('刷新后列表包含自定义题', (await page.locator('.puzzle-item').count()) === 6)

  // 删除功能：两步确认 + 删后消失 + 刷新后仍不在 + 内置题不受影响
  const delBtn = page.locator('.puzzle-del')
  const delCount = await delBtn.count()
  ok('只有自定义题带删除按钮', delCount === 1, `删除按钮数=${delCount}`)

  // 第一次点：只进确认态，不删除
  await delBtn.first().click()
  await page.waitForTimeout(60)
  const confirmLabel = await delBtn.first().textContent()
  const stillThereAfterArm = await page.locator('.puzzle-item').count()
  ok('第一次点只进入确认态', confirmLabel === '确认' && stillThereAfterArm === 6, `文案=${confirmLabel} 列表=${stillThereAfterArm}`)

  // 第二次点：真删
  await delBtn.first().click()
  await page.waitForTimeout(80)
  const afterDelete = await page.locator('.puzzle-item').count()
  const delCountAfter = await page.locator('.puzzle-del').count()
  ok('第二次点确认后删除', afterDelete === 5 && delCountAfter === 0, `列表=${afterDelete} 删除按钮=${delCountAfter}`)

  // 刷新后仍然不在，且 localStorage 已清空
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(150)
  const afterReloadDelete = await page.locator('.puzzle-item').count()
  const savedEmpty = await page.evaluate(() => {
    const raw = localStorage.getItem('heibai-saved-puzzles')
    return !raw || JSON.parse(raw).length === 0
  })
  ok('删除后刷新仍不在题库', afterReloadDelete === 5 && savedEmpty, `列表=${afterReloadDelete} localStorage已空=${savedEmpty}`)

  // 内置题不给删（列表里不应再出现任何删除按钮）
  ok('内置题不带删除按钮', (await page.locator('.puzzle-del').count()) === 0)

  await page.screenshot({ path: 'output/ui-check.png', fullPage: true })
  await browser.close()
} catch (err) {
  console.error('运行异常：', err)
  process.exitCode = 1
}

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
if (failed.length) process.exit(1)
