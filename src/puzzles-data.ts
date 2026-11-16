/* 自动生成，勿手改。scripts/gen-puzzles.mts（npm run gen） */
export type RawPuzzle = {
  id: string
  name: string
  /** 正方形边长（旧格式；矩形题改用 width/height，两者都给时以 width/height 为准） */
  size?: number
  /** 棋盘宽（偶数；可省略，省略时用 size） */
  width?: number
  /** 棋盘高（偶数；可省略，省略时用 size） */
  height?: number
  difficulty: 'easy'|'medium'|'hard'|'custom'
  series: string
  /** 题面：'.' = 空白，'B' = 黑，'W' = 白；length = width*height，row-major */
  givens: string
  /** 参考解：'B' / 'W'；length = width*height，row-major */
  solution: string
}

export const RAW_PUZZLES: RawPuzzle[] = [
  { id: "starter-6x6", name: "入门 · 6×6", size: 6, difficulty: "easy", series: "starter", givens: "B.B.WW.B.W...BW.B.B.W.WB...W..W.WB.B", solution: "BWBBWWWBBWBWWBWWBBBWWBWBBWBWBWWBWBWB" },
  { id: "classic-8x8-A", name: "经典 · 8×8 A", size: 8, difficulty: "medium", series: "classic", givens: ".WW..W.BW.WB.WWB...W..B.B....BWB..WB..B.............B.BBW.B...BW", solution: "BWWBBWWBWBWBBWWBBWBWWBBWBWBWWBWBWBWBBWBWBBWBWBWWWWBWBWBBWBBWWBBW" },
  { id: "classic-8x8-B", name: "经典 · 8×8 B", size: 8, difficulty: "medium", series: "classic", givens: "W......B....B....W.BWW.BW.BW......W..WW.BB....W.WW.B...BB..B.W..", solution: "WWBWBBWBWBBWBBWWBWWBWWBBWBBWWBBWBWWBBWWBBBWWBBWWWWBBWWBBBBWBWWBW" },
  { id: "challenge-10x10", name: "挑战 · 10×10", size: 10, difficulty: "hard", series: "challenge", givens: ".....BWW...B.......WB.B.BW..WWWB.B....W.WW...B...........BWW..BBW..B..W...BW..........WB...W.W...BW.", solution: "WBBWWBWWBBBBWBWBWWBWBWBWBWBBWWWBWBBWBWWBWWBBWBWWBBBBWWBBWBWWBWBBWWBBWWWBWWBWBWBBBWWBWBWBBWWWBWBWBBWB" },
  { id: "challenge-12x12", name: "挑战 · 12×12", size: 12, difficulty: "hard", series: "challenge", givens: "B....WW.W.W.B.W.B..W....WW.W...WBW...W..W....WW......WB............W..B....W....B.W.B..W.W.W....W..B.....W.......B.......B...BWB.B..B...BW...WB.", solution: "BBWBBWWBWBWWBBWBBWBWWBWWWWBWWBBWBWBBWWBBWBWBBWWBBBWWBWBBWBWWWWBBWBWWBWBBWBBWWBWBBWWBBBWWBWBWWBBWWWBBWWBBWWBBBWWBWBWWBBWBWBWWBBWBWBBWBWBWBWBWBWBW" },
]
