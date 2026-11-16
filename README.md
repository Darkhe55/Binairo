# 黑白 Binairo

一个基于 Web 的黑白（Binairo / Takuzu）谜题游戏，原生 SVG 渲染，内置逻辑解题器。

## 在线体验

```bash
npm install
npm run dev
```

浏览器打开终端显示的地址（默认 `http://localhost:5176`）。

## 游戏规则

- 每行、每列的黑子数与白子数相等，各占一半
- 不能出现三个同色连排，横向和纵向都算
- 任意两行不能完全相同，任意两列也不能完全相同

## 操作

| 操作 | 说明 |
|------|------|
| 左键点空格 | 循环：空 → 黑 → 白 → 空 |
| 右键点空格 | 反向循环：空 → 白 → 黑 → 空 |
| 按住左键拖拽 | 连续填黑 |
| 按住右键拖拽 | 连续填白 |
| 滚轮 / 中键拖拽 | 缩放 / 平移画布 |
| Z / Shift+Z / Y | 撤销 / 重做 |
| C / H / S / Esc | 检查 / 提示一格 / 显示解 / 清空 |
| R / L / P / M | 随机抽题 / 逻辑解题 / 暂停回放 / 音效开关 |
| 0 / + / - | 视图复位 / 放大 / 缩小 |

## 功能

- **逻辑解题**：规则引擎逐帧回放，显示每一步理由；回放中按钮变为停止，按 `P` 暂停/继续
- **提示一格 / 显示解**：提示优先揭示所有解一致的格子，显示解直接填入可行答案
- **撤销/重做**：按手势分组，一次拖拽只需一步撤销
- **进度保存**：自动保存当前题目进度，刷新不丢失
- **音效特效**：Web Audio 合成拨弦、水滴与落子动画，无外部音频资源
- **缩放/平移**：滚轮缩放，中键或 `Shift` 拖拽平移
- **题库**：内置 5 道题，从 6×6 入门到 12×12 挑战
- **自定义题**：摆放给定格并做唯一解校验；宽高都可调（必须是偶数），上限 40×50（纵向）
- **实时校验**：三连、黑白不均、重复行列即时标红

## 技术栈

- Vite + TypeScript
- 原生 SVG（无框架）
- Web Audio 合成音效（无外部资源）
- localStorage 存储进度与题库

## 项目结构

```
src/
  main.ts
  render.ts
  logic.ts
  solver.ts
  puzzles.ts
  puzzles-data.ts
  state.ts
  validate.ts
  library.ts
  audio.ts
  fx.ts
  styles.css
```

## 命令

```bash
npm run dev       # 开发服务（127.0.0.1:5176）
npm run build     # tsc --noEmit + vite build
npm run gen       # 重新生成题库
npm run check     # 审计题库
```

## 图片识别导入

用 Playwright + Edge 识别题面图片里的网格与黑白圆子，生成题库格式后预览 / 写入。

```bash
# 只识别 + 预览（默认会做唯一性检查）
npm run import-image -- 题面.png

# 只识别网格与圆子
npm run import-image -- 题面.png --dry

# 人工修正个别格子后追加到题库（写入 src/imported-puzzles.ts，npm run gen 不会覆盖）
npm run import-image -- 题面.png --map 3,4=B --name "我的黑白" --append
```

| 参数 | 说明 |
|------|------|
| `--name 名称` | 题库中显示的名称（默认「识图 · W×H」） |
| `--series 系列` | 系列名（默认「图片导入」） |
| `--difficulty 级别` | `easy` / `medium` / `hard` / `custom`（默认 `hard`） |
| `--size N` | 正方形网格边长；默认自动识别 |
| `--map 行,列=值` | 人工覆盖某格（行列从 1 开始；`B`/`1` = 黑，`W`/`2` = 白，`.`/`0` = 空） |
| `--append` | 写入 `src/imported-puzzles.ts` |
| `--verify` | 唯一性检查（`--append` 时也会自动执行） |
| `--dry` | 只识别网格与圆子，不求解、不写入 |
| `--max-nodes N` / `--time-budget MS` | 唯一性搜索节点 / 时间上限 |
| `--edge PATH` | 指定 Edge 路径（默认自动探测） |

识别流程：以亮度众数作背景 → 多档阈值投影找网格线 → 每格中心暗度判断实心黑子、中心留白 + 深色圆环判断空心白子 →
生成 `B/W/.` 题面串。内置题截图也可以直接导入（可用 `--map` 修正个别格子）。
注意：`src/types.ts` 使用了 `const enum`，脚本会自动用 `--experimental-transform-types` 重新启动自己。

