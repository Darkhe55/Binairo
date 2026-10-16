// src/puzzles-data.ts
var RAW_PUZZLES = [
  { id: "starter-6x6", name: "\u5165\u95E8 \xB7 6\xD76", size: 6, difficulty: "easy", series: "starter", givens: "B.B.WW.B.W...BW.B.B.W.WB...W..W.WB.B", solution: "BWBBWWWBBWBWWBWWBBBWWBWBBWBWBWWBWBWB" },
  { id: "classic-8x8-A", name: "\u7ECF\u5178 \xB7 8\xD78 A", size: 8, difficulty: "medium", series: "classic", givens: ".WW..W.BW.WB.WWB...W..B.B....BWB..WB..B.............B.BBW.B...BW", solution: "BWWBBWWBWBWBBWWBBWBWWBBWBWBWWBWBWBWBBWBWBBWBWBWWWWBWBWBBWBBWWBBW" },
  { id: "classic-8x8-B", name: "\u7ECF\u5178 \xB7 8\xD78 B", size: 8, difficulty: "medium", series: "classic", givens: "W......B....B....W.BWW.BW.BW......W..WW.BB....W.WW.B...BB..B.W..", solution: "WWBWBBWBWBBWBBWWBWWBWWBBWBBWWBBWBWWBBWWBBBWWBBWWWWBBWWBBBBWBWWBW" },
  { id: "challenge-10x10", name: "\u6311\u6218 \xB7 10\xD710", size: 10, difficulty: "hard", series: "challenge", givens: ".....BWW...B.......WB.B.BW..WWWB.B....W.WW...B...........BWW..BBW..B..W...BW..........WB...W.W...BW.", solution: "WBBWWBWWBBBBWBWBWWBWBWBWBWBBWWWBWBBWBWWBWWBBWBWWBBBBWWBBWBWWBWBBWWBBWWWBWWBWBWBBBWWBWBWBBWWWBWBWBBWB" },
  { id: "challenge-12x12", name: "\u6311\u6218 \xB7 12\xD712", size: 12, difficulty: "hard", series: "challenge", givens: "B....WW.W.W.B.W.B..W....WW.W...WBW...W..W....WW......WB............W..B....W....B.W.B..W.W.W....W..B.....W.......B.......B...BWB.B..B...BW...WB.", solution: "BBWBBWWBWBWWBBWBBWBWWBWWWWBWWBBWBWBBWWBBWBWBBWWBBBWWBWBBWBWWWWBBWBWWBWBBWBBWWBWBBWWBBBWWBWBWWBBWWWBBWWBBWWBBBWWBWBWWBBWBWBWWBBWBWBBWBWBWBWBWBWBW" }
];

// src/puzzles.ts
function parseCells(s) {
  return [...s].map((ch) => ch === "." ? 0 : ch === "B" ? 1 : 2);
}
function toPuzzle(r) {
  return {
    id: r.id,
    name: r.name,
    size: r.size,
    difficulty: r.difficulty,
    givens: parseCells(r.givens),
    solution: parseCells(r.solution)
  };
}
var puzzles = RAW_PUZZLES.map(toPuzzle);

// src/state.ts
function idx(size, x, y) {
  return y * size + x;
}
function createEmptyState(puzzle) {
  return {
    puzzleId: puzzle.id,
    size: puzzle.size,
    cells: new Array(puzzle.size * puzzle.size).fill(0 /* Unknown */)
  };
}
function rowOf(state, y) {
  const s = state.size;
  return state.cells.slice(y * s, y * s + s);
}
function colOf(state, x) {
  const s = state.size;
  const out = [];
  for (let y = 0; y < s; y++) out.push(state.cells[y * s + x]);
  return out;
}

// src/solver.ts
var COLORS = [1 /* Black */, 2 /* White */];
var Searcher = class {
  size;
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
    this.size = puzzle.size;
    this.puzzle = puzzle;
    this.cells = new Array(this.size * this.size).fill(0 /* Unknown */);
    this.blackInRow = new Int32Array(this.size);
    this.whiteInRow = new Int32Array(this.size);
    this.blackInCol = new Int32Array(this.size);
    this.whiteInCol = new Int32Array(this.size);
    this.freeInRow = new Int32Array(this.size).fill(this.size);
    this.freeInCol = new Int32Array(this.size).fill(this.size);
    for (let i = 0; i < puzzle.givens.length; i++) {
      const g = puzzle.givens[i];
      if (g === 0 /* Unknown */) continue;
      this.cells[i] = g;
      this.book(i, g, 1);
    }
    this.maxNodes = opts.maxNodes ?? 4e5;
    this.deadline = opts.timeBudgetMs ? Date.now() + opts.timeBudgetMs : 0;
    this.rng = opts.rng;
    for (let y = 0; y < this.size; y++) {
      if (this.freeInRow[y] === 0) this.fullRows.push(rowOf(this.asState(), y));
    }
    for (let x = 0; x < this.size; x++) {
      if (this.freeInCol[x] === 0) this.fullCols.push(colOf(this.asState(), x));
    }
  }
  book(index, value, sign) {
    const x = index % this.size;
    const y = Math.floor(index / this.size);
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
    const x = index % this.size;
    const y = Math.floor(index / this.size);
    const half = this.size / 2;
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
    if (black > half || white > half) return false;
    if (black + this.freeInRow[y] < half) return false;
    const blackC = value === 1 /* Black */ ? this.blackInCol[x] : this.whiteInCol[x];
    const whiteC = value === 2 /* White */ ? this.whiteInCol[x] : this.blackInCol[x];
    if (blackC > half || whiteC > half) return false;
    if (blackC + this.freeInCol[x] < half) return false;
    return true;
  }
  asState() {
    return { puzzleId: this.puzzle.id, size: this.size, cells: this.cells };
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
    const total = this.size * this.size;
    const order = [];
    for (let i = 0; i < total; i++) if (this.cells[i] === 0 /* Unknown */) order.push(i);
    const dfs = (k) => {
      if (k === order.length) return onFound(this.cells.slice());
      this.nodes++;
      if (!this.checkBudget()) return true;
      const i = order[k];
      const x = i % this.size;
      const y = Math.floor(i / this.size);
      const colors = this.rng ? this.rng() < 0.5 ? [1 /* Black */, 2 /* White */] : [2 /* White */, 1 /* Black */] : COLORS;
      for (const v of colors) {
        this.cells[i] = v;
        this.book(i, v, 1);
        const okCounts = (v === 1 /* Black */ ? this.blackInRow[y] : this.whiteInRow[y]) <= this.size / 2 && (v === 1 /* Black */ ? this.blackInCol[x] : this.whiteInCol[x]) <= this.size / 2;
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
  const s = puzzle.size;
  const half = s / 2;
  const triples = [];
  const tripleCells = [];
  const badRows = [];
  const badCols = [];
  const dupRows = [];
  const dupCols = [];
  let filled = 0;
  const rows = [];
  const cols = [];
  for (let y = 0; y < s; y++) {
    const row = rowOf(state, y);
    rows.push(row);
    const t = findTriple(row);
    if (t >= 0) {
      triples.push(`\u7B2C ${y + 1} \u884C`);
      for (let i = t; i < t + 3; i++) tripleCells.push(idx(s, i, y));
    }
    const black = countColor(row, 1 /* Black */);
    const white = countColor(row, 2 /* White */);
    if (black > half || white > half) badRows.push(y);
  }
  for (let x = 0; x < s; x++) {
    const col = colOf(state, x);
    cols.push(col);
    const t = findTriple(col);
    if (t >= 0) {
      triples.push(`\u7B2C ${x + 1} \u5217`);
      for (let i = t; i < t + 3; i++) tripleCells.push(idx(s, x, i));
    }
    const black = countColor(col, 1 /* Black */);
    const white = countColor(col, 2 /* White */);
    if (black > half || white > half) badCols.push(x);
  }
  for (let y = 0; y < s; y++) {
    if (rows[y].some((v) => v === 0 /* Unknown */)) continue;
    for (let y2 = y + 1; y2 < s; y2++) {
      if (rows[y2].some((v) => v === 0 /* Unknown */)) continue;
      if (sameLine2(rows[y], rows[y2])) {
        if (!dupRows.includes(y)) dupRows.push(y);
        if (!dupRows.includes(y2)) dupRows.push(y2);
      }
    }
  }
  for (let x = 0; x < s; x++) {
    if (cols[x].some((v) => v === 0 /* Unknown */)) continue;
    for (let x2 = x + 1; x2 < s; x2++) {
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
  const unknown = s * s - filled;
  const solved = unknown === 0 && triples.length === 0 && badRows.length === 0 && badCols.length === 0 && dupRows.length === 0 && dupCols.length === 0;
  return { triples, tripleCells, badRows, badCols, dupRows, dupCols, filled, unknown, solved };
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
  const total = p.size * p.size;
  console.log(`${p.id}  ${p.size}\xD7${p.size}  ${p.difficulty}`);
  let bad = false;
  bad ||= failIf(p.givens.length !== total, `givens \u957F\u5EA6 ${p.givens.length} \u2260 ${total}`);
  bad ||= failIf(!p.solution || p.solution.length !== total, "solution \u957F\u5EA6\u4E0D\u5BF9");
  bad ||= failIf(p.size % 2 !== 0, `\u5C3A\u5BF8 ${p.size} \u4E0D\u662F\u5076\u6570`);
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
console.log("");
if (fail) {
  console.log(`\u5931\u8D25 ${fail} \u9879`);
  process.exit(1);
}
console.log("\u5168\u90E8\u901A\u8FC7");
