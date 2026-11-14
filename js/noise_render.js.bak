// ============================================================
// 噪域渲染入口
//   真正的合成在 js/noise_shader.js（逐像素移植 Phira 的 ActiveBlock / BlockCompose shader）
//   这里只负责：调用合成 + 画手指被挡住时的柔光（_TouchGlowColor / _TouchPosRadius）
// ============================================================

let noise_shader_warned = false;

// 【自证】本文件一旦执行，就把标记写到 window 上。
// 以后排查时只要看 window.__noise_render_loaded 就知道「文件到底有没有被执行」，
// 而不是像以前那样只能看到「噪域不显示」这种没头没尾的现象。
window.__noise_render_loaded = true;

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

    // 【关键修复】以前用 typeof render_noise_shader === "function" 判断。
    // 这个写法在「noise_shader.js 已加载但函数被挂到 window 上」或
    // 「两个文件分别处于不同全局上下文」时会误判成「不存在」，
    // 表现就是：main.js 一切正常，噪域却完全不画，且没有任何报错。
    // 改成显式取全局对象，两个来源都认，判不出来才提示。
    const shader = (typeof window !== "undefined" && window.render_noise_shader)
        || (typeof globalThis.render_noise_shader === "function" && globalThis.render_noise_shader)
        || null;

    if (typeof shader === "function") {
        shader(ctx, areas, t, w, h, ox, oy);
    } else if (!noise_shader_warned) {
        // 【重要】以前这里是静默跳过，结果「文件语法错误 / 没部署」完全看不出来。
        //         现在直接把原因写到开始界面的提示行，并且进控制台。
        noise_shader_warned = true;

        const msg = window.__noise_shader_loaded
            ? "噪域脚本已加载但 render_noise_shader 未定义：js/noise_shader.js 第 " +
              (window.__noise_shader_error_line || "?") + " 行有错（详见控制台）"
            : "噪域脚本未生效：js/noise_shader.js 没有执行（404 / 语法错误 / 路径不对，详见控制台）";

        console.error("[噪域] " + msg);
        console.error("[噪域] 自查：window.__noise_shader_loaded =", window.__noise_shader_loaded);

        const el = document.querySelector("#import-message");

        if (el) {
            el.style.color = "#ff5566";
            el.textContent = msg;
        }
    }

    draw_noise_hover(ctx, noiseState, w, h, ox, oy);
}
