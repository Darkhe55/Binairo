import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

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

const b = await chromium.launch({ headless: true, executablePath: EXE })
const p = await b.newPage({ viewport: { width: 1280, height: 900 } })
const errs = []
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
p.on('console', (m) => {
  if (m.type() === 'error') errs.push('CONSOLE ' + m.text())
})
await p.goto('http://127.0.0.1:5176/', { waitUntil: 'networkidle' })
console.log('题目数:', await p.locator('.puzzle-item').count())
console.log('当前题:', await p.locator('.puzzle-item.active .title').textContent())
console.log('给定格(淡灰底):', await p.locator('.board-svg .cell.given').count())
console.log('棋子:', await p.locator('.board-svg .disc').count())
console.log('状态栏:', await p.locator('#status').textContent())
console.log('JS 报错:', errs.length ? errs.join(' | ') : '无')
await b.close()
