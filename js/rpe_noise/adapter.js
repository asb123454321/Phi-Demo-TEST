// ============================================================
// rpe NoiseSkin 适配层
//   把 rpe-next-main 的原版渲染器（noise-skin-renderer.js，未改逻辑）
//   接到本模板的噪域数据上。
//
// 数据映射：
//   area.isSubtract  → entry.area.isInvert
//   area.visible/fade → entry.state ('active' | 'ready' | 'disabled')
//   pose 四角（世界坐标）→ entry.points
//
// 组件：
//   - 加载 js/rpe_noise/skins/<Skin>/ 下的 config.json + glsl + tex
//   - 把文件读成 Map<相对路径, Uint8Array>（渲染器的 skin() 需要这种形式）
//   - 提供 render() 供 noise_render.js 调用
// ============================================================

(function () {
    "use strict";

    const SKIN_ROOT = "js/rpe_noise/skins/";

    const state = {
        renderer: null,
        assets: new Map(),      // 已加载的全部皮肤资源（按 skin 名索引）
        loading: new Set(),
        ready: new Set(),
        current: null,
        warned: new Set()
    };

    // ---------- 加载一个皮肤目录 ----------
    function load_skin(name) {
        if (state.assets.has(name) || state.loading.has(name)) return;

        state.loading.add(name);

        const files = new Map();
        const directory = SKIN_ROOT + name + "/";

        const add = (path) => fetch(directory + path)
            .then(r => {
                if (!r.ok) throw new Error("HTTP " + r.status + " " + directory + path);

                return r.arrayBuffer();
            })
            .then(buffer => {
                files.set(name + "/" + path, new Uint8Array(buffer));
            });

        // 先拿 config.json，再按 passes + textures 决定还要哪些文件
        fetch(directory + "config.json")
            .then(r => {
                if (!r.ok) throw new Error("HTTP " + r.status + " " + directory + "config.json");

                return r.json();
            })
            .then(config => {
                const need = new Set(["config.json", "main.glsl"]);

                for (const pass of config.passes || []) need.add(pass.shader);

                const readTexturePaths = (text) => {
                    const re = /uniform\s+sampler2D\s+\w+\s*;\s*\/\/\s*@texture\s+(\S+)/g;
                    let m;

                    while ((m = re.exec(text))) need.add(m[1]);
                };

                // 先把 main.glsl 之外的文件都排队，再单独读 glsl 找贴图路径
                const readAll = [];
                const textFiles = new Map();

                for (const path of need) {
                    readAll.push(fetch(directory + path)
                        .then(r => {
                            if (!r.ok) throw new Error("HTTP " + r.status + " " + directory + path);

                            return r.arrayBuffer();
                        })
                        .then(buf => {
                            const bytes = new Uint8Array(buf);

                            files.set(name + "/" + path, bytes);

                            if (path.endsWith(".glsl")) {
                                textFiles.set(path, new TextDecoder().decode(bytes));
                            }
                        }));
                }

                return Promise.all(readAll).then(() => {
                    // glsl 里的 @texture 贴图
                    const texPaths = new Set();

                    for (const text of textFiles.values()) {
                        const re = /uniform\s+sampler2D\s+\w+\s*;\s*\/\/\s*@texture\s+(\S+)/g;
                        let m;

                        while ((m = re.exec(text))) texPaths.add(m[1]);
                    }

                    return Promise.all([...texPaths].map(path => {
                        if (files.has(name + "/" + path)) return null;

                        return fetch(directory + path)
                            .then(r => {
                                if (!r.ok) throw new Error("HTTP " + r.status + " " + directory + path);

                                return r.arrayBuffer();
                            })
                            .then(buf => files.set(name + "/" + path, new Uint8Array(buf)));
                    }));
                });
            })
            .then(() => {
                state.assets.set(name, files);
                state.loading.delete(name);
                state.ready.add(name);
            })
            .catch(e => {
                state.loading.delete(name);
                console.error("[噪域] 皮肤 " + name + " 加载失败：", e);
            });
    }

    // ---------- 区域 → 渲染器需要的 entry ----------
    function area_state(area, t) {
        if (area.active && area.active(t)) return "active";
        if (area.ready && area.ready(t)) return "ready";

        return "disabled";
    }

    // 生成渲染器需要的 entry
    //   playW/playH：16:9 谱面画面尺寸（噪域几何的定义空间）
    //   输出点已换算到「整张画布」的像素坐标系
    function build_entries(areas, t, aspect, playW, playH) {
        const entries = [];

        for (let i = 0; i < areas.length; i++) {
            const area = areas[i];

            if (area.visible && !area.visible(t)) continue;

            const pose = area.pose(t, aspect);
            const ca = Math.cos(pose.angle), sa = Math.sin(pose.angle);
            const sx = pose.size[0], sy = pose.size[1];
            const cx = pose.center[0], cy = pose.center[1];

            // 局部四角 → 世界坐标（与 main.js 的 worldPoint 同一套单位）
            const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([ux, uy]) => {
                const lx = ux * sx, ly = uy * sy;

                return {
                    x: cx + (lx * ca - ly * sa),
                    y: cy + (lx * sa + ly * ca)
                };
            });

            entries.push({
                area: {
                    isInvert: !!area.isSubtract,
                    // 渲染器不用这个字段做逻辑，只是透传
                    raw: area
                },
                index: i,
                state: area_state(area, t),
                points: corners,
                scaleX: 1,
                scaleY: 1
            });
        }

        return entries;
    }

    // 中间画布（尺寸 = 画面 w×h，交给渲染器当 context.canvas）
    let stage = null, stage_ctx = null;

    // ---------- 初始化渲染器 ----------
    function ensure_renderer() {
        if (state.renderer) return state.renderer;

        // 取渲染器类：优先共享注册表（打包器重排也安全），再退回全局名
        const registry = window.__RPE_NOISE_REGISTRY__ || {};
        let RendererClass = null;

        if (typeof registry.Renderer === "function") RendererClass = registry.Renderer;
        else if (typeof window.NoiseSkinRenderer === "function") RendererClass = window.NoiseSkinRenderer;

        if (!RendererClass) {
            console.error(
                "[噪域] NoiseSkinRenderer 未定义：js/rpe_noise/noise-skin-renderer.js 没加载或执行失败\n" +
                "  诊断: parseNoiseSkin=" + (typeof parseNoiseSkin) +
                "  skinSize=" + (typeof skinSize) +
                "  noisePadding=" + (typeof noisePadding) +
                "  paddedNoiseShader=" + (typeof paddedNoiseShader) +
                "  registry=" + (window.__RPE_NOISE_REGISTRY__ ? Object.keys(window.__RPE_NOISE_REGISTRY__).join(",") || "空" : "无")
            );
            return null;
        }

        try {
            state.renderer = new RendererClass(
                () => {},                                  // invalidate
                (msg) => console.warn("[噪域] " + msg),    // report
                // overlay=false：皮肤自己产出完整的 16:9 画面帧，再整块贴回。
                //   由于 stage 是从主画布「已经画好的画面」截取的，
                //   贴回后背景模糊/画面外区域都不会被改动。
                { overlay: false }
            );
        } catch (e) {
            console.error("[噪域] 渲染器创建失败：", e);
            return null;
        }

        if (!state.renderer.gl) {
            console.error("[噪域] 浏览器不支持 WebGL2，rpe 皮肤渲染器需要 WebGL2");
            state.renderer = null;
            return null;
        }

        return state.renderer;
    }

    // ---------- 对外入口 ----------
    // 参数与 render_noise_areas 一致
    //   w/h/ox/oy 是「整张画布」的尺寸与偏移（噪域要覆盖全屏，包括 UI）
    //   噪域区域本身是按 16:9 画面定义的，这里换算到整张画布坐标
    function render_rpe_noise(ctx, noiseState, areas, t, w, h, ox, oy, skinName) {
        const skin = skinName || state.current || "NoiseField";

        load_skin(skin);

        if (!state.ready.has(skin)) return false;

        const renderer = ensure_renderer();

        if (!renderer) return false;

        const assets = state.assets.get(skin);

        if (!assets) return false;

        // w/h 就是 16:9 谱面画面尺寸（main.js 传进来的 w, h）
        const playW = w, playH = h;
        const aspect = playW / playH;
        const entries = build_entries(areas, t, aspect, playW, playH);

        if (entries.length === 0) return false;

        const layer = {
            id: "default",
            name: skin,
            skin: skin,
            parameters: {},
            channel: "normal"
        };

        // 触摸：填进渲染器的 touchPoints（vec4 * 32）
        fill_touches(renderer, noiseState, w, h, ox, oy);

        // ---- 中间画布：尺寸恰为画面（w×h）----
        // 渲染器要求 context.canvas 就是「视口那张画布」（内部 ratio = canvas.width / canvasWidth 必须为 1）。
        // 直接传主画布会让 ratio ≠ 1，几何与截图全部错位。
        if (!stage || stage.width !== Math.round(w) || stage.height !== Math.round(h)) {
            stage = document.createElement("canvas");
            stage.width = Math.round(w);
            stage.height = Math.round(h);
            stage_ctx = stage.getContext("2d");
        }

        stage_ctx.setTransform(1, 0, 0, 1, 0, 0);
        stage_ctx.clearRect(0, 0, stage.width, stage.height);

        try {
            stage_ctx.drawImage(ctx.canvas, ox | 0, oy | 0, w | 0, h | 0, 0, 0, stage.width, stage.height);
        } catch (e) {
            // 跨源污染时用空底图
        }

        const viewport = { left: 0, top: 0, width: w, height: h };
        const canvasWidth = w;
        const canvasHeight = h;

        const ok = renderer.render(
            stage_ctx, layer, assets, entries,
            t, viewport, /* scale */ h / 10, canvasWidth, canvasHeight
        );

        if (!ok) {
            if (!state.warned.has(skin)) {
                state.warned.add(skin);
                console.warn("[噪域] render 返回 false（皮肤 " + skin + "）");
            }

            return false;
        }

        // 贴回主画布
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(stage, 0, 0, stage.width, stage.height, 0, 0, w, h);
        ctx.restore();

        return true;
    }

    function fill_touches(renderer, noiseState, w, h, ox, oy) {
        const arr = renderer.touchPoints;

        if (!arr) return;

        arr.fill(0);

        let n = 0;
        const list = (noiseState && Array.isArray(noiseState.positions)) ? noiseState.positions : [];

        for (const pos of list) {
            if (n >= 32) break;

            const o = n * 4;

            arr[o] = (pos[0] - (ox || 0)) / w;
            arr[o + 1] = (pos[1] - (oy || 0)) / h;
            arr[o + 2] = 0.10;
            arr[o + 3] = 1.0;
            n++;
        }

        renderer.touchCountOverride = n;
    }

    function set_skin(name) {
        state.current = name;
        load_skin(name);
    }

    function available_skins() {
        return ["NoiseField", "Ocean"];
    }

    window.RpeNoise = {
        render: render_rpe_noise,
        setSkin: set_skin,
        skins: available_skins,
        state: state
    };
    window.__rpe_noise_loaded = true;
})();
