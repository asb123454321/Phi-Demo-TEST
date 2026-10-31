// ============================================================
// 噪域渲染入口
//   真正的合成在 js/noise_shader.js（逐像素移植 Phira 的 ActiveBlock / BlockCompose shader）
//   这里只负责：调用合成 + 画手指被挡住时的柔光（_TouchGlowColor / _TouchPosRadius）
// ============================================================

let noise_shader_warned = false;

// 被挡住的手指：柔光（原版是 _TouchPosCount 个点的 smooth-min SDF 光晕）
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

    if (typeof render_noise_shader === "function") {
        render_noise_shader(ctx, areas, t, w, h, ox, oy);
    } else if (!noise_shader_warned) {
        // 【重要】以前这里是静默跳过，结果「文件语法错误 / 没部署」完全看不出来。
        //         现在直接把原因写到开始界面的提示行，并且进控制台。
        noise_shader_warned = true;

        const msg = "噪域脚本未生效：js/noise_shader.js 解析失败或没加载到（详见控制台）";

        console.error("[噪域] " + msg);
        console.error("[噪域] 检查 js/noise_shader.js 是否有语法错误（重复 const 等）");

        const el = document.querySelector("#import-message");

        if (el) {
            el.style.color = "#ff5566";
            el.textContent = msg;
        }
    }

    draw_noise_hover(ctx, noiseState, w, h, ox, oy);
}
