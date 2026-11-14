/*
 * Independent procedural renderer for chart blockAreaList noise regions.
 * This is original code; it preserves main.js's existing BlockArea interface.
 * All pixel work happens on a bounded offscreen surface, never on the full
 * device-pixel-ratio canvas.
 */
(function (root) {
    "use strict";
    root.__noise_shader_loaded = true;

    const STYLE = Object.freeze({
        maxSide: 420,
        minScale: 1.5,
        maxScale: 4,
        fill: [116, 22, 42],
        active: [242, 55, 81],
        subtract: [190, 132, 255],
        edge: [255, 120, 143],
        glow: [255, 42, 78],
        pulseRate: 1.75,
        lineWidth: 1.7,
        glowWidth: 10,
    });

    let surface = null;
    let surfaceContext = null;
    let stats = { visible: 0, active: 0, pixels: 0, scale: 1 };
    const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
    const mix = (a, b, amount) => a + (b - a) * amount;
    const smooth = (edge0, edge1, value) => {
        const amount = clamp((value - edge0) / Math.max(1e-6, edge1 - edge0));
        return amount * amount * (3 - 2 * amount);
    };

    function hash(x, y, seed) {
        let n = Math.imul(x | 0, 0x45d9f3b) ^ Math.imul(y | 0, 0x119de1f3) ^ Math.imul(seed | 0, 0x3449);
        n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
        n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
        return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
    }

    function valueNoise(x, y, seed) {
        const ix = Math.floor(x), iy = Math.floor(y);
        const fx = x - ix, fy = y - iy;
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        const a = mix(hash(ix, iy, seed), hash(ix + 1, iy, seed), sx);
        const b = mix(hash(ix, iy + 1, seed), hash(ix + 1, iy + 1, seed), sx);
        return mix(a, b, sy) * 2 - 1;
    }

    function fbm(x, y, time) {
        const drift = time * 0.075;
        return valueNoise(x * 2.0 + drift, y * 2.0 - drift * 0.63, 23) * 0.58
            + valueNoise(x * 4.6 - drift * 0.8, y * 4.6 + drift, 61) * 0.29
            + valueNoise(x * 9.5 + drift * 0.5, y * 9.5 - drift, 109) * 0.13;
    }

    function getSurface(width, height) {
        if (!surface) {
            surface = document.createElement("canvas");
            surfaceContext = surface.getContext("2d");
        }
        if (surface.width !== width || surface.height !== height) {
            surface.width = width;
            surface.height = height;
        }
        return surfaceContext;
    }

    function prepareArea(area, index, time, width, height) {
        if (!area || typeof area !== "object") return null;
        const visible = typeof area.visible === "function"
            ? area.visible(time)
            : time >= Number(area.appearTime ?? 0) && time < Number(area.disappearTime ?? Infinity);
        if (!visible || typeof area.pose !== "function") return null;

        let pose;
        try { pose = area.pose(time, width / height); } catch { return null; }
        if (!pose || !Array.isArray(pose.center) || !Array.isArray(pose.size)
            || !pose.center.every(Number.isFinite) || !pose.size.every(Number.isFinite)) return null;

        const angle = Number(pose.angle) || 0;
        const cosine = Math.cos(angle), sine = Math.sin(angle);
        const centerX = width / 2 + pose.center[0] * height / 10;
        const centerY = height / 2 - pose.center[1] * height / 10;
        const halfWidth = Math.abs(pose.size[0]) * height / 20;
        const halfHeight = Math.abs(pose.size[1]) * height / 20;
        const active = typeof area.active === "function"
            ? area.active(time)
            : time >= Number(area.enableTime ?? area.appearTime ?? 0) && time < Number(area.disableTime ?? Infinity);
        const ready = typeof area.ready === "function"
            ? area.ready(time)
            : time >= Number(area.enableTime ?? Infinity) - 0.5 && time < Number(area.enableTime ?? Infinity);
        const fade = typeof area.fade === "function" ? clamp(area.fade(time)) : 1;
        const readyPhase = ready ? clamp((time - (Number(area.enableTime) - 0.5)) / 0.5) : 0;
        const readiness = ready ? 0.5 + 0.5 * Math.sin(readyPhase * Math.PI * 8) : 0;
        return { area, index, centerX, centerY, halfWidth, halfHeight, cosine, sine, active, readiness, fade, subtract: area.isSubtract === true };
    }

    // Signed distance to an oriented rectangle in screen coordinates.
    function rectangleDistance(item, x, y) {
        const dx = x - item.centerX, dy = y - item.centerY;
        const localX = Math.abs(dx * item.cosine + dy * item.sine) - item.halfWidth;
        const localY = Math.abs(-dx * item.sine + dy * item.cosine) - item.halfHeight;
        return Math.hypot(Math.max(localX, 0), Math.max(localY, 0)) + Math.min(Math.max(localX, localY), 0);
    }

    function areaPath(context, item, scaleX, scaleY) {
        context.beginPath();
        item.corners.forEach((point, index) => {
            const x = point.x * scaleX, y = point.y * scaleY;
            if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
        });
        context.closePath();
    }

    function renderNoiseAreas(ctx, areas, time, width, height) {
        if (!ctx || !Array.isArray(areas) || areas.length === 0 || !(width > 0 && height > 0)) {
            stats = { visible: 0, active: 0, pixels: 0, scale: 1 };
            return;
        }

        const scale = clamp(Math.max(width, height) / STYLE.maxSide, STYLE.minScale, STYLE.maxScale);
        const rasterWidth = Math.max(1, Math.ceil(width / scale));
        const rasterHeight = Math.max(1, Math.ceil(height / scale));
        const scaleX = rasterWidth / width, scaleY = rasterHeight / height;
        const target = getSurface(rasterWidth, rasterHeight);
        const frame = target.createImageData(rasterWidth, rasterHeight);
        const pixels = frame.data;
        const items = [];

        for (let index = 0; index < Math.min(areas.length, 2048); index++) {
            const item = prepareArea(areas[index], index, time, width, height);
            if (!item || item.halfWidth < 0.25 || item.halfHeight < 0.25 || item.fade <= 0) continue;
            const { centerX: cx, centerY: cy, halfWidth: hw, halfHeight: hh, cosine: c, sine: s } = item;
            item.corners = [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(([x,y]) => ({ x: cx + x*c - y*s, y: cy + x*s + y*c }));
            items.push(item);
        }

        let activeCount = 0;
        for (const item of items) if (item.active) activeCount++;

        // Rasterize coverage into an isolated RGBA image. Normal regions union;
        // subtract regions toggle the mask, so holes do not erase the game scene.
        for (let py = 0; py < rasterHeight; py++) {
            const screenY = (py + 0.5) / scaleY;
            const normalizedY = screenY / height;
            for (let px = 0; px < rasterWidth; px++) {
                const screenX = (px + 0.5) / scaleX;
                const normalizedX = screenX / width;
                let normalInside = false, subtractCount = 0;
                let nearest = Infinity, edgeItem = null;
                let readiness = 0, fade = 1;

                for (const item of items) {
                    const distance = rectangleDistance(item, screenX, screenY);
                    if (Math.abs(distance) < nearest) { nearest = Math.abs(distance); edgeItem = item; }
                    if (distance <= 0) {
                        if (item.subtract) subtractCount++; else normalInside = true;
                        readiness = Math.max(readiness, item.active ? 1 : item.readiness);
                        fade = Math.min(fade, item.fade);
                    }
                }

                const inside = normalInside && (subtractCount % 2 === 0);
                const edge = edgeItem ? 1 - smooth(0, STYLE.lineWidth * scale, nearest) : 0;
                const glow = edgeItem ? Math.exp(-nearest / Math.max(1, STYLE.glowWidth * scale))
                    * (1 - smooth(0, STYLE.glowWidth * scale, nearest)) : 0;
                const turbulence = fbm(normalizedX * 7, normalizedY * 7, time);
                const detail = fbm(normalizedX * 17 + 13, normalizedY * 17 - 7, time * 1.13);
                const pulse = 0.76 + 0.24 * Math.sin(time * STYLE.pulseRate * Math.PI * 2 + turbulence * 2.5);
                const ripple = 0.5 + 0.5 * Math.sin((Math.hypot(normalizedX - 0.5, normalizedY - 0.5) * 18 - time * STYLE.rippleRate * 2) * Math.PI);
                let red = 0, green = 0, blue = 0, alpha = 0;

                if (inside) {
                    const state = readiness;
                    const texture = 0.91 + 0.09 * turbulence + 0.06 * detail;
                    red = STYLE.fill[0] * texture + STYLE.active[0] * state * 0.08;
                    green = STYLE.fill[1] * texture + STYLE.active[1] * state * (0.17 + ripple * 0.1);
                    blue = STYLE.fill[2] * texture + STYLE.active[2] * state * (0.13 + ripple * 0.08);
                    const mottling = clamp((detail + 0.45) * 0.14);
                    red += mottling * 70; green += mottling * 73; blue += mottling * 100;
                    alpha = 0.46 * fade * (0.48 + state * 0.52);
                }
                if (edgeItem) {
                    const edgeColor = edgeItem.subtract ? STYLE.subtract : STYLE.edge;
                    const edgeAlpha = (edge * 0.88 + glow * 0.2) * edgeItem.fade;
                    red = mix(red, edgeColor[0] * pulse, edge);
                    green = mix(green, edgeColor[1] * pulse, edge);
                    blue = mix(blue, edgeColor[2] * pulse, edge);
                    red += STYLE.glow[0] * glow * 0.16;
                    green += STYLE.glow[1] * glow * 0.16;
                    blue += STYLE.glow[2] * glow * 0.16;
                    alpha = Math.max(alpha, edgeAlpha);
                }

                const offset = (py * rasterWidth + px) * 4;
                pixels[offset] = clamp(red / 255, 0, 1) * 255;
                pixels[offset + 1] = clamp(green / 255, 0, 1) * 255;
                pixels[offset + 2] = clamp(blue / 255, 0, 1) * 255;
                pixels[offset + 3] = clamp(alpha, 0, 0.94) * 255;
            }
        }

        target.putImageData(frame, 0, 0);
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(buffer, 0, 0, rasterWidth, rasterHeight, 0, 0, width, height);

        // Vector highlights and low-frequency contour shimmer are rendered at
        // display resolution over the softly textured fill.
        for (const item of items) {
            const color = item.subtract ? STYLE.subtract : STYLE.edge;
            const path = new Path2D();
            item.corners.forEach((point, index) => index ? path.lineTo(point.x, point.y) : path.moveTo(point.x, point.y));
            path.closePath();
            ctx.save();
            ctx.globalAlpha = item.fade * (item.active ? 0.9 : 0.58 + item.readiness * 0.3);
            ctx.strokeStyle = `rgb(${color.join(",")})`;
            ctx.lineWidth = Math.max(1, STYLE.lineWidth * scale);
            ctx.shadowColor = `rgba(${color.join(",")},.75)`;
            ctx.shadowBlur = STYLE.glowWidth * scale;
            ctx.stroke(path);
            if (item.active || item.readiness > 0.05) {
                ctx.shadowBlur = 0;
                ctx.setLineDash([8 * scaleX, 6 * scaleX]);
                ctx.lineDashOffset = -time * 18 * scaleX;
                ctx.strokeStyle = `rgba(255,235,240,${0.27 + 0.18 * Math.sin(time * 5 + item.index)})`;
                ctx.lineWidth = Math.max(1, scale * 0.65);
                ctx.stroke(path);
            }
            ctx.restore();
        }
        ctx.restore();
        stats = { visible: items.length, active: activeCount, pixels: rasterWidth * rasterHeight, scale };
    }

    root.render_noise_shader = renderNoiseAreas;
    root.NOISE_SHADER = STYLE;
    root.__noiseRenderStats = () => ({ ...stats });
})(typeof window !== "undefined" ? window : globalThis);
