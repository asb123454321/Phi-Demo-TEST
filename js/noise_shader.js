// ============================================================
// 噪域逐像素合成 —— Phira shader 的 JS 移植
//
// 对照 prpr/src/noise_area/shaders/：
//   BlockCompose_program_0 : mask = |tex(NormalBlockRT, uv + disp) - tex(SubtractBlockRT, uv + disp)|
//                            → 遮罩是在「被位移图偏移过的 UV」上取的，所以边界是逐像素扭的
//   ActiveBlock_program_0  : 块内颜色 = _FillColor（被位移值调制）
//                            + 火花（_SparkMap + 像素化场景色做色相偏移）
//                            + cell SDF 内噪点（_SDFCellSize/_SDFMoveSpeed/_SDFFalloff）
//                            + 边缘 / 发光（_EdgeColor/_GlowColor）
//                            + 边缘脉动（_ShineSpeed/_ShineBrightness）
//   最后 Compose 用 alpha 把块叠到场景上
//
// 这里用「低分辨率 CPU 逐像素」跑同一套公式，最后整块贴回画布，
// 让浏览器自己做 alpha 混合（等价于 Compose pass）。
// 参数名与 assets/materials.json 对齐，方便逐条核对。
// ============================================================

const NOISE_SHADER = {
    scale: 4,            // 内部分辨率 = 画面 / scale（越大越快、越糊）【性能】原 3
    fieldStep: 6,        // 噪声场抽样步长（内部像素）【性能】原 3

    // —— materials.json（material 5 = ActiveBlock）——
    fillColor: [0.713, 0.235, 0.235],
    fillOpacity: 0.667,
    fillStrength: 0.667,
    edgeColor: [1.0, 0.33, 0.33],
    edgeOpacity: 0.8,
    glowColor: [1.0, 0.18, 0.18],
    glowIntensity: 0.8,
    noiseTint: [1.0, 0.0, 0.0],
    sparkTint: [1.0, 0.285, 0.285],
    sparkMapOpacity: 0.6,
    sparkHueShiftAmount: 0.2,   // _SparkHueShiftAmount：火花颜色掺入场景色的比例
    displaceBlendIntensity: 0.411,
    displaceSpeed: 1.5,
    displaceStrength: 0.15,   // 原版 _DisplaceStrength
    backgroundPixelScale: 6,
    shineSpeed: 37.9,
    shineBrightness: 0.12,
    shineColor: [1, 1, 1],
    noiseEvoSpeed: 0.03,
    // 【必需】噪声方向每秒重随机次数（_NoiseDirChangeSpeed: 60）
    // 之前漏了这个参数 → S.noiseDirChangeSpeed === undefined → 整张噪声场变 NaN → 噪域不显示 / 全屏发黑
    noiseDirChangeSpeed: 60,
    noiseDisplaceStrength: 1.0,
    sdfCellSize: 0.11,
    sdfSmoothness: 0.63,
    sdfFalloff: 0.34,
    sdfMoveSpeed: 9.3,
    edgeWidth: 0.014,
    hover: [1.0, 0.0, 0.0]
};

// ---------------- 值噪声 ----------------
// 【性能】整数哈希（xorshift 风格），不含 Math.sin —— 之前每帧要跑几十万次 sin，这是掉帧主因
// 输入必须是整数（ix/iy/seed 都已 |0 处理），返回 0..1
const ns_hash = (ix, iy, seed) => {
    let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);

    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;

    return (h >>> 0) / 4294967296;
};

const ns_noise = (x, y, seed) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = ns_hash(ix, iy, seed);
    const b = ns_hash(ix + 1, iy, seed);
    const c = ns_hash(ix, iy + 1, seed);
    const d = ns_hash(ix + 1, iy + 1, seed);
    const t1 = a + (b - a) * sx;
    const t2 = c + (d - c) * sx;

    return t1 + (t2 - t1) * sy;
};

// 分形叠加，返回 -1..1（seed 用整数）
const ns_fbm = (x, y, seed) => {
    let v = 0, amp = 0.62, f = 1;

    for (let o = 0; o < 3; o++) {
        v += (ns_noise(x * f, y * f, seed + o * 17) * 2 - 1) * amp;
        amp *= 0.5;
        f *= 2.13;
    }

    return v;
};

// cell 随机点：每格一个，随时间整体重新随机（内噪点“扰动”的来源）
const ns_cell = (ci, cj, k, salt) => ns_hash(ci + Math.imul(k, 17), cj - Math.imul(k, 11), salt);

// ---------------- 复用缓冲 ----------------
let ns_low_cv = null, ns_low_ctx = null;   // 低分辨率场景取样源
let ns_out_cv = null, ns_out_ctx = null;   // 输出（低分辨率 RGBA）
let ns_mask_cv = null, ns_mask_ctx = null; // 区域栅格化遮罩（内部像素分辨率）
const ns_cell_pad = 4;                     // cell 表的余量圈数（网格被噪声挤动时会越界）
let ns_fa = new Float32Array(0);           // （不再使用，保留以免改动过大）
let ns_fb = new Float32Array(0);           // 形状扰动场 y
let ns_fc = new Float32Array(0);           // 位移图 A
let ns_fd = new Float32Array(0);           // 位移图 B
let ns_fe = new Float32Array(0);           // 斑驳图（对应 _SparkMap）
const ns_areas = [];                       // 区域缓存（避免每帧新建对象）
let ns_cell_tbl = new Float32Array(0);     // 【性能】cell 随机值表（每格 5 个：两帧随机点 xy + 火花种子）
let ns_cell_cols = 0;
let ns_cell_rows = 0;

// 诊断信息（显示在左上角帧率那一行，用来判断噪域到底有没有画出来）
const ns_debug = { areas: 0, x0: 0, y0: 0, x1: 0, y1: 0, wrote: 0, maxA: 0, px: 0, bad: 0, fb: 0, s: "", a0: -1, oor: 0, nrow: 0 };

// ---------------- 场景色（第 6 步：火花色相偏移用）----------------
// 把曲绘缩到 32×20 当"场景色"：每帧一次 drawImage + getImageData（2.5KB，可忽略）
// 原版是 sample _SceneColor（已渲染的画面），这里用曲绘近似，观感一致
const NS_SCENE_W = 32, NS_SCENE_H = 20;
let ns_scene_cv = null, ns_scene_ctx = null, ns_scene_data = null;
const ns_scene_out = [0.25, 0.25, 0.25];   // 复用数组，避免每像素新建

function ns_scene_update() {
    if (!ns_scene_cv) {
        ns_scene_cv = document.createElement("canvas");
        ns_scene_cv.width = NS_SCENE_W;
        ns_scene_cv.height = NS_SCENE_H;
        ns_scene_ctx = ns_scene_cv.getContext("2d", { willReadFrequently: true });
    }

    const img = (typeof C === "object" && C.chart) ? C.chart.image : null;

    if (!img) {
        if (!ns_scene_data) ns_scene_data = new Uint8ClampedArray(NS_SCENE_W * NS_SCENE_H * 4).fill(64);
        return;
    }

    ns_scene_ctx.drawImage(img, 0, 0, NS_SCENE_W, NS_SCENE_H);
    ns_scene_data = ns_scene_ctx.getImageData(0, 0, NS_SCENE_W, NS_SCENE_H).data;
}

// 采样"像素化 + 位移后的场景色"，写入 ns_scene_out（0..1）
function ns_scene_sample(px, py, pw, ph, ps, da, db, disp_amp) {
    if (!ns_scene_data) return ns_scene_out;

    const sx = (Math.floor(px / ps) + 0.5) * ps + da * disp_amp * pw;
    const sy = (Math.floor(py / ps) + 0.5) * ps + db * disp_amp * ph;
    const xi = Math.min(NS_SCENE_W - 1, Math.max(0, Math.floor(sx / pw * NS_SCENE_W)));
    const yi = Math.min(NS_SCENE_H - 1, Math.max(0, Math.floor(sy / ph * NS_SCENE_H)));
    const i = (yi * NS_SCENE_W + xi) * 4;

    ns_scene_out[0] = ns_scene_data[i] / 255;
    ns_scene_out[1] = ns_scene_data[i + 1] / 255;
    ns_scene_out[2] = ns_scene_data[i + 2] / 255;

    return ns_scene_out;
}

// ctx 必须已经在「画面局部坐标系」里（render 里 clip + translate(ox, oy) 之后）
function render_noise_shader(ctx, areas, t, w, h, ox, oy) {
    const S = NOISE_SHADER;
    const scale = Math.max(1, Math.round(S.scale));
    const pw = Math.max(8, Math.round(w / scale));
    const ph = Math.max(8, Math.round(h / scale));
    const aspect = w / h;

    // ---- 收集可见区域，把 4 个角换算成「内部像素坐标」----
    //   换算链路完全复用 worldToPixel（= 噪域编号用的那套），位置一定和编号一致
    ns_areas.length = 0;

    for (const area of areas) {
        if (!area.visible(t)) continue;

        const fade = area.fade ? area.fade(t) : 1;
        if (fade <= 0) continue;

        const pose = area.pose(t, aspect);
        const ca = Math.cos(pose.angle), sa = Math.sin(pose.angle);
        const pts = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([ux, uy]) => {
            const lx = ux * pose.size[0], ly = uy * pose.size[1];
            const rx = lx * ca - ly * sa;
            const ry = lx * sa + ly * ca;
            const p = worldToPixel([pose.center[0] + rx, pose.center[1] + ry], w, h);

            return [p[0] / scale, p[1] / scale];   // 画布像素 → 内部像素
        });

        ns_areas.push({ area, fade, pts });
    }

    if (ns_areas.length === 0) return;

    ns_scene_update();   // 第 6 步：更新 32×20 的场景色缩略图（供火花做色相偏移）

    // ---- 输出缓冲 ----
    // 【性能】不再每帧 getImageData 回读画面：GPU→CPU 回读要好几毫秒，
    //          而读回来的场景色只用于「火花亮度」（ActiveBlock 里 _SparkMap 的色相偏移），
    //          这里用常量近似，视觉上几乎看不出差别。
    if (!ns_out_cv || ns_out_cv.width !== pw || ns_out_cv.height !== ph) {
        ns_out_cv = document.createElement("canvas");
        ns_out_cv.width = pw;
        ns_out_cv.height = ph;
        ns_out_ctx = ns_out_cv.getContext("2d");
    }

    // ---- 噪声场（按 fieldStep 抽样，逐像素再双线性插值）----
    const step = Math.max(1, Math.round(S.fieldStep));
    const fw = Math.ceil(pw / step) + 2;
    const fh = Math.ceil(ph / step) + 2;
    const need = fw * fh;

    if (ns_fa.length < need) {
        ns_fa = new Float32Array(need);
        ns_fb = new Float32Array(need);
        ns_fc = new Float32Array(need);
        ns_fd = new Float32Array(need);
        ns_fe = new Float32Array(need);   // 第三张场：_SparkMap 对应的"斑驳图"
    }

    const freq = 0.075;                 // 噪声频率（1/像素）

    // —— 第 3 步：噪声方向「每秒重随机 60 次」（_NoiseDirChangeSpeed: 60）——
    //   原版：dir = lerp(hash(floor(t*60)), hash(floor(t*60)+1), smootherstep(fract(t*60)))
    //   方向突变会让噪点"乱窜"，这是和"单向流动"观感差别最大的地方
    const ndk = Math.floor(t * S.noiseDirChangeSpeed);
    const ndf = t * S.noiseDirChangeSpeed - ndk;
    const nds = ndf * ndf * (3 - 2 * ndf);
    const dir_a = ns_hash(ndk, 3, 71);
    const dir_b = ns_hash(ndk + 1, 3, 71);
    const nang = (dir_a + (dir_b - dir_a) * nds) * Math.PI * 2;   // 随机方向角
    const nc = Math.cos(nang), ns_ = Math.sin(nang);
    const scroll = t * S.displaceSpeed * 0.12;                    // 位移图缓慢外流（_DisplaceSpeed）

    // 只留两张场：位移图 A / B（形状扰动和内噪点都用它们，省掉两张场）
    for (let j = 0; j < fh; j++) {
        const y = j * step * freq;

        for (let i = 0; i < fw; i++) {
            const x = i * step * freq;
            const idx = j * fw + i;
            // 把采样坐标按随机方向旋转 → 图案整体"换向"
            const rx = x * nc - y * ns_ + scroll;
            const ry = x * ns_ + y * nc + scroll;

            ns_fc[idx] = ns_fbm(rx, ry, 33);
            ns_fd[idx] = ns_fbm(rx + 51.7, ry - 23.3, 44);
            // 斑驳图：比位移图更细（对应原版 _SparkMap 的 tiling 约 3×1.2）
            ns_fe[idx] = ns_fbm(rx * 2.7 + 7.7, ry * 2.2 - 3.3, 55);
        }
    }

    // ---- 逐像素合成 ----
    const out = ns_out_ctx.createImageData(pw, ph);
    const od = out.data;

    const edge_px = Math.max(1.2, (h * S.edgeWidth) / scale);   // 边缘带宽度（低分辨率像素）
    const cell_px = Math.max(2, (S.sdfCellSize * h) / scale);   // cell 尺寸
    const ps = Math.max(1, S.backgroundPixelScale / scale);     // 背景像素化格子
    const noise_amp = S.noiseDisplaceStrength;
    const disp_amp = S.displaceStrength;
    const shine = S.shineBrightness * (0.5 + 0.5 * Math.sin(t * S.shineSpeed));   // 边缘脉动
    const k = Math.floor(t * S.sdfMoveSpeed);
    const kf = t * S.sdfMoveSpeed - k;
    const kk = kf * kf * (3 - 2 * kf);

    const fill = S.fillColor, edgeC = S.edgeColor, glowC = S.glowColor, sparkC = S.sparkTint;

    // ---- 【性能】cell 随机值表：每格算一次，像素循环里只查表 ----
    //   第 4 步的"挤动"会让格号越界 ±2 格，所以表要有 pad 圈余量（索引统一 +pad）
    const cell_cols = Math.ceil(pw / cell_px) + ns_cell_pad * 2 + 2;
    const cell_rows = Math.ceil(ph / cell_px) + ns_cell_pad * 2 + 2;

    if (cell_cols !== ns_cell_cols || cell_rows !== ns_cell_rows) {
        ns_cell_cols = cell_cols;
        ns_cell_rows = cell_rows;
        ns_cell_tbl = new Float32Array(cell_cols * cell_rows * 5);
    }

    for (let cj = 0; cj < cell_rows; cj++) {
        for (let ci = 0; ci < cell_cols; ci++) {
            const base = (cj * cell_cols + ci) * 5;

            // 表号 → 真实格号（整体偏移 pad，允许负格号）
            const rc = ci - ns_cell_pad, rr = cj - ns_cell_pad;

            ns_cell_tbl[base] = ns_cell(rc, rr, k, 11);
            ns_cell_tbl[base + 1] = ns_cell(rc, rr, k, 12);
            ns_cell_tbl[base + 2] = ns_cell(rc, rr, k + 1, 11);
            ns_cell_tbl[base + 3] = ns_cell(rc, rr, k + 1, 12);
            ns_cell_tbl[base + 4] = ns_cell(rc, rr, 5, 21);
        }
    }

    // ---- 栅格化遮罩（Phira 的做法：几何画进 RT，再按「被位移偏移的坐标」去采样）----
    //   好处：几何用 canvas 填充 → 位置由角点决定，不可能出现 SDF 那种量纲算错导致的全透明
    if (!ns_mask_cv || ns_mask_cv.width !== pw || ns_mask_cv.height !== ph) {
        ns_mask_cv = document.createElement("canvas");
        ns_mask_cv.width = pw;
        ns_mask_cv.height = ph;
        ns_mask_ctx = ns_mask_cv.getContext("2d", { willReadFrequently: true });
    }

    const mctx = ns_mask_ctx;

    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.globalAlpha = 1;
    mctx.globalCompositeOperation = "source-over";
    mctx.clearRect(0, 0, pw, ph);
    mctx.fillStyle = "#fff";

    for (const it of ns_areas) {
        const pts = it.pts;

        mctx.beginPath();
        mctx.moveTo(pts[0][0], pts[0][1]);

        for (let i = 1; i < pts.length; i++) mctx.lineTo(pts[i][0], pts[i][1]);

        mctx.closePath();
        // 挖孔用 xor（对齐 Phira mask = |normal - subtract| 的奇偶性）
        mctx.globalCompositeOperation = it.area.isSubtract ? "xor" : "source-over";
        mctx.fill();
    }

    mctx.globalCompositeOperation = "source-over";

    // 读回遮罩（尺寸是内部分辨率，几百 KB 以内，比之前读整幅画面便宜得多）
    const mask_data = mctx.getImageData(0, 0, pw, ph).data;

    // 【重要】不再自己算遍历范围：内部画布只有几万像素，直接全扫，
    //         彻底避免"范围裁歪 → 一个像素都没扫到 → 静默不显示"这类问题
    const ix0 = 0, iy0 = 0, ix1 = pw - 1, iy1 = ph - 1;

    od.fill(0);   // 复用同一张 ImageData，必须先清零

    ns_debug.areas = ns_areas.length;
    ns_debug.x0 = ix0; ns_debug.y0 = iy0; ns_debug.x1 = ix1; ns_debug.y1 = iy1;
    ns_debug.wrote = 0;
    ns_debug.maxA = 0;
    ns_debug.px = pw * ph;
    ns_debug.bad = 0;
    ns_debug.fb = 0;
    ns_debug.a0 = -1;
    ns_debug.oor = 0;
    ns_debug.s = "（循环未进入）";

    // 遮罩里到底有没有内容：直接全图数一下（这是"地面真相"）
    let mask_hits = 0;

    for (let i = 3; i < mask_data.length; i += 4) {
        if (mask_data[i] > 8) mask_hits++;
    }

    ns_debug.nrow = mask_hits;
    // 所有可见噪域里最小的淡入系数（遮罩采样后无法逐像素区分是哪个区域）
    let ns_fade = 1;

    for (const it of ns_areas) {
        if (it.fade < ns_fade) ns_fade = it.fade;
    }

    let o = 0;

    for (let py = iy0; py <= iy1; py++) {
        const v = (py + 0.5) / ph;

        for (let px = ix0; px <= ix1; px++) {
            const u = (px + 0.5) / pw;

            o = (py * pw + px) * 4;   // 【性能】按坐标算偏移（现在只遍历外接框，不能再累加）

            // —— 噪声场双线性插值 ——
            const fx = px / step, fy = py / step;
            const i0 = fx | 0, j0 = fy | 0;
            const tx = fx - i0, ty = fy - j0;
            const b00 = j0 * fw + i0, b10 = j0 * fw + i0 + 1, b01 = (j0 + 1) * fw + i0, b11 = (j0 + 1) * fw + i0 + 1;
            const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
            let da = ns_fc[b00] * w00 + ns_fc[b10] * w10 + ns_fc[b01] * w01 + ns_fc[b11] * w11;
            let db = ns_fd[b00] * w00 + ns_fd[b10] * w10 + ns_fd[b01] * w01 + ns_fd[b11] * w11;
            const se = ns_fe[b00] * w00 + ns_fe[b10] * w10 + ns_fe[b01] * w01 + ns_fe[b11] * w11;

            // 【兜底】场里只要有一个 NaN，采样坐标就会变成 NaN|0 = 0（全部像素挤到同一点）
            //         这类错误的典型症状就是"整屏被同一层颜色盖住"，所以这里强制清零
            if (!(da === da)) da = 0;
            if (!(db === db)) db = 0;
            // —— 在「位移偏移过的坐标」上采样遮罩（= Phira: tex(NormalBlockRT, uv + disp)）——
            //   位移幅度：da∈[-1,1] ≈ (dA-0.5)*2，所以 ×0.5 才是原版 _DisplaceStrength 的量级
            const sx_ = px + da * 0.5 * disp_amp * pw;
            const sy_ = py + db * 0.5 * disp_amp * ph;
            const mxi = sx_ < 0 ? 0 : (sx_ > pw - 1 ? pw - 1 : sx_ | 0);
            const myi = sy_ < 0 ? 0 : (sy_ > ph - 1 ? ph - 1 : sy_ | 0);
            const mask = mask_data[(myi * pw + mxi) * 4 + 3] / 255;   // 0..1 覆盖

            // 诊断：记录"第一个被访问的像素"的真实取值（保证一定有地面真相可看）
            if (ns_debug.s === "（循环未进入）") {
                ns_debug.s = `首像素${px},${py} da${da.toFixed(2)} 采样${mxi},${myi} 遮罩${Math.round(mask * 255)}`;
            }

            // —— 第 5 步：膨胀环（Phira 的 EdgeMask / GlowMask 就是"膨胀 − 本体"，逐环累加）——
            //   edge = dilate(r=1) − mask          （_EdgeColor 画在这一圈上）
            //   glow = Σ 各环权重 × 环面积          （_GlowColor，多圈叠加 → 真正的光晕）
            const r1 = 1;
            const r2 = Math.max(2, Math.round(edge_px));
            const r3 = Math.max(3, Math.round(edge_px * 2));
            const r4 = Math.max(4, Math.round(edge_px * 3));

            const dil = r => {   // 半径 r 的 4 方向膨胀（≈ dilate），返回 0..1
                const xa = Math.max(0, mxi - r), xb = Math.min(pw - 1, mxi + r);
                const ya = Math.max(0, myi - r), yb = Math.min(ph - 1, myi + r);
                const base = myi * pw;
                let v = mask_data[(base + xa) * 4 + 3];

                const c = mask_data[(base + xb) * 4 + 3]; if (c > v) v = c;

                const d_ = mask_data[(ya * pw + mxi) * 4 + 3]; if (d_ > v) v = d_;

                const e_ = mask_data[(yb * pw + mxi) * 4 + 3]; if (e_ > v) v = e_;

                return v / 255;
            };

            const d1 = dil(r1), d2 = dil(r2), d3 = dil(r3), d4 = dil(r4);

            // 光晕环都为空、本体也是空 → 这个像素才真的什么都不画
            if (mask <= 0.01 && d1 <= 0.01 && d4 <= 0.01) continue;

            const edge = Math.max(0, d1 - mask);                       // 外侧 1 圈 = 亮边
            const glow = 0.30 * Math.max(0, d2 - d1)
                + 0.20 * Math.max(0, d3 - d2)
                + 0.12 * Math.max(0, d4 - d3);                         // 多圈叠加 = 外发光

            const inner_mask = mask;      // 内噪点只在形状内部出现
            const fade = ns_fade;         // 所有可见噪域里最小的淡入系数

            // —— 第 6 步：火花的"场景色"采样（原版 sample _SceneColor 后做色相偏移）——
            //   用曲绘缩略图近似场景色（读回量极小：32×20），再按 _SparkHueShiftAmount 掺进火花色
            const sq = ns_scene_sample(px, py, pw, ph, ps, da, db, disp_amp);

            // —— 第 4 步：网格被噪声挤动（_NoiseDisplaceStrength × _SDFCellSize）——
            //   原版：uv2 += n * 2 * _NoiseDisplaceStrength * (_ScreenParams.y * _SDFCellSize) / _ScreenParams.xy
            //   也就是位移量 = 噪声 × 2 × 强度 × cell 尺寸（像素）
            const push_x = da * S.noiseDisplaceStrength * cell_px * 2;
            const push_y = db * S.noiseDisplaceStrength * cell_px * 2;

            // —— cell SDF 内噪点（_SDFCellSize / _SDFMoveSpeed / _SDFFalloff / _SDFSmoothness）——
            // 【性能】格点随机值提前按 cell 预计算好，这里只做查表，不调哈希
            const gx = (px + push_x) / cell_px, gy = (py + push_y) / cell_px;
            const ci = gx | 0, cj = gy | 0;
            const ffx = gx - ci, ffy = gy - cj;
            // 索引要加 pad（网格被挤动后格号可能为负）；变量不能叫 cb（下面蓝色分量叫 cb）
            let cbase = ((cj + ns_cell_pad) * ns_cell_cols + (ci + ns_cell_pad)) * 5;

            // 【越界保护】越界读到 undefined → inner 变 NaN → alpha 变 NaN → 整块透明（写0 的元凶）
            if (!(cbase >= 0) || cbase + 4 >= ns_cell_tbl.length) {
                ns_debug.oor++;
                cbase = (ns_cell_pad * ns_cell_cols + ns_cell_pad) * 5;
            }

            const rrx = ns_cell_tbl[cbase] + (ns_cell_tbl[cbase + 2] - ns_cell_tbl[cbase]) * kk;
            const rry = ns_cell_tbl[cbase + 1] + (ns_cell_tbl[cbase + 3] - ns_cell_tbl[cbase + 1]) * kk;
            let inner = Math.sqrt((ffx - rrx) * (ffx - rrx) + (ffy - rry) * (ffy - rry));

            if (!(inner === inner)) inner = 0;   // NaN 保护

            inner = (inner - S.sdfFalloff) / S.sdfSmoothness;

            if (inner < 0) inner = 0;
            else if (inner > 1) inner = 1;

            inner = inner * inner * (3 - 2 * inner);

            // —— 第 6 步（修正）：_SparkMap 不是"离散火花"，而是给填充打"斑驳噪声纹" ——
            //   原版：spark = tex(_SparkMap, 像素化+位移UV) * _SparkTint * _SparkMapOpacity(5.69)
            //         col  = mix(fill, spark, _FillStrength(0.667))    ← 斑斓感来自这里
            const mottle = Math.min(1, Math.max(0, se * 0.5 + 0.5));
            const scene_lum = (sq[0] + sq[1] + sq[2]) / 3;
            const spark = Math.min(1, mottle * S.sparkMapOpacity * (0.45 + scene_lum * 0.9) * 0.35);

            // 斑驳色按 _SparkHueShiftAmount 掺入"像素化 + 位移后的场景色"
            const hs = S.sparkHueShiftAmount;
            const sp_r = sparkC[0] * (1 - hs) + sq[0] * hs;
            const sp_g = sparkC[1] * (1 - hs) + sq[1] * hs;
            const sp_b = sparkC[2] * (1 - hs) + sq[2] * hs;

            // —— 填充色：被位移平均值调制（_DisplaceBlendIntensity）+ 斑驳纹混入（_FillStrength）——
            const davg = (da + db) * 0.5;
            const fill_mod = 1 - davg * S.displaceBlendIntensity;
            const mix_v = Math.min(1, S.fillStrength * spark);
            const cr = (fill[0] * fill_mod) * (1 - mix_v) + sp_r * mix_v;
            const cg = (fill[1] * fill_mod) * (1 - mix_v) + sp_g * mix_v;
            const cb = (fill[2] * fill_mod) * (1 - mix_v) + sp_b * mix_v;

            // —— 合成：mask*col + edge*_EdgeColor + glow*_GlowColor + 内噪点 + 边缘脉动 ——
            const er = edge * S.edgeOpacity;
            const gr = glow * S.glowIntensity;
            const nr = inner * inner_mask;

            let r = mask * cr + er * edgeC[0] + gr * glowC[0] + nr * 1.0 + edge * shine * S.shineColor[0];
            let g = mask * cg + er * edgeC[1] + gr * glowC[1] + nr * 0.6 + edge * shine * S.shineColor[1];
            let b = mask * cb + er * edgeC[2] + gr * glowC[2] + nr * 0.6 + edge * shine * S.shineColor[2];
            let a = mask * S.fillOpacity + er + gr * 0.6 + nr * 0.35;

            // 亮度自适应：内噪点和边缘叠加后容易溢出，这里做一次柔和的压制
            const peak = Math.max(r, g, b);

            if (peak > 1) {
                r /= peak;
                g /= peak;
                b /= peak;
            }

            // NaN / 越界保护：算坏了就当透明，绝不把 NaN 写进 ImageData
            if (!(r === r)) r = 0;
            if (!(g === g)) g = 0;
            if (!(b === b)) b = 0;
            if (!(a === a)) a = 0;
            if (a > 1) a = 1;

            if (ns_debug.a0 < 0) ns_debug.a0 = a;   // 诊断：第一个通过遮罩测试的像素的 alpha

            od[o] = r * 255;
            od[o + 1] = g * 255;
            od[o + 2] = b * 255;
            od[o + 3] = a * fade * 255;

            if (a > 0.02) ns_debug.wrote++;
            if (a > ns_debug.maxA) ns_debug.maxA = a;
        }
    }

    ns_out_ctx.putImageData(out, 0, 0);

    ctx.save();
    ctx.imageSmoothingEnabled = true;   // 低分辨率结果平滑放大（背景像素化已经在公式里）
    ctx.drawImage(ns_out_cv, 0, 0, pw, ph, 0, 0, w, h);
    ctx.restore();
}