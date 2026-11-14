// ============================================================
// rpe-next 原生模块桥接
//
// 直接用 <script type="module"> 引入 rpe-next-main 的原始 ESM 模块，
// 不做任何改写。浏览器原生支持 ESM，所以可以原样引用。
//
// 提供两个能力：
//   1. parse()       —— rpe-next 原版解析 + 校验（保持 RPE 结构）
//   2. toSimulator() —— 把 RPE 结构转成本模拟器内部用的扁平事件表
// ============================================================

import { parseChart } from "./rpe_core/src/core/chart.mjs";
import { beatValue } from "./rpe_core/src/core/beat.mjs";
import { TempoMap } from "./rpe_core/src/core/tempo.mjs";
import { easing } from "./rpe_core/src/core/easing.mjs";

/**
 * 用 rpe-next 原版解析器读 RPE
 * @param {string|object} json
 * @returns {object} RPE 结构（eventLayers / 拍号数组）
 */
export function parseRpeNative(json) {
    const text = typeof json === "string" ? json : JSON.stringify(json);

    return parseChart(text);
}

/**
 * 把带缓动的事件烘焙成小段线性事件
 */
function bakeEvents(events, segments, mapValue) {
    const out = [];

    for (const e of events) {
        const t0 = beatValue(e.startTime);
        const t1 = beatValue(e.endTime);
        const v0 = mapValue(e.start);
        const v1 = mapValue(e.end);
        const type = e.easingType ?? 1;
        const left = e.easingLeft ?? 0;
        const right = e.easingRight ?? 1;

        if (type === 1 || !(t1 > t0) || Math.abs(v1 - v0) < 1e-9) {
            out.push({ t0, t1, v0, v1 });
            continue;
        }

        let prevT = t0;
        let prevV = v0;

        for (let i = 1; i <= segments; i++) {
            const p = i / segments;
            const tt = t0 + (t1 - t0) * p;

            // rpe-next 的签名：easing(进度, 类型, 左, 右) —— 内部已处理区间裁剪
            const vv = v0 + (v1 - v0) * easing(p, type, left, right);

            out.push({ t0: prevT, t1: tt, v0: prevV, v1: vv });
            prevT = tt;
            prevV = vv;
        }
    }

    return out;
}

/**
 * RPE 结构 → 模拟器能直接消费的扁平结构
 */
export function toSimulator(chart) {
    const tempo = new TempoMap(chart.BPMList);
    const baseBpm = chart.BPMList[0]?.bpm ?? 120;
    const SEGMENTS = 12;

    const judgeLineList = [];

    chart.judgeLineList.forEach((line, index) => {
        const bpmfactor = Number(line.bpmfactor) || 1;
        const lineBpm = baseBpm * bpmfactor;

        // RPE 拍 → 秒 → 模拟器拍
        const toSimBeat = (rpeBeat) => tempo.seconds(rpeBeat) * lineBpm * 32 / 60;

        // 合并所有 eventLayer 的同类事件
        const collect = (key) => {
            const all = [];

            for (const layer of line.eventLayers ?? []) {
                for (const e of layer?.[key] ?? []) all.push(e);
            }

            all.sort((a, b) => beatValue(a.startTime) - beatValue(b.startTime));

            return all;
        };

        const bake = (key, mapValue = v => v) =>
            bakeEvents(collect(key), SEGMENTS, mapValue).map(b => ({
                startTime: toSimBeat(b.t0),
                endTime: toSimBeat(b.t1),
                start: b.v0,
                end: b.v1
            }));

        // 补 ±∞ 覆盖
        //   【重要】speedEvents 的前置段必须 value=0：
        //   init_speed_events 会按 (endTime - startTime) * value 累加 floorPosition，
        //   如果前置段从 -999999 到 0、value 又非 0，就会把 floorPosition 抬高上百万，
        //   所有音符被判定为「离屏太远」而剔除 —— 表现就是画面全空。
        const chain = (evs, fallback, isSpeed = false) => {
            if (!evs.length) {
                return [{ startTime: 0, endTime: 1e9, start: fallback, end: fallback }];
            }

            const out = [];

            if (evs[0].startTime > 0) {
                out.push({
                    startTime: 0,
                    endTime: evs[0].startTime,
                    start: isSpeed ? 0 : evs[0].start,
                    end: evs[0].start
                });
            }

            out.push(...evs);

            const last = out[out.length - 1];

            if (last.endTime < 1e9) {
                out.push({
                    startTime: last.endTime,
                    endTime: 1e9,
                    start: isSpeed ? 0 : last.end,
                    end: last.end
                });
            }

            return out;
        };

        // moveX / moveY 都是 -1..1 → 0..1
        const mx = chain(bake("moveXEvents", v => (v + 1) / 2), 0.5);
        const my = chain(bake("moveYEvents", v => (v + 1) / 2), 0.5);
        const rot = chain(bake("rotateEvents"), 0);
        const alpha = chain(bake("alphaEvents", v => v / 255), 1);
        // speed：RPE 的 value 与官方 v3 同量级（0~10），直接用。
        //   早期转换器乘了 11/45，会把速度压到原来的 24%，floorPosition 全错、音符飞出画面。
        const speed = chain(bake("speedEvents"), 1.0, true);

        // X 与 Y 合并
        const move = [];
        const n = Math.max(mx.length, my.length);

        for (let i = 0; i < n; i++) {
            const ex = mx[Math.min(i, mx.length - 1)];
            const ey = my[Math.min(i, my.length - 1)];

            move.push({
                startTime: ex.startTime,
                endTime: ex.endTime,
                start: ex.start,
                end: ex.end,
                start2: ey.start,
                end2: ey.end
            });
        }

        // 音符
        const above = [];
        const below = [];

        for (const note of line.notes ?? []) {
            const type = ({ 1: 1, 2: 3, 3: 4, 4: 2 })[Number(note.type)] ?? 1;

            const t0 = toSimBeat(beatValue(note.startTime));
            const t1 = toSimBeat(beatValue(note.endTime));

            const item = {
                type,
                time: t0,
                positionX: Number(note.positionX) / 75.375,
                holdTime: Math.max(0, t1 - t0),
                speed: Number(note.speed) || 1,
                isFake: Number(note.isFake) || 0
            };

            if (Number(note.above) === 2) below.push(item);
            else above.push(item);
        }

        judgeLineList.push({
            bpm: lineBpm,
            speedEvents: speed.map(e => ({ startTime: e.startTime, endTime: e.endTime, value: e.start })),
            judgeLineMoveEvents: move,
            judgeLineRotateEvents: rot,
            judgeLineDisappearEvents: alpha,
            notesAbove: above,
            notesBelow: below,
            Name: line.Name ?? ("Line " + (index + 1)),
            Texture: line.Texture ?? "line.png"
        });
    });

    return {
        formatVersion: 3,
        offset: (Number(chart.META?.offset) || 0) / 1000,
        judgeLineList,
        __from_rpe: true,
        __rpe_native: true,
        __import_info: {
            Name: chart.META?.name,
            Artist: chart.META?.composer,
            Charter: chart.META?.charter,
            Level: chart.META?.level,
            Music: chart.META?.song,
            Image: chart.META?.background
        },
        __import_warnings: []
    };
}

/**
 * 一步到位：RPE JSON → 模拟器结构
 */
export function loadRpe(json) {
    return toSimulator(parseRpeNative(json));
}

window.RpeNative = {
    parse: parseRpeNative,
    toSimulator,
    load: loadRpe,
    ready: true
};

window.__rpe_native_loaded = true;

console.log("[RPE] rpe-next 原生模块已加载");
