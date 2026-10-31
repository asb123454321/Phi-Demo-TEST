// PEC → Phigros chart.json，严格按 Phira 的 prpr/src/parse/pec.rs 语义
// 单位：
//   音符 x   : pec_x / 115.2               (pgr.rs: positionX * 0.1125，pec.rs: /1024，115.2=0.1125*1024)
//   判定线 x : pec_x / 2048                (pec.rs: /2048*2-1；pgr.rs: -1+v*2)
//   判定线 y : pec_y / 1400
//   时间     : beat × 60/bpm = 秒 → pgr time = 秒 / (60/32/bpm) = beat × 32
//   旋转     : -pec_value
//   透明度   : pec_value / 255
//   线速     : pec_value / 5.85
//   offset   : 首行/1000 - 0.15
//   #        : 覆盖 note.speed；Hold 在 pgr 里 speed 恒为 1
(function (global) {
    const PEC_W = 2048, PEC_H = 1400, SPEED_DIV = 5.85, NOTE_X = 115.2;
    const FIXED_OFFSET = 0.15;

    function parse(pec) {
        const tokens = String(pec).replace(/^\uFEFF/, "").split(/\s+/).filter(Boolean);
        let p = 0;

        const offset_ms = Number(tokens[p++]) || 0;
        const offset_sec = offset_ms / 1000 - FIXED_OFFSET;

        // ---- 第一遍：收集 bp ----
        const bpm_list = [];
        // 第二遍才解析其余（bpm 必须在前面）
        const lines = [];      // {speed:[], moveX:[], moveY:[], rot:[], alpha:[], notes:[]}
        const getLine = id => {
            while (lines.length <= id) lines.push({ speed: [], moveX: [], moveY: [], rot: [], alpha: [], notes: [] });
            return lines[id];
        };

        // 先把 bp 全部扫出来（PEC 允许 bp 在前，稳妥起见先整体收集）
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i] === "bp") bpm_list.push({ time: Number(tokens[i + 1]) || 0, bpm: Number(tokens[i + 2]) || 120 });
        }
        bpm_list.sort((a, b) => a.time - b.time);
        const base_bpm = bpm_list.length ? bpm_list[0].bpm : 120;

        const beatToSec = beat => {
            if (!bpm_list.length) return beat * 60 / base_bpm;
            let acc = 0;
            for (let i = 0; i < bpm_list.length; i++) {
                const s = bpm_list[i].time, e = (i + 1 < bpm_list.length) ? bpm_list[i + 1].time : Infinity;
                if (beat <= s) return acc;
                const seg = Math.min(beat, e) - s;
                acc += seg * 60 / bpm_list[i].bpm;
                if (beat <= e) return acc;
            }
            return acc;
        };
        const toPgrTime = beat => Math.round(beatToSec(beat) / (60 / 32 / base_bpm));

        let last_note = null;
        let last_line = null;

        while (p < tokens.length) {
            const cmd = tokens[p++];
            if (cmd === "bp") { p += 2; continue; }

            // 音符
            if (/^n[1-4]$/.test(cmd)) {
                const id = Number(tokens[p++]);
                const line = getLine(id);
                last_line = id;
                const t1 = Number(tokens[p++]);
                let t2 = t1;
                if (cmd === "n2") t2 = Number(tokens[p++]);
                const x = Number(tokens[p++]);
                const above = Number(tokens[p++]) === 1;
                const fake = Number(tokens[p++]) !== 0;
                const note = {
                    type: Number(cmd[1]),
                    time: toPgrTime(t1),
                    holdTime: cmd === "n2" ? toPgrTime(t2) - toPgrTime(t1) : 0,
                    positionX: x / NOTE_X,
                    speed: 1,
                    above, fake
                };
                // # 和 &（可能紧随其后，也可能在下一行，token 流已扁平化）
                if (tokens[p] === "#") { p++; note.speed = Number(tokens[p++]); }
                if (tokens[p] === "&") { p++; p++; }
                line.notes.push(note);
                last_note = note;
                continue;
            }

            // 线条指令
            if (cmd[0] === "c") {
                const ty = cmd[1];
                const id = Number(tokens[p++]);
                const line = getLine(id);
                const t1 = Number(tokens[p++]);
                const T1 = toPgrTime(t1);

                if (ty === "v") {
                    line.speed.push({ t: T1, v: Number(tokens[p++]) / SPEED_DIV });
                } else if (ty === "p") {
                    line.moveX.push({ t: T1, v: Number(tokens[p++]) / PEC_W });
                    line.moveY.push({ t: T1, v: Number(tokens[p++]) / PEC_H });
                } else if (ty === "d") {
                    line.rot.push({ t: T1, v: -Number(tokens[p++]) });
                } else if (ty === "a") {
                    line.alpha.push({ t: T1, v: Number(tokens[p++]) / 255 });
                } else if (ty === "m") {
                    const t2 = toPgrTime(Number(tokens[p++]));
                    const x = Number(tokens[p++]) / PEC_W, y = Number(tokens[p++]) / PEC_H;
                    p++;   // tween
                    line.moveX.push({ t: T1, t2, v: x, interp: true });
                    line.moveY.push({ t: T1, t2, v: y, interp: true });
                } else if (ty === "r") {
                    const t2 = toPgrTime(Number(tokens[p++]));
                    const r = -Number(tokens[p++]);
                    p++;   // tween
                    line.rot.push({ t: T1, t2, v: r, interp: true });
                } else if (ty === "f") {
                    const t2 = toPgrTime(Number(tokens[p++]));
                    const a = Number(tokens[p++]) / 255;   // 注意：cf 没有 tween
                    line.alpha.push({ t: T1, t2, v: a, interp: true });
                } else {
                    throw new Error("未知指令: " + cmd);
                }
                continue;
            }
            throw new Error("未知指令: " + cmd);
        }

        // ---- 事件流 → Phigros 的 [start,end] 事件对 ----
        // PEC 的 cp/cd/ca 是「该时刻起保持」，cm/cr/cf 是「渐变到该值」。
        // Phigros 用 (start,end,start,end) 区间描述，需要把「保持」段补齐。
        const buildEvents = (evs, def) => {
            const out = [];
            let cur = def;
            let cur_t = 0;
            for (const e of evs) {
                if (e.t > cur_t) out.push({ startTime: cur_t, endTime: e.t, start: cur, end: cur });
                if (e.interp) {
                    out.push({ startTime: e.t, endTime: Math.max(e.t, e.t2), start: cur, end: e.v });
                    cur = e.v;
                    cur_t = Math.max(e.t, e.t2);
                } else {
                    out.push({ startTime: e.t, endTime: e.t, start: e.v, end: e.v });
                    cur = e.v;
                    cur_t = e.t;
                }
            }
            if (out.length === 0) out.push({ startTime: 0, endTime: 1e9, start: def, end: def });
            return out;
        };

        const judgeLineList = lines.map(L => {
            const mv = buildEvents(L.moveX, 0.5);
            const mvy = buildEvents(L.moveY, 0.5);
            const rt = buildEvents(L.rot, 0);
            const al = buildEvents(L.alpha, 1);

            // 速度事件（floorPosition 由 json 解析时重算，这里给 0）
            const speedEvents = L.speed.length
                ? L.speed.map((e, i) => ({
                    startTime: e.t,
                    endTime: i + 1 < L.speed.length ? L.speed[i + 1].t : 1e9,
                    value: e.v,
                    floorPosition: 0
                }))
                : [{ startTime: 0, endTime: 1e9, value: 1, floorPosition: 0 }];

            // 合并 xy
            const moveEvents = [];
            for (let i = 0; i < Math.min(mv.length, mvy.length); i++) {
                moveEvents.push({
                    startTime: mv[i].startTime, endTime: mv[i].endTime,
                    start: mv[i].start, end: mv[i].end,
                    start2: mvy[i].start, end2: mvy[i].end
                });
            }

            const above = L.notes.filter(n => n.above).map(n => ({
                type: n.type, time: n.time, positionX: n.positionX,
                holdTime: n.holdTime, speed: n.speed, floorPosition: 0
            }));
            const below = L.notes.filter(n => !n.above).map(n => ({
                type: n.type, time: n.time, positionX: n.positionX,
                holdTime: n.holdTime, speed: n.speed, floorPosition: 0
            }));

            return {
                bpm: base_bpm,
                speedEvents,
                notesAbove: above,
                notesBelow: below,
                judgeLineDisappearEvents: al.map(e => ({ startTime: e.startTime, endTime: e.endTime, start: e.start, end: e.end, start2: 0, end2: 0 })),
                judgeLineMoveEvents: moveEvents,
                judgeLineRotateEvents: rt.map(e => ({ startTime: e.startTime, endTime: e.endTime, start: e.start, end: e.end, start2: 0, end2: 0 }))
            };
        });

        return {
            formatVersion: 3,
            offset: offset_sec,
            numOfNotes: judgeLineList.reduce((s, l) => s + l.notesAbove.length + l.notesBelow.length, 0),
            judgeLineList
        };
    }

    global.PEC2JSON_PHIRA = { parse };
})(typeof window !== "undefined" ? window : globalThis);
