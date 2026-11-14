# Phi-Demo-TEST
模仿 phigros 的一个小东西 + **chart.json → PEC 转换器**

## 转换器

**打开 `convert.html`** 即可用。

### 两种用法

**1. 只转谱面**：拖 `chart.json` 进来 → 转换 → 下载 `.pec`

**2. 拖整个压缩包**（推荐）：拖 `.zip` / `.pez` 进来

程序会自动：
- 在包里找 `chart.json`
- 把谱面转成 `.pec`
- 音乐 `.ogg/.mp3`、图片 `.png/.jpg` **原样保留**
- 生成 `info.yml`，`format` 写成 `pec`，`chart` / `music` / `illustration` 指向新文件名
- 打成一个新 zip 给你下载

产物结构：

```
chart.pec        ← 转换后的谱面
music.ogg        ← 原样
image.png        ← 原样
info.yml         ← 自动生成/更新
```

`info.yml` 会从原来的 `info.yml` / `info.txt` / `info.json` 里**继承已有字段**
（name / charter / composer / illustrator / backgroundDim / offset 等），
只改 `chart`、`format`、`music`、`illustration` 四个键。

界面选项：

| 选项 | 作用 |
|---|---|
| 导出判定线动效 | 是否输出 `cp/cm/cd/cr/ca/cf` |
| 导出线速 cv | 是否输出 `cv` |
| Hold 的 `#` 固定为 1 | 对齐 `pgr.rs` 行为 |
| 生成 info.yml | 打包时是否写清单 |

### 文件

- `convert.html` —— 网页界面
- `chart2pec.js` —— 转换核心，`Chart2PEC.convert(chart, opts)`，浏览器和 Node 都能用
- `export_pec.js` —— 命令行批量导出
- `pec2json_phira.js` —— 反向解析器（PEC → JSON），用于往返校验

```js
// Node
require("./chart2pec.js");
const chart = JSON.parse(fs.readFileSync("res/chart/chart.json", "utf8"));
const { text, stats } = globalThis.Chart2PEC.convert(chart, { withLines: true });
```

## 换算依据

**权威来源是 Phira 的 Rust 解析器**，不是网上流传的 `pec2json.js`（那套是另一个方言）：

- `PhiraiAd-1.5.2/prpr/src/parse/pec.rs` —— 读 PEC
- `PhiraiAd-1.5.2/prpr/src/parse/pgr.rs` —— 读 Phigros JSON
- `PhiraiAd-1.5.2/prpr/src/core.rs` —— `HEIGHT_RATIO = 0.83175`

### 指令参数（严格按 `take_*` 顺序）

| 指令 | 参数 | 说明 |
|---|---|---|
| `cp` | `line time x y` | 单点 |
| `cm` | `line t1 t2 x y tween` | **只有终点** |
| `cd` | `line time rot` | 单点 |
| `cr` | `line t1 t2 rot tween` | 只有终点 |
| `ca` | `line time alpha` | 单点 |
| `cf` | `line t1 t2 alpha` | 只有终点，**没有 tween** |
| `cv` | `line time speed` | |
| `n1~n4` | `line time [t2] x above fake` | |

`tween` 走 `parse::<u8>()` ⇒ 传超过 255 的数会报 `number too large to fit in target type`。

### 单位换算

| 项 | Phira 解析端 | 导出时 |
|---|---|---|
| 音符 x | `/ 1024` | `positionX × 115.2` |
| 判定线 x | `/ 2048 × 2 − 1` | `值 × 2048` |
| 判定线 y | `/ 1400 × 2 − 1` | `值 × 1400`（**不翻转**） |
| 时间 | 拍 | `note.time / 32` |
| 旋转 | `-value` | 已取负 |
| 透明度 | `/ 255` | `alpha × 255` |
| 线速 | `/ 5.85` | `value × 5.85 / 0.83175` = `× 7.0334` |
| offset | `首行/1000 − 0.15` | `(offset + 0.15) × 1000` |

**线速为什么不是 ×5.85**：两边的 floorPosition 定义不对称——

```
pgr.rs : pos += Δt(秒) × value / HEIGHT_RATIO     (0.83175)
pec.rs : height += Δt(秒) × (cv / 5.85)
等价   ⇒ cv = value × 5.85 / 0.83175 = value × 7.0334
```

只用 5.85 会让整谱流速变成应有的 83.2%。

**音符 x 为什么是 115.2**

```
pgr.rs : translation = positionX × (2 × 9/160) = positionX × 0.1125
pec.rs : positionX = pec_x / 1024
等价   ⇒ pec_x = positionX × 0.1125 × 1024 = positionX × 115.2
```

### 四个必踩的坑

1. **每条线的第一类事件必须以单点开头**
   `parse_events` 用 `kfs.last().value` 当渐变起点，第一条就是 `cm`/`cr`/`cf` 会直接
   `bail("interpolating event found before a concrete value appears")`。

2. **`cm`/`cr` 只传终点**
   多给一个起点会被当成 tween → `应当为 tween` → `number too large`。

3. **`cf` 没有 tween**（源码里硬编码为 2）
   多写一个 `1` → `未知的末尾附加内容: 1`。

4. **跳变段要先补单点**
   原谱有 `0.2 → 0.8 → 0.2` 这种跳变。`cm` 起点取自上一帧，不补 `cp` 就会从
   错误的位置开始渐变，表现为“判定线位置对不上”。

### Hold 流速

```rust
// pgr.rs
speed: if pgr.kind == 3 { 1. } else { pgr.speed as f64 },
```

Phira 读 JSON 时 **Hold 的 speed 被强制为 1**，忽略 json 里的值；而 PEC 的 `#`
会无条件覆盖。所以导出时 Hold 的 `#` 必须写 `1`（`holdSpeedOne` 选项控制）。

Hold 的视觉长度由 `cv` 的 floorPosition 差决定，`#` 只影响显示倍率。

## 验证

`chart_phira.pec` —— 65311 行，1397 音符，66 条线。

| 检查 | 结果 |
|---|---|
| 逐 token 消耗校验（含 `unexpected-extra`） | 0 错误 |
| 音符 time / holdTime 往返误差 | 0 |
| 音符 positionX 往返误差 | 6.7e-7 |
| 判定线 move x / y 往返误差 | 0.00000 |
| 旋转往返误差 | 0.0005° |
| alpha 往返误差 | 0.002 |
| `cv` 回算误差 | 7e-6 |

## 其它文件

- `main.js` —— 模拟器主体，`export_note_text(false, true)` 走同一套换算
- `index.html` —— 模拟器界面
- `old_scripts/` —— 早期 `.pl` 脚本、错误导出文件、`pec2json.js.old`（另一套方言，**勿用**）

## 已知未修

- `main.js` 里 `note.hold_length = note.secht * note.speed * pgrh` 没乘线速，
  官方谱 `speed: 500` 的 Hold 会渲染到屏幕外。
