/*
 * Independent procedural renderer for chart blockAreaList noise regions.
 * Original implementation; preserves the BlockArea/render_noise_shader API.
 * Raster work is bounded to a small offscreen canvas for mobile performance.
 */
(function (root) {
    "use strict";
    root.__noise_shader_loaded = true;

    const STYLE = Object.freeze({
        maxSide: 480, minScale: 1.5, maxScale: 4,
        fill: [112, 23, 42], active: [238, 50, 78],
        subtract: [189, 131, 255], edge: [255, 119, 143], glow: [255, 37, 78],
        lineWidth: 1.8, glowWidth: 10, pulseRate: 1.8,
    });
    let buffer = null, bufferContext = null;
    let stats = { visible: 0, active: 0, pixels: 0, scale: 1 };
    const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
    const mix = (a, b, t) => a + (b - a) * t;
    const smooth = (a, b, x) => { const t = clamp((x - a) / Math.max(1e-6, b - a)); return t * t * (3 - 2 * t); };

    function hash(x, y, seed) {
        let n = Math.imul(x | 0, 0x45d9f3b) ^ Math.imul(y | 0, 0x119de1f3) ^ Math.imul(seed | 0, 0x3449);
        n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
        n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
        return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
    }
    function valueNoise(x, y, seed) {
        const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        const a = mix(hash(ix, iy, seed), hash(ix + 1, iy, seed), sx);
        const b = mix(hash(ix, iy + 1, seed), hash(ix + 1, iy + 1, seed), sx);
        return mix(a, b, sy) * 2 - 1;
    }
    function fbm(x, y, time) {
        const drift = time * .075;
        return valueNoise(x * 2 + drift, y * 2 - drift * .6, 23) * .58
            + valueNoise(x * 4.5 - drift * .8, y * 4.5 + drift, 61) * .29
            + valueNoise(x * 9 + drift * .5, y * 9 - drift, 109) * .13;
    }
    function getBuffer(width, height) {
        if (!buffer) { buffer = document.createElement('canvas'); bufferContext = buffer.getContext('2d'); }
        if (buffer.width !== width || buffer.height !== height) { buffer.width = width; buffer.height = height; }
        return bufferContext;
    }
    function readArea(area, index, time, width, height) {
        if (!area || typeof area !== 'object') return null;
        const visible = typeof area.visible === 'function' ? area.visible(time)
            : time >= Number(area.appearTime ?? 0) && time < Number(area.disappearTime ?? Infinity);
        if (!visible || typeof area.pose !== 'function') return null;
        let pose;
        try { pose = area.pose(time, width / height); } catch { return null; }
        if (!pose || !Array.isArray(pose.center) || !Array.isArray(pose.size)
            || !pose.center.every(Number.isFinite) || !pose.size.every(Number.isFinite)) return null;
        const angle = Number(pose.angle) || 0, cosine = Math.cos(angle), sine = Math.sin(angle);
        const cx = width / 2 + pose.center[0] * height / 10;
        const cy = height / 2 - pose.center[1] * height / 10;
        const halfWidth = Math.abs(pose.size[0]) * height / 20;
        const halfHeight = Math.abs(pose.size[1]) * height / 20;
        const active = typeof area.active === 'function' ? area.active(time)
            : time >= Number(area.enableTime ?? area.appearTime ?? 0) && time < Number(area.disableTime ?? Infinity);
        const ready = typeof area.ready === 'function' ? area.ready(time)
            : time >= Number(area.enableTime ?? Infinity) - .5 && time < Number(area.enableTime ?? Infinity);
        const fade = typeof area.fade === 'function' ? clamp(area.fade(time)) : 1;
        const readyPhase = ready ? clamp((time - (Number(area.enableTime) - .5)) / .5) : 0;
        const readiness = ready ? .5 + .5 * Math.sin(readyPhase * Math.PI * 8) : 0;
        const corners = [[-halfWidth,-halfHeight],[halfWidth,-halfHeight],[halfWidth,halfHeight],[-halfWidth,halfHeight]]
            .map(([x,y]) => ({ x: cx + x*cosine - y*sine, y: cy + x*sine + y*cosine }));
        return { area, index, cx, cy, halfWidth, halfHeight, cosine, sine, corners, active, readiness, fade, subtract: area.isSubtract === true };
    }
    function makePath(item, scaleX, scaleY) {
        const path = new Path2D();
        item.corners.forEach((point, index) => {
            const x = point.x * scaleX, y = point.y * scaleY;
            if (index) path.lineTo(x, y); else path.moveTo(x, y);
        });
        path.closePath();
        return path;
    }
    function distanceToRectangle(item, x, y) {
        const dx = x - item.cx, dy = y - item.cy;
        const localX = Math.abs(dx * item.cosine + dy * item.sine) - item.halfWidth;
        const localY = Math.abs(-dx * item.sine + dy * item.cosine) - item.halfHeight;
        return Math.hypot(Math.max(localX, 0), Math.max(localY, 0)) + Math.min(Math.max(localX, localY), 0);
    }

    function renderNoiseAreas(ctx, areas, time, width, height) {
        if (!ctx || !Array.isArray(areas) || !areas.length || !(width > 0 && height > 0)) {
            stats = { visible: 0, active: 0, pixels: 0, scale: 1 };
            return;
        }
        const scale = clamp(Math.max(width, height) / STYLE.maxSide, STYLE.minScale, STYLE.maxScale);
        const rasterWidth = Math.max(1, Math.ceil(width / scale));
        const rasterHeight = Math.max(1, Math.ceil(height / scale));
        const scaleX = rasterWidth / width, scaleY = rasterHeight / height;
        const target = getBuffer(rasterWidth, rasterHeight);
        const frame = target.createImageData(rasterWidth, rasterHeight);
        const pixels = frame.data;
        const items = [];
        for (let index = 0; index < Math.min(areas.length, 2048); index++) {
            const item = readArea(areas[index], index, time, width, height);
            if (item && item.fade > 0 && item.halfWidth >= .25 && item.halfHeight >= .25) items.push(item);
        }
        let activeCount = 0;
        for (const item of items) if (item.active) activeCount++;

        for (let py = 0; py < rasterHeight; py++) {
            const y = (py + .5) / scaleY, ny = y / height;
            for (let px = 0; px < rasterWidth; px++) {
                const x = (px + .5) / scaleX, nx = x / width;
                let hasNormal = false, holeParity = 0, nearest = Infinity, edgeItem = null;
                let readiness = 0, insideFade = 1;
                for (const item of items) {
                    const distance = distanceToRectangle(item, x, y);
                    if (Math.abs(distance) < nearest) { nearest = Math.abs(distance); edgeItem = item; }
                    if (distance <= 0) {
                        if (item.subtract) holeParity ^= 1; else hasNormal = true;
                        readiness = Math.max(readiness, item.active ? 1 : item.readiness);
                        insideFade = Math.min(insideFade, item.fade);
                    }
                }
                const inside = hasNormal && holeParity === 0;
                const turbulence = fbm(nx * 7, ny * 7, time);
                const detail = fbm(nx * 16 + 13, ny * 16 - 7, time * 1.13);
                const ripple = .5 + .5 * Math.sin((Math.hypot(nx-.5, ny-.5)*18 - time*1.1*2)*Math.PI);
                const pulse = .76 + .24 * Math.sin(time*1.8*Math.PI*2 + turbulence*2.5);
                let r = 0, g = 0, b = 0, a = 0;
                if (inside) {
                    const texture = .91 + .09*turbulence + .06*detail;
                    r = STYLE.fill[0]*texture + STYLE.active[0]*readiness*.08;
                    g = STYLE.fill[1]*texture + STYLE.active[1]*readiness*(.17+ripple*.1);
                    b = STYLE.fill[2]*texture + STYLE.active[2]*readiness*(.13+ripple*.08);
                    const mottling = clamp((detail+.45)*.14);
                    r += mottling*70; g += mottling*73; b += mottling*100;
                    a = .46*insideFade*(.48+readiness*.52);
                }
                if (edgeItem) {
                    const edge = 1-smooth(0, STYLE.lineWidth*scale, nearest);
                    const glow = Math.exp(-nearest/Math.max(1,STYLE.glowWidth*scale))
                        *(1-smooth(0,STYLE.glowWidth*scale,nearest));
                    const color = edgeItem.subtract ? STYLE.subtract : STYLE.edge;
                    r = mix(r,color[0]*pulse,edge) + STYLE.glow[0]*glow*.16;
                    g = mix(g,color[1]*pulse,edge) + STYLE.glow[1]*glow*.16;
                    b = mix(b,color[2]*pulse,edge) + STYLE.glow[2]*glow*.16;
                    a = Math.max(a,(edge*.88+glow*.2)*edgeItem.fade);
                }
                const offset=(py*rasterWidth+px)*4;
                pixels[offset]=clamp(r/255,0,1)*255;
                pixels[offset+1]=clamp(g/255,0,1)*255;
                pixels[offset+2]=clamp(b/255,0,1)*255;
                pixels[offset+3]=clamp(a,0,.94)*255;
            }
        }
        target.putImageData(frame,0,0);
        ctx.save();
        ctx.globalAlpha=1;
        ctx.globalCompositeOperation='source-over';
        ctx.imageSmoothingEnabled=true;
        ctx.drawImage(buffer,0,0,rasterWidth,rasterHeight,0,0,width,height);
        // Crisp contour and a gentle marching highlight complement the soft fill.
        for (const item of items) {
            const color=item.subtract?STYLE.subtract:STYLE.edge, path=makePath(item,1,1);
            ctx.save();
            ctx.globalAlpha=item.fade*(item.active?.9:.58+item.readiness*.3);
            ctx.strokeStyle=`rgb(${color.join(',')})`;
            ctx.lineWidth=Math.max(1,STYLE.lineWidth*scale);
            ctx.shadowColor=`rgba(${color.join(',')},.72)`;
            ctx.shadowBlur=STYLE.glowWidth*scale;
            ctx.stroke(path);
            if(item.active||item.readiness>.05){
                ctx.shadowBlur=0;
                ctx.setLineDash([8*scaleX,6*scaleX]);
                ctx.lineDashOffset=-time*18*scaleX;
                ctx.strokeStyle=`rgba(255,235,240,${.27+.18*Math.sin(time*5+item.index)})`;
                ctx.lineWidth=Math.max(1,scale*.65);
                ctx.stroke(path);
            }
            ctx.restore();
        }
        ctx.restore();
        stats={visible:items.length,active:activeCount,pixels:rasterWidth*rasterHeight,scale};
    }

    root.render_noise_shader = renderNoiseAreas;
    root.NOISE_SHADER = STYLE;
    root.__noiseRenderStats = () => ({ ...stats });
})(typeof window !== 'undefined' ? window : globalThis);
