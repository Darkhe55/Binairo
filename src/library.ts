/**
 * 自定义题库持久化
 * ==========================
 * 和内置题库（puzzles-data.ts）分开：玩家自己摆的题板存 localStorage，
 * 刷新页面、重启浏览器后仍出现在题面列表里。
 *
 * 存储时把 givens 压成串（黑 B / 白 W / 空 .），比存数字数组省地方也好排查。
 */
import type { CellState, Puzzle } from './types'
import { CellState as CS } from './types'

const KEY = 'heibai-saved-puzzles'

/** givens → 串 */
function encodeGivens(givens: CellState[]): string {
  return givens.map((g) => (g === CS.Black ? 'B' : g === CS.White ? 'W' : '.')).join('')
}

/** 串 → givens，非法字符按空格处理 */
function decodeGivens(s: string): CellState[] {
  return [...s].map((ch) =>
    ch === 'B' ? CS.Black : ch === 'W' ? CS.White : CS.Unknown,
  ) as CellState[]
}

/** 内容指纹：同一张题板恒定得到同一个 id，
 *  重复保存是覆盖而不是越堆越多，刷新后也不会换 id。 */
export function customPuzzleId(givens: CellState[]): string {
  let h = 5381
  for (const g of givens) h = ((h * 33) ^ g) >>> 0
  return `custom-${h.toString(36)}`
}

/** 读取本地题库；数据损坏时宁可返回空列表，也不要让整个应用挂掉 */
export function loadSavedPuzzles(): Puzzle[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return []

    const out: Puzzle[] = []
    for (const x of arr) {
      if (!x || typeof x !== 'object') continue
      const r = x as {
        id?: unknown
        name?: unknown
        size?: unknown
        width?: unknown
        height?: unknown
        givens?: unknown
      }
      if (typeof r.id !== 'string' || typeof r.givens !== 'string') continue

      const givens = decodeGivens(r.givens)
      const legacySize =
        typeof r.size === 'number' && r.size > 0 ? r.size : Math.round(Math.sqrt(givens.length))
      const width = typeof r.width === 'number' && r.width > 0 ? r.width : legacySize
      const height = typeof r.height === 'number' && r.height > 0 ? r.height : legacySize
      if (width <= 0 || height <= 0 || givens.length !== width * height) continue

      out.push({
        id: r.id,
        name: typeof r.name === 'string' && r.name ? r.name : `自定义 ${width}×${height}`,
        width,
        height,
        givens,
        difficulty: 'custom',
      })
    }
    return out
  } catch {
    return []
  }
}

function persistSavedPuzzles(list: Puzzle[]): void {
  const payload = list.map((p) => ({
    id: p.id,
    name: p.name,
    width: p.width,
    height: p.height,
    givens: encodeGivens(p.givens),
  }))
  try {
    localStorage.setItem(KEY, JSON.stringify(payload))
  } catch {
    /* 隐私模式或配额满：静默失败，保存功能降级为不可用 */
  }
}

/** 追加或覆盖同 id，返回最新列表 */
export function savePuzzleToLibrary(p: Puzzle): Puzzle[] {
  const list = loadSavedPuzzles()
  const i = list.findIndex((x) => x.id === p.id)
  if (i >= 0) list[i] = p
  else list.push(p)
  persistSavedPuzzles(list)
  return list
}

/** 从本地题库移除一张 */
export function removeSavedPuzzle(id: string): Puzzle[] {
  const list = loadSavedPuzzles().filter((p) => p.id !== id)
  persistSavedPuzzles(list)
  return list
}
