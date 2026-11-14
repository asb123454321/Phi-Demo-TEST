// ============================================================
// 噪域渲染入口
//
//   直接调用 rpe-next-main 的原版渲染器（js/rpe_noise/）：
//     noise-skin.js            ← src/core/noise-skin.mjs
//     noise-skin-padding.js    ← src/core/noise-skin-padding.mjs
//     noise-skin-compat.js     ← src/core/noise-skin-compat.mjs
//     noise-skin-renderer.js   ← src/ui/noise-skin-renderer.mjs
//     adapter.js               ← 本模板 ↔ 渲染器的数据换算
//
//   皮肤文件原样放在 js/rpe_noise/skins/ 下（config.json + glsl + tex）。
// ============================================================

let noise_shader_warned = false;

window.__noise_render_loaded = true;

function draw_noise_hover(ctx, noiseState, w, h, ox, oy) {
    if (!noiseState || noiseState.positions.length === 0) return;

    const r = Math.min(w, h) * 0.085;

    for (let i = 0; i < noiseState.positions.length && i < 10; i++) {
        const pos = noiseState.positions[i];
        const cx = pos[0] - ox;
        const cy = pos[1] - oy;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);

        g.addColorStop(0, "rgba(255, 70, 70, 0.45)");
        g.addColorStop(1, "rgba(255, 70, 70, 0)");

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

// ctx 必须已经在「画面局部坐标系」里（render 里 clip + translate(ox, oy) 之后）
function render_noise_areas(ctx, noiseState, areas, t, w, h, ox, oy) {
    if (!areas || areas.length === 0) return;

    // ---------- rpe 原版渲染器 ----------
    if (window.RpeNoise) {
        try {
            if (window.RpeNoise.render(ctx, noiseState, areas, t, w, h, ox, oy)) return;
        } catch (e) {
            console.error("[噪域] rpe 渲染器异常：", e);
        }
    } else if (!noise_shader_warned) {
        noise_shader_warned = true;
        console.error("[噪域] js/rpe_noise/adapter.js 未加载");
    }
}
