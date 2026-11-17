// src/puzzles-data.ts
var RAW_PUZZLES = [
  { id: "starter-6x6", name: "\u5165\u95E8 \xB7 6\xD76", size: 6, difficulty: "easy", series: "starter", givens: "B.B.WW.B.W...BW.B.B.W.WB...W..W.WB.B", solution: "BWBBWWWBBWBWWBWWBBBWWBWBBWBWBWWBWBWB" },
  { id: "classic-8x8-A", name: "\u7ECF\u5178 \xB7 8\xD78 A", size: 8, difficulty: "medium", series: "classic", givens: ".WW..W.BW.WB.WWB...W..B.B....BWB..WB..B.............B.BBW.B...BW", solution: "BWWBBWWBWBWBBWWBBWBWWBBWBWBWWBWBWBWBBWBWBBWBWBWWWWBWBWBBWBBWWBBW" },
  { id: "classic-8x8-B", name: "\u7ECF\u5178 \xB7 8\xD78 B", size: 8, difficulty: "medium", series: "classic", givens: "W......B....B....W.BWW.BW.BW......W..WW.BB....W.WW.B...BB..B.W..", solution: "WWBWBBWBWBBWBBWWBWWBWWBBWBBWWBBWBWWBBWWBBBWWBBWWWWBBWWBBBBWBWWBW" },
  { id: "challenge-10x10", name: "\u6311\u6218 \xB7 10\xD710", size: 10, difficulty: "hard", series: "challenge", givens: ".....BWW...B.......WB.B.BW..WWWB.B....W.WW...B...........BWW..BBW..B..W...BW..........WB...W.W...BW.", solution: "WBBWWBWWBBBBWBWBWWBWBWBWBWBBWWWBWBBWBWWBWWBBWBWWBBBBWWBBWBWWBWBBWWBBWWWBWWBWBWBBBWWBWBWBBWWWBWBWBBWB" },
  { id: "challenge-12x12", name: "\u6311\u6218 \xB7 12\xD712", size: 12, difficulty: "hard", series: "challenge", givens: "B....WW.W.W.B.W.B..W....WW.W...WBW...W..W....WW......WB............W..B....W....B.W.B..W.W.W....W..B.....W.......B.......B...BWB.B..B...BW...WB.", solution: "BBWBBWWBWBWWBBWBBWBWWBWWWWBWWBBWBWBBWWBBWBWBBWWBBBWWBWBBWBWWWWBBWBWWBWBBWBBWWBWBBWWBBBWWBWBWWBBWWWBBWWBBWWBBBWWBWBWWBBWBWBWWBBWBWBBWBWBWBWBWBWBW" }
];

// src/imported-puzzles.ts
var IMPORTED_PUZZLES = [];

// src/puzzles.ts
function parseCells(s) {
  return [...s].map((ch) => ch === "." ? 0 : ch === "B" ? 1 : 2);
}
function toPuzzle(r) {
  const width = r.width ?? r.size ?? 0;
  const height = r.height ?? r.size ?? 0;
  return {
    id: r.id,
    name: r.name,
    width,
    height,
    difficulty: r.difficulty,
    givens: parseCells(r.givens),
    solution: parseCells(r.solution)
  };
}
var ALL_RAW = [...RAW_PUZZLES, ...IMPORTED_PUZZLES];
var puzzles = ALL_RAW.map(toPuzzle);

// src/state.ts
function idx(width, x, y) {
  return y * width + x;
}
function createEmptyState(puzzle) {
  return {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    cells: new Array(puzzle.width * puzzle.height).fill(0 /* Unknown */)
  };
}
function rowOf(state, y) {
  const w = state.width;
  return state.cells.slice(y * w, y * w + w);
}
function colOf(state, x) {
  const w = state.width;
  const h = state.height;
  const out = [];
  for (let y = 0; y < h; y++) out.push(state.cells[y * w + x]);
  return out;
}

// src/solver.ts
var COLORS = [1 /* Black */, 2 /* White */];
var Searcher = class {
  width;
  height;
  puzzle;
  cells;
  blackInRow;
  whiteInRow;
  blackInCol;
  whiteInCol;
  freeInRow;
  freeInCol;
  /** 已填满的行（用于查重） */
  fullRows = [];
  fullCols = [];
  maxNodes;
  deadline;
  rng;
  nodes = 0;
  timedOut = false;
  constructor(puzzle, opts = {}) {
    this.width = puzzle.width;
    this.height = puzzle.height;
    this.puzzle = puzzle;
    this.cells = new Array(this.width * this.height).fill(0 /* Unknown */);
    this.blackInRow = new Int32Array(this.height);
    this.whiteInRow = new Int32Array(this.height);
    this.blackInCol = new Int32Array(this.width);
    this.whiteInCol = new Int32Array(this.width);
    this.freeInRow = new Int32Array(this.height).fill(this.width);
    this.freeInCol = new Int32Array(this.width).fill(this.height);
    for (let i = 0; i < puzzle.givens.length; i++) {
      const g = puzzle.givens[i];
      if (g === 0 /* Unknown */) continue;
      this.cells[i] = g;
      this.book(i, g, 1);
    }
    this.maxNodes = opts.maxNodes ?? 4e5;
    this.deadline = opts.timeBudgetMs ? Date.now() + opts.timeBudgetMs : 0;
    this.rng = opts.rng;
    for (let y = 0; y < this.height; y++) {
      if (this.freeInRow[y] === 0) this.fullRows.push(rowOf(this.asState(), y));
    }
    for (let x = 0; x < this.width; x++) {
      if (this.freeInCol[x] === 0) this.fullCols.push(colOf(this.asState(), x));
    }
  }
  book(index, value, sign) {
    const x = index % this.width;
    const y = Math.floor(index / this.width);
    this.freeInRow[y] -= sign;
    this.freeInCol[x] -= sign;
    if (value === 1 /* Black */) {
      this.blackInRow[y] += sign;
      this.blackInCol[x] += sign;
    } else {
      this.whiteInRow[y] += sign;
      this.whiteInCol[x] += sign;
    }
  }
  checkBudget() {
    if (this.nodes > this.maxNodes) {
      this.timedOut = true;
      return false;
    }
    if (this.deadline && (this.nodes & 2047) === 0 && Date.now() > this.deadline) {
      this.timedOut = true;
      return false;
    }
    return true;
  }
  /** 落子后是否仍自洽 */
  okAfter(index, value) {
    const x = index % this.width;
    const y = Math.floor(index / this.width);
    const halfRow = this.width / 2;
    const halfCol = this.height / 2;
    const row = rowOf(this.asState(), y);
    const col = colOf(this.asState(), x);
    const checkLine = (line, at) => {
      for (let i = Math.max(0, at - 2); i <= Math.min(line.length - 3, at); i++) {
        const v = line[i];
        if (v === 0 /* Unknown */) continue;
        if (v === line[i + 1] && v === line[i + 2]) return false;
      }
      return true;
    };
    if (!checkLine(row, x)) return false;
    if (!checkLine(col, y)) return false;
    const black = value === 1 /* Black */ ? this.blackInRow[y] : this.whiteInRow[y];
    const white = value === 2 /* White */ ? this.whiteInRow[y] : this.blackInRow[y];
    if (black > halfRow || white > halfRow) return false;
    if (black + this.freeInRow[y] < halfRow) return false;
    const blackC = value === 1 /* Black */ ? this.blackInCol[x] : this.whiteInCol[x];
    const whiteC = value === 2 /* White */ ? this.whiteInCol[x] : this.blackInCol[x];
    if (blackC > halfCol || whiteC > halfCol) return false;
    if (blackC + this.freeInCol[x] < halfCol) return false;
    return true;
  }
  asState() {
    return {
      puzzleId: this.puzzle.id,
      width: this.width,
      height: this.height,
      cells: this.cells
    };
  }
  /** 行/列刚被填满时，查是否与已登记的行/列重复 */
  duplicateCheck(x, y) {
    if (this.freeInRow[y] === 0) {
      const row = rowOf(this.asState(), y);
      if (this.fullRows.some((other) => sameLine(other, row))) return false;
    }
    if (this.freeInCol[x] === 0) {
      const col = colOf(this.asState(), x);
      if (this.fullCols.some((other) => sameLine(other, col))) return false;
    }
    return true;
  }
  search(onFound) {
    const total = this.width * this.height;
    const order = [];
    for (let i = 0; i < total; i++) if (this.cells[i] === 0 /* Unknown */) order.push(i);
    const dfs = (k) => {
      if (k === order.length) return onFound(this.cells.slice());
      this.nodes++;
      if (!this.checkBudget()) return true;
      const i = order[k];
      const x = i % this.width;
      const y = Math.floor(i / this.width);
      const colors = this.rng ? this.rng() < 0.5 ? [1 /* Black */, 2 /* White */] : [2 /* White */, 1 /* Black */] : COLORS;
      for (const v of colors) {
        this.cells[i] = v;
        this.book(i, v, 1);
        const halfRow = this.width / 2;
        const halfCol = this.height / 2;
        const okCounts = (v === 1 /* Black */ ? this.blackInRow[y] : this.whiteInRow[y]) <= halfRow && (v === 1 /* Black */ ? this.blackInCol[x] : this.whiteInCol[x]) <= halfCol;
        const rowJustFilled = this.freeInRow[y] === 0;
        const colJustFilled = this.freeInCol[x] === 0;
        const dupOk = okCounts && this.duplicateCheck(x, y);
        if (dupOk) {
          if (rowJustFilled) this.fullRows.push(rowOf(this.asState(), y));
          if (colJustFilled) this.fullCols.push(colOf(this.asState(), x));
          if (this.okAfter(i, v) && dfs(k + 1)) return true;
          if (colJustFilled) this.fullCols.pop();
          if (rowJustFilled) this.fullRows.pop();
        }
        this.book(i, v, -1);
        this.cells[i] = 0 /* Unknown */;
      }
      return false;
    };
    return dfs(0);
  }
  toState(puzzle, cells) {
    const st = createEmptyState(puzzle);
    for (let i = 0; i < cells.length; i++) st.cells[i] = cells[i];
    return st;
  }
};
function sameLine(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0 /* Unknown */ || b[i] === 0 /* Unknown */) return false;
    if (a[i] !== b[i]) return false;
  }
  return true;
}
function countSolutions(puzzle, limit = 2, opts = {}) {
  const s = new Searcher(puzzle, opts);
  let count = 0;
  let first = null;
  let second = null;
  s.search((cells) => {
    count++;
    if (!first) first = s.toState(puzzle, cells);
    else if (!second) second = s.toState(puzzle, cells);
    return count >= limit;
  });
  return { count, capped: count >= limit, nodes: s.nodes, timedOut: s.timedOut, first, second };
}

// src/validate.ts
function findTriple(line) {
  for (let i = 0; i + 2 < line.length; i++) {
    const a = line[i];
    if (a === 0 /* Unknown */) continue;
    if (a === line[i + 1] && a === line[i + 2]) return i;
  }
  return -1;
}
function countColor(line, color) {
  let n = 0;
  for (const v of line) if (v === color) n++;
  return n;
}
function sameLine2(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0 /* Unknown */ || b[i] === 0 /* Unknown */) return false;
    if (a[i] !== b[i]) return false;
  }
  return true;
}
function validate(state, puzzle) {
  const w = puzzle.width;
  const h = puzzle.height;
  const halfRow = w / 2;
  const halfCol = h / 2;
  const triples = [];
  const tripleCells = [];
  const badRows = [];
  const badCols = [];
  const dupRows = [];
  const dupCols = [];
  let filled = 0;
  const rows = [];
  const cols = [];
  for (let y = 0; y < h; y++) {
    const row = rowOf(state, y);
    rows.push(row);
    const t = findTriple(row);
    if (t >= 0) {
      triples.push(`\u7B2C ${y + 1} \u884C`);
      for (let i = t; i < t + 3; i++) tripleCells.push(idx(w, i, y));
    }
    const black = countColor(row, 1 /* Black */);
    const white = countColor(row, 2 /* White */);
    if (black > halfRow || white > halfRow) badRows.push(y);
  }
  for (let x = 0; x < w; x++) {
    const col = colOf(state, x);
    cols.push(col);
    const t = findTriple(col);
    if (t >= 0) {
      triples.push(`\u7B2C ${x + 1} \u5217`);
      for (let i = t; i < t + 3; i++) tripleCells.push(idx(w, x, i));
    }
    const black = countColor(col, 1 /* Black */);
    const white = countColor(col, 2 /* White */);
    if (black > halfCol || white > halfCol) badCols.push(x);
  }
  for (let y = 0; y < h; y++) {
    if (rows[y].some((v) => v === 0 /* Unknown */)) continue;
    for (let y2 = y + 1; y2 < h; y2++) {
      if (rows[y2].some((v) => v === 0 /* Unknown */)) continue;
      if (sameLine2(rows[y], rows[y2])) {
        if (!dupRows.includes(y)) dupRows.push(y);
        if (!dupRows.includes(y2)) dupRows.push(y2);
      }
    }
  }
  for (let x = 0; x < w; x++) {
    if (cols[x].some((v) => v === 0 /* Unknown */)) continue;
    for (let x2 = x + 1; x2 < w; x2++) {
      if (cols[x2].some((v) => v === 0 /* Unknown */)) continue;
      if (sameLine2(cols[x], cols[x2])) {
        if (!dupCols.includes(x)) dupCols.push(x);
        if (!dupCols.includes(x2)) dupCols.push(x2);
      }
    }
  }
  for (let i = 0; i < state.cells.length; i++) {
    if (state.cells[i] !== 0 /* Unknown */) filled++;
  }
  const unknown = w * h - filled;
  const solved = unknown === 0 && triples.length === 0 && badRows.length === 0 && badCols.length === 0 && dupRows.length === 0 && dupCols.length === 0;
  return { triples, tripleCells, badRows, badCols, dupRows, dupCols, filled, unknown, solved };
}

// src/logic.ts
var MAX_ROUNDS = 512;
function colorName(v) {
  return v === 1 /* Black */ ? "\u9ED1" : v === 2 /* White */ ? "\u767D" : "\u7A7A";
}
function otherColor(v) {
  return v === 1 /* Black */ ? 2 /* White */ : 1 /* Black */;
}
function deduce(ctx, steps, index, value, reason) {
  const cur = ctx.cells[index] ?? 0 /* Unknown */;
  if (cur === value) return;
  if (cur !== 0 /* Unknown */) {
    ctx.conflicts.push(`\u7B2C ${index + 1} \u683C\u63A8\u5F97${colorName(value)}\uFF0C\u4F46\u76D8\u9762\u4E0A\u5DF2\u662F${colorName(cur)}`);
    return;
  }
  ctx.cells[index] = value;
  steps.push({ index, value, reason });
}
function lineOf(puzzle, kind, k) {
  const w = puzzle.width;
  const out = [];
  const len = kind === "row" ? puzzle.width : puzzle.height;
  for (let i = 0; i < len; i++) out.push(kind === "row" ? k * w + i : i * w + k);
  return out;
}
function lineLabel(kind, k) {
  return `\u7B2C ${k + 1} ${kind === "row" ? "\u884C" : "\u5217"}`;
}
function allLines(puzzle) {
  const out = [];
  for (let k = 0; k < puzzle.height; k++) {
    out.push({ kind: "row", k, cells: lineOf(puzzle, "row", k) });
  }
  for (let k = 0; k < puzzle.width; k++) {
    out.push({ kind: "col", k, cells: lineOf(puzzle, "col", k) });
  }
  return out;
}
function lineShapes(ctx) {
  return allLines(ctx.puzzle).map((line) => {
    const vals = line.cells.map((i) => ctx.cells[i] ?? 0 /* Unknown */);
    const unknown = [];
    vals.forEach((v, i) => {
      if (v === 0 /* Unknown */) unknown.push(i);
    });
    return { line, vals, unknown };
  });
}
function combinationCount(n, k, cap = 1e6) {
  if (k < 0 || k > n) return 0;
  const kk = Math.min(k, n - k);
  let c = 1;
  for (let i = 0; i < kk; i++) {
    c = c * (n - i) / (i + 1);
    if (c > cap) return cap + 1;
  }
  return Math.round(c);
}
function forEachCombination(n, k, visit) {
  if (k < 0 || k > n) return;
  if (k === 0) {
    visit([]);
    return;
  }
  const pick = [];
  for (let i = 0; i < k; i++) pick.push(i);
  for (; ; ) {
    if (!visit(pick)) return;
    let i = k - 1;
    while (i >= 0 && pick[i] === n - k + i) i--;
    if (i < 0) return;
    pick[i]++;
    for (let j = i + 1; j < k; j++) pick[j] = pick[j - 1] + 1;
  }
}
var pairEndsRule = {
  id: "pair-ends",
  name: "\u540C\u8272\u4E24\u7AEF / \u5939\u5FC3\u586B\u5F02\u8272",
  fn: (ctx) => {
    const steps = [];
    for (const line of allLines(ctx.puzzle)) {
      const cells = line.cells;
      const n = cells.length;
      const at = (i) => ctx.cells[cells[i]] ?? 0 /* Unknown */;
      const label = lineLabel(line.kind, line.k);
      const p = (i) => i + 1;
      for (let i = 0; i + 1 < n; i++) {
        const a = at(i);
        if (a === 0 /* Unknown */ || a !== at(i + 1)) continue;
        const need = otherColor(a);
        if (i - 1 >= 0) {
          deduce(
            ctx,
            steps,
            cells[i - 1],
            need,
            `${label}\u7B2C ${p(i)}\u3001${p(i + 1)} \u683C\u8FDE\u7EED\u4E24\u4E2A${colorName(a)}\uFF0C\u7B2C ${p(i - 1)} \u683C\u53EA\u80FD\u662F${colorName(need)}`
          );
        }
        if (i + 2 < n) {
          deduce(
            ctx,
            steps,
            cells[i + 2],
            need,
            `${label}\u7B2C ${p(i)}\u3001${p(i + 1)} \u683C\u8FDE\u7EED\u4E24\u4E2A${colorName(a)}\uFF0C\u7B2C ${p(i + 2)} \u683C\u53EA\u80FD\u662F${colorName(need)}`
          );
        }
      }
      for (let i = 0; i + 2 < n; i++) {
        const a = at(i);
        if (a === 0 /* Unknown */ || a !== at(i + 2)) continue;
        const need = otherColor(a);
        deduce(
          ctx,
          steps,
          cells[i + 1],
          need,
          `${label}\u7B2C ${p(i)}\u3001${p(i + 2)} \u683C\u4E2D\u95F4\u9694\u7740\u4E00\u4E2A${colorName(a)}\uFF0C\u7B2C ${p(i + 1)} \u683C\u53EA\u80FD\u662F${colorName(need)}`
        );
      }
    }
    return steps;
  }
};
var halfLockRule = {
  id: "half-lock",
  name: "\u534A\u6570\u540E\u5269\u4F59\u586B\u5F02\u8272",
  fn: (ctx) => {
    const steps = [];
    for (const line of allLines(ctx.puzzle)) {
      let black = 0;
      let white = 0;
      const unknown = [];
      for (const idx2 of line.cells) {
        const v = ctx.cells[idx2] ?? 0 /* Unknown */;
        if (v === 1 /* Black */) black++;
        else if (v === 2 /* White */) white++;
        else unknown.push(idx2);
      }
      if (!unknown.length) continue;
      const label = lineLabel(line.kind, line.k);
      const half = line.cells.length / 2;
      if (black === half) {
        for (const idx2 of unknown) {
          deduce(
            ctx,
            steps,
            idx2,
            2 /* White */,
            `${label}\u9ED1\u5B50\u5DF2\u8FBE\u534A\u6570 ${half} \u4E2A\uFF0C\u5269\u4F59 ${unknown.length} \u683C\u53EA\u80FD\u662F\u767D`
          );
        }
      } else if (white === half) {
        for (const idx2 of unknown) {
          deduce(
            ctx,
            steps,
            idx2,
            1 /* Black */,
            `${label}\u767D\u5B50\u5DF2\u8FBE\u534A\u6570 ${half} \u4E2A\uFF0C\u5269\u4F59 ${unknown.length} \u683C\u53EA\u80FD\u662F\u9ED1`
          );
        }
      }
    }
    return steps;
  }
};
var pairUrgencyRule = {
  id: "pair-urgency",
  name: "\u6210\u5BF9\u7A7A\u683C\u7EA6\u675F",
  fn: (ctx) => {
    const steps = [];
    const colors = [1 /* Black */, 2 /* White */];
    for (const line of allLines(ctx.puzzle)) {
      const cells = line.cells;
      const n = cells.length;
      if (n % 2 !== 0) continue;
      const half = n / 2;
      const at = (i) => ctx.cells[cells[i]] ?? 0 /* Unknown */;
      let black = 0;
      let white = 0;
      const unknown = [];
      for (let i = 0; i < n; i++) {
        const v = at(i);
        if (v === 1 /* Black */) black++;
        else if (v === 2 /* White */) white++;
        else unknown.push(i);
      }
      if (!unknown.length) continue;
      for (const x of colors) {
        const y = otherColor(x);
        const needY = half - (x === 1 /* Black */ ? white : black);
        if (needY <= 0) continue;
        const dominoes = [];
        for (let i = 0; i + 1 < n; i++) {
          if (at(i) !== 0 /* Unknown */ || at(i + 1) !== 0 /* Unknown */) continue;
          const touchesX = i - 1 >= 0 && at(i - 1) === x || i + 2 < n && at(i + 2) === x;
          if (touchesX) dominoes.push([i, i + 1]);
        }
        if (dominoes.length < needY) continue;
        const picked = [];
        let lastEnd = -1;
        for (const d of [...dominoes].sort((a, b) => a[1] - b[1])) {
          if (d[0] > lastEnd) {
            picked.push(d);
            lastEnd = d[1];
          }
        }
        if (picked.length !== needY) continue;
        const covered = /* @__PURE__ */ new Set();
        for (const [a, b] of picked) {
          covered.add(a);
          covered.add(b);
        }
        for (const i of unknown) {
          if (covered.has(i)) continue;
          deduce(
            ctx,
            steps,
            cells[i],
            x,
            `${lineLabel(line.kind, line.k)}\u8FD8\u9700 ${needY} \u9897${colorName(y)}\uFF0C${picked.length} \u5904\u4E92\u4E0D\u91CD\u53E0\u7684\u6210\u5BF9\u7A7A\u683C\u5DF2\u5404\u9700\u4E00\u9897\uFF0C\u8986\u76D6\u5916\u7684\u672A\u5B9A\u683C\u53EA\u80FD\u662F${colorName(x)}`
          );
        }
      }
    }
    return steps;
  }
};
var twinLineRule = {
  id: "twin-line",
  name: "\u53CC\u7A7A\u683C\u67E5\u91CD",
  fn: (ctx) => {
    const steps = [];
    const shapes = lineShapes(ctx);
    for (const s of shapes) {
      if (s.unknown.length !== 2) continue;
      const n = s.vals.length;
      if (n % 2 !== 0) continue;
      const half = n / 2;
      let black = 0;
      let white = 0;
      for (const v of s.vals) {
        if (v === 1 /* Black */) black++;
        else if (v === 2 /* White */) white++;
      }
      if (half - black !== 1 || half - white !== 1) continue;
      const p = s.unknown[0];
      const q = s.unknown[1];
      const label = lineLabel(s.line.kind, s.line.k);
      for (const t of shapes) {
        if (t.line.kind !== s.line.kind || t.unknown.length !== 0) continue;
        let twin = true;
        for (let i = 0; i < n; i++) {
          if (i === p || i === q) continue;
          if (t.vals[i] !== s.vals[i]) {
            twin = false;
            break;
          }
        }
        if (!twin) continue;
        const a = t.vals[p];
        const b = t.vals[q];
        if (a === b) continue;
        const reason = `${label}\u7B2C ${p + 1}\u3001${q + 1} \u683C\u672A\u5B9A\uFF08\u4E00\u9ED1\u4E00\u767D\uFF09\uFF0C\u82E5\u586B${colorName(
          a
        )}${colorName(b)} \u5C31\u4F1A\u548C\u5DF2\u5B8C\u6210\u7684\u7B2C ${t.line.k + 1} ${s.line.kind === "row" ? "\u884C" : "\u5217"}\u5B8C\u5168\u76F8\u540C\uFF0C\u53EA\u80FD\u53CD\u8FC7\u6765\u586B`;
        deduce(ctx, steps, s.line.cells[p], otherColor(a), reason);
        deduce(ctx, steps, s.line.cells[q], otherColor(b), reason);
      }
    }
    return steps;
  }
};
var MAX_DUP_COMBOS = 4096;
var dupForceRule = {
  id: "dup-force",
  name: "\u67E5\u91CD\u903C\u6B65",
  fn: (ctx) => {
    const steps = [];
    const shapes = lineShapes(ctx);
    for (const s of shapes) {
      const k = s.unknown.length;
      const n = s.vals.length;
      if (!k || n % 2 !== 0) continue;
      const half = n / 2;
      let black = 0;
      let white = 0;
      for (const v of s.vals) {
        if (v === 1 /* Black */) black++;
        else if (v === 2 /* White */) white++;
      }
      const needB = half - black;
      const needW = half - white;
      if (needB < 0 || needW < 0 || needB + needW !== k) continue;
      if (combinationCount(k, needB) > MAX_DUP_COMBOS) continue;
      const targets = /* @__PURE__ */ new Set();
      for (const t of shapes) {
        if (t.line.kind !== s.line.kind || t.unknown.length) continue;
        let match = true;
        for (let i = 0; i < n; i++) {
          if (s.vals[i] !== 0 /* Unknown */ && s.vals[i] !== t.vals[i]) {
            match = false;
            break;
          }
        }
        if (!match) continue;
        let mask = 0;
        for (let j = 0; j < k; j++) {
          if (t.vals[s.unknown[j]] === 1 /* Black */) mask |= 1 << j;
        }
        targets.add(mask);
      }
      if (!targets.size) continue;
      const canBlack = new Array(k).fill(false);
      const canWhite = new Array(k).fill(false);
      let settled = 0;
      let survivors = 0;
      forEachCombination(k, needB, (pick) => {
        let mask = 0;
        for (const j of pick) mask |= 1 << j;
        if (targets.has(mask)) return true;
        survivors++;
        for (let j = 0; j < k; j++) {
          const isBlack = (mask & 1 << j) !== 0;
          if (isBlack) {
            if (!canBlack[j]) {
              canBlack[j] = true;
              if (canWhite[j]) settled++;
            }
          } else if (!canWhite[j]) {
            canWhite[j] = true;
            if (canBlack[j]) settled++;
          }
        }
        return settled < k;
      });
      const label = lineLabel(s.line.kind, s.line.k);
      const kindName = s.line.kind === "row" ? "\u884C" : "\u5217";
      if (!survivors) {
        const reason = `${label}\u65E0\u8BBA\u600E\u4E48\u8865\u90FD\u4F1A\u4E0E\u5DF2\u5B8C\u6210\u7684\u540C${kindName}\u91CD\u590D`;
        if (!ctx.conflicts.includes(reason)) ctx.conflicts.push(reason);
        continue;
      }
      for (let j = 0; j < k; j++) {
        const at = s.unknown[j];
        const index = s.line.cells[at];
        const tail = `${label}\u9700\u8865 ${needB} \u9ED1 ${needW} \u767D\uFF0C\u5254\u9664\u4F1A\u4E0E\u5DF2\u5B8C\u6210${kindName}\u91CD\u590D\u7684\u8865\u6CD5\u540E`;
        if (canBlack[j] && !canWhite[j]) {
          deduce(ctx, steps, index, 1 /* Black */, `${tail}\uFF0C\u7B2C ${at + 1} \u683C\u53EA\u80FD\u586B\u9ED1`);
        } else if (canWhite[j] && !canBlack[j]) {
          deduce(ctx, steps, index, 2 /* White */, `${tail}\uFF0C\u7B2C ${at + 1} \u683C\u53EA\u80FD\u586B\u767D`);
        }
      }
    }
    return steps;
  }
};
var HYPOTHESIS_BUDGET_MS = 900;
var HYPOTHESIS_SEARCH = { maxNodes: 2e4, timeBudgetMs: 40 };
var HYPOTHESIS_TRIES = 8;
function propagate(puzzle, cells) {
  const ctx = { puzzle, cells: cells.slice(), conflicts: [] };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let progressed = false;
    for (const rule of RULES) {
      if (rule.whenStalled) continue;
      if (rule.fn(ctx).length) progressed = true;
    }
    if (!progressed || ctx.conflicts.length) break;
  }
  return ctx;
}
function isContradiction(puzzle, cells) {
  const v = validate({ puzzleId: puzzle.id, width: puzzle.width, height: puzzle.height, cells }, puzzle);
  return v.triples.length > 0 || v.badRows.length > 0 || v.badCols.length > 0 || v.dupRows.length > 0 || v.dupCols.length > 0;
}
function refutedBy(puzzle, cells, index, value) {
  const trial = cells.slice();
  trial[index] = value;
  const sub = propagate(puzzle, trial);
  if (sub.conflicts.length || isContradiction(puzzle, sub.cells)) return true;
  const r = countSolutions({ ...puzzle, givens: sub.cells }, 1, HYPOTHESIS_SEARCH);
  return !r.timedOut && r.count === 0;
}
var hypothesisRule = {
  id: "hypothesis",
  name: "\u5047\u8BBE\u63A8\u6F14\u53CD\u8BC1",
  whenStalled: true,
  fn: (ctx) => {
    const steps = [];
    const deadline = ctx.deadline ?? Infinity;
    if (Date.now() > deadline) return steps;
    const w = ctx.puzzle.width;
    const h = ctx.puzzle.height;
    const total = w * h;
    if (ctx.cells.length !== total) return steps;
    const rowBlank = new Array(h).fill(0);
    const colBlank = new Array(w).fill(0);
    const blanks = [];
    for (let i = 0; i < total; i++) {
      if (ctx.cells[i] !== 0 /* Unknown */) continue;
      blanks.push(i);
      rowBlank[Math.floor(i / w)]++;
      colBlank[i % w]++;
    }
    if (!blanks.length) return steps;
    blanks.sort((a, b) => {
      const sa = rowBlank[Math.floor(a / w)] + colBlank[a % w];
      const sb = rowBlank[Math.floor(b / w)] + colBlank[b % w];
      return sa - sb;
    });
    let tries = 0;
    for (const index of blanks) {
      if (tries >= HYPOTHESIS_TRIES || Date.now() > deadline) break;
      tries++;
      if (refutedBy(ctx.puzzle, ctx.cells, index, 1 /* Black */)) {
        deduce(ctx, steps, index, 2 /* White */, `\u5047\u8BBE\u7B2C ${index + 1} \u683C\u4E3A\u9ED1\u4F1A\u63A8\u51FA\u77DB\u76FE\uFF0C\u6545\u53EA\u80FD\u662F\u767D`);
        break;
      }
      if (refutedBy(ctx.puzzle, ctx.cells, index, 2 /* White */)) {
        deduce(ctx, steps, index, 1 /* Black */, `\u5047\u8BBE\u7B2C ${index + 1} \u683C\u4E3A\u767D\u4F1A\u63A8\u51FA\u77DB\u76FE\uFF0C\u6545\u53EA\u80FD\u662F\u9ED1`);
        break;
      }
    }
    return steps;
  }
};
var RULES = [
  pairEndsRule,
  halfLockRule,
  pairUrgencyRule,
  twinLineRule,
  dupForceRule,
  hypothesisRule
];
function planLogicSolve(puzzle, start) {
  const t0 = Date.now();
  const total = puzzle.width * puzzle.height;
  const base = (start ?? puzzle.givens).slice();
  if (base.length !== total) {
    return {
      supported: false,
      reason: "\u76D8\u9762\u6570\u636E\u957F\u5EA6\u4E0E\u9898\u76EE\u5C3A\u5BF8\u4E0D\u7B26\uFF0C\u65E0\u6CD5\u903B\u8F91\u89E3\u9898\u3002",
      steps: [],
      complete: false,
      ms: 0,
      cells: [],
      conflicts: []
    };
  }
  for (let i = 0; i < puzzle.givens.length; i++) {
    const g = puzzle.givens[i];
    if (g !== 0 /* Unknown */) base[i] = g;
  }
  const ctx = {
    puzzle,
    cells: base,
    conflicts: [],
    deadline: Date.now() + HYPOTHESIS_BUDGET_MS
  };
  const steps = [];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let progressed = false;
    for (const rule of RULES) {
      if (rule.whenStalled) continue;
      for (const s of rule.fn(ctx)) {
        steps.push(s);
        progressed = true;
      }
    }
    if (progressed) continue;
    let advanced = false;
    for (const rule of RULES) {
      if (!rule.whenStalled) continue;
      for (const s of rule.fn(ctx)) {
        steps.push(s);
        advanced = true;
      }
    }
    if (!advanced) break;
  }
  return {
    supported: true,
    reason: "",
    steps,
    complete: ctx.cells.every((c) => c !== 0 /* Unknown */),
    ms: Date.now() - t0,
    cells: ctx.cells,
    conflicts: ctx.conflicts
  };
}

// scripts/check.mts
var fail = 0;
var failIf = (cond, msg) => {
  if (cond) {
    console.log(`  \u2717 ${msg}`);
    fail++;
    return true;
  }
  return false;
};
console.log(`\u5171 ${puzzles.length} \u9053\u9898
`);
for (const p of puzzles) {
  const total = p.width * p.height;
  console.log(`${p.id}  ${p.width}\xD7${p.height}  ${p.difficulty}`);
  let bad = false;
  bad ||= failIf(p.givens.length !== total, `givens \u957F\u5EA6 ${p.givens.length} \u2260 ${total}`);
  bad ||= failIf(!p.solution || p.solution.length !== total, "solution \u957F\u5EA6\u4E0D\u5BF9");
  bad ||= failIf(p.width % 2 !== 0 || p.height % 2 !== 0, `\u5C3A\u5BF8 ${p.width}\xD7${p.height} \u4E0D\u662F\u5076\u6570`);
  if (bad) continue;
  for (let i = 0; i < total; i++) {
    if (p.givens[i] !== 0 /* Unknown */ && p.givens[i] !== p.solution[i]) {
      failIf(true, `\u683C\u5B50 ${i} \u9898\u9762\u4E0E\u53C2\u8003\u89E3\u51B2\u7A81`);
      bad = true;
      break;
    }
  }
  if (bad) continue;
  const st = createEmptyState(p);
  st.cells = p.solution.slice();
  const v = validate(st, p);
  bad ||= failIf(
    !v.solved,
    `\u53C2\u8003\u89E3\u4E0D\u5408\u6CD5\uFF1A\u4E09\u8FDE=${v.triples.length} \u884C=${v.badRows.length} \u5217=${v.badCols.length} \u91CD\u590D\u884C=${v.dupRows.length} \u91CD\u590D\u5217=${v.dupCols.length}`
  );
  const r = countSolutions(p, 2, { maxNodes: 2e6, timeBudgetMs: 3e4 });
  bad ||= failIf(r.timedOut, "\u552F\u4E00\u89E3\u6821\u9A8C\u8D85\u65F6");
  bad ||= failIf(r.count !== 1, `\u89E3\u6570 = ${r.count}\uFF08\u5E94\u4E3A 1\uFF09`);
  const givenCount = p.givens.filter((g) => g !== 0 /* Unknown */).length;
  console.log(`  \u2713 \u53C2\u8003\u89E3\u5408\u6CD5 \xB7 \u552F\u4E00\u89E3 \xB7 \u7ED9\u5B9A ${givenCount}/${total} (${(givenCount / total * 100).toFixed(0)}%)`);
}
var colorName2 = (v) => v === 1 /* Black */ ? "\u9ED1" : v === 2 /* White */ ? "\u767D" : "\u7A7A";
console.log(`\u903B\u8F91\u89E3\u8C1C\u5668\u89C4\u5219\uFF1A${RULES.map((r) => `${r.id}\uFF08${r.name}\uFF09`).join(" + ")}`);
var solvedByLogic = 0;
for (const p of puzzles) {
  if (!p.solution) continue;
  const plan = planLogicSolve(p, p.givens);
  let bad = false;
  if (plan.conflicts.length) {
    failIf(true, `${p.id} \u903B\u8F91\u63A8\u8BBA\u51FA\u73B0\u77DB\u76FE\uFF1A${plan.conflicts[0]}`);
    bad = true;
  }
  for (const s of plan.steps) {
    if (s.value !== p.solution[s.index]) {
      failIf(
        true,
        `${p.id} \u683C\u5B50 ${s.index} \u63A8\u8BBA\u4E3A${colorName2(s.value)}\uFF0C\u4F46\u53C2\u8003\u89E3\u662F${colorName2(p.solution[s.index])}\uFF08${s.reason}\uFF09`
      );
      bad = true;
      break;
    }
  }
  if (bad) continue;
  if (plan.complete) solvedByLogic++;
  console.log(
    `  \u2713 ${p.id} \u4EC5\u51ED\u9898\u9762\u63A8\u51FA ${plan.steps.length}/${p.width * p.height} \u683C${plan.complete ? "\uFF08\u5DF2\u5168\u90E8\u89E3\u51FA\uFF09" : ""}`
  );
}
console.log(
  `\u903B\u8F91\u89E3\u9898\uFF1A${solvedByLogic}/${puzzles.length} \u9053\u9898\u80FD\u88AB\u73B0\u6709\u89C4\u5219\u5B8C\u6574\u89E3\u51FA\uFF0C\u5176\u4F59\u9700\u8981\u66F4\u9AD8\u7EA7\u7684\u89C4\u5219
`
);
console.log("");
if (fail) {
  console.log(`\u5931\u8D25 ${fail} \u9879`);
  process.exit(1);
}
console.log("\u5168\u90E8\u901A\u8FC7");
