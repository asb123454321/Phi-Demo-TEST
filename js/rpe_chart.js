// ============================================================
// 原生 RPE 谱面解析器
//
// 直接从 RPE JSON（RPEVersion + BPMList + eventLayers）解析，
// 输出本模拟器内部使用的结构，不经过「转官方 v3」。
//
// 输出结构与官方 v3 对齐（模拟器 init 阶段直接消费）：
//   line.bpm
//   line.speedEvents            [{ startTime, endTime, value }]        单位=拍×32
//   line.judgeLineMoveEvents    [{ startTime, endTime, start, end, start2, end2 }]
//   line.judgeLineRotateEvents  [{ startTime, endTime, start, end }]
//   line.judgeLineDisappearEvents [{ startTime, endTime, start, end }]  0..1
//   line.notesAbove / line.notesBelow  [{ type, time, positionX, holdTime, speed }]
//
// RPE 原始字段对照：
//   BPMList[i]        { bpm, startTime:[整数,分子,分母] }
//   eventLayers[]     { moveXEvents, moveYEvents, rotateEvents, alphaEvents, speedEvents }
//   事件              { startTime, endTime, start, end, easingType, easingLeft, easingRight, linkgroup }
//   notes             { type, startTime, endTime, positionX, speed, above(1/2), isFake, size, ... }
//   type: 1=Tap 2=Hold 3=Flick 4=Drag（官方 v3 是 1=Tap 2=Drag 3=Hold 4=Flick，必须换）
//   above: 1=上半 2=下半
// ============================================================

(function () {
    "use strict";

    // ---------- 拍号 [整数, 分子, 分母] → 浮点拍 ----------
    const beat_of = (b) => {
        if (typeof b === "number") return b;
        if (!Array.isArray(b) || b.length < 3) return 0;

        const den = Number(b[2]) || 1;

        return Number(b[0]) + Number(b[1]) / den;
    };

    // ---------- 缓动：把 RPE 的 easingType 转成采样函数 ----------
    //   RPE 用 Unity 的缓动编号（1..29），这里只要够画就行。
    //   为了不引入一整张表，直接用「分段线性烘焙」：
    //   把带缓动的长事件拆成若干小段线性事件，模拟器只做线性插值也不会错。
    const ease_raw = (n, t) => {
        const p = Math.max(0, Math.min(1, t));

        switch (n) {
            case 1: return p;                                   // Linear
            case 2: return p * p;                               // InQuad
            case 3: return 1 - (1 - p) * (1 - p);               // OutQuad
            case 4: return p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p);  // InOutQuad
            case 5: return p * p * p;                           // InCubic
            case 6: return 1 - Math.pow(1 - p, 3);              // OutCubic
            case 7: return p < 0.5 ? 4 * p * p * p : 1 - 4 * Math.pow(1 - p, 3);
            case 8: return p * p * p * p;                       // InQuart
            case 9: return 1 - Math.pow(1 - p, 4);              // OutQuart
            case 10: return p < 0.5 ? 8 * Math.pow(p, 4) : 1 - 8 * Math.pow(1 - p, 4);
            case 11: return 1 - Math.cos((p * Math.PI) / 2);    // InSine
            case 12: return Math.sin((p * Math.PI) / 2);        // OutSine
            case 13: return (1 - Math.cos(Math.PI * p)) / 2;    // InOutSine
            case 14: return Math.pow(2, 10 * (p - 1));          // InExpo
            case 15: return 1 - Math.pow(2, -10 * p);           // OutExpo
            case 16: return p < 0.5
                ? Math.pow(2, 10 * (2 * p - 1)) / 2
                : (2 - Math.pow(2, -10 * (2 * p - 1))) / 2;
            case 17: return 1 - Math.sqrt(1 - p * p);           // InCirc
            case 18: return Math.sqrt(1 - (1 - p) * (1 - p));   // OutCirc
            case 19: return p < 0.5
                ? (1 - Math.sqrt(1 - 4 * p * p)) / 2
                : (Math.sqrt(1 - 4 * (p - 1) * (p - 1)) + 1) / 2;
            case 20: {                                          // InBack
                const c = 1.70158;

                return p * p * ((c + 1) * p - c);
            }
            case 21: {                                          // OutBack
                const c = 1.70158;

                return 1 + (p - 1) * (p - 1) * ((c + 1) * (p - 1) + c);
            }
            case 22: {                                          // InOutBack
                const c = 1.70158 * 1.525;

                return p < 0.5
                    ? (Math.pow(2 * p, 2) * ((c + 1) * 2 * p - c)) / 2
                    : (Math.pow(2 * p - 2, 2) * ((c + 1) * (2 * p - 2) + c) + 2) / 2;
            }
            case 23: {                                          // InElastic
                if (p === 0 || p === 1) return p;

                return -Math.pow(2, 10 * (p - 1)) * Math.sin((p - 1.1) * 5 * Math.PI);
            }
            case 24: {                                          // OutElastic
                if (p === 0 || p === 1) return p;

                return Math.pow(2, -10 * p) * Math.sin((p - 0.1) * 5 * Math.PI) + 1;
            }
            case 25: return p < 0.5 ? 0 : 1;                    // Step
            case 26: {                                          // InBounce
                const n1 = 7.5625, d1 = 2.75;

                if (p < 1 / d1) return n1 * p * p;
                if (p < 2 / d1) return n1 * (p -= 1.5 / d1) * p + 0.75;
                if (p < 2.5 / d1) return n1 * (p -= 2.25 / d1) * p + 0.9375;

                return n1 * (p -= 2.625 / d1) * p + 0.984375;
            }
            case 27: return 1 - ease_raw(26, 1 - p);            // OutBounce
            case 28: return p < 0.5
                ? ease_raw(26, p * 2) / 2
                : 1 - ease_raw(26, (1 - p) * 2) / 2;            // InOutBounce
            default: return p;
        }
    };

    // easingLeft / easingRight：Unity 的缓动区间裁剪
    const ease_at = (type, p, left, right) => {
        if (type === 1 || type === 0) return p;

        const l = Number.isFinite(left) ? left : 0;
        const r = Number.isFinite(right) ? right : 1;
        const lo = ease_raw(type, l);
        const hi = ease_raw(type, r);
        const v = ease_raw(type, l + (r - l) * Math.max(0, Math.min(1, p)));
        const span = hi - lo;

        return Math.abs(span) < 1e-9 ? p : (v - lo) / span;
    };

    // ---------- 把带缓动的事件烘焙成小段线性事件 ----------
    //   segments：把 [startTime, endTime] 切成多少段（越大越精确）
    const SEGMENTS = 12;

    const bake = (evs, map_value) => {
        const out = [];

        for (const e of evs) {
            const t0 = e.t0, t1 = e.t1;
            const type = e.easingType ?? 1;
            const left = e.easingLeft, right = e.easingRight;
            const v0 = map_value(e, "start");
            const v1 = map_value(e, "end");

            // 无缓动 / 零长度 → 单段
            if (type === 1 || !(t1 > t0) || Math.abs(v1 - v0) < 1e-9) {
                out.push({ t0: t0, t1: t1, v0: v0, v1: v1 });
                continue;
            }

            let prev_t = t0;
            let prev_v = v0;

            for (let i = 1; i <= SEGMENTS; i++) {
                const p = i / SEGMENTS;
                const tt = t0 + (t1 - t0) * p;
                const vv = v0 + (v1 - v0) * ease_at(type, p, left, right);

                out.push({ t0: prev_t, t1: tt, v0: prev_v, v1: vv });

                prev_t = tt;
                prev_v = vv;
            }
        }

        return out;
    };

    // 烘焙结果 → 模拟器要的 { startTime, endTime, start, end, ... }
    const to_official_events = (baked, extra_keys) => {
        const out = [];

        for (const b of baked) {
            const ev = {
                startTime: b.t0,
                endTime: b.t1,
                start: b.v0,
                end: b.v1
            };

            if (extra_keys) Object.assign(ev, extra_keys(b));

            out.push(ev);
        }

        return out;
    };

    // ============================================================
    // 主解析
    // ============================================================
    function parse_rpe(json) {
        const data = typeof json === "string" ? JSON.parse(json) : json;
        const meta = data.META || {};
        const warnings = [];

        // ---- BPM 表：算出「拍 → 秒」的分段映射 ----
        const raw_bpm = Array.isArray(data.BPMList) ? data.BPMList : [];

        const bpm_list = (raw_bpm.length ? raw_bpm : [{ bpm: 120, startTime: [0, 0, 1] }])
            .filter(b => b && typeof b === "object")
            .map(b => ({ beat: beat_of(b.startTime), bpm: Number(b.bpm) || 120 }))
            .sort((a, b) => a.beat - b.beat);

        if (!bpm_list.length) bpm_list.push({ beat: 0, bpm: 120 });

        const base_bpm = bpm_list[0]?.bpm || 120;

        // 拍 → 秒
        const beat_to_sec = (beat) => {
            let sec = 0;
            let prev_beat = 0;
            let prev_bpm = base_bpm;

            for (const b of bpm_list) {
                if (beat <= b.beat) break;

                sec += (b.beat - prev_beat) * 60 / prev_bpm;
                prev_beat = b.beat;
                prev_bpm = b.bpm;
            }

            return sec + (beat - prev_beat) * 60 / prev_bpm;
        };

        // 秒 → 拍（模拟器需要的是「拍」，所以反过来用）
        const sec_to_beat = (sec) => {
            let acc = 0;
            let prev_beat = 0;
            let prev_bpm = base_bpm;

            for (const b of bpm_list) {
                const seg = (b.beat - prev_beat) * 60 / prev_bpm;

                if (sec <= acc + seg) return prev_beat + (sec - acc) * prev_bpm / 60;

                acc += seg;
                prev_beat = b.beat;
                prev_bpm = b.bpm;
            }

            return prev_beat + (sec - acc) * prev_bpm / 60;
        };

        // 时间单位换算：模拟器内部用「秒」，事件表用「拍」。
        // 这里统一把 RPE 的拍直接当「拍」用（不转秒），
        // 因为模拟器的 sec2beat 会按 line.bpm 自己算。
        // 但 BPM 变速时 line.bpm 是固定值，所以必须把「拍 → 该线 bpm 下的等效拍」。

        const lines = [];

        (Array.isArray(data.judgeLineList) ? data.judgeLineList : []).forEach((src_line, index) => {
            if (!src_line || typeof src_line !== "object") return;
            const bpmfactor = Number(src_line.bpmfactor) || 1;
            const line_bpm = base_bpm * bpmfactor;

            // ---- 收集该线所有 eventLayer 的事件，按通道合并 ----
            const ch = {
                moveX: [], moveY: [], rotate: [], alpha: [], speed: []
            };

            const layers = Array.isArray(src_line.eventLayers) ? src_line.eventLayers : [];

            for (const layer of layers) {
                if (!layer) continue;

                const push = (arr, list, mapper) => {
                    if (!Array.isArray(list)) return;

                    for (const j of list) {
                        if (!j || typeof j !== "object") continue;

                        const t0 = beat_of(j.startTime), t1 = beat_of(j.endTime);

                        arr.push({
                            t0: t0, t1: t1,
                            s: Number(j.start), e: Number(j.end),
                            easingType: j.easingType ?? 1,
                            easingLeft: j.easingLeft,
                            easingRight: j.easingRight,
                            mapper: mapper
                        });
                    }
                };

                push(ch.moveX, layer.moveXEvents, src_line => 0);
                push(ch.moveY, layer.moveYEvents, src_line => 0);
                push(ch.rotate, layer.rotateEvents, src_line => 0);
                push(ch.alpha, layer.alphaEvents, src_line => 0);
                push(ch.speed, layer.speedEvents, src_line => 0);
            }

            // 全部按开始时间排序
            for (const k in ch) ch[k].sort((a, b) => a.t0 - b.t0);

            // ---- 拍 → 模拟器拍（×32，和官方 v3 一致） ----
            //   模拟器：line.sec2beat(t) = t / (pgrbeat / bpm)，pgrbeat = 60/32
            //   → 拍(模拟器) = 秒 / (60/32/bpm) = 秒 × bpm × 32 / 60
            //   RPE 的「拍」是音乐拍，需要先转成秒再转模拟器拍。
            const to_sim_beat = (rpe_beat) => {
                const sec = beat_to_sec(rpe_beat);

                return sec * line_bpm * 32 / 60;
            };

            // ---- 各通道 → 官方 v3 事件 ----
            const mk_linear = (list, keyStart, keyEnd) => {
                // 把带缓动的段烘焙后转成 { startTime, endTime, start, end }
                const baked = [];

                for (const e of list) {
                    const t0 = to_sim_beat(e.t0);
                    const t1 = to_sim_beat(e.t1);
                    const type = e.easingType;

                    if (type === 1 || !(t1 > t0)) {
                        baked.push({ t0: t0, t1: t1, v0: e.s, v1: e.e });
                        continue;
                    }

                    let prev_t = t0, prev_v = e.s;

                    for (let i = 1; i <= SEGMENTS; i++) {
                        const p = i / SEGMENTS;
                        const tt = t0 + (t1 - t0) * p;
                        const vv = e.s + (e.e - e.s) * ease_at(type, p, e.easingLeft, e.easingRight);

                        baked.push({ t0: prev_t, t1: tt, v0: prev_v, v1: vv });
                        prev_t = tt;
                        prev_v = vv;
                    }
                }

                return baked;
            };

            // 叠一条线：保证时间从 0 覆盖到 +inf（模拟器 find_event 需要）
            //   【重要】speedEvents 的前置段必须 value=0，
            //   否则 init_speed_events 会把 floorPosition 抬高到上百万，
            //   所有音符被判定为「离屏」而剔除 → 画面全空。
            const clamp_chain = (evs, fallback, is_speed = false) => {
                if (!evs.length) {
                    return [{ startTime: 0, endTime: 1000000000, start: fallback, end: fallback }];
                }

                const out = [];

                if (evs[0].startTime > 0) {
                    out.push({
                        startTime: 0, endTime: evs[0].startTime,
                        start: is_speed ? 0 : evs[0].start, end: evs[0].start
                    });
                }

                for (const e of evs) out.push(e);

                const last = out[out.length - 1];

                if (last.endTime < 1000000000) {
                    out.push({
                        startTime: last.endTime, endTime: 1000000000,
                        start: is_speed ? 0 : last.end, end: last.end
                    });
                }

                return out;
            };

            const bx = mk_linear(ch.moveX);
            const by = mk_linear(ch.moveY);
            const br = mk_linear(ch.rotate);
            const ba = mk_linear(ch.alpha);
            const bs = mk_linear(ch.speed);

            // move：X 用 start/end，Y 用 start2/end2
            //   RPE 的 moveX 是 -1..1 → 官方 v3 是 0..1，需要 +1)/2
            const move_x = clamp_chain(bx.map(e => ({
                startTime: e.t0, endTime: e.t1,
                start: (e.v0 + 1) / 2, end: (e.v1 + 1) / 2
            })));

            //   RPE 的 moveY 也是 -1..1 → 官方 v3 的 y 是 0..1（渲染时取 1-y）
            const move_y = clamp_chain(by.map(e => ({
                startTime: e.t0, endTime: e.t1,
                start: (e.v0 + 1) / 2, end: (e.v1 + 1) / 2
            })));

            // 把 X 和 Y 合并到同一张表
            const move_events = [];
            const nm = Math.max(move_x.length, move_y.length);

            for (let i = 0; i < nm; i++) {
                const ex = move_x[Math.min(i, move_x.length - 1)];
                const ey = move_y[Math.min(i, move_y.length - 1)];

                move_events.push({
                    startTime: ex.startTime,
                    endTime: ex.endTime,
                    start: ex.start,
                    end: ex.end,
                    start2: ey.start2 !== undefined ? ey.start2 : ey.start,
                    end2: ey.end2 !== undefined ? ey.end2 : ey.end
                });
            }

            // rotate：RPE 角度 → 官方 v3（模拟器里 get_state 会再 ×-1）
            const rotate_events = clamp_chain(br.map(e => ({
                startTime: e.t0, endTime: e.t1, start: e.v0, end: e.v1
            })));

            // alpha：RPE 是 0..255 → 官方 v3 是 0..1
            const alpha_events = clamp_chain(ba.map(e => ({
                startTime: e.t0, endTime: e.t1,
                start: e.v0 / 255, end: e.v1 / 255
            })));

            // speed：RPE 的 value 与官方 v3 同量级（0~10），直接用。
            //   早期转换器乘了 11/45，会把速度压到 24%，floorPosition 全错、音符飞出画面。
            const speed_events = clamp_chain(bs.map(e => ({
                startTime: e.t0, endTime: e.t1,
                start: e.v0, end: e.v1
            })), 1.0, true);

            // speed 用 value 字段（模拟器读 e.value）
            const final_speed = speed_events.map(e => ({
                startTime: e.startTime,
                endTime: e.endTime,
                value: e.start
            }));

            // ---- 音符 ----
            const notes_above = [];
            const notes_below = [];

            for (const n of (Array.isArray(src_line.notes) ? src_line.notes : [])) {
                if (!n || typeof n !== "object") continue;

                // RPE: 1=Tap 2=Hold 3=Flick 4=Drag
                // 官方: 1=Tap 2=Drag 3=Hold 4=Flick
                const type = ({ 1: 1, 2: 3, 3: 4, 4: 2 })[Number(n.type)] ?? 1;

                const t0 = to_sim_beat(beat_of(n.startTime));
                const t1 = to_sim_beat(beat_of(n.endTime));

                const note = {
                    type: type,
                    time: t0,
                    positionX: Number(n.positionX) / 75.375,
                    holdTime: Math.max(0, t1 - t0),
                    speed: Number(n.speed) || 1,
                    isFake: Number(n.isFake) || 0
                };

                if (Number(n.above) === 2) notes_below.push(note);
                else notes_above.push(note);
            }

            lines.push({
                bpm: line_bpm,
                speedEvents: final_speed,
                judgeLineMoveEvents: move_events,
                judgeLineRotateEvents: rotate_events,
                judgeLineDisappearEvents: alpha_events,
                notesAbove: notes_above,
                notesBelow: notes_below,
                // RPE 里线可能被隐藏
                Texture: src_line.Texture ?? "line.png",
                Name: src_line.Name ?? ("Line " + (index + 1))
            });
        });

        return {
            formatVersion: 3,          // 让上层走官方路径
            offset: (Number(meta.offset) || 0) / 1000,
            judgeLineList: lines,
            __from_rpe: true,
            __import_info: {
                Name: meta.name,
                Artist: meta.composer,
                Charter: meta.charter,
                Level: meta.level,
                Music: meta.song,
                Image: meta.background
            },
            __import_warnings: warnings
        };
    }

    window.RpeChart = {
        parse: parse_rpe,
        beat_of: beat_of
    };
    window.__rpe_chart_loaded = true;
})();
