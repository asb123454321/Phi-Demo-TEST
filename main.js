const C = {
    note: {
        tap: 1,
        drag: 2,
        hold: 3,
        flick: 4
    },
    units: {
        pgrw: 0.05625,
        pgrh: 0.6,
        pgrbeat: 60 / 32
    },
    linew: 0.0075,
    lineh: 5.76,
    pcolor: [0xff, 0xec, 0x9f],
    palpha: 0xe1 / 0xff,
    click_sounds: {},
    note_imgs: {},
    chart: {},
    hit_fx_imgs: []
};

const cv = document.querySelector("#main-canvas");
const ctx = cv.getContext("2d");

// ======= blockAreaList / noise-area support =======
// Put this right after the C = { ... }; block and before const cv = ...

// small helpers
const lerp = (a, b, p) => a + (b - a) * p;
const ratio = (t, a, b) => (b <= a ? 1 : Math.max(0, Math.min(1, (t - a) / (b - a))));

const ease_raw = (n, t) => {
    const p = Math.max(0, Math.min(1, t));
    switch (n) {
        case 1: return 1 - Math.cos((p * Math.PI) / 2);
        case 2: return Math.sin((p * Math.PI) / 2);
        case 3: return (1 - Math.cos(Math.PI * p)) / 2;
        case 4: return p * p;
        case 5: return 1 - (1 - p) ** 2;
        case 6: return p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2;
        case 7: return p ** 3;
        case 8: return 1 - (1 - p) ** 3;
        case 9: return p < 0.5 ? 4 * p ** 3 : 1 - ((-2 * p + 2) ** 3) / 2;
        case 10: return p ** 4;
        case 11: return 1 - (1 - p) ** 4;
        case 12: return p < 0.5 ? 8 * p ** 4 : 1 - ((-2 * p + 2) ** 4) / 2;
        case 13: return 0;
        case 14: return 1;
        default: return p;
    }
};

const ease = (n, t) => {
    const p = Math.max(0, Math.min(1, t)) * 100;
    const i = Math.floor(p);
    const a = ease_raw(n, i / 100);
    const b = ease_raw(n, Math.min(100, i + 1) / 100);
    return a + (b - a) * (p - i);
};

const safe_div = (a, b) => (Math.abs(b) < 1e-6 ? 1 : a / b);

const worldPoint = (pt, aspect) => [(pt.x - 0.5) * 10 * aspect, (pt.y - 0.5) * 10];
const rotatePoint = ([x, y], angle) => {
    const c = Math.cos(angle), s = Math.sin(angle);
    return [c * x - s * y, s * x + c * y];
};
const worldToPixel = ([x, y], w, h) => [w / 2 + x * h / 10, h / 2 - y * h / 10];

// BlockArea class: parse chart raw area definitions
class BlockArea {
    constructor(raw) {
        this.topRightPercentage = raw.topRightPercentage || raw.top_right_percentage || { x: 0.6, y: 0.6 };
        this.bottomLeftPercentage = raw.bottomLeftPercentage || raw.bottom_left_percentage || { x: 0.4, y: 0.4 };
        this.appearTime = Number(raw.appearTime ?? raw.appear_time ?? 0) || 0;
        this.enableTime = Number(raw.enableTime ?? raw.enable_time ?? this.appearTime) || this.appearTime;
        this.disableTime = Number(raw.disableTime ?? raw.disable_time ?? (this.enableTime + 9999)) || (this.enableTime + 9999);
        this.disappearTime = Number(raw.disappearTime ?? raw.disappear_time ?? (this.disableTime + 0.5)) || (this.disableTime + 0.5);
        this.isSubtract = !!(raw.isSubtract ?? raw.is_subtract);

        this.rotateEvents = (raw.rotateEvents || raw.rotate_events || []).map(e => ({
            anchor: e.anchor || { x: 0.5, y: 0.5 },
            time: Number(e.time || 0),
            rotation: Number(e.rotation || 0),
            easeType: Number(e.easeType ?? e.ease_type ?? 0)
        }));
        this.moveEvents = (raw.moveEvents || raw.move_events || []).map(e => ({
            endPosition: e.endPosition || e.end_position || { x: 0.5, y: 0.5 },
            time: Number(e.time || 0),
            easeTypeX: Number(e.easeTypeX ?? e.ease_type_x ?? 0),
            easeTypeY: Number(e.easeTypeY ?? e.ease_type_y ?? 0)
        }));
        this.scaleEvents = (raw.scaleEvents || raw.scale_events || []).map(e => ({
            anchor: e.anchor || { x: 0.5, y: 0.5 },
            time: Number(e.time || 0),
            scale: e.scale || { x: 1, y: 1 },
            easeTypeX: Number(e.easeTypeX ?? e.ease_type_x ?? 0),
            easeTypeY: Number(e.easeTypeY ?? e.ease_type_y ?? 0)
        }));

        this.rotateEvents.sort((a, b) => a.time - b.time);
        this.moveEvents.sort((a, b) => a.time - b.time);
        this.scaleEvents.sort((a, b) => a.time - b.time);
    }

    active(t) { return t >= this.enableTime && t < this.disableTime; }
    visible(t) { return t >= this.appearTime && t < this.disappearTime; }
    ready(t) { return t >= (this.enableTime - 0.5) && t < this.enableTime; }

    pose(t, aspect) {
        const lo = this.bottomLeftPercentage;
        const hi = this.topRightPercentage;
        const loWorld = worldPoint(lo, aspect);
        const hiWorld = worldPoint(hi, aspect);
        const base = [(loWorld[0] + hiWorld[0]) / 2, (loWorld[1] + hiWorld[1]) / 2];
        let center = [...base];
        let scale = { x: 1, y: 1 };

        if (this.scaleEvents.length > 0) {
            scale = { ...this.scaleEvents[0].scale };
            for (let i = 0; i < this.scaleEvents.length; i++) {
                const e = this.scaleEvents[i];
                const next = this.scaleEvents[i + 1];
                if (!next) break;
                const p = ratio(t, e.time, next.time);
                const completed = t >= next.time;
                const v = {
                    x: e.scale.x + (next.scale.x - e.scale.x) * (completed ? 1 : ease(e.easeTypeX, p)),
                    y: e.scale.y + (next.scale.y - e.scale.y) * (completed ? 1 : ease(e.easeTypeY, p))
                };
                const anchor = worldPoint(e.anchor, aspect);
                const rel = [safe_div(v.x, e.scale.x), safe_div(v.y, e.scale.y)];
                center = [anchor[0] + (center[0] - anchor[0]) * rel[0], anchor[1] + (center[1] - anchor[1]) * rel[1]];
                scale = v;
                if (t < next.time) break;
            }
        }

        let angle = 0;
        if (this.rotateEvents.length > 0) {
            angle = this.rotateEvents[0].rotation;
            for (let i = 0; i < this.rotateEvents.length; i++) {
                const e = this.rotateEvents[i];
                const next = this.rotateEvents[i + 1];
                if (!next) break;
                const p = ratio(t, e.time, next.time);
                const completed = t >= next.time;
                const value = e.rotation + (next.rotation - e.rotation) * (completed ? 1 : ease(e.easeType, p));
                const anchor = worldPoint(e.anchor, aspect);
                const rotated = rotatePoint([center[0] - anchor[0], center[1] - anchor[1]], (value - e.rotation) * Math.PI / 180);
                center = [anchor[0] + rotated[0], anchor[1] + rotated[1]];
                angle = value;
                if (t < next.time) break;
            }
        }

        if (this.moveEvents.length > 0) {
            let curPos = this.moveEvents[0].endPosition;
            for (let i = 0; i < this.moveEvents.length; i++) {
                const e = this.moveEvents[i];
                const next = this.moveEvents[i + 1];
                if (!next) break;
                const p = ratio(t, e.time, next.time);
                const completed = t >= next.time;
                curPos = {
                    x: e.endPosition.x + (next.endPosition.x - e.endPosition.x) * (completed ? 1 : ease(e.easeTypeX, p)),
                    y: e.endPosition.y + (next.endPosition.y - e.endPosition.y) * (completed ? 1 : ease(e.easeTypeY, p))
                };
                if (t < next.time) break;
            }
            const move = worldPoint(curPos, aspect);
            center = [center[0] + move[0] - base[0], center[1] + move[1] - base[1]];
        }

        return {
            center,
            size: [Math.abs(hiWorld[0] - loWorld[0]) * scale.x, Math.abs(hiWorld[1] - loWorld[1]) * scale.y],
            angle: angle * Math.PI / 180
        };
    }

    containsPoint(p, pose, adjusted, subtract) {
        const [cx, cy] = pose.center;
        const [sx, sy] = pose.size;
        if (Math.abs(sx) < 0.0001 || Math.abs(sy) < 0.0001) return false;
        const [lx, ly] = rotatePoint([p[0] - cx, p[1] - cy], -pose.angle);
        const sign = subtract ? 1 : -1;
        const half = adjusted
            ? {
                x: 0.5 + Math.min(0.25, 0.3 / Math.abs(sx)) * sign,
                y: 0.5 + Math.min(0.25, 0.3 / Math.abs(sy)) * sign
            }
            : { x: 0.5, y: 0.5 };

        return Math.abs(lx / sx) <= half.x && Math.abs(ly / sy) <= half.y;
    }
}

// blocked logic
function blocked(areas, px, py, t, w, h, ox, oy) {
    let a = false, b = false, c = false, d = false;
    const aspect = w / h;
    const point = [((px - ox) / w - 0.5) * 10 * aspect, (0.5 - (py - oy) / h) * 10];
    for (const area of areas) {
        if (!area.active(t)) continue;
        const pose = area.pose(t, aspect);
        if (area.containsPoint(point, pose, false, area.isSubtract)) {
            if (area.isSubtract) b = !b; else a = true;
        }
        if (area.containsPoint(point, pose, true, area.isSubtract)) {
            if (area.isSubtract) d = !d; else c = true;
        }
    }
    return (a ^ b) && (c ^ d);
}

// NoiseAreaState
class NoiseAreaState {
    constructor() {
        this.blockedIds = new Set();
        this.positions = [];
        this.hovers = new Array(10).fill(null).map(() => ({ finger: null, position: [0,0], scale: 0, target: 0, elapsed: 0 }));
    }
    clear() {
        this.blockedIds.clear();
        this.positions = [];
        for (const h of this.hovers) { h.finger = null; h.scale = 0; h.target = 0; h.elapsed = 0; }
    }
    update(areas, touches, t, w, h, ox, oy, enabled, dt) {
        if (!enabled) { this.clear(); return; }
        const presentIds = new Set(touches.map(tt => tt.id));
        for (const id of Array.from(this.blockedIds)) if (!presentIds.has(id)) this.blockedIds.delete(id);
        this.positions = [];
        const seen = new Array(this.hovers.length).fill(false);

        for (const tt of touches) {
            const { id, pos } = tt;
            const isBlocked = this.blockedIds.has(id) || blocked(areas, pos[0], pos[1], t, w, h, ox, oy);
            if (isBlocked) {
                this.blockedIds.add(id);
                this.positions.push(pos);
                let slot = this.hovers.findIndex(h => h.finger === id);
                if (slot === -1) slot = this.hovers.findIndex(h => h.finger === null);
                if (slot !== -1) {
                    const h = this.hovers[slot];
                    if (h.finger !== id) { h.finger = id; h.scale = 0; h.target = 1.15; h.elapsed = 0; }
                    h.position = pos;
                    seen[slot] = true;
                }
            }
        }

        for (let i = 0; i < this.hovers.length; i++) {
            const h = this.hovers[i];
            if (h.finger !== null && !seen[i]) { h.finger = null; h.target = 0; h.elapsed = 0; }
            if (h.scale !== h.target) {
                h.elapsed += dt;
                const p = Math.min(1, h.elapsed / 0.1);
                h.scale = lerp(h.scale, h.target, p);
            }
        }
    }
    isBlocked(id) { return this.blockedIds.has(id); }
}

const noiseState = new NoiseAreaState();
let noiseAreas = [];
let noiseEnabled = true;

// parse blockAreaList from chart data
function parseBlockAreasFromChart(chartData) {
    const raw = chartData.blockAreaList || chartData.block_area_list || chartData.block_area || chartData.blockAreaList;
    if (!raw || !Array.isArray(raw)) return [];
    return raw.map(r => new BlockArea(r));
}

// active pointer tracking
const activePointers = new Map();
let lastFrameTime = performance.now();

// pointerdown block check
window.addEventListener('pointerdown', ev => {
    const rect = cv.getBoundingClientRect();
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;

    activePointers.set(ev.pointerId, [px, py]);

    const sw = cv.width, sh = cv.height;
    const w = (sw / sh > 16 / 9) ? (sh * 16 / 9) : sw;
    const h = (sw / sh > 16 / 9) ? sh : (sw * 9 / 16);
    const ox = (sw - w) / 2, oy = (sh - h) / 2;

    if (px < ox || px > ox + w || py < oy || py > oy + h) return;

    const t = C.chart?.music?.currentTime ?? 0;
    if (blocked(noiseAreas, px, py, t, w, h, ox, oy)) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,100,100,0.9)';
        ctx.beginPath();
        ctx.arc(px, py, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ev.preventDefault();
        ev.stopPropagation();
        return;
    }
});

window.addEventListener('pointermove', ev => {
    const rect = cv.getBoundingClientRect();
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    if (activePointers.has(ev.pointerId)) activePointers.set(ev.pointerId, [px, py]);
});

window.addEventListener('pointerup', ev => { activePointers.delete(ev.pointerId); });
window.addEventListener('pointercancel', ev => { activePointers.delete(ev.pointerId); });

// render block areas
function renderBlockAreas(ctx, areas, t, w, h, ox, oy) {
    if (!areas || areas.length === 0) return;

    const drawPose = (mctx, pose) => {
        const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, y]) => {
            const offset = rotatePoint([x * pose.size[0], y * pose.size[1]], pose.angle);
            return worldToPixel([pose.center[0] + offset[0], pose.center[1] + offset[1]], w, h);
        });
        mctx.beginPath();
        mctx.moveTo(corners[0][0], corners[0][1]);
        for (let i = 1; i < corners.length; i++) mctx.lineTo(corners[i][0], corners[i][1]);
        mctx.closePath();
        mctx.fill();
    };

    const mask = document.createElement('canvas');
    mask.width = Math.ceil(w);
    mask.height = Math.ceil(h);
    const mctx = mask.getContext('2d');
    mctx.clearRect(0, 0, mask.width, mask.height);

    mctx.save();
    for (const area of areas) {
        if (!area.visible(t) || area.isSubtract) continue;
        const p = area.pose(t, w / h);
        mctx.fillStyle = 'rgba(255,0,0,0.75)';
        drawPose(mctx, p);
    }

    mctx.globalCompositeOperation = 'destination-out';
    for (const area of areas) {
        if (!area.visible(t) || !area.isSubtract) continue;
        const p = area.pose(t, w / h);
        mctx.fillStyle = 'rgba(0,0,0,1)';
        drawPose(mctx, p);
    }
    mctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(mask, 0, 0);
    ctx.restore();

    for (let i = 0; i < noiseState.positions.length && i < 10; i++) {
        const pos = noiseState.positions[i];
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.beginPath();
        ctx.arc(pos[0] - ox, pos[1] - oy, Math.min(w, h) * 0.06, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

// ======= blockAreaList support END =======

// 去顶栏/屏幕旋转过程中 window.innerWidth 可能瞬时为 0，
// 这里以 canvas 实际显示尺寸为准，并跳过非法值（否则画布会变成 0×0，画面全黑）
const resize_canvas = () => {
    const w = cv.clientWidth || window.innerWidth || document.body.clientWidth;
    const h = cv.clientHeight || window.innerHeight || document.body.clientHeight;

    if (w > 0 && h > 0 && (cv.width !== w || cv.height !== h)) {
        cv.width = w;
        cv.height = h;
    }
};
const actx = new (window.AudioContext || window.webkitAudioContext)();

const TOTAL_STEPS = 17;
let loaded_steps = 0;

const set_progress = (msg, fraction = 0) => {
    const bar = document.querySelector("#loading-bar");
    const text = document.querySelector("#loading-text");

    if (bar) {
        bar.style.width = (Math.min(TOTAL_STEPS, loaded_steps + fraction) / TOTAL_STEPS * 100).toFixed(1) + "%";
    }

    if (text) {
        text.textContent = msg || `正在加载资源... ${loaded_steps}/${TOTAL_STEPS}`;
    }
};

const step = async (fn, msg) => {
    set_progress(msg);
    const r = await fn((fraction, progressMsg) => {
        set_progress(progressMsg || msg, fraction);
    });
    loaded_steps++;
    set_progress();
    return r;
};

// 用 XHR 读二进制：file:// 下 fetch 会被浏览器直接拒绝，XHR 可以正常读本地资源
const load_bin = (url, onProgress) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = "arraybuffer";
    xhr.onprogress = event => {
        if (event.lengthComputable && onProgress) {
            onProgress(event.loaded / event.total);
        }
    };
    xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 0) {
            resolve(xhr.response);
        } else {
            reject(new Error(`${url} 加载失败（HTTP ${xhr.status}）`));
        }
    };
    xhr.onerror = () => reject(new Error(`${url} 加载失败（网络错误）`));
    xhr.ontimeout = () => reject(new Error(`${url} 加载超时`));
    xhr.timeout = 120000;
    xhr.send();
});

const load_audio = async (url, onProgress) => await actx.decodeAudioData(await load_bin(url, onProgress));

const play_sound = async buf => {
    const source = actx.createBufferSource();
    source.buffer = buf;
    source.connect(actx.destination);
    source.start();
};

const load_img = async url => {
    const img = new Image();
    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error(`${url} 加载失败（图片）`));
        img.src = url;
    });

    return img;
};

const load_json = async (url, onProgress) => {
    const data = await load_bin(url, onProgress);
    if (url.endsWith("chart.json") && onProgress) {
        onProgress(1, "正在解析谱面 chart.json...");
    }
    return JSON.parse(new TextDecoder("utf-8").decode(data));
};

const clip_img = (img, y0, y1) => {
    const tempcv = document.createElement("canvas");
    tempcv.width = img.width;
    tempcv.height = y1 - y0;
    const tempctx = tempcv.getContext("2d");
    tempctx.drawImage(img, 0, -y0);
    return tempcv;
};

const clip_block_img = (img, x0, y0, x1, y1) => {
    const tempcv = document.createElement("canvas");
    tempcv.width = x1 - x0;
    tempcv.height = y1 - y0;
    const tempctx = tempcv.getContext("2d");
    tempctx.drawImage(img, -x0, -y0);
    return tempcv;
};

const clip_hold = (img, atlas) => {
    const tail = clip_img(img, 0, atlas[0]);
    const body = clip_img(img, atlas[0], img.height - atlas[1]);
    const head = clip_img(img, img.height - atlas[1], atlas[1]);

    return [head, body, tail];
};

const load_audioele = async (url, onProgress) => {
    const audio = new Audio();
    audio.preload = "auto";

    await new Promise((resolve, reject) => {
        audio.onprogress = () => {
            if (onProgress && Number.isFinite(audio.duration) && audio.duration > 0 && audio.buffered.length > 0) {
                onProgress(Math.min(0.99, audio.buffered.end(audio.buffered.length - 1) / audio.duration));
            }
        };
        audio.onloadeddata = () => {
            if (onProgress) onProgress(1);
            resolve();
        };
        audio.onerror = () => reject(new Error(`${url} 加载失败（音频）`));
        audio.src = url;
        audio.load();
    });

    return audio;
};

const linear = (t, st, et, sv, ev) => sv + (t - st) / (et - st) * (ev - sv);

const find_event = (t, es) => {
    let l = 0, r = es.length - 1;

    while (l <= r) {
        const m = Math.floor((l + r) / 2);
        const e = es[m];

        if (e.startTime <= t && t <= e.endTime) {
            return m;
        } else if (e.startTime > t) {
            r = m - 1;
        } else {
            l = m + 1;
        }
    }

    return -1;
};

const init_speed_events = es => {
    let fp = 0.0;

    for (const e of es) {
        e.floorPosition = fp;
        fp += (e.endTime - e.startTime) * e.value;
    }
};

const merge_notes = (above, below) => {
    for (const note of above) {
        note.is_above = true;
    }

    for (const note of below) {
        note.is_above = false;
    }

    return [...above, ...below];
};

const init_note_fp = (notes, ses) => {
    for (const note of notes) {
        note.floorPosition = get_fp(note.time, ses);
    }
};

const get_event_val = (t, es, sn, en) => {
    const i = find_event(t, es);
    if (i === -1) {
        return 0.0;
    }

    const e = es[i];

    return linear(t, e.startTime, e.endTime, e[sn], e[en]);
};

const get_fp = (t, es) => {
    const i = find_event(t, es);
    if (i === -1) {
        return 0.0;
    }

    const e = es[i];

    return e.floorPosition + (t - e.startTime) * e.value;
};

const rotate_point = (x, y, r, deg) => {
    return [
        x + r * Math.cos(deg * Math.PI / 180),
        y + r * Math.sin(deg * Math.PI / 180)
    ];
}

const get_blur_img = (img, r) => {
    r *= (img.width + img.height);
    const tempcv = document.createElement("canvas");
    tempcv.width = img.width;
    tempcv.height = img.height;
    const tempctx = tempcv.getContext("2d");
    const morescale = Math.max(r / img.width, r / img.height);
    tempctx.scale(1 + morescale, 1 + morescale);
    tempctx.translate(-r / 2, -r / 2);
    tempctx.filter = `blur(${r}px)`;
    tempctx.drawImage(img, 0, 0);
    return tempcv;
};

const cv_put_color = (cv, color) => {
    const ctx = cv.getContext("2d");
    const imgdata = ctx.getImageData(0, 0, cv.width, cv.height);
    for (let i = 0; i < imgdata.data.length; i += 4) {
        imgdata.data.set([
            Math.floor(imgdata.data[i] * color[0] / 0xff),
            Math.floor(imgdata.data[i + 1] * color[1] / 0xff),
            Math.floor(imgdata.data[i + 2] * color[2] / 0xff),
            imgdata.data[i + 3]
        ], i);
    }
    ctx.putImageData(imgdata, 0, 0);
    return cv;
};

// ---- 偏移调节（单位毫秒，正数 = 谱面与打击音整体延后）----
const OFFSET_KEY = "phigros_offset";
let offset_ms = 0;

try {
    offset_ms = Math.max(-5000, Math.min(5000, Number(localStorage.getItem(OFFSET_KEY)) || 0));
} catch (e) {}

const offset_value_el = document.querySelector("#offset-value");
const offset_toggle_btn = document.querySelector("#offset-toggle");
const offset_panel_el = document.querySelector("#offset-panel");

const set_offset = ms => {
    offset_ms = Math.max(-5000, Math.min(5000, Math.round(ms)));

    if (offset_value_el) {
        offset_value_el.textContent = `偏移 ${offset_ms > 0 ? "+" : ""}${offset_ms} ms`;
    }

    try {
        localStorage.setItem(OFFSET_KEY, String(offset_ms));
    } catch (e) {}
};

document.querySelectorAll("#offset-panel [data-delta]").forEach(btn => {
    btn.onclick = () => set_offset(offset_ms + Number(btn.dataset.delta));
});

const offset_reset_btn = document.querySelector("#offset-reset");

if (offset_reset_btn) {
    offset_reset_btn.onclick = () => set_offset(0);
}

// 面板可拖动：按住面板空白处/数值栏拖，按钮照常点击；位置记在 localStorage
const OFFSET_POS_KEY = "phigros_offset_pos";
let offset_panel_pos = null;

try {
    const saved_pos = JSON.parse(localStorage.getItem(OFFSET_POS_KEY) || "null");

    if (saved_pos && typeof saved_pos.x === "number" && typeof saved_pos.y === "number") {
        offset_panel_pos = saved_pos;
    }
} catch (e) {}

const place_panel = (x, y) => {
    if (!offset_panel_el) return;

    const r = offset_panel_el.getBoundingClientRect();
    const nx = Math.max(0, Math.min(Math.max(0, window.innerWidth - r.width), x));
    const ny = Math.max(0, Math.min(Math.max(0, window.innerHeight - r.height), y));

    offset_panel_el.style.right = "auto";
    offset_panel_el.style.bottom = "auto";
    offset_panel_el.style.left = nx + "px";
    offset_panel_el.style.top = ny + "px";
    offset_panel_pos = { x: nx, y: ny };
};

if (offset_toggle_btn && offset_panel_el) {
    offset_toggle_btn.onclick = () => {
        offset_panel_el.classList.toggle("hidden");

        if (!offset_panel_el.classList.contains("hidden") && offset_panel_pos) {
            place_panel(offset_panel_pos.x, offset_panel_pos.y);
        }
    };
}

if (offset_panel_el) {
    let drag = null;

    offset_panel_el.addEventListener("pointerdown", e => {
        if (e.target.closest("button")) return;

        const r = offset_panel_el.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };

        try {
            offset_panel_el.setPointerCapture(e.pointerId);
        } catch (err) {}

        e.preventDefault();
    });

    offset_panel_el.addEventListener("pointermove", e => {
        if (!drag) return;
        place_panel(e.clientX - drag.dx, e.clientY - drag.dy);
    });

    const end_drag = () => {
        if (!drag) return;
        drag = null;

        try {
            localStorage.setItem(OFFSET_POS_KEY, JSON.stringify(offset_panel_pos));
        } catch (e) {}
    };

    offset_panel_el.addEventListener("pointerup", end_drag);
    offset_panel_el.addEventListener("pointercancel", end_drag);

    window.addEventListener("resize", () => {
        if (offset_panel_pos && !offset_panel_el.classList.contains("hidden")) {
            place_panel(offset_panel_pos.x, offset_panel_pos.y);
        }
    });
}

set_offset(offset_ms);

const render = () => {
    resize_canvas();

    const t = C.chart.music.currentTime - (C.chart.data.offset + offset_ms / 1000);

    const [sw, sh] = [cv.width, cv.height];

    ctx.clearRect(0, 0, sw, sh);
    ctx.drawImage(C.chart.image, 0, 0, sw, sh);
    ctx.fillRectEx(0, 0, sw, sh, "rgba(0, 0, 0, 0.6)");

    const [w, h] = (sw / sh > 16 / 9)
        ? [sh * 16 / 9, sh]
        : [sw, sw * 9 / 16];
    const [ox, oy] = [(sw - w) / 2, (sh - h) / 2];
    const note_width = w * 0.1234375;

    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, w, h);
    ctx.clip();
    ctx.translate(ox, oy);

    ctx.drawImage(C.chart.image, 0, 0, w, h);
    ctx.fillRectEx(0, 0, w, h, "rgba(0, 0, 0, 0.6)");

    // ----- noise-area update & render -----
    {
        const now = performance.now();
        const dt = Math.max(0, (now - lastFrameTime) / 1000);
        lastFrameTime = now;

        const touches = [];
        for (const [id, pos] of activePointers.entries()) touches.push({ id, pos });

        noiseState.update(noiseAreas, touches, t, w, h, ox, oy, noiseEnabled, dt);
        renderBlockAreas(ctx, noiseAreas, t, w, h, ox, oy);
    }
    // ---------------------------------------

    for (const line of C.chart.data.judgeLineList) {
        let [ lineRotate, lineX, lineY, lineAlpha ] = line.get_state(t);
        lineX *= w; lineY *= h;
        const lineDrawPos = [
            ...rotate_point(lineX, lineY, h * C.lineh, lineRotate),
            ...rotate_point(lineX, lineY, h * C.lineh, lineRotate + 180),
        ];

        ctx.drawLine(...lineDrawPos, h * C.linew, `rgba(${C.pcolor.join(", ")}, ${lineAlpha})`);
        const beatt = line.sec2beat(t);
        const linefp = get_fp(beatt, line.speedEvents);

        for (const note of line.notes) {
            if (note.sect < t && !note.clicked) {
                play_sound(C.click_sounds[note.type]);
                note.clicked = true;
            }

            if ((!note.is_hold && note.sect < t) || (note.is_hold && note.hold_end_time < t)) {
                continue;
            }

            let note_fp = (note.floorPosition - linefp) * C.units.pgrh * (C.units.pgrbeat / line.bpm) * h;

            if (!note.is_hold) {
                note_fp *= note.speed;
            }

            if (!note.is_hold && note_fp < -1e6) {
                continue;
            }

            if (note_fp > h * 2) {
                continue;
            }

            const draw_head = note.sect > t;
            const note_head_img = C.note_head_imgs[note.type][note.morebets];
            const this_note_width = note_width * (note.morebets ? (
                C.note_head_imgs[note.type][1].width
                / C.note_head_imgs[note.type][0].width
            ) : 1.0);

            const this_note_head_height = this_note_width / note_head_img.width * note_head_img.height;
            const note_atline_pos = rotate_point(lineX, lineY, note.positionX * C.units.pgrw * w, lineRotate);
            const l2n_rotate = lineRotate - (note.is_above ? 90 : -90)
            const note_head_pos = rotate_point(...note_atline_pos, note_fp, l2n_rotate);

            const note_draw_rotate = lineRotate + (note.is_above ? 0 : 180);

            if (draw_head) {
                ctx.drawCenterRotateImage(
                    note_head_img, ...note_head_pos,
                    this_note_width, this_note_head_height,
                    note_draw_rotate
                );
            }

            if (note.is_hold) {
                const note_body_img = C.hold_body_imgs[note.morebets];
                const note_tail_img = C.hold_tail_imgs[note.morebets];
                const note_tail_height = this_note_width / note_tail_img.width * note_tail_img.height;

                const note_body_height = Math.max(
                    note.hold_length * h
                    + Math.min(0, note_fp)
                    + (note.clicked ? this_note_head_height / 2 : 0)
                    - note_tail_height / 2
                    , 0
                );

                const note_body_pos = rotate_point(
                    ...((!note.clicked) ? note_head_pos : note_atline_pos),
                    ((!note.clicked) ? this_note_head_height / 2 : 0) + note_body_height / 2,
                    l2n_rotate);

                ctx.drawCenterRotateImage(
                    note_body_img, ...note_body_pos,
                    this_note_width, note_body_height,
                    note_draw_rotate
                );

                const note_tail_pos = rotate_point(
                    ...note_body_pos,
                    note_body_height / 2 + note_tail_height / 2,
                    l2n_rotate
                );

                ctx.drawCenterRotateImage(
                    note_tail_img, ...note_tail_pos,
                    this_note_width, note_tail_height,
                    note_draw_rotate
                );
            }
        }
    }

    const effect_dur = 0.5;

    for (const [note, effect_t] of C.chart.data.click_effect_collection) {
        if (effect_t > t) break;
        if (effect_t + effect_dur < t) continue;

        const p = (t - effect_t) / effect_dur;
        const imi = Math.max(0, Math.min(C.hit_fx_imgs.length - 1, Math.floor(p * C.hit_fx_imgs.length)));
        const im = C.hit_fx_imgs[imi];
        const effect_size = note_width * 1.375 * 1.12;
        const [ pars, pos_getter ] = note.get_click_effect(w, h);
        const [ x, y ] = pos_getter(effect_t);

        ctx.save();
        ctx.globalAlpha *= C.palpha;
        ctx.drawImage(
            im,
            x - effect_size / 2, y - effect_size / 2,
            effect_size, effect_size
        );
        ctx.restore();

        for (const paritem of pars) {
            const [ rotate, size, r ] = paritem(p);
            ctx.save();
            ctx.translate(x, y);
            const parcenter = rotate_point(0, 0, r, rotate);
            ctx.fillRectEx(parcenter[0], parcenter[1], size, size, `rgba(${C.pcolor.join(", ")}, ${1.0 - p})`);
            ctx.restore();
        }
    }

    ctx.restore();

    requestAnimationFrame(render);
};

CanvasRenderingContext2D.prototype.drawLine = function (x0, y0, x1, y1, w, c) {
    this.save();
    this.beginPath();
    this.moveTo(x0, y0);
    this.lineTo(x1, y1);
    this.lineWidth = w;
    this.strokeStyle = c;
    this.stroke();
    this.restore();
};

CanvasRenderingContext2D.prototype.fillRectEx = function (x, y, w, h, c) {
    this.save();
    this.beginPath();
    this.rect(x, y, w, h);
    this.fillStyle = c;
    this.fill();
    this.restore();
};

CanvasRenderingContext2D.prototype.drawCenterRotateImage = function (img, x, y, w, h, deg) {
    this.save();
    this.translate(x, y);
    this.rotate(deg * Math.PI / 180);
    this.drawImage(img, -w / 2, -h / 2, w, h);
    this.restore();
};

CanvasRenderingContext2D.prototype.drawBCRotateImage = function (img, x, y, w, h, deg) {
    this.save();
    this.translate(x, y + h / 2);
    this.rotate(deg * Math.PI / 180);
    this.drawImage(img, -w / 2, -h, w, h);
    this.restore();
};

const load_game = async () => {
    resize_canvas();

    C.click_sounds[C.note.tap] = await step(onProgress => load_audio("res/click.ogg", onProgress), "正在加载点击音效...");
    C.click_sounds[C.note.hold] = C.click_sounds[C.note.tap];
    C.click_sounds[C.note.drag] = await step(onProgress => load_audio("res/drag.ogg", onProgress), "正在加载拖动音效...");
    C.click_sounds[C.note.flick] = await step(onProgress => load_audio("res/flick.ogg", onProgress), "正在加载滑动音效...");

    C.note_imgs.click = await step(() => load_img("res/click.png"), "正在加载点击音符...");
    C.note_imgs.drag = await step(() => load_img("res/drag.png"), "正在加载拖动音符...");
    C.note_imgs.hold = await step(() => load_img("res/hold.png"), "正在加载长押音符...");
    C.note_imgs.flick = await step(() => load_img("res/flick.png"), "正在加载滑动音符...");

    C.note_imgs.click_mh = await step(() => load_img("res/click_mh.png"), "正在加载高亮点击音符...");
    C.note_imgs.drag_mh = await step(() => load_img("res/drag_mh.png"), "正在加载高亮拖动音符...");
    C.note_imgs.hold_mh = await step(() => load_img("res/hold_mh.png"), "正在加载高亮长押音符...");
    C.note_imgs.flick_mh = await step(() => load_img("res/flick_mh.png"), "正在加载高亮滑动音符...");

    C.respack_info = await step(onProgress => load_json("res/respack.json", onProgress), "正在读取资源配置...");

    [C.note_imgs.hold_head, C.note_imgs.hold_body, C.note_imgs.hold_tail] = clip_hold(C.note_imgs.hold, C.respack_info.holdAtlas);
    [C.note_imgs.hold_mh_head, C.note_imgs.hold_mh_body, C.note_imgs.hold_mh_tail] = clip_hold(C.note_imgs.hold_mh, C.respack_info.holdAtlasMH);

    C.chart.info = await step(onProgress => load_json("res/chart/info.json", onProgress), "正在读取谱面信息...");
    C.chart.data = await step(onProgress => load_json("res/chart/chart.json", onProgress), "正在下载谱面 chart.json...");
    noiseAreas = parseBlockAreasFromChart(C.chart.data);
    C.chart.music = await step(onProgress => load_audioele("res/chart/music.ogg", onProgress), "正在加载谱面音乐...");
    C.chart.image = get_blur_img(await step(() => load_img("res/chart/image.png"), "正在加载曲绘..."), 0.05);

    C.note_head_imgs = {
        [C.note.tap]: [C.note_imgs.click, C.note_imgs.click_mh],
        [C.note.drag]: [C.note_imgs.drag, C.note_imgs.drag_mh],
        [C.note.flick]: [C.note_imgs.flick, C.note_imgs.flick_mh],
        [C.note.hold]: [C.note_imgs.hold_head, C.note_imgs.hold_mh_head]
    };

    C.hold_body_imgs = [C.note_imgs.hold_body, C.note_imgs.hold_mh_body];
    C.hold_tail_imgs = [C.note_imgs.hold_tail, C.note_imgs.hold_mh_tail];

    C.hit_fx = await step(() => load_img("res/hit_fx.png"), "正在加载打击特效...");
    set_progress("正在生成打击特效...");

    for (let j = 0; j < C.respack_info.hitFx[1]; j++) {
        for (let i = 0; i < C.respack_info.hitFx[0]; i++) {
            C.hit_fx_imgs.push(
                cv_put_color(clip_block_img(
                    C.hit_fx,
                    (i / C.respack_info.hitFx[0]) * C.hit_fx.width,
                    (j / C.respack_info.hitFx[1]) * C.hit_fx.height,
                    ((i + 1) / C.respack_info.hitFx[0]) * C.hit_fx.width,
                    ((j + 1) / C.respack_info.hitFx[1]) * C.hit_fx.height
                ), C.pcolor)
            );
        }
    }

    C.chart.music.style.display = "none";
    document.body.appendChild(C.chart.music);

    set_progress("正在初始化谱面...");

    const note_sect_counter = new Map();

    for (const line of C.chart.data.judgeLineList) {
        line.speedEvents.sort((a, b) => a.startTime - b.startTime);
        line.judgeLineRotateEvents.sort((a, b) => a.startTime - b.startTime);
        line.judgeLineMoveEvents.sort((a, b) => a.startTime - b.startTime);
        line.judgeLineDisappearEvents.sort((a, b) => a.startTime - b.startTime);

        line.sec2beat = function (t) {return t / (C.units.pgrbeat / this.bpm)};
        line.beat2sec = function (t) {return t * (C.units.pgrbeat / this.bpm)};
        line.get_state = function (t) {
            const beatt = this.sec2beat(t);
            const rotate = get_event_val(beatt, line.judgeLineRotateEvents, "start", "end") * -1;
            const x = get_event_val(beatt, line.judgeLineMoveEvents, "start", "end");
            const y = 1.0 - get_event_val(beatt, line.judgeLineMoveEvents, "start2", "end2");
            const alpha = get_event_val(beatt, line.judgeLineDisappearEvents, "start", "end");

            return [ rotate, x, y, alpha ];
        };

        init_speed_events(line.speedEvents);
        line.notes = merge_notes(line.notesAbove, line.notesBelow);
        init_note_fp(line.notes, line.speedEvents);

        for (const note of line.notes) {
            note.sect = line.beat2sec(note.time);
            note.secht = line.beat2sec(note.holdTime);
            note.hold_end_time = note.sect + note.secht;
            note.hold_length = note.secht * note.speed * C.units.pgrh;
            note.is_hold = note.type === C.note.hold;
            note.clicked = false;
            note.master = line;

            if (!note_sect_counter.has(note.sect)) {
                note_sect_counter.set(note.sect, 0);
            }

            note_sect_counter.set(note.sect, note_sect_counter.get(note.sect) + 1);
        }

        delete line.notesAbove;
        delete line.notesBelow;
    }

    for (const line of C.chart.data.judgeLineList) {
        for (const note of line.notes) {
            note.morebets = +(note_sect_counter.get(note.sect) > 1);
        }
    }

    C.chart.data.click_effect_collection = [];

    for (const line of C.chart.data.judgeLineList) {
        for (const note of line.notes) {
            note.get_click_effect = function (w, h) {
                const pars = new Array(4).fill(0).map(() => {
                    const rotate = Math.random() * 360;
                    const s = w / 4040 * 3;
                    const size = s * 33 * 0.75;
                    const r = s * (Math.random() * (265 - 185) + 185);
                    return p => {
                        return [ rotate, size, r * (9 * p / (8 * p + 1)) ];
                    };
                });
                this.get_click_effect = () => [ pars, t => {
                    let [ lineRotate, lineX, lineY, _ ] = line.get_state(t);
                    const pos = rotate_point(
                        lineX * w, lineY * h,
                        this.positionX * C.units.pgrw * w,
                        lineRotate
                    );
                    return pos;
                } ];
                return this.get_click_effect();
            };

            C.chart.data.click_effect_collection.push([ note, note.sect ]);

            if (note.is_hold) {
                const dt = 30 / line.bpm;
                let st = note.sect + dt;
                while (st < note.hold_end_time) {
                    C.chart.data.click_effect_collection.push([ note, st ]);
                    st += dt;
                }
            }
        }
    }

    C.chart.data.click_effect_collection.sort((a, b) => a[1] - b[1]);

    window.onresize = () => {
        resize_canvas();
    };

    console.log(C);

    set_progress("加载完成");
    document.querySelector("#loading-screen").classList.add("hidden");
    document.querySelector("#start-screen").classList.remove("hidden");

    document.querySelector("#start-button").onclick = () => {
        document.querySelector("#start-screen").classList.add("hidden");

        if (actx.state === "suspended") {
            actx.resume().catch(e => console.warn("音频恢复失败", e));
        }

        C.chart.music.play().catch(e => console.warn("音乐播放失败", e));
        render();
    };
};

window.onload = () => {
    load_game().catch(e => {
        console.error(e);

        const text = document.querySelector("#loading-text");

        if (text) {
            text.style.color = "#ff5566";
            text.textContent = "加载失败：" + (e && e.message ? e.message : e);
        }
    });
};