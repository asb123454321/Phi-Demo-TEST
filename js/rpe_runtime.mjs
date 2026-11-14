// ============================================================
// rpe-next 运行时桥接
//   解析、校验、几何计算全部用 rpe-next 原版代码：
//     parseChart()      src/core/chart.mjs
//     TempoMap          src/core/tempo.mjs
//     LineRuntime       src/core/scene.mjs
//     previewViewport   src/core/editor-display.mjs
//   本文件只把它们组装成「按秒取画面」的运行时对象。
// ============================================================

import { parseChart } from "./rpe_core/src/core/chart.mjs";
import { TempoMap } from "./rpe_core/src/core/tempo.mjs";
import { LineRuntime } from "./rpe_core/src/core/scene.mjs";
import { previewViewport, previewNotePosition, previewPositionScale } from "./rpe_core/src/core/editor-display.mjs";

const toRad = deg => deg * Math.PI / 180;

class RpeRuntime {
    constructor(chart) {
        this.chart = chart;
        this.tempo = new TempoMap(chart.BPMList);

        this.lines = (chart.judgeLineList ?? []).map(line => ({
            line,
            runtime: new LineRuntime(line, this.tempo)
        }));

        this.order = this.lines
            .map((item, index) => index)
            .sort((a, b) => Number(this.lines[a].line.zOrder ?? 0) - Number(this.lines[b].line.zOrder ?? 0) || a - b);

        this.duration = 0;
        for (const item of this.lines) {
            for (const entry of item.runtime.notes) {
                if (Number.isFinite(entry.end)) this.duration = Math.max(this.duration, entry.end);
            }
        }

        this.noteCount = this.lines.reduce((sum, item) => sum + item.runtime.notes.length, 0);

        console.log("[RPE] 运行时编译完成：判定线", this.lines.length,
            "条，音符", this.noteCount, "个，时长", this.duration.toFixed(2), "秒");
    }

    frame(seconds, width, height) {
        const vp = previewViewport(width, height);
        const posScale = previewPositionScale(1.5);
        const originX = width / 2;
        const originY = height / 2;

        const out = [];

        for (const idx of this.order) {
            const { line, runtime } = this.lines[idx];
            const state = runtime.state(seconds);
            const rotation = toRad(state.rotation);
            const cos = Math.cos(rotation);
            const sin = Math.sin(rotation);

            const item = {
                kind: "line",
                state,
                rotation,
                screenX: originX + state.x * vp.scale,
                screenY: originY - state.y * vp.scale,
                notes: []
            };

            for (const entry of runtime.visibleNotes(seconds, state, 1600)) {
                const pos = previewNotePosition(runtime.noteState(entry, state, seconds), line, posScale);

                if (!(pos.alpha > 0) || pos.size === 0) continue;

                const worldX = state.x + pos.x * cos + pos.y * sin;
                const worldY = -state.y + pos.x * sin - pos.y * cos;

                const tail = entry.note.type === 2 && Number.isFinite(pos.tail) ? pos.tail : pos.y;
                const tailWorldX = state.x + pos.x * cos + tail * sin;
                const tailWorldY = -state.y + pos.x * sin - tail * cos;

                item.notes.push({
                    entry,
                    note: entry.note,
                    pos,
                    screenX: originX + worldX * vp.scale,
                    screenY: originY + worldY * vp.scale,
                    tailX: originX + tailWorldX * vp.scale,
                    tailY: originY + tailWorldY * vp.scale,
                    size: pos.size,
                    sizeY: pos.sizeY,
                    alpha: pos.alpha,
                    showHead: pos.showHead,
                    isHold: entry.note.type === 2
                });
            }

            out.push(item);
        }

        return { lines: out, scale: vp.scale };
    }
}

export function compile(json) {
    const text = typeof json === "string" ? json : JSON.stringify(json);

    return new RpeRuntime(parseChart(text));
}

window.RpeRuntime = { compile, isRuntime: true };
window.__rpe_runtime_loaded = true;

console.log("[RPE] rpe-next 运行时模块已加载");
