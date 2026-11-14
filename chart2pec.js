/* ============================================================
 * chart2pec.js —— Phigros chart.json → Phira PEC
 *
 * 全部系数严格对齐 Phira 的 Rust 解析器：
 *   PhiraiAd-1.5.2/prpr/src/parse/pec.rs
 *   PhiraiAd-1.5.2/prpr/src/parse/pgr.rs
 *   PhiraiAd-1.5.2/prpr/src/core.rs
 *
 * 用法：
 *   Chart2PEC.convert(chartObj, { withLines: true })  → 字符串
 * ============================================================ */
(function (global) {
    "use strict";

    // ---------- PEC 指令参数（严格按 take_* 顺序） ----------
    //   cp  line time x y
    //   cm  line t1 t2 x y tween          （只给终点）
    //   cd  line time rot
    //   cr  line t1 t2 rot tween          （只给终点）
    //   ca  line time alpha
    //   cf  line t1 t2 alpha              （没有 tween！）
    //   cv  line time speed
    //   n*  line time [t2] x above fake
    const PEC_W = 2048;
    const PEC_H = 1400;
    const PGROW = 32;                 // 1 PEC 拍 = 32 个 pgr time 单位
    const NOTE_X = 0.1125 * 1024;     // = 115.2（pgr.rs: positionX × 0.1125；pec.rs: /1024）
    const HEIGHT_RATIO = 0.83175;     // prpr/src/core.rs
    const SPEED_SCALE = 5.85 / HEIGHT_RATIO;   // ≈ 7.0334（不是 5.85！）
    const FIXED_OFFSET = 0.15;        // offset = 首行/1000 - 0.15

    const TAG = { 1: "n1", 2: "n4", 3: "n2", 4: "n3" };   // json type → PEC 指令

    const num = (v, d = 3) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return "0";
        const s = n.toFixed(d).replace(/\.?0+$/, "");
        return (s === "" || s === "-0") ? "0" : s;
    };

    // pgr time → PEC 拍
    const beat = t => num(Number(t) / PGROW, 3);

    const isOK = e => Number(e.endTime ?? e.startTime) > 0;

    // 官方谱有 startTime = -999999 的占位事件（记录 t=0 前的状态）。
    // 丢掉会丢初值；换成负数拍会让解析器错位。所以夹到 0，保留 endTime。
    const clip = e => {
        const st = Math.max(0, Number(e.startTime));
        const en = Math.max(st, Number(e.endTime ?? e.startTime));
        return Object.assign({}, e, { startTime: st, endTime: en });
    };

    const evs = (list) => (list || []).filter(isOK).map(clip);

    /**
     * 生成一条判定线的全部指令
     * @returns {string[]}
     */
    function lineCommands(line, idx) {
        const out = [];
        const px = v => Number((Number(v) * PEC_W).toFixed(2));
        const py = v => Number((Number(v) * PEC_H).toFixed(2));

        // ---- 位移 ----
        // cm 只给终点，起点 = 上一帧。所以「起点 ≠ 上一段终点」时要先补 cp 瞬移。
        let lx = null, ly = null;
        for (const e of evs(line.judgeLineMoveEvents)) {
            const x1 = px(e.start), y1 = py(e.start2 ?? 0.5);
            const x2 = px(e.end ?? e.start), y2 = py(e.end2 ?? e.start2 ?? 0.5);

            if (lx === null || x1 !== lx || y1 !== ly) {
                out.push(`cp ${idx} ${beat(e.startTime)} ${x1} ${y1}`);
                lx = x1; ly = y1;
            }
            if (x1 === x2 && y1 === y2) {
                if (lx !== x2 || ly !== y2) {
                    out.push(`cp ${idx} ${beat(e.startTime)} ${x2} ${y2}`);
                    lx = x2; ly = y2;
                }
            } else {
                out.push(`cm ${idx} ${beat(e.startTime)} ${beat(e.endTime)} ${x2} ${y2} 1`);
                lx = x2; ly = y2;
            }
        }

        // ---- 旋转（取负）----
        let lr = null;
        for (const e of evs(line.judgeLineRotateEvents)) {
            const r1 = num(-(e.start ?? 0), 3);
            const r2 = num(-(e.end ?? e.start ?? 0), 3);

            if (lr === null || r1 !== lr) {
                out.push(`cd ${idx} ${beat(e.startTime)} ${r1}`);
                lr = r1;
            }
            if (r1 === r2) {
                if (lr !== r2) {
                    out.push(`cd ${idx} ${beat(e.startTime)} ${r2}`);
                    lr = r2;
                }
            } else {
                out.push(`cr ${idx} ${beat(e.startTime)} ${beat(e.endTime)} ${r2} 1`);
                lr = r2;
            }
        }

        // ---- 透明度（0~1 → 0~255）----
        let la = null;
        for (const e of evs(line.judgeLineDisappearEvents)) {
            const a1 = Math.round(Math.max(0, Math.min(1, Number(e.start ?? 0))) * 255);
            const a2 = Math.round(Math.max(0, Math.min(1, Number(e.end ?? e.start ?? 0))) * 255);

            if (la === null || a1 !== la) {
                out.push(`ca ${idx} ${beat(e.startTime)} ${a1}`);
                la = a1;
            }
            if (a1 === a2) {
                if (la !== a2) {
                    out.push(`ca ${idx} ${beat(e.startTime)} ${a2}`);
                    la = a2;
                }
            } else {
                out.push(`cf ${idx} ${beat(e.startTime)} ${beat(e.endTime)} ${a2}`);
                la = a2;
            }
        }

        // ---- 线速 ----
        for (const e of evs(line.speedEvents)) {
            out.push(`cv ${idx} ${beat(e.startTime)} ${num(Number(e.value ?? 0) * SPEED_SCALE, 4)}`);
        }

        return out;
    }

    /**
     * 整张谱 → PEC 文本
     * @param {object} chart  Phigros chart.json 对象
     * @param {object} [opt]
     * @param {boolean} [opt.withLines=true]  是否输出判定线指令
     * @param {boolean} [opt.withSpeed=true]  是否输出 cv
     * @param {boolean} [opt.holdSpeedOne=true] Hold 的 # 恒为 1（对齐 pgr.rs）
     * @returns {{ text: string, stats: object }}
     */
    function convert(chart, opt) {
        opt = opt || {};
        const withLines = opt.withLines !== false;
        const withSpeed = opt.withSpeed !== false;
        const holdSpeedOne = opt.holdSpeedOne !== false;

        if (!chart || !Array.isArray(chart.judgeLineList)) {
            throw new Error("不是有效的 chart.json（缺少 judgeLineList）");
        }

        const lines = chart.judgeLineList;
        const baseBpm = Number(lines[0]?.bpm) || 120;

        const head = [
            String(Math.round(((Number(chart.offset) || 0) + FIXED_OFFSET) * 1000)),
            `bp 0 ${num(baseBpm, 4)}`
        ];

        // ---- 判定线指令（必须在音符之前）----
        const lineOut = [];
        if (withLines) {
            lines.forEach((line, i) => {
                const cmds = lineCommands(line, i);
                for (const c of cmds) {
                    if (!withSpeed && c.startsWith("cv ")) continue;
                    lineOut.push(c);
                }
            });
        }

        // ---- 音符 ----
        const rows = [];
        let nAbove = 0, nBelow = 0, nHold = 0;

        lines.forEach((line, li) => {
            const all = [
                ...(line.notes || []),
                ...(line.notesAbove || []).map(n => Object.assign(n, { __above: true })),
                ...(line.notesBelow || []).map(n => Object.assign(n, { __above: false }))
            ];
            // line.notes 已合并时不会重复（merge_notes 后 notesAbove 被删了）
            const seen = new Set();
            for (const note of all) {
                if (seen.has(note)) continue;
                seen.add(note);

                const isAbove = note.__above !== undefined ? note.__above : (note.is_above !== false);
                const type = Number(note.type);
                const tag = TAG[type] || "n1";

                const t1 = beat(note.time);
                const x = num(Number(note.positionX) * NOTE_X, 2);
                const s = isAbove ? 1 : 2;

                let body;
                if (type === 3) {   // Hold
                    const t2 = beat(Number(note.time) + Number(note.holdTime ?? 0));
                    body = `${tag} ${li} ${t1} ${t2} ${x} ${s} 0`;
                    nHold++;
                } else {
                    body = `${tag} ${li} ${t1} ${x} ${s} 0`;
                }

                // pgr.rs: speed: if kind == 3 { 1. } else { speed }
                const sp = (type === 3 && holdSpeedOne) ? 1 : Number(note.speed ?? 1);

                rows.push({ t: Number(note.time) || 0, body: body + `\n# ${num(sp, 3)}\n& 1` });
                if (isAbove) nAbove++; else nBelow++;
            }
        });

        rows.sort((a, b) => a.t - b.t);

        const text = [...head, ...lineOut, ...rows.map(r => r.body)].join("\n") + "\n";

        return {
            text,
            stats: {
                lines: lines.length,
                notes: rows.length,
                notesAbove: nAbove,
                notesBelow: nBelow,
                holds: nHold,
                lineCommands: lineOut.length,
                bpm: baseBpm,
                chars: text.length
            }
        };
    }

    global.Chart2PEC = { convert, lineCommands, constants: { PEC_W, PEC_H, NOTE_X, HEIGHT_RATIO, SPEED_SCALE, FIXED_OFFSET } };
})(typeof window !== "undefined" ? window : globalThis);
