import './styles.css'
import type { CellState, GameState, LogicStep, Move, Puzzle } from './types'
import { CellState as CS } from './types'
import {
  applyGivens,
  applyMove,
  cellValue,
  createEmptyState,
  cycleCell,
  deserializeState,
  invertMove,
  isGiven,
  serializeState,
} from './state'
import { givenCount, puzzles, randomPuzzle } from './puzzles'
import {
  customPuzzleId,
  loadSavedPuzzles,
  removeSavedPuzzle,
  savePuzzleToLibrary,
} from './library'
import {
  cellCenter,
  clientToViewBox,
  hitTestCell,
  metricsFor,
  renderBoard,
  updateFlash,
  updateHover,
} from './render'
import { validate } from './validate'
import { countSolutions } from './solver'
import { planLogicSolve, RULES } from './logic'
import { isMuted, resumeAudio, setMuted } from './audio'
import { bumpStreak, fxNegative, fxPositive } from './fx'

const SAVE_PREFIX = 'heibai-save:'

interface Session {
  puzzle: Puzzle
  state: GameState
  /** 一次手势/一次操作算一个撤销单元 */
  undo: Move[][]
  redo: Move[][]
}

function $(sel: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(sel)
  if (!el) throw new Error(`missing ${sel}`)
  return el
}

function $input(sel: string): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(sel)
  if (!el) throw new Error(`missing ${sel}`)
  return el
}

/* ———————————————————— 存档 ———————————————————— */

function loadSave(puzzleId: string): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + puzzleId)
    if (!raw) return null
    const data = JSON.parse(raw) as {
      version: number
      puzzleId: string
      size: number
      cells: number[]
    }
    if (data.version !== 1) return null
    return deserializeState(data)
  } catch {
    return null
  }
}

function saveState(session: Session): void {
  localStorage.setItem(
    SAVE_PREFIX + session.puzzle.id,
    JSON.stringify(serializeState(session.state)),
  )
}

function difficultyLabel(d: Puzzle['difficulty']): string {
  return d === 'easy' ? '入门' : d === 'medium' ? '进阶' : d === 'custom' ? '自定义' : '挑战'
}

/* ———————————————————— 页面骨架 ———————————————————— */

const app = document.querySelector('#app')
if (!app) throw new Error('no #app')

app.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <h1>黑白</h1>
      <p>Binairo · 每行每列黑白颜色数量相等 · 同色不出现三连 · 任意两行/两列排列不相同</p>
    </div>
    <div class="brand">
      <p style="margin:0">左键填入黑子· 右键白子· 按住拖动连续填入· 点击则在棋子中循环切换</p>
    </div>
  </header>

  <div class="layout">
    <aside class="panel">
      <h2>题面</h2>
      <div class="toolbar" style="margin-top:0">
        <button class="btn" id="btn-random" type="button">随机抽题</button>
        <button class="btn" id="btn-mute" type="button">音效：开</button>
        <button class="btn" id="btn-custom" type="button">自定义</button>
      </div>
      <div class="puzzle-list" id="puzzle-list"></div>

      <div class="custom-editor" id="custom-editor" hidden>
        <h2>自定义题板</h2>
        <div class="custom-row">
          <label>边长 <input id="custom-n" type="number" min="4" max="40" step="2" value="6" /></label>
          <button class="btn" id="custom-regen" type="button">生成网格</button>
        </div>
        <div class="custom-hint">点击格子循环：空 → 黑 → 白 → 空，摆好给定格后「载入题板」。｜ 键盘：方向键移动 · 1 填黑 · 2 填白 · . / 退格清空 · Enter / Tab 下一格 · Home / End 行首行尾</div>
        <div class="custom-grid" id="custom-grid"></div>
        <div class="toolbar" style="margin-top:10px">
          <button class="btn primary" id="custom-apply" type="button">载入题板</button>
          <button class="btn" id="custom-save" type="button">保存到题库</button>
          <button class="btn" id="custom-unique" type="button">唯一解校验</button>
          <button class="btn danger" id="custom-close" type="button">关闭</button>
        </div>
        <div class="custom-msg" id="custom-msg"></div>
      </div>

      <div class="toolbar">
        <button class="btn primary" id="btn-check" type="button">检查</button>
        <button class="btn" id="btn-undo" type="button">撤销</button>
        <button class="btn" id="btn-redo" type="button">重做</button>
        <button class="btn" id="btn-hint" type="button">提示一格</button>
        <button class="btn" id="btn-logic" type="button">逻辑解题</button>
        <button class="btn" id="btn-solve" type="button">显示解</button>
        <button class="btn danger" id="btn-clear" type="button">清空</button>
      </div>

      <div class="status" id="status">选择左侧题目开始。</div>

      <div class="legend">
        <div><kbd>左键</kbd> 填入黑子 · 点击循环：空 → 黑 → 白 → 空</div>
        <div><kbd>右键</kbd> 填入白子 · 点击反向循环：空 → 白 → 黑 → 空</div>
        <div><kbd>拖拽</kbd> 左键连续填黑 · 右键连续填白</div>
        <div><kbd>滚轮</kbd> 缩放 · <kbd>中键拖拽</kbd> 平移 · <kbd>0</kbd> 复位视图</div>
        <div><kbd>Z</kbd> 撤销 · <kbd>Shift+Z</kbd> 重做</div>
        <div><kbd>C</kbd> 检查 · <kbd>H</kbd> 提示 · <kbd>S</kbd> 显示解 · <kbd>Esc</kbd> 清空</div>
        <div><kbd>R</kbd> 随机抽题 · <kbd>L</kbd> 逻辑解题 · <kbd>M</kbd> 音效开关</div>
      </div>
    </aside>

    <main class="panel board-wrap" id="board-wrap">
      <div class="zoom-bar">
        <button class="btn" id="zoom-out" type="button" title="缩小">−</button>
        <span class="zoom-label" id="zoom-label">100%</span>
        <button class="btn" id="zoom-in" type="button" title="放大">+</button>
        <button class="btn" id="zoom-reset" type="button">复位</button>
      </div>
      <div id="board"></div>
    </main>
  </div>
`

let session: Session | null = null

/** 题库 = 内置题 + 本地保存的自定义题板 */
let library: Puzzle[] = [...puzzles, ...loadSavedPuzzles()]

/** 正在等待第二次点击确认删除的题板 id（两步确认，防误删） */
let pendingDeleteId: string | null = null

/* ———————————————————— 刷新 ———————————————————— */

function setStatus(text: string, tone: 'ok' | 'bad' | 'solving' | '' = '') {
  const el = $('#status')
  el.textContent = text
  el.className = 'status' + (tone ? ` ${tone}` : '')
}

function renderPuzzleList() {
  const list = $('#puzzle-list')
  list.innerHTML = library
    .map((p) => {
      const active = session?.puzzle.id === p.id ? ' active' : ''
      // 只有本地保存的自定义题板能删，内置题不给删
      const confirming = pendingDeleteId === p.id
      const del =
        p.difficulty === 'custom'
          ? `<button class="puzzle-del${confirming ? ' confirm' : ''}" data-del="${p.id}" type="button" title="${
              confirming ? '再点一次确认删除' : '从题库删除'
            }">${confirming ? '确认' : '×'}</button>`
          : ''
      return `
        <div class="puzzle-row">
          <button class="puzzle-item${active}" data-id="${p.id}" type="button">
            <span class="title">${p.name}</span>
            <span class="meta">${p.size}×${p.size} · ${difficultyLabel(p.difficulty)} · ${givenCount(p)} 个给定格</span>
          </button>
          ${del}
        </div>
      `
    })
    .join('')

  list.querySelectorAll<HTMLButtonElement>('.puzzle-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id
      const p = id ? library.find((x) => x.id === id) : undefined
      if (p) selectPuzzle(p)
    })
  })

  // 删除走两步：第一次点只进确认态，再点一次才真删
  list.querySelectorAll<HTMLButtonElement>('.puzzle-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.del
      if (!id) return
      if (pendingDeleteId === id) deleteSavedPuzzle(id)
      else {
        pendingDeleteId = id
        renderPuzzleList()
      }
    })
  })
}

function currentSvg(): SVGSVGElement | null {
  return $('#board').querySelector<SVGSVGElement>('svg.board-svg')
}

function renderBoardOnly() {
  if (!session) return
  const result = validate(session.state, session.puzzle)
  $('#board').innerHTML = renderBoard(session.puzzle, session.state, result)
  const svg = currentSvg()
  if (svg) {
    const m = metricsFor(session.puzzle)
    if (hoverCell !== null) updateHover(svg, m, hoverCell)
    if (flashCell !== null) updateFlash(svg, m, flashCell)
  }
}

function refresh() {
  renderPuzzleList()
  renderBoardOnly()
  if (!session) return
  const result = validate(session.state, session.puzzle)
  $('#board-wrap').classList.toggle('solved', result.solved)

  if (result.solved) {
    setStatus('完成！三条规则全部满足。', 'ok')
    return
  }
  const bits: string[] = [`已填 ${result.filled}/${session.puzzle.size * session.puzzle.size}`]
  if (result.triples.length) bits.push(`${result.triples.length} 处三连`)
  if (result.badRows.length) bits.push(`${result.badRows.length} 行黑白不均`)
  if (result.badCols.length) bits.push(`${result.badCols.length} 列黑白不均`)
  if (result.dupRows.length) bits.push(`${result.dupRows.length} 行与他人重复`)
  if (result.dupCols.length) bits.push(`${result.dupCols.length} 列与他人重复`)
  if (
    !result.triples.length &&
    !result.badRows.length &&
    !result.badCols.length &&
    !result.dupRows.length &&
    !result.dupCols.length
  ) {
    bits.push('目前没有冲突')
  }
  setStatus(bits.join(' · '))
}

/* ———————————————————— 落子 ———————————————————— */

function moveFor(index: number, to: CellState): Move | null {
  if (!session) return null
  const from = cellValue(session.state, index)
  if (from === to) return null
  return { index, from, to }
}

/** 「逻辑解题」按钮 / L 键：回放中再点一下就是停止 */
function toggleLogicSolver(): void {
  resumeAudio()
  if (logicPlaying) stopLogic()
  else void runLogicSolver()
}

function pushMoves(moves: Array<Move | null>): number {
  if (!session) return 0
  // 玩家一落子就中断回放，否则推论会和手改互相覆盖
  if (logicPlaying) stopLogic()
  const group = moves.filter((m): m is Move => m !== null)
  if (!group.length) return 0
  for (const mv of group) applyMove(session.state, mv)
  session.undo.push(group)
  session.redo.length = 0
  saveState(session)
  return group.length
}

function setCells(targets: Array<{ index: number; value: CellState }>): number {
  if (!session) return 0
  const n = pushMoves(targets.map((t) => moveFor(t.index, t.value)))
  if (n) refresh()
  return n
}

function toggleCell(index: number, dir: 1 | -1 = 1, forceFx = false): void {
  if (!session) return
  if (isGiven(session.puzzle, index)) return
  const next = cycleCell(cellValue(session.state, index), dir)
  if (setCells([{ index, value: next }])) playCellFx(index, next !== CS.Unknown, forceFx)
}

function undo(): void {
  if (!session) return
  if (logicPlaying) stopLogic()
  const group = session.undo.pop()
  if (!group) return
  for (let i = group.length - 1; i >= 0; i--) applyMove(session.state, invertMove(group[i]!))
  session.redo.push(group)
  saveState(session)
  refresh()
}

function redo(): void {
  if (!session) return
  if (logicPlaying) stopLogic()
  const group = session.redo.pop()
  if (!group) return
  for (const mv of group) applyMove(session.state, mv)
  session.undo.push(group)
  saveState(session)
  refresh()
}

function clearBoard(): void {
  if (!session) return
  stopLogic()
  const targets = []
  for (let i = 0; i < session.puzzle.size * session.puzzle.size; i++) {
    if (isGiven(session.puzzle, i)) continue
    targets.push({ index: i, value: CS.Unknown })
  }
  if (setCells(targets)) setStatus('已清空（给定格保留）。')
}

function showSolution(): void {
  if (!session) return
  stopLogic()
  const sol = session.puzzle.solution
  if (!sol) {
    setStatus('这道题没有参考解。', 'bad')
    return
  }
  const targets = sol.map((value, index) => ({ index, value }))
  if (setCells(targets)) setStatus('已显示参考解（可撤销）。', 'solving')
}

function hint(): void {
  if (!session) return
  stopLogic()
  const sol = session.puzzle.solution
  if (!sol) {
    setStatus('这道题没有参考解，无法提示。', 'bad')
    return
  }
  const unknown: number[] = []
  for (let i = 0; i < sol.length; i++) {
    if (isGiven(session.puzzle, i)) continue
    if (cellValue(session.state, i) === CS.Unknown) unknown.push(i)
  }
  if (!unknown.length) {
    setStatus('已经没有空格了。')
    return
  }
  const pick = unknown[Math.floor(Math.random() * unknown.length)]!
  const value = sol[pick]!
  if (setCells([{ index: pick, value }])) {
    setStatus(value === CS.Black ? '已提示一格：这里是黑。' : '已提示一格：这里是白。', 'solving')
  }
}

function check(): void {
  if (!session) return
  const result = validate(session.state, session.puzzle)
  if (result.solved) {
    setStatus('检查通过：已解出。', 'ok')
    return
  }
  const bits: string[] = ['检查结果：']
  if (result.unknown) bits.push(`还有 ${result.unknown} 格未填`)
  if (result.triples.length) bits.push(`${result.triples.length} 处三连（已标红）`)
  if (result.badRows.length) bits.push(`${result.badRows.length} 行黑白不均`)
  if (result.badCols.length) bits.push(`${result.badCols.length} 列黑白不均`)
  if (result.dupRows.length) bits.push(`${result.dupRows.length} 行与他人重复`)
  if (result.dupCols.length) bits.push(`${result.dupCols.length} 列与他人重复`)
  const bad =
    result.triples.length ||
    result.badRows.length ||
    result.badCols.length ||
    result.dupRows.length ||
    result.dupCols.length
  setStatus(bits.join(' · '), bad ? 'bad' : '')
}

/* ———————————————————— 选题 ———————————————————— */

function selectPuzzle(puzzle: Puzzle): void {
  stopLogic()
  pendingDeleteId = null
  const saved = loadSave(puzzle.id)
  session = {
    puzzle,
    state: applyGivens(puzzle, saved ?? createEmptyState(puzzle)),
    undo: [],
    redo: [],
  }
  refresh()
  resetView()
  setStatus(`已载入「${puzzle.name}」。左键在空格里填黑白。`)
}

function pickRandomPuzzle(): void {
  selectPuzzle(randomPuzzle(session?.puzzle.id, library))
}

/* ———————————————————— 悬停 ———————————————————— */

let hoverCell: number | null = null

function clearHover(): void {
  hoverCell = null
  const svg = currentSvg()
  if (svg && session) updateHover(svg, metricsFor(session.puzzle), null)
}

function updateHoverAt(clientX: number, clientY: number): void {
  if (!session) return
  const svg = currentSvg()
  if (!svg) return
  const vb = clientToViewBox(svg, clientX, clientY)
  if (!vb) return
  const m = metricsFor(session.puzzle)
  const cell = hitTestCell(m, session.puzzle, vb.x, vb.y)
  if (cell === hoverCell) return
  hoverCell = cell
  updateHover(svg, m, cell)
}

/* ———————————————————— 手势 ———————————————————— */

/** 按下后移动超过这个距离才算「拖拽填充」；没超过就还是点击，松手时走轮换 */
const DRAG_THRESHOLD = 8

interface Gesture {
  mode: 'paint' | 'pan'
  /** 按下手势的按键：0 = 左键，2 = 右键（pan 手势用不到） */
  button?: 0 | 2
  paintDir: CellState
  /** 按下时命中的格子：拖拽时从它开始铺，纯点击时对它轮换 */
  startCell: number
  lastCell: number
  startX: number
  startY: number
  /** 是否已越过拖拽阈值 —— true 表示本次是拖拽，不再当作点击 */
  moved: boolean
  pointerId: number
}

let gesture: Gesture | null = null

function panGesture(e: PointerEvent): Gesture {
  return {
    mode: 'pan',
    paintDir: CS.Unknown,
    startCell: -1,
    lastCell: -1,
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
    pointerId: e.pointerId,
  }
}

function boardPointerDown(e: PointerEvent): void {
  resumeAudio()
  if (!session) return
  const svg = currentSvg()
  if (!svg) return
  const m = metricsFor(session.puzzle)

  // 只认左 / 中 / 右三键，鼠标侧键之类直接忽略
  if (e.button !== 0 && e.button !== 1 && e.button !== 2) return

  const vb = clientToViewBox(svg, e.clientX, e.clientY)
  const cell = vb ? hitTestCell(m, session.puzzle, vb.x, vb.y) : null

  // 中键，或按在空白处 → 平移
  if (e.button === 1 || cell === null) {
    e.preventDefault()
    gesture = panGesture(e)
    return
  }

  e.preventDefault()
  // 左右键按下只记手势、先不落子：
  // 拖拽 → 按按键填充（左黑 / 右白）；松手没拖 → 按点击轮换（左正向 / 右反向）
  gesture = {
    mode: 'paint',
    button: e.button === 2 ? 2 : 0,
    paintDir: e.button === 2 ? CS.White : CS.Black,
    startCell: cell,
    lastCell: cell,
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
    pointerId: e.pointerId,
  }
  hoverCell = cell
}

function boardPointerMove(e: PointerEvent): void {
  if (!gesture) {
    updateHoverAt(e.clientX, e.clientY)
    return
  }
  if (e.pointerId !== gesture.pointerId) return

  if (gesture.mode === 'pan') {
    const dx = e.clientX - gesture.startX
    const dy = e.clientY - gesture.startY
    if (!gesture.moved && Math.hypot(dx, dy) < 5) return
    gesture.moved = true
    panBy(dx, dy)
    gesture.startX = e.clientX
    gesture.startY = e.clientY
    return
  }

  // 没越过阈值就先不动：松手时按点击轮换处理
  if (!gesture.moved) {
    if (
      Math.hypot(e.clientX - gesture.startX, e.clientY - gesture.startY) <=
      DRAG_THRESHOLD
    ) {
      return
    }
    gesture.moved = true
    paintGestureCell(gesture.startCell)
  }

  const svg = currentSvg()
  if (!svg || !session) return
  const vb = clientToViewBox(svg, e.clientX, e.clientY)
  if (!vb) return
  const m = metricsFor(session.puzzle)
  const cell = hitTestCell(m, session.puzzle, vb.x, vb.y)
  if (cell === null || cell === gesture.lastCell) return
  gesture.lastCell = cell
  paintGestureCell(cell)
}

/** 拖拽填充：按当前手势的颜色铺一格（给定格锁定，特效节流避免一屏音符） */
function paintGestureCell(cell: number): void {
  if (!gesture || gesture.mode !== 'paint' || !session) return
  if (isGiven(session.puzzle, cell)) return
  if (setCells([{ index: cell, value: gesture.paintDir }])) {
    playCellFx(cell, gesture.paintDir !== CS.Unknown)
  }
}

function boardPointerUp(e: PointerEvent): void {
  if (!gesture || e.pointerId !== gesture.pointerId) return
  const g = gesture
  gesture = null
  // 没拖拽 → 点击轮换：左键正向（空→黑→白→空），右键反向（空→白→黑→空）
  if (g.mode === 'paint' && !g.moved) {
    toggleCell(g.startCell, g.button === 2 ? -1 : 1, true)
  }
}

/** 手势被系统取消（如触摸中断）：直接丢弃，不当成点击 */
function boardPointerCancel(e: PointerEvent): void {
  if (!gesture || e.pointerId !== gesture.pointerId) return
  gesture = null
}

function bindBoard(): void {
  const board = $('#board')
  board.addEventListener('contextmenu', (e) => e.preventDefault())
  board.addEventListener('pointerdown', boardPointerDown)
  board.addEventListener('pointerleave', () => {
    if (!gesture) clearHover()
  })
  board.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const svg = currentSvg()
      if (!svg || !session) return
      const vb = clientToViewBox(svg, e.clientX, e.clientY)
      setZoom(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), vb ?? undefined)
    },
    { passive: false },
  )
  window.addEventListener('pointermove', boardPointerMove)
  window.addEventListener('pointerup', boardPointerUp)
  window.addEventListener('pointercancel', boardPointerCancel)
}

/* ———————————————————— 缩放 / 平移 ———————————————————— */

let zoom = 1
let panX = 0
let panY = 0

function baseVB() {
  if (!session) return { w: 100, h: 100 }
  const m = metricsFor(session.puzzle)
  return { w: m.svgWidth, h: m.svgHeight }
}

function applyViewBox(): void {
  const svg = currentSvg()
  if (!svg) return
  const { w, h } = baseVB()
  svg.setAttribute('viewBox', `${panX} ${panY} ${w / zoom} ${h / zoom}`)
}

function clampPan(): void {
  const { w, h } = baseVB()
  const vw = w / zoom
  const vh = h / zoom
  panX = Math.min(Math.max(panX, Math.min(0, w - vw)), Math.max(0, w - vw))
  panY = Math.min(Math.max(panY, Math.min(0, h - vh)), Math.max(0, h - vh))
}

function setZoom(next: number, anchor?: { x: number; y: number }): void {
  if (!session) return
  const prev = zoom
  zoom = Math.min(Math.max(next, 0.5), 3)
  if (zoom === prev) return
  if (anchor) {
    panX = anchor.x - (anchor.x - panX) * (prev / zoom)
    panY = anchor.y - (anchor.y - panY) * (prev / zoom)
  }
  clampPan()
  applyViewBox()
  updateZoomLabel()
}

function panBy(dxScreen: number, dyScreen: number): void {
  const svg = currentSvg()
  if (!svg) return
  const rect = svg.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  const { w, h } = baseVB()
  panX -= (dxScreen / rect.width) * (w / zoom)
  panY -= (dyScreen / rect.height) * (h / zoom)
  clampPan()
  applyViewBox()
}

function resetView(): void {
  zoom = 1
  panX = 0
  panY = 0
  applyViewBox()
  updateZoomLabel()
}

function updateZoomLabel(): void {
  $('#zoom-label').textContent = `${Math.round(zoom * 100)}%`
}

/* ———————————————————— 逻辑解题（预留） ———————————————————— */

let flashCell: number | null = null

/* ———————————————————— 逻辑解题播放 ———————————————————— */

/** 单步名义时长；同色连拍时按 streak 收敛，避免一长串同样的颜色拖得太久 */
const LOGIC_STEP_MS = 360
const LOGIC_MIN_GAP_MS = 80
/** 回放开始前给状态栏留出上屏时间 */
const LOGIC_LEAD_MS = 280

let logicPlaying = false
/** 每次取消/重开都自增，回放循环靠它判断自己是否还有效 */
let logicToken = 0

function sleep(ms: number, token: number): Promise<boolean> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(token === logicToken), ms)
  })
}

function stopLogic(): void {
  logicToken++
  flashCell = null
  const svg = currentSvg()
  if (svg && session) updateFlash(svg, metricsFor(session.puzzle), null)
  if (logicPlaying) {
    logicPlaying = false
    setBoardBusy(false)
  }
}

/** 回放期间锁住棋盘，免得边播边改把推论搅乱 */
function setBoardBusy(busy: boolean): void {
  $('#board').style.pointerEvents = busy ? 'none' : ''
  $('#btn-logic').textContent = busy ? '停止回放' : '逻辑解题'
}

/**
 * 逻辑解题分两个相位：先一次性推完整个计划，再只读计划逐回落子。
 * 动画不和推理交错，播放中也不会再跑规则。
 */
async function runLogicSolver(): Promise<void> {
  if (!session || logicPlaying) return
  const puzzle = session.puzzle
  const start = session.state.cells.slice()
  const live = session

  logicPlaying = true
  logicToken++
  const token = logicToken
  setBoardBusy(true)
  setStatus('逻辑解题：推理中…', 'solving')
  if (!(await sleep(16, token))) return

  const plan = planLogicSolve(puzzle, start)
  if (token !== logicToken) return

  if (!plan.supported) {
    finishLogicPlayback(token)
    setStatus(`逻辑解题：${plan.reason}`, 'solving')
    return
  }
  if (plan.conflicts.length) {
    finishLogicPlayback(token)
    setStatus(`逻辑解题：盘面自相矛盾——${plan.conflicts[0]}`, 'bad')
    return
  }
  if (!plan.steps.length) {
    finishLogicPlayback(token)
    setStatus(
      plan.complete
        ? '逻辑解题：棋盘已填满，推不出新格子。'
        : '逻辑解题：现有规则推不出新格子，继续手玩吧。',
      'solving',
    )
    return
  }

  const ruleNames = RULES.map((r) => r.name).join(' + ')
  setStatus(`推理完成：${ruleNames} 共 ${plan.steps.length} 步，开始回放…`, 'solving')
  if (!(await sleep(LOGIC_LEAD_MS, token))) return

  await playLogicPlan(live, plan.steps, token)
  if (token !== logicToken) return

  finishLogicPlayback(token)
  const result = validate(live.state, live.puzzle)
  setStatus(
    result.solved
      ? `逻辑解题回放完毕（${plan.steps.length} 步），已解出！`
      : `逻辑解题回放完毕：推出 ${plan.steps.length} 格，还剩 ${result.unknown} 格未定。`,
    result.solved ? 'ok' : 'solving',
  )
}

/** 收尾：只有自己还是当前令牌时才恢复现场，免得被取消后抢别人的状态 */
function finishLogicPlayback(token: number): void {
  if (token !== logicToken) return
  logicPlaying = false
  setBoardBusy(false)
}

/** 相位 2：逐步落子 + 特效 + 音效。整段播放算一个撤销单元，按一次 Z 整段收回 */
async function playLogicPlan(live: Session, steps: LogicStep[], token: number): Promise<void> {
  const group: Move[] = []
  let streak = 0
  let lastValue: CellState | null = null

  for (let i = 0; i < steps.length; i++) {
    if (token !== logicToken) break
    if (session !== live) break

    const step = steps[i]!
    const from = cellValue(live.state, step.index)
    if (from === step.value) continue
    group.push({ index: step.index, from, to: step.value })
    applyMove(live.state, { index: step.index, from, to: step.value })

    // 同色连拍收敛间隔，并让音效逐级抬音高
    streak = step.value === lastValue ? streak + 1 : 1
    lastValue = step.value

    renderBoardOnly()
    playCellFx(step.index, step.value !== CS.Unknown, true)
    setStatus(`回放 [${i + 1}/${steps.length}] ${step.reason}`, 'solving')

    if (i < steps.length - 1) {
      const gap = Math.max(LOGIC_MIN_GAP_MS, Math.round(LOGIC_STEP_MS / Math.sqrt(streak)))
      if (!(await sleep(gap, token))) break
    }
  }

  if (group.length) {
    live.undo.push(group)
    live.redo.length = 0
    saveState(live)
  }
}

/* ———————————————————— 自定义题板 ———————————————————— */

/** 自定义题板边长范围（必须偶数，黑白才能各半） */
const CUSTOM_MIN = 4
const CUSTOM_MAX = 40

let customN = 6
let customGivens: CellState[] = new Array<CellState>(36).fill(CS.Unknown)
/** 键盘光标所在格（0..customN²-1），-1 表示未选 */
let customCursor = -1

function customMsg(text: string, tone: 'ok' | 'bad' | '' = '') {
  const el = $('#custom-msg')
  el.textContent = text
  el.className = 'custom-msg' + (tone ? ` ${tone}` : ''
  )
}

function renderCustomGrid(): void {
  const grid = $('#custom-grid')
  grid.tabIndex = 0
  grid.style.gridTemplateColumns = `repeat(${customN}, 34px)`
  const parts: string[] = []
  for (let i = 0; i < customN * customN; i++) {
    const v = customGivens[i]
    const sel = i === customCursor ? ' selected' : ''
    const cls = v === CS.Black ? 'custom-cell black' : v === CS.White ? 'custom-cell white' : 'custom-cell'
    parts.push(`<button class="${cls}${sel}" type="button" data-i="${i}"></button>`)
  }
  grid.innerHTML = parts.join('')
  grid.querySelectorAll<HTMLButtonElement>('.custom-cell').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.i)
      customCursor = i
      customGivens[i] = cycleCell(customGivens[i] ?? CS.Unknown, 1)
      renderCustomGrid()
    })
  })
}

/** 移动键盘光标并保持它在盘面内；出界时夹住不动 */
function customMoveCursor(dx: number, dy: number): void {
  const n = customN
  if (n <= 0) return
  const from = customCursor < 0 ? 0 : customCursor
  const row = Math.floor(from / n)
  const col = from % n
  const r = Math.min(Math.max(row + dy, 0), n - 1)
  const c = Math.min(Math.max(col + dx, 0), n - 1)
  customCursor = r * n + c
  renderCustomGrid()
  // 大题板下把光标滚进可视区
  const btn = document.querySelector<HTMLButtonElement>(
    `.custom-cell[data-i="${customCursor}"]`,
  )
  btn?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

/** 跳到某一行的行首/行尾 */
function customCursorToEdge(edge: 'home' | 'end'): void {
  const n = customN
  if (n <= 0) return
  const row = Math.floor((customCursor < 0 ? 0 : customCursor) / n)
  customCursor = edge === 'home' ? row * n : row * n + n - 1
  renderCustomGrid()
  const btn = document.querySelector<HTMLButtonElement>(
    `.custom-cell[data-i="${customCursor}"]`,
  )
  btn?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

/** 自定义题板的键盘处理：编辑器开着时才吃这些键，避免和全局快捷键打架 */
function customEditorKeydown(e: KeyboardEvent): boolean {
  if ($('#custom-editor').hidden) return false
  const target = e.target as HTMLElement | null
  // 在边长输入框里打字不拦截
  if (target && target.tagName === 'INPUT') return false

  const k = e.key
  // 1 = 黑，2 = 白（填完自动右移一格）
  if (k === '1' || k === '2') {
    e.preventDefault()
    const value = k === '1' ? CS.Black : CS.White
    if (customCursor < 0) customCursor = 0
    customGivens[customCursor] = value
    renderCustomGrid()
    customMoveCursor(1, 0)
    return true
  }
  // 清空：. / 退格 / Delete / 空格（退格填完左移，其余右移）
  if (k === '.' || k === 'Backspace' || k === 'Delete' || k === ' ') {
    e.preventDefault()
    if (customCursor < 0) customCursor = 0
    customGivens[customCursor] = CS.Unknown
    renderCustomGrid()
    if (k === 'Backspace') customMoveCursor(-1, 0)
    else customMoveCursor(1, 0)
    return true
  }
  if (k === 'ArrowLeft') {
    e.preventDefault()
    customMoveCursor(-1, 0)
    return true
  }
  if (k === 'ArrowRight') {
    e.preventDefault()
    customMoveCursor(1, 0)
    return true
  }
  if (k === 'ArrowUp') {
    e.preventDefault()
    customMoveCursor(0, -1)
    return true
  }
  if (k === 'ArrowDown') {
    e.preventDefault()
    customMoveCursor(0, 1)
    return true
  }
  // Enter / Tab 下一格，Shift 反向
  if (k === 'Enter' || k === 'Tab') {
    e.preventDefault()
    if (e.shiftKey) customMoveCursor(-1, 0)
    else customMoveCursor(1, 0)
    return true
  }
  if (k === 'Home') {
    e.preventDefault()
    customCursorToEdge('home')
    return true
  }
  if (k === 'End') {
    e.preventDefault()
    customCursorToEdge('end')
    return true
  }
  // 编辑器开着时，其余按键一律吞掉：否则 Z/C/R/S 等全局快捷键会在摆题时误触发
  e.preventDefault()
  return true
}

function readCustomSize(): void {
  let n = Number($input('#custom-n').value) || 6
  if (n % 2 !== 0) n += 1
  customN = Math.min(Math.max(n, CUSTOM_MIN), CUSTOM_MAX)
}

function regenCustomGrid(): void {
  readCustomSize()
  customGivens = new Array<CellState>(customN * customN).fill(CS.Unknown)
  customCursor = 0
  renderCustomGrid()
  customMsg(`已生成 ${customN}×${customN} 网格。方向键移动 · 1 填黑 · 2 填白 · . 清空。`)
  $('#custom-grid').focus()
}

function openCustomEditor(): void {
  $('#custom-editor').hidden = false
  readCustomSize()
  customGivens = new Array<CellState>(customN * customN).fill(CS.Unknown)
  customCursor = 0
  renderCustomGrid()
  customMsg('点击格子循环：空 → 黑 → 白 → 空；也可用键盘：方向键移动 · 1 填黑 · 2 填白 · . 清空。')
  $('#custom-grid').focus()
}

function closeCustomEditor(): void {
  $('#custom-editor').hidden = true
  customMsg('')
}

function customPuzzle(): Puzzle {
  return {
    // 同一张题板恒定同一个 id：重复保存是覆盖，刷新后也不会变
    id: customPuzzleId(customGivens),
    name: `自定义 ${customN}×${customN}`,
    size: customN,
    givens: customGivens.slice(),
    difficulty: 'custom',
  }
}

function stampLabel(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 保存到本地题库：写盘、刷新列表，题板保持打开方便接着改 */
function saveCustomPuzzle(): void {
  if (!syncCustomSize()) return
  if (!customGivens.some((g) => g !== CS.Unknown)) {
    customMsg('至少放一个给定格。', 'bad')
    return
  }
  const base = customPuzzle()
  const name = `自定义 ${base.size}×${base.size} · ${stampLabel()}`
  const saved = savePuzzleToLibrary({ ...base, name })
  library = [...puzzles, ...saved]
  renderPuzzleList()
  customMsg(`已保存到题库：「${name}」，刷新页面后仍在。`, 'ok')
  setStatus(`自定义题板已存入题库（现有 ${saved.length} 张自定义题）。`)
}

/** 从本地题库删除一张自定义题板；删的正是当前题时自动切到题库第一题 */
function deleteSavedPuzzle(id: string): void {
  // 进度存档一起清掉：否则重新摆出同一张题板时会捡回旧进度
  try {
    localStorage.removeItem(SAVE_PREFIX + id)
  } catch {
    /* 存不了就存不了，不影响删除本身 */
  }
  const saved = removeSavedPuzzle(id)
  library = [...puzzles, ...saved]
  pendingDeleteId = null
  // 删的是当前题：切到题库第一题，别留一个不在列表里的活跃项
  if (session && session.puzzle.id === id && library[0]) selectPuzzle(library[0])
  else renderPuzzleList()
  setStatus(`已从题库删除该题板（题库还有 ${saved.length} 张自定义题）。`)
}

/** 读边长输入并保证网格和它一致：改了边长却没点「生成网格」时重建网格 */
function syncCustomSize(): boolean {
  readCustomSize()
  if (customGivens.length === customN * customN) return true
  customGivens = new Array<CellState>(customN * customN).fill(CS.Unknown)
  renderCustomGrid()
  customMsg(`边长已改为 ${customN}，网格随之重置，请重新摆给定格。`, 'bad')
  return false
}

function loadCustomPuzzle(): void {
  if (!syncCustomSize()) return
  if (!customGivens.some((g) => g !== CS.Unknown)) {
    customMsg('至少放一个给定格。', 'bad')
    return
  }
  const puzzle = customPuzzle()
  selectPuzzle(puzzle)
  // 题板故意不收起：只有点「关闭」才关，方便载入后接着改
  customMsg(`已载入「${puzzle.name}」。题板保持打开，可继续修改。`, 'ok')
}

function checkCustomUnique(): void {
  if (!syncCustomSize()) return
  const puzzle = customPuzzle()
  const t0 = Date.now()
  const r = countSolutions(puzzle, 2, { maxNodes: 400_000, timeBudgetMs: 8000 })
  if (r.timedOut) {
    customMsg(`校验超时（${Date.now() - t0}ms）：给定格可能太少。`, 'bad')
    return
  }
  if (r.count === 0) customMsg('无解：这组给定格互相矛盾。', 'bad')
  else if (r.count === 1) customMsg(`唯一解 ✓（${Date.now() - t0}ms）`, 'ok')
  else customMsg(`有 ${r.count}+ 个解，不是唯一解。`, 'bad')
}

/* ———————————————————— 落子特效 + 音效 ———————————————————— */

let lastFxAt = 0

/** 落子/排除的特效：弦振（线段）或形变（图形）+ 对应音效 */
function playCellFx(cell: number, positive: boolean, force = false): void {
  // 拖拽连续涂时节流：同一时间只保留一个音/一段动画
  if (!force) {
    const now = typeof performance !== 'undefined' ? performance.now() : 0
    if (now - lastFxAt < 70) return
    lastFxAt = now
  }
  if (!session) return
  const svg = currentSvg()
  if (!svg) return
  const m = metricsFor(session.puzzle)
  const cx = cell % m.size
  const cy = Math.floor(cell / m.size)
  const center = cellCenter(m, cx, cy)
  const el = svg.querySelector<SVGElement>(`[data-cell="${cell}"]`)
  const streak = bumpStreak(positive ? 'pos' : 'neg')
  if (positive) fxPositive({ svg, positiveEl: el, center }, streak)
  else fxNegative({ svg, positiveEl: null, negativeEl: el, center }, streak)
}

function toggleMute(): void {
  const next = !isMuted()
  setMuted(next)
  const btn = document.querySelector<HTMLButtonElement>('#btn-mute')
  if (btn) btn.textContent = next ? '音效：关' : '音效：开'
}


/* ———————————————————— 键盘 ———————————————————— */

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
  // 自定义题板开着时，键盘先归题板用，别让全局快捷键（Z/C/R 等）抢走
  if (customEditorKeydown(e)) return
  const k = e.key.toLowerCase()
  if (k === 'z' && !e.shiftKey) {
    e.preventDefault()
    undo()
  } else if ((k === 'z' && e.shiftKey) || k === 'y') {
    e.preventDefault()
    redo()
  } else if (k === 'c') {
    check()
  } else if (k === 'r') {
    pickRandomPuzzle()
  } else if (k === 'h') {
    hint()
  } else if (k === 's') {
    showSolution()
  } else if (k === 'l') {
    toggleLogicSolver()
  } else if (k === 'm') {
    toggleMute()
  } else if (k === 'escape') {
    clearBoard()
  } else if (k === '0') {
    resetView()
  } else if (k === '+' || k === '=') {
    setZoom(zoom * 1.15)
  } else if (k === '-') {
    setZoom(zoom / 1.15)
  }
})

/* ———————————————————— 绑定按钮 ———————————————————— */

$('#btn-random').addEventListener('click', pickRandomPuzzle)
$('#btn-mute').addEventListener('click', toggleMute)
$('#btn-custom').addEventListener('click', openCustomEditor)
$('#btn-check').addEventListener('click', check)
$('#btn-undo').addEventListener('click', undo)
$('#btn-redo').addEventListener('click', redo)
$('#btn-hint').addEventListener('click', hint)
$('#btn-logic').addEventListener('click', toggleLogicSolver)
$('#btn-solve').addEventListener('click', showSolution)
$('#btn-clear').addEventListener('click', clearBoard)
$('#zoom-in').addEventListener('click', () => setZoom(zoom * 1.15))
$('#zoom-out').addEventListener('click', () => setZoom(zoom / 1.15))
$('#zoom-reset').addEventListener('click', resetView)
$('#custom-regen').addEventListener('click', regenCustomGrid)
$('#custom-apply').addEventListener('click', loadCustomPuzzle)
$('#custom-save').addEventListener('click', saveCustomPuzzle)
$('#custom-unique').addEventListener('click', checkCustomUnique)
$('#custom-close').addEventListener('click', closeCustomEditor)

bindBoard()

/* ———————————————————— 启动 ———————————————————— */

selectPuzzle(puzzles[0]!)
setStatus(`已载入「${puzzles[0]!.name}」。左键在空格里填黑白。`)

;(window as unknown as { __heibai: unknown }).__heibai = {
  get session() {
    return session
  },
  validate: () => (session ? validate(session.state, session.puzzle) : null),
  setCell: (i: number, v: CellState) => setCells([{ index: i, value: v }]),
}
