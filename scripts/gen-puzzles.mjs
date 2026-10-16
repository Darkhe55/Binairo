// src/state.ts
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

// scripts/gen-puzzles.mts
import { writeFileSync } from "node:fs";
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 1831565813;
    let r = Math.imul(t ^ t >>> 15, 1 | t);
    r ^= r + Math.imul(r ^ r >>> 7, 61 | r);
    return ((r ^ r >>> 14) >>> 0) / 4294967296;
  };
}
function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}
var emptyPuzzle = (size, givens) => ({
  id: "gen",
  name: "gen",
  size,
  givens,
  difficulty: "custom"
});
function randomSolution(size, rng) {
  const p = emptyPuzzle(size, new Array(size * size).fill(0 /* Unknown */));
  const r = countSolutions(p, 1, { rng, maxNodes: 4e5, timeBudgetMs: 8e3 });
  return r.first ? r.first.cells : null;
}
var SPECS = [
  { id: "starter-6x6", name: "\u5165\u95E8 \xB7 6\xD76", size: 6, difficulty: "easy", series: "starter", seed: 20260401, keep: 18 },
  { id: "classic-8x8-A", name: "\u7ECF\u5178 \xB7 8\xD78 A", size: 8, difficulty: "medium", series: "classic", seed: 20260402, keep: 26 },
  { id: "classic-8x8-B", name: "\u7ECF\u5178 \xB7 8\xD78 B", size: 8, difficulty: "medium", series: "classic", seed: 20260403, keep: 24 },
  { id: "challenge-10x10", name: "\u6311\u6218 \xB7 10\xD710", size: 10, difficulty: "hard", series: "challenge", seed: 20260404, keep: 34 },
  { id: "challenge-12x12", name: "\u6311\u6218 \xB7 12\xD712", size: 12, difficulty: "hard", series: "challenge", seed: 20260405, keep: 44 }
];
function generate(spec) {
  const size = spec.size;
  const total = size * size;
  const t0 = Date.now();
  const rng = mulberry32(spec.seed);
  const solution = randomSolution(size, rng);
  if (!solution) throw new Error(`${spec.id}: \u9020\u4E0D\u51FA\u5408\u6CD5\u6EE1\u76D8`);
  const givens = solution.slice();
  let kept = total;
  for (const i of shuffled(
    Array.from({ length: total }, (_, i2) => i2),
    rng
  )) {
    if (kept <= spec.keep) break;
    const backup = givens[i];
    givens[i] = 0 /* Unknown */;
    const r = countSolutions(emptyPuzzle(size, givens.slice()), 2, {
      maxNodes: 8e5,
      timeBudgetMs: 8e3
    });
    if (r.count !== 1 || r.timedOut) givens[i] = backup;
    else kept--;
  }
  const finalPuzzle = emptyPuzzle(size, givens.slice());
  const check = countSolutions(finalPuzzle, 2, { maxNodes: 2e6, timeBudgetMs: 3e4 });
  if (check.count !== 1) {
    throw new Error(`${spec.id}: \u6700\u7EC8\u552F\u4E00\u89E3\u6821\u9A8C\u5931\u8D25 count=${check.count}`);
  }
  console.log(
    `${spec.id.padEnd(16)} ${size}x${size}  \u7ED9\u5B9A ${kept}/${total} (${(kept / total * 100).toFixed(0)}%)  \u552F\u4E00\u89E3 \u2713  ${Date.now() - t0}ms`
  );
  const sym = (v) => v === 1 /* Black */ ? "B" : v === 2 /* White */ ? "W" : ".";
  return {
    id: spec.id,
    name: spec.name,
    size,
    difficulty: spec.difficulty,
    series: spec.series,
    givens: givens.map(sym).join(""),
    solution: solution.map(sym).join("")
  };
}
var rows = SPECS.map(generate);
var file = `/* \u81EA\u52A8\u751F\u6210\uFF0C\u52FF\u624B\u6539\u3002scripts/gen-puzzles.mts\uFF08npm run gen\uFF09 */
export type RawPuzzle = {
  id: string
  name: string
  size: number
  difficulty: 'easy'|'medium'|'hard'|'custom'
  series: string
  /** \u9898\u9762\uFF1A'.' = \u7A7A\u767D\uFF0C'B' = \u9ED1\uFF0C'W' = \u767D\uFF1Blength = size*size\uFF0Crow-major */
  givens: string
  /** \u53C2\u8003\u89E3\uFF1A'B' / 'W'\uFF1Blength = size*size\uFF0Crow-major */
  solution: string
}

export const RAW_PUZZLES: RawPuzzle[] = [
${rows.map(
  (r) => `  { id: ${JSON.stringify(r.id)}, name: ${JSON.stringify(r.name)}, size: ${r.size}, difficulty: ${JSON.stringify(r.difficulty)}, series: ${JSON.stringify(r.series)}, givens: ${JSON.stringify(r.givens)}, solution: ${JSON.stringify(r.solution)} },`
).join("\n")}
]
`;
writeFileSync(new URL("../src/puzzles-data.ts", import.meta.url), file, "utf8");
console.log("\n\u5DF2\u5199\u5165 src/puzzles-data.ts");
