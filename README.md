# Phi-Demo-TEST ｜ 音游谱面转换器 & 模拟器

> 一个模仿 **Phigros** 的小东西，加上一个非常猎奇的 **chart.json → PEC 格式转换器**。
> 本仓库同时包含一个可交互的谱面**模拟器**，以及一整套把官Phi JSON谱转换成 `.pec` 谱面文件的工具链。

---

## 目录

1. [这个项目到底是干嘛的？](#一这个项目到底是干嘛的)
2. [能用它做什么](#二能用它做什么)
3. [运行环境与前置要求](#三运行环境与前置要求)
4. [快速开始](#四快速开始)
5. [功能一：谱面模拟器 index.html](#五功能一谱面模拟器-indexhtml)
6. [功能二：格式转换器 convert.html](#六功能二格式转换器-converthtml)
7. [命令行工具](#七命令行工具)
8. [转换原理与单位换算](#八转换原理与单位换算)
9. [完整文件结构总览](#九完整文件结构总览)
10. [常见问题排查（FAQ）](#十常见问题排查faq)
11. [二次开发指南](#十一二次开发指南)
12. [当前内置谱面](#十二当前内置谱面)
13. [许可证与版权说明](#十三许可证与版权说明)
14. [项目开发记录](#十四项目开发记录)

---

## 一、这个项目到底是干嘛的？

简单说，这单纯就是一个**Phi模拟器**：

随便做了一个转换器，能把：

```
Phigros 官方 chart.json  ────▶  Phira 能直接加载的 .pec 文件
```
对着 **Phira 开源项目的解析源码**（`pgr.rs`、`pec.rs`、`core.rs`），保证音符位置、判定线运动、线速、旋转、透明度等所有参数都和 Phira 内部真正读到的数值基本一致。

同时，这个仓库注重写**模仿 Phigros 的网页模拟器**，可以直接在浏览器里跑，，用来预览谱面 / 测试转换结果。

### 一句话总结

- **既可以读取官谱，又可以把官谱转为pec。。。**

---

## 二、能用它做什么

| By bike | 用什么 | 结果 |
|---|---|---|
| 想预览一份谱面长啥样 | 打开 `index.html` | 在浏览器里看到模拟器播放谱面 |
| 有官方的 `chart.json`，想转成pec | 打开 `convert.html` | 出来了 `.pec` 文件 |
| 想批量转换很多谱 | 用 Node 跑 `export_pec.js` | 命令行批量输出 `.pec` |
| 想看看转换的核心逻辑 | 读 `chart2pec.js` | 滚木滚木滚木滚木滚木滚木 |

---

## 三、运行环境与前置要求

### 这个项目几乎零依赖，主要需要：

| 需求 | 说明 | 必须要吗 |
|---|---|---|
| 一个现代浏览器 | Chrome / Edge / Firefox / Safari 都行，电脑手机均可 | 必须（跑模拟器和转换器网页） |
| Node.js（可选） | 跑 `export_pec.js` 命令行批量转换时用 | 只有用命令行才需要 |
| 网络？ | html本地的 也没有网络请求 | 不需要联网 |

### 特别说明

- `convert.html` 和 `index.html` 都是**纯前端静态页面**，没有任何后端、不需要装环境。
- 手机浏览器、手机里的 WebView 都能直接打开，界面对触屏做了适配。
- 转换器特意**不用文件选择框的 accept 硬过滤**，因为手机 WebView 会把 accept 当成硬性过滤导致选不到 `.zip / .pez`，真实判断是在 JS 里做的（看扩展名 + 读文件头），所以手机上选文件更稳。

---

## 四、快速开始

### 第 1 步：拿到这些文件

你需要整个项目文件都在（至少要有 `convert.html`、`chart2pec.js`、`index.html`、`main.js`、`lib/`、`res/` 这些）。

### 第 2 步：打开转换器

- **电脑**：双击 `convert.html`，浏览器会自动打开；或者把文件拖进浏览器地址栏。
- **手机**：把文件传到手机（微信文件助手 / USB / 网盘），用手机浏览器打开 `convert.html`。

### 第 3 步：拖一个 json 进去转

1. 点击页面里那个虚线框「**点这里选文件，或把文件拖进来**」。
2. 选一个 `chart.json`（或者直接拖一个 `.zip / .pez` 压缩包进来也行）。
3. 页面右侧/下方会出现**转换统计**（判定线 / 音符 / Hold / 线条指令的数量）。
4. 点蓝色按钮「**转换**」。
5. 转完点「**下载 .pec**」或「**复制全文**」。

搞定。这就是最核心的用法，三分钟就能跑通。

---

## 五、功能一：谱面模拟器 (index.html)

### 这是什么

一个模仿 Phigros 判定机制与判定线渲染的**网页模拟器**。打开网页就可以打开网页查看网页的网页Phi的网页模拟器。

### 怎么打开

双击 `index.html`（或拖进浏览器）。页面是**全屏黑底**的，加载时顶部有进度条，加载完成后出现开始画面。

> 注意：`index.html` 依赖同目录下的 `main.js`、`res/` 里的资源（字体、点击音效、判定图片等）。如果只复制了 `index.html` 一个文件过去，页面会变成滚木。。。

### 它和转换器有什么关系

`main.js` 里有一句核心代码 `export_note_text(false, true)`，它和 `chart2pec.js` **走的是同一套换算逻辑**。也就是说，模拟器渲染谱面的换算方式 = 转换器导出 PEC 的换算方式，两边是统一的。这在调试谱面时非常有用：你可以先在模拟器里看效果，再导出 PEC。

### 界面布局（从上到下）

| 区块 | 作用 | 缺陷 |
|---|---|---|
| 加载画面 | 加载 `res/` 里的音频、字体、贴图，带进度条 | - |
| 开始画面 | 半透明黑底 + 标题，点击进入游玩 | - |
| 游玩画面 | 判定线 + 音符下落，触屏 / 鼠标操作 | 电脑用不了键盘。。。 |

---

## 六、功能二：格式转换器 (convert.html)

这是整个项目的核心功能。下面把每一步都拆开讲。

### 6.1 界面总览

页面从上到下依次是：

1. **标题**：`json → pec`
2. **拖拽区**：虚线框，点它选文件或把文件拖进去。
3. **文件信息区**：显示你选中的文件名字、大小等。
4. **选项区**：4 个复选框（下面详解）。
5. **操作按钮**：`转换` / `下载 .pec` / `复制全文` / `打包成 .zip`。
6. **状态消息区**：显示成功 / 失败 / 警告。
7. **预览区**：可切换视图查看转换出来的 PEC 文本或原始 JSON。
8. **打包区**：拖入压缩包后这里会列出包内文件清单。
9. **统计面板**：判定线数、音符数、Hold 数、线条指令数。

### 6.2 支持的输入

| 输入 | 说明 |
|---|---|
| 单个 `chart.json` | 只转换谱面本身 |
| 单个 `.zip` | 自动在里面找 json，转谱，音乐/图片原样保留，重新打包 |
| 单个 `.pez` | 同上（`.pez` 就是 Phigros 的谱面压缩包格式） |
| 多个文件 | 支持多选，逐个处理 |

> 类型判断完全在 JS 里做：先看扩展名，再读文件头。所以**不挑文件后缀**，逻辑会自动判断。

### 6.3 四个选项是什么意思

| 选项 | 默认 | 作用 | 什么时候建议勾 |
|---|---|---|---|
| **导出判定线动效** | 勾选 | 是否输出判定线的移动/旋转/透明度指令（`cp/cm/cd/cr/ca/cf`） | 绝大多数情况都要勾；即使不勾选游戏也会出错，所以“绝大多数情况”就当做“肯定要”最好 |
| **导出线速 cv** | 勾选 | 是否输出判定线的速度变化指令 `cv` | 谱面里线速有变化就勾；想固定线速可不勾 |
| **Hold 的 `#` 固定为 1** | 勾选 | 把 Hold 音符的速度参数强制写成 1 | 一般要勾，见下方 6.4 的详细解释 |
| **生成 info.yml** | 勾选（打包时才出现） | 打包时自动生成/更新 `info.yml`，把 `format` 写成 `pec` | 这个无所谓 看自己心愿 |

### 6.4 为什么「Hold 的 `#` 要固定为 1」？

- **Phira 读 JSON 时**（`pgr.rs`），遇到 Hold（kind==3）会把它的 speed **强制当成 1**，根本无视 JSON 里写的 speed 值。
- 但 **PEC 格式里 `#` 会无条件覆盖**，也就是说只要你在 PEC 里写了 `# 2`，它就会真的按 2 来。
- 结果就是：如果导出时把 JSON 里那个被无视的 speed 原样写进 PEC 的 `#`，会导致**同一个 Hold 在 Phira 里和官方表现不一致**。
- 所以转换器默认把 Hold 的 `#` **强制写成 1**，去对齐 Phira 的真实行为。

另外还有个知识：**Hold 的视觉长度不是由 `#` 决定的**，而是由线速 `cv` 的 floorPosition 差决定的，`#` 只影响显示倍率。

### 6.5 四种操作按钮的用法

| 按钮 | 什么时候点 | 得到什么 |
|---|---|---|
| **转换** | 选好文件 + 调好选项后 | 在预览区/消息区看到转换结果和统计 |
| **下载 .pec** | 转换成功后 | 浏览器下载一个 `.pec` 文本文件 |
| **复制全文** | 转换成功后 | 把整个 PEC 文本复制到剪贴板，方便粘贴 |
| **打包成 .zip** | 拖入了压缩包且转换后 | 下载一个重新打包好的 zip（谱面已替换） |

### 6.6 打包流程详细说明（拖 zip / pez 时）

拖入 `.zip / .pez` 后，转换器会自动：

1. 在包内找到 `.json` 谱面文件。
2. 把谱面转成 `.pec`。
3. 音乐 `.ogg / .mp3`、图片 `.png / .jpg` **原样保留**，不重编码。
4. 生成 `info.yml`，其中 `format` 写 `pec`，`chart / music / illustration` 指向新文件名。
5. 打成一个**新的 zip** 让你下载。

产物结构：

```
chart.pec      ← 转换后的谱面
music.ogg      ← 原样保留
image.png      ← 原样保留
info.yml       ← 自动生成 / 更新
```

`info.yml` 会从原来的 `info.yml` / `info.txt` / `info.json` 里**继承已有字段**（如 `name / charter / composer / illustrator / backgroundDim / offset` 等），只改 `chart`、`format`、`music`、`illustration` 这四个键，别的都不动。

### 6.7 怎么判断转换对不对

- 看**统计面板**：判定线数、音符数、Hold 数、线条指令数，和你谱面 JSON 里的实际数量对得上，基本就没错。
- 看**消息区**：绿色是成功，红色是报错，黄色是警告。
- 用**反向解析**：把转出的 `.pec` 用 `pec2json_phira.js` 反解析回 JSON，再和你原 JSON 对比（往返校验），差异应该在误差范围内。

---

## 七、命令行工具

如果你装了 Node.js，想**批量转换**谱面，不用开网页，直接用命令行。

### 安装依赖

本项目用到的第三方库只有 `jszip`（命令行模式下），先安装：

```bash
npm install jszip
```

### 基本用法

```bash
node export_pec.js <输入文件或目录> [输出目录]
```

举例：

```bash
# 转换单个文件，输出到当前目录
node export_pec.js chart.json

# 转换整个目录下所有 json，输出到 out/ 文件夹
node export_pec.js ./charts ./out
```

### 在你自己写的 Node 脚本里调用核心

`chart2pec.js` 是纯逻辑，浏览器和 Node 都能 require：

```js
require("./chart2pec.js");

const fs = require("fs");
const chart = JSON.parse(fs.readFileSync("res/chart/chart.json", "utf8"));

const { text, stats } = globalThis.Chart2PEC.convert(chart, {
    withLines: true,     // 导出判定线动效
    withSpeed: true,     // 导出线速 cv
    holdSpeedOne: true,  // Hold 的 # 固定为 1
});

console.log(text);
console.log(stats); // 判定线/音符/Hold/指令 的数量统计
```

---

## 八、转换原理与单位换算

**重要声明**：下面所有换算依据，都是对照 **Phira 开源项目**的这几个文件：

- `Phira/prpr/src/parse/pec.rs` —— 读 PEC
- `Phira/prpr/src/parse/pgr.rs` —— 读 Phi JSON
- `Phira/prpr/src/core.rs` —— 核心常量 `HEIGHT_RATIO = 0.83175`

### 8.1 指令参数表（严格按 `take_*` 顺序）

| 指令 | 参数 | 说明 |
|---|---|---|
| `cp` | `line time x y` | 判定线单点移动 |
| `cm` | `line t1 t2 x y tween` | 判定线移动，**只有终点** |
| `cd` | `line time rot` | 判定线单点旋转 |
| `cr` | `line t1 t2 rot tween` | 判定线旋转，只有终点 |
| `ca` | `line time alpha` | 判定线单点透明度 |
| `cf` | `line t1 t2 alpha` | 判定线透明度，只有终点，**没有 tween** |
| `cv` | `line time speed` | 判定线速度 |
| `n1~n4` | `line time [t2] x above fake` | 音符（tap / drag / hold / flick） |

> 注意：`tween` 在 Phira 里走 `parse::<u8>()`，所以**传超过 255 的数会报错**：`number too large to fit in target type`。转换时如果谱里有超大插值，会出问题，这是 Phira 自身的限制。

### 8.2 单位换算对照表

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

### 8.3 线速 cv 为什么是 × 7.0334（推导过程）

```
pgr.rs : pos += Δt(秒) × value / HEIGHT_RATIO     (0.83175)
pec.rs : height += Δt(秒) × (cv / 5.85)
等价   ⇒ cv = value × 5.85 / 0.83175 = value × 7.0334
```

也就是说，Phi JSON 里的 `value` 要经过两次换算（除以 HEIGHT_RATIO 得到实际位移，再除以 5.85 换算成 cv），合并起来就是乘 `7.0334`。

### 8.4 音符 x 为什么是 115.2（推导过程）

```
pgr.rs : translation = positionX × (2 × 9/160) = positionX × 0.1125
pec.rs : positionX = pec_x / 1024
等价   ⇒ pec_x = positionX × 0.1125 × 1024 = positionX × 115.2
```

一句话：两个引擎对 x 坐标的“缩放基准”不一样，换算后正好是乘 `115.2`。

### 8.5 Hold 流速规则（前面提过，这里给出源码依据）

```rust
// pgr.rs
speed: if pgr.kind == 3 { 1. } else { pgr.speed as f64 },
```

- Phira 读 JSON 时，**Hold 的 speed 被强制为 1**，忽略 JSON 里的值。
- 而 PEC 的 `#` 会无条件覆盖。
- 所以导出时 Hold 的 `#` 必须写 `1`（由 `holdSpeedOne` 选项控制）。
- Hold 的视觉长度由 `cv` 的 floorPosition 差决定，`#` 只影响显示倍率。

---

## 九、完整文件结构总览

```
Phi-Demo-TEST/
├── convert.html            # 转换器网页界面（打开就用）
├── chart2pec.js            # 转换核心（浏览器 + Node 通用）
├── export_pec.js           # 命令行批量导出工具
├── pec2json_phira.js       # 反向解析器（PEC → JSON，用于校验）
├── index.html              # 谱面模拟器界面（打开就用）
├── main.js                 # 模拟器主体（含 export_note_text 换算）
├── opening-bridge.js       # 谱面/开头相关脚本
├── opening-original.js     # 谱面/开头相关脚本
├── server.py               # 简易本地服务器脚本（可选，方便跑页面）
├── appIcon.png             # 应用图标
├── LICENSE                 # GPL-3.0 开源协议
├── README.md               # 本文件
│
├── lib/
│   ├── jszip.min.js        # 压缩包处理库（第三方）
│   └── pec2json.js         # 旧版反解析（另一套方言，勿用，用 pec2json_phira.js）
│
├── js/
│   ├── noise_render.js     # 背景噪点渲染
│   └── noise_shader.js     # 背景噪点着色器
│
├── res/                    # 资源目录
│   ├── chart/              # 当前谱面
│   │   ├── chart.json      # 官方 Phi JSON 谱面
│   │   ├── chart.zip       # 打包好的谱面包
│   │   ├── image.png       # 曲绘
│   │   ├── info.json       # 曲名/难度信息
│   │   ├── info.txt
│   │   ├── info.yml
│   │   └── music.ogg       # 音频
│   ├── click.png / click.ogg       # tap 判定贴图 / 音效
│   ├── drag.png / drag.ogg         # drag 判定贴图 / 音效
│   ├── flick.png / flick.ogg       # flick 判定贴图 / 音效
│   ├── hold.png                    # hold 判定贴图
│   ├── hit_fx.png                  # 打击特效
│   ├── PHIFON.ttf / ResourceHanCN-Bold.ttf / 拾陆字濑户2.0-1.ttf   # 字体
│   └── respack.json                # 资源包描述
│
├── old_scripts/            # 早期 .pl 脚本、错误导出文件（开发历史，勿用于正式流程）
│   ├── an.pl / an2.pl / fix2.pl / mkpe.pl / phira_fix.pl / s2.pl / st.pl / st2.pl / to_beat.pl ...
│   └── chart_phira*.pec / pec2json.js.old ...
│
└── 各种转换脚本/中间产物：
    an.pl / an2.pl / fix2.pl / mkpe.pl / phira_fix.pl / s2.pl / st.pl / st2.pl / to_beat.pl
    times.txt / chart_phira.pec / chart.txt / c.txt / log.txt
    main.js.bak / main.js.before_phira_fix / main.js.pec_bak
    js_stub_note.txt ...
```

> 提示：`old_scripts/`、`.bak`、`.before_phira_fix`、`.pec_bak` 这些是**开发过程中留下的备份和早期脚本**，`lib/pec2json.js` 也是旧方言。正式转换请只用 `convert.html` + `chart2pec.js` + `pec2json_phira.js`。

---

## 十、常见问题排查（FAQ）

### Q1：双击 convert.html 没有反应 / 页面全白？
- 确认整个项目文件都在（尤其 `chart2pec.js`、`lib/jszip.min.js`），不要只复制单个 html。可以换一个浏览器（Chrome / Edge）再试，看浏览器控制台（F12）有没有红色报错。

### Q2：转换时报 `number too large to fit in target type`？
- 这是 Phira 的 `tween` 参数只能接受 0~255，你的谱里有超大的插值数。它属于 Phira 自身限制，要么改谱把值压到 255 内，要么降低对这条指令的要求。

### Q3：转出来的谱在 Phira 里 Hold 表现不对？
- 确认「Hold 的 `#` 固定为 1」勾上了，否则 JSON 里那个被 Phira 无视的 speed 会污染 PEC。
- 参考上文 6.4 / 8.5。
- 本身转换的逻辑就写的有点不太对。。。。。。

### Q4：手机上选不到 zip / pez 文件？
- 转换器特意**不用 accept 硬过滤**，真实判断在 JS 里。如果还选不到，可能是你的文件管理器/浏览器限制，把文件放到更方便的目录再选。但是绝大多数手机并不会这样。

### Q5：模拟器 index.html 打开只有黑屏/加载不出来？
- 确认 `res/` 文件夹在 `index.html` 旁边，缺了字体/音频/贴图会加载失败。确认 `main.js` 在同目录。

### Q6：我想跑本地服务（可选）
- 可以用自带的 `server.py`：`python3 server.py`，然后浏览器访问它打印的地址。
- 静态页面其实双击就能开，这个服务器只是图省事/排除浏览器本地文件限制用。

---

## 十一、二次开发指南

### 想改转换规则？
核心只有一个：**`chart2pec.js`**。
- 找 `Chart2PEC.convert(chart, opts)` 入口。
- `opts` 支持 `withLines`（判定线动效）、`withSpeed`（线速）、`holdSpeedOne`（Hold # 固定 1）等。
- 所有换算常量（`115.2`、`2048`、`1400`、`7.0334`、`0.83175`）都在里面，按需改。

### 想加新的谱面？
- 把官方谱 `chart.json`、曲绘 `image.png`、音频 `music.ogg`、信息 `info.yml/json` 放进 `res/chart/` 替换即可。
- 模拟器会自动加载 `res/chart/` 下的资源。

### 想写测试 / 校验？
- 用 `pec2json_phira.js` 把导出的 PEC 反解析回 JSON，和原 JSON 逐字段对比，这就是**往返校验**，能抓住换算 bug。

### 目录约定
- 新功能放新文件，别把逻辑全塞进 `main.js` / `convert.html` 的 `<script>` 里。
- 转换核心保持**纯函数**（不碰 DOM），这样浏览器和 Node 都能用。

---

## 十二、当前内置谱面

`res/chart/` 目前内置的谱面信息：

| 字段 | 值 |
|---|---|
| 曲名 | **ハテ**（Hate） |
| 难度 | **AT Lv.17** |

（这是一份 Phigros 官方谱面，仅用于演示转换器和模拟器。）

---

## 十三、许可证与版权说明

- 本仓库采用 **GPL-3.0** 开源协议，详见 `LICENSE`。
- 项目内的音游谱面、音频、曲绘等素材，版权归各自原作者/版权方所有；这里仅用于技术演示与学习。
- 核心换算逻辑参考了 **Phira 开源项目**（`pgr.rs` / `pec.rs` / `core.rs`），感谢大佬们的开源。

---

## 十四、项目开发记录

<!-- ### 已知未修 / 待办
- `main.js` 里 `note.hold_length = note.secht * note.speed * pgrh` 没乘线速，官方谱 `speed: 500` 的 Hold 会渲染到屏幕外。
- 仓库里还有不少 `.bak / old_scripts` 开发中间产物，后续建议整理或用 `.gitignore` 排除。 -->

### 我认为比较牛逼的：
- **转换器 v1**：实现 `chart.json → PEC` 基础转换，对齐 Phira 解析。
- **Phira 兼容修正**：Hold `#` 固定 1、线速 cv、判定线动效输出等（`main.js.before_phira_fix` 记录了修正前的状态）。

---

> 铺  师  一生气
噪  域  会下降
我是铺师，只要我一生气，天上就会落下噪域。
你们要小心一点。啊，不要惹我，生气。不然的话天上就会掉下噪域。
来现在你们开始打键盘吧。你们的切打的全对呢，我就不生气。打的要是不对呢，我就生气。
让噪域降下来吧，你们的准度全给砍了。
哈哈哈小伙伴们，大家好我是八亍。
咱们今天玩的这个机制的名字叫做天上有噪域啊
铺师生气，噪域下降。
快乱糊你们赶紧推上B吧，每人一个难度啊。
你干嘛，要把我给配了吗。
哈，哈哈。
这家伙有一彩51啊，被我肘出去。
小隆鼻一直开这铺，在这里乱练键盘想要把铺给P了。

---

###### 滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木滚木
