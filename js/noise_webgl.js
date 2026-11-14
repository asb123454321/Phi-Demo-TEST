// ============================================================
// 噪域 WebGL 渲染器 —— 逐 pass 移植 rpe-next-main / assets/noise-skins/NoiseField
//
// 与原版一致的 14 个 pass（见 NoiseField/config.json）：
//   composeActive      → activeCompose   (r8, 1/8)
//   composeDisabled    → disabledCompose (rg8, 1/8)
//   edge               → effects.r       (1/4)
//   glow ×5 (ping-pong)→ effects.g        (1/4)
//   glowExtract        → effects.g
//   disabled           → $screen
//   ready              → $screen
//   copy               → sceneColor
//   touchMask          → touchHover      (r8, 1/8)
//   main               → $screen
//
// 与 rpe 客户端的差异（受限于浏览器 / 本模板）：
//   1. blockMask 在 rpe 里是「6 个布尔位打包成一字节的 R8」。
//      本模板没有那么多 RT pass，这里改成用 canvas 把几何栅格化成
//      同样的 6 个位平面（见 build_mask_textures），语义完全一致。
//   2. touchPoints 由 noiseState.hovers 提供（最多 32 个）。
// ============================================================

(function () {
    "use strict";

    const SKIN_PATH = "res/noise_tex/";

    const TEX_FILES = {
        blockNoise: "BlockNoise1.png",
        pointNoise: "PointNoise.png",
        fieldNoise: "FD_Noise.png"
    };

    // ---------- 材质默认值（来自 NoiseField/main.glsl 的 uniform 注释）----------
    const MAT = {
        outlineColor: [1.0, 0.33018857, 0.33018857, 1.0],
        fillOpacity: 0.667,
        fillStrength: 0.667,
        edgeOpacity: 0.8,
        glowIntensity: 0.8,
        backgroundPixelScale: 6.0,
        activeDisplaceSpeed: 1.5,
        activeDisplaceStrength: 0.15,
        activeSparkMapOpacity: 5.69,
        disabledFillOpacity: 0.4,
        shineBrightness: 0.12,
        shineSpeed: 37.9,
        touchHoverStrength: 1.0,
        touchPosBrightness: 2.0,
        touchReleaseDuration: 0.1,
        touchRadius: 0.25
    };

    // ---------- 目标 RT 尺寸比例（NoiseField/config.json targets）----------
    const RT_SCALE = {
        activeCompose: 0.125,
        disabledCompose: 0.125,
        effects: 0.25,
        pingA: 0.25,
        pingB: 0.25,
        sceneColor: 1 / 6,
        touchHover: 0.125
    };

    // ============================================================
    // 着色器源码
    //   #version 100 / precision / varying 按 WebGL1 重写，
    //   其余数学逐字保留（含注释里标注的常量和推导）
    // ============================================================

    const VS = `
attribute vec2 aPos;
varying vec2 uv;
void main() {
    // aPos: (-1,-1)..(1,1)，但 uv 需要「左上为原点的 0..1」
    // （与 canvas 2D 的 worldToPixel 一致：y 向下增长）
    uv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
    gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

    // ---------- 公共代码段 ----------
    const COMMON_MASK = `
uniform sampler2D blockMask;
uniform vec2 screenSize;
const float maskPixelScale = 8.0;

float nfBit(float value, float position) {
    return mod(floor(value / exp2(position)), 2.0);
}
// blockMask 每个像素打包 6 个布尔位，bit 顺序 0..5：
// ANormal, ASubtract, D+R Normal, D+R Subtract, R Normal, R Subtract
float nfMaskBit(vec2 p, float bit) {
    vec2 msz = max(floor(screenSize / max(maskPixelScale, 1.0)), vec2(1.0));
    vec2 q = (floor(p * msz) + 0.5) / msz;
    float maskWord = floor(texture2D(blockMask, q).r * 255.0 + 0.5);
    return nfBit(maskWord, bit);
}
`;

    const COMMON_COLOR = `
uniform vec4 outlineColor;

vec3 nfRGBtoHSV(vec3 c) {
    float hi = max(max(c.r,c.g),c.b);
    float lo = min(min(c.r,c.g),c.b);
    float d = hi-lo;
    float h = 0.0;
    if (d > 1e-10) {
        if (hi==c.r) h=mod((c.g-c.b)/d,6.0);
        else if (hi==c.g) h=(c.b-c.r)/d+2.0;
        else h=(c.r-c.g)/d+4.0;
        h=mod(h/6.0,1.0);
    }
    return vec3(h, hi<=1e-10 ? 0.0 : d/hi, hi);
}
vec3 nfHSVtoRGB(vec3 h) {
    vec3 p=clamp(abs(fract(h.xxx+vec3(1.0,2.0/3.0,1.0/3.0))*6.0-3.0)-1.0,0.0,1.0);
    return h.z*(vec3(1.0)+h.y*(p-vec3(1.0)));
}
vec3 nfVariant(float s, float v) {
    vec3 c=nfRGBtoHSV(outlineColor.rgb);
    c.y=clamp(c.y*s,0.0,1.0);
    c.z=clamp(c.z*v,0.0,1.0);
    return nfHSVtoRGB(c);
}
vec3 nfEdge() { return nfVariant(1.0,1.0); }
vec3 nfFill() { return nfVariant(1.0,0.713207483291626); }
vec3 nfGlow() { return nfVariant(1.2253520800891937,1.0); }
vec3 nfSpark() { return nfVariant(1.0676054460523543,1.0); }
vec3 nfDisabledFill() { return nfVariant(1.0794083394988696,0.4970000088214874); }
vec3 nfDisabledSpark() { return nfVariant(1.1197181312580806,0.31132078170776367); }
vec3 nfTouchColor() {
    vec3 c=nfRGBtoHSV(outlineColor.rgb);
    return nfHSVtoRGB(vec3(c.x,1.0,1.0));
}
`;

    const FS_HEAD = `
precision highp float;
varying highp vec2 uv;
`;

    // ---------- composeActive.glsl ----------
    const FS_COMPOSE_ACTIVE = FS_HEAD + COMMON_MASK + `
uniform sampler2D blockNoise;
uniform float time;
const float composeDisplaceSpeed = 2.5899999141693115;
const float composeDisplaceStrength = 0.10000000149011612;
const vec2 composeDisplaceDirection = vec2(0.5,0.5);
const vec2 composeDisplaceMapST = vec2(2.13,1.02);

void main() {
    vec2 dir = normalize(composeDisplaceDirection);
    vec2 perp = vec2(-dir.y, dir.x);
    float t = (time / 20.0) * composeDisplaceSpeed;
    vec2 duv = uv * composeDisplaceMapST;
    float d1 = texture2D(blockNoise, duv + dir * t).r - 0.5;
    float d2 = texture2D(blockNoise, duv + perp * t).r - 0.5;
    vec2 disp = dir * d1 + perp * d2;
    vec2 maskUV = uv + disp * composeDisplaceStrength;
    float n = nfMaskBit(maskUV, 0.0);
    float s = nfMaskBit(maskUV, 1.0);
    gl_FragColor = vec4(abs(s - n), 0.0, 0.0, 1.0);
}
`;

    // ---------- composeDisabled.glsl ----------
    const FS_COMPOSE_DISABLED = FS_HEAD + COMMON_MASK + `
void main() {
    float dn = nfMaskBit(uv, 2.0);
    float ds = nfMaskBit(uv, 3.0);
    gl_FragColor = vec4(abs(ds - dn), ds, 0.0, 1.0);
}
`;

    // ---------- edge.glsl ----------
    const FS_EDGE = FS_HEAD + `
uniform sampler2D mainTex;
uniform sampler2D composeRT;
uniform vec2 targetTexelSize;

void main() {
    vec2 t = targetTexelSize;
    float m = texture2D(mainTex, uv).r;
    m = max(m, texture2D(mainTex, uv + vec2( t.x, 0.0)).r);
    m = max(m, texture2D(mainTex, uv + vec2(-t.x, 0.0)).r);
    m = max(m, texture2D(mainTex, uv + vec2(0.0,  t.y)).r);
    m = max(m, texture2D(mainTex, uv + vec2(0.0, -t.y)).r);
    m = max(m, texture2D(mainTex, uv + vec2( t.x,  t.y)).r);
    m = max(m, texture2D(mainTex, uv + vec2(-t.x,  t.y)).r);
    m = max(m, texture2D(mainTex, uv + vec2( t.x, -t.y)).r);
    m = max(m, texture2D(mainTex, uv + vec2(-t.x, -t.y)).r);
    float edge = clamp(m - texture2D(composeRT, uv).r, 0.0, 1.0);
    gl_FragColor = vec4(edge, 0.0, 0.0, 1.0);
}
`;

    // ---------- glow.glsl ----------
    const FS_GLOW = FS_HEAD + `
uniform sampler2D mainTex;
uniform sampler2D composeRT;
uniform vec2 targetTexelSize;
uniform float passWeight;
uniform float firstPass;

void main() {
    vec2 t = targetTexelSize;
    vec2 cur = texture2D(mainTex, uv).rg;
    float m = cur.r;
    m = max(m, texture2D(mainTex, uv + vec2( t.x, 0.0)).r);
    m = max(m, texture2D(mainTex, uv + vec2(-t.x, 0.0)).r);
    m = max(m, texture2D(mainTex, uv + vec2(0.0,  t.y)).r);
    m = max(m, texture2D(mainTex, uv + vec2(0.0, -t.y)).r);
    m = max(m, texture2D(mainTex, uv + vec2( t.x,  t.y)).r);
    m = max(m, texture2D(mainTex, uv + vec2(-t.x,  t.y)).r);
    m = max(m, texture2D(mainTex, uv + vec2( t.x, -t.y)).r);
    m = max(m, texture2D(mainTex, uv + vec2(-t.x, -t.y)).r);
    float ring = clamp(m - cur.r, 0.0, 1.0);
    ring *= 1.0 - texture2D(composeRT, uv).r;
    float weighted = ring * passWeight;
    float accum = (firstPass > 0.5) ? weighted : (cur.g + weighted);
    gl_FragColor = vec4(m, clamp(accum, 0.0, 1.0), 0.0, 1.0);
}
`;

    // ---------- glowExtract.glsl ----------
    const FS_GLOW_EXTRACT = FS_HEAD + `
uniform sampler2D mainTex;
void main() {
    gl_FragColor = vec4(0.0, texture2D(mainTex, uv).g, 0.0, 1.0);
}
`;

    // ---------- edge + glow 合并（替代 rpe 里 effects.r 与 effects.g 分两次写）----------
    //   edge.glsl 和 glowExtract.glsl 在 rpe 里分别写 effects 的 R / G 两个通道。
    //   WebGL1 不允许对同一纹理「边读边写」，所以这里一次算完两件事：
    //     R = clamp(max9(compose) - compose, 0, 1)   （与 edge.glsl 完全一致）
    //     G = glowRT.g                                （glowExtract 的输出）
    const FS_EDGE_GLOW_MERGE = FS_HEAD + `
uniform sampler2D mainTex;
uniform sampler2D composeRT;
uniform sampler2D glowRT;
uniform vec2 targetTexelSize;

void main() {
    vec2 t = targetTexelSize;
    float m = texture2D(mainTex, uv).r;
    m = max(m, texture2D(mainTex, uv + vec2( t.x, 0.0)).r);
    m = max(m, texture2D(mainTex, uv + vec2(-t.x, 0.0)).r);
    m = max(m, texture2D(mainTex, uv + vec2(0.0,  t.y)).r);
    m = max(m, texture2D(mainTex, uv + vec2(0.0, -t.y)).r);
    m = max(m, texture2D(mainTex, uv + vec2( t.x,  t.y)).r);
    m = max(m, texture2D(mainTex, uv + vec2(-t.x,  t.y)).r);
    m = max(m, texture2D(mainTex, uv + vec2( t.x, -t.y)).r);
    m = max(m, texture2D(mainTex, uv + vec2(-t.x, -t.y)).r);
    float edge = clamp(m - texture2D(composeRT, uv).r, 0.0, 1.0);
    float glow = texture2D(glowRT, uv).g;
    gl_FragColor = vec4(edge, glow, 0.0, 1.0);
}
`;

    // ---------- disabled.glsl ----------
    const FS_DISABLED = FS_HEAD + COMMON_COLOR + `
uniform sampler2D composeRT;
uniform sampler2D screenTexture;
uniform sampler2D blockNoise;
uniform sampler2D pointNoise;
uniform float time;
uniform float disabledFillOpacity;
const float disabledDisplaceSpeed = 0.30000001192092896;
const vec2 disabledDisplaceDirection = vec2(1.0,1.0);
const vec2 disabledDisplaceMapST = vec2(0.50,0.20);
const vec2 disabledSparkMapST = vec2(3.00,1.20);
const float disabledSparkMapOpacity = 3.5;
const float disabledSparkDisplaceIntensity = 2.2899999618530273;

void main() {
    float comp = texture2D(composeRT, uv).r;
    if (comp - 0.0001 < 0.0) { gl_FragColor = texture2D(screenTexture, uv); return; }

    vec2 dir = normalize(disabledDisplaceDirection);
    vec2 perp = vec2(-dir.y, dir.x);
    float t = (time / 20.0) * disabledDisplaceSpeed;

    vec2 duv = uv * disabledDisplaceMapST;
    float dPerp = texture2D(blockNoise, duv + perp * t).r;
    float dDir  = texture2D(blockNoise, duv + dir  * t).r;

    float dispAvg = (dPerp + dDir) * 0.5;
    vec2 disp = dir * (dDir - 0.5) + perp * (dPerp - 0.5);

    vec2 sparkUV = uv * disabledSparkMapST + disp * disabledSparkDisplaceIntensity;
    float spark = texture2D(pointNoise, sparkUV).r;

    vec3 rgb = nfDisabledFill() * disabledFillOpacity;
    rgb += spark * nfDisabledSpark() * dispAvg * disabledSparkMapOpacity;
    rgb *= comp;

    vec4 behind = texture2D(screenTexture, uv);
    gl_FragColor = vec4(behind.rgb + rgb, 1.0);
}
`;

    // ---------- ready.glsl ----------
    const FS_READY = FS_HEAD + COMMON_MASK + `
uniform sampler2D screenTexture;
uniform sampler2D composeRT;
uniform float time;
uniform float shineBrightness;
uniform float shineSpeed;

void main() {
    float dn = nfMaskBit(uv, 4.0);
    float ds = nfMaskBit(uv, 5.0);
    float m = ds - dn;
    float c = texture2D(composeRT, uv).r;
    float a = c * abs(m);
    if (a - 0.0001 < 0.0) { gl_FragColor = texture2D(screenTexture, uv); return; }

    float pulse = sin(time * shineSpeed) * 0.5 + 1.0;
    vec3 rgb = vec3(a) * pulse * (vec3(1.0) * shineBrightness);
    vec4 behind = texture2D(screenTexture, uv);
    gl_FragColor = vec4(behind.rgb + rgb * a, clamp(behind.a + a * a, 0.0, 1.0));
}
`;

    // ---------- copy.glsl ----------
    const FS_COPY = FS_HEAD + `
uniform sampler2D mainTex;
void main() {
    gl_FragColor = texture2D(mainTex, uv);
}
`;

    // ---------- touchMask.glsl ----------
    const FS_TOUCH_MASK = FS_HEAD + `
uniform vec2 screenSize;
uniform int touchCount;
uniform vec4 touchPoints[32];
uniform float touchRadius;
uniform float touchReleaseDuration;

float touchHoverFromStage(vec4 touchPoint) {
    if (touchPoint.w > 0.5)
        return clamp(touchPoint.z / 0.10, 0.0, 1.0);
    if (touchReleaseDuration <= 0.0) return 0.0;
    return clamp(1.0 - touchPoint.z / touchReleaseDuration, 0.0, 1.0);
}

void main() {
    float aspect=screenSize.x/max(screenSize.y,1.0);
    float v=0.0;
    for (int i=0;i<32;++i) {
        if(i>=touchCount) break;
        vec4 tp=touchPoints[i];
        tp.z=touchHoverFromStage(tp);
        if(tp.z<=0.0001) continue;
        float d=length((uv-tp.xy)*vec2(aspect,1.0));
        float r=max(touchRadius*tp.z,0.0001);
        float fade=1.0-smoothstep(0.0,r,d);
        v=max(v,fade*tp.z);
    }
    gl_FragColor=vec4(v,0.0,0.0,1.0);
}
`;

    // ---------- main.glsl（最大的一块，逐字保留）----------
    const FS_MAIN = FS_HEAD + COMMON_MASK + COMMON_COLOR + `
uniform sampler2D screenTexture;
uniform sampler2D composeRT;
uniform sampler2D effectRT;
uniform sampler2D readyComposeRT;
uniform sampler2D sceneColorRT;
uniform sampler2D touchHoverRT;
uniform sampler2D blockNoise;
uniform sampler2D pointNoise;
uniform sampler2D fieldNoise;
uniform vec2 effectRTSize;
uniform float time;
uniform int touchCount;
uniform vec4 touchPoints[32];

// 编辑器可调（uniform）
uniform float fillOpacity;
uniform float fillStrength;
uniform float edgeOpacity;
uniform float glowIntensity;
uniform float backgroundPixelScale;
uniform float activeDisplaceSpeed;
uniform float activeDisplaceStrength;
uniform float activeSparkMapOpacity;
uniform float shineBrightness;
uniform float shineSpeed;
uniform float touchHoverStrength;
uniform float touchPosBrightness;

const float displaceBlendIntensity = 0.41100001335144043;
const vec2 activeDisplaceDirection = vec2(1.0,1.0);
const vec2 activeDisplaceMapST = vec2(0.80,0.30);
const vec2 activeSparkMapST = vec2(3.00,1.20);
const float activeSparkDisplaceIntensity = 2.390000104904175;
const float activeSparkHueShiftAmount = 0.20000000298023224;
const float touchBackgroundPixelScale = 8.0;
const vec2 touchDisplaceDirection = vec2(1.0,1.0);
const vec2 touchDisplaceMapST = vec2(0.55,0.30);
const vec2 fieldNoiseST = vec2(1.50,1.46);
const float touchDisplaceSpeed = 2.9000000953674316;
const float touchDisplaceStrength = 0.07999999821186066;
const float noiseEvoSpeed = 0.029999999329447746;
const float noiseDirChangeSpeed = 60.0;
const float noiseDisplaceStrength = 1.0;
const float noiseRadius = 0.47999998927116394;
const float noiseSmoothness = 1.0;
const float sdfCellSize = 0.10999999940395355;
const float sdfMoveSpeed = 9.300000190734863;
const float sdfFalloff = 0.3400000035762787;
const float sdfSmoothness = 0.6299999952316284;
const float touchPosRadius = 0.5;
const float touchPosLowThreshold = 0.6299999952316284;
const float touchPosShineSpeed = 43.0;
const float touchPosSDFFalloff = 0.4099999964237213;
const float touchPosSDFSmoothness = 0.4699999988079071;

vec2 nfPixelCenter(vec2 p, float scale) {
    float s = max(scale, 1.0);
    return (floor(p * screenSize / s) * s + vec2(s * 0.5)) / screenSize;
}
vec2 nfDir(vec2 d) {
    return length(d) > 0.00001 ? normalize(d) : vec2(0.70710678);
}
float nfSmooth(float x) { x=clamp(x,0.0,1.0); return x*x*(3.0-2.0*x); }

// Extracted TouchEffect/ActiveBlock hash（.38147 / .93821 不乘 .1031）
float nfHashScaled(vec2 coord) {
    vec2 p=fract(coord*0.1031);
    float d=dot(vec3(p.x,p.y,p.x),vec3(p.y,p.x,p.x)+33.3300018);
    vec2 q=p+d;
    return fract(q.x*(q.x+q.y));
}
float nfDirectionHash(float tick,float seed) {
    float a=fract(tick*0.1031);
    float d=dot(vec3(a,seed,a),vec3(seed,a,a)+33.3300018);
    vec2 q=vec2(a,seed)+d;
    return fract(q.x*(q.x+q.y));
}
vec2 nfNoiseFlow(float t) {
    float tick=floor(t), u=nfSmooth(fract(t));
    vec2 before=vec2(nfDirectionHash(tick,0.381470025),
                     nfDirectionHash(tick,0.93821007))*2.0-1.0;
    vec2 after=vec2(nfDirectionHash(tick+1.0,0.381470025),
                    nfDirectionHash(tick+1.0,0.93821007))*2.0-1.0;
    return mix(before,after,u);
}

float nfTouchShine(vec2 screenUV,vec2 displacement) {
    float d=1.0;
    vec2 p=(screenUV+displacement)*screenSize/screenSize.y;
    bool anyPress=false;
    for(int i=0;i<32;++i) {
        if(i>=touchCount) break;
        if(touchPoints[i].w<0.5) continue;
        anyPress=true;
        vec2 c=touchPoints[i].xy*screenSize/screenSize.y;
        float e=length(p-c);
        float k=max(touchPosSDFSmoothness-abs(d-e),0.0)/max(touchPosSDFSmoothness,1e-5);
        k=k*k*touchPosSDFSmoothness;
        d=min(d,e)-0.25*k;
    }
    if(!anyPress) return 0.0;
    float x=clamp((d-touchPosRadius)/(-max(touchPosRadius,1e-5)),0.0,1.0);
    x=nfSmooth(x);
    x=pow(max(x,1e-6),touchPosSDFFalloff);
    float strength=mix(touchPosLowThreshold,1.0,0.5+0.5*sin(time*touchPosShineSpeed))*touchPosBrightness;
    return x*strength;
}

vec3 nfTouchEffect(vec2 p) {
    vec2 dir=nfDir(touchDisplaceDirection), perp=vec2(-dir.y,dir.x);
    float t=(time/20.0)*touchDisplaceSpeed;
    vec2 texUV=p*touchDisplaceMapST;
    float a=texture2D(blockNoise,nfPixelCenter(texUV+dir*t,touchBackgroundPixelScale)).r;
    float b=texture2D(blockNoise,nfPixelCenter(texUV+perp*t,touchBackgroundPixelScale)).r;
    vec2 disp=dir*(a-0.5)+perp*(b-0.5);
    float hover=texture2D(touchHoverRT,p+disp*touchDisplaceStrength).r;

    float gate=nfSmooth((hover-(noiseRadius-noiseSmoothness))/max(2.0*noiseSmoothness,1e-5));
    float core=nfSmooth(hover);

    vec2 flow=nfNoiseFlow(time*noiseDirChangeSpeed);
    vec2 mapUV=p*fieldNoiseST+flow*noiseEvoSpeed;
    vec2 fd=texture2D(fieldNoise,mapUV).rg*2.0-1.0;

    float cellPx=max(screenSize.y*sdfCellSize,1e-5);
    vec2 cell=p*screenSize/cellPx + fd*noiseDisplaceStrength;
    vec2 c=floor(cell), f=fract(cell);
    float animation=time*sdfMoveSpeed;
    float tick=floor(animation), w=nfSmooth(fract(animation));
    vec2 key=c+vec2(tick);
    vec2 seed0=vec2(nfHashScaled(key),nfHashScaled(key+vec2(17.1700001)));
    vec2 seed1=vec2(nfHashScaled(key+vec2(1.0)),nfHashScaled(key+vec2(18.1700001)));
    float dist=length(f-mix(seed0,seed1,w));
    float sdf=nfSmooth((dist-sdfFalloff)/max(sdfSmoothness,1e-5));

    vec3 noiseTint=nfTouchColor();
    vec3 glowColor=nfTouchColor();
    vec3 cellColor=clamp(vec3(sdf)*(vec3(1.0)+noiseTint),0.0,1.0);
    vec3 n=gate*cellColor;
    vec3 g=core*glowColor;

    vec3 low=2.0*n*g;
    vec3 high=1.0-2.0*(vec3(1.0)-n)*(vec3(1.0)-g);
    vec3 overlay=clamp(mix(low,high,step(vec3(0.5),n)),0.0,1.0);
    return (overlay + 0.5*g)*touchHoverStrength;
}

vec2 pixelCenter(vec2 p, float scale) {
    float s = max(scale, 1.0);
    return (floor(p * screenSize / s) * s + vec2(s * 0.5)) / screenSize;
}

vec3 rgb2hsvFaithful(vec3 c) {
    vec4 K = vec4(0.0, -0.3333333333, 0.6666666667, -1.0);
    vec4 p = (c.g >= c.b) ? vec4(c.g, c.b, K.x, K.y)
                          : vec4(c.b, c.g, K.w, K.z);
    vec4 q = (c.r >= p.x) ? vec4(c.r, p.y, p.z, p.x)
                          : vec4(p.x, p.y, p.w, c.r);
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgbFaithful(vec3 hsv) {
    vec3 p = abs(fract(hsv.xxx + vec3(1.0, 0.666666667, 0.333333333)) * 6.0 - 3.0) - 1.0;
    p = clamp(p, 0.0, 1.0);
    return hsv.z * (vec3(1.0) + hsv.y * (p - vec3(1.0)));
}

vec3 overlayFaithful(vec3 base, vec3 blend) {
    vec3 low = 2.0 * base * blend;
    vec3 high = vec3(1.0) - 2.0 * (vec3(1.0) - base) * (vec3(1.0) - blend);
    vec3 chooseHigh = step(vec3(0.5), base);
    return clamp(mix(low, high, chooseHigh), 0.0, 1.0);
}

void main() {
    float limit = (8.0 / 9.0) * (screenSize.y / screenSize.x);
    if (abs(uv.x - 0.5) > limit) { gl_FragColor = texture2D(screenTexture, uv); return; }

    float comp = texture2D(composeRT, uv).r;
    vec2 edgeUV = (floor(uv * effectRTSize) + vec2(0.5)) / effectRTSize;
    float edge = texture2D(effectRT, edgeUV).r;
    float glow = texture2D(effectRT, uv).g;

    float dn = nfMaskBit(uv, 4.0);
    float ds = nfMaskBit(uv, 5.0);
    float ready = texture2D(readyComposeRT, uv).r;
    float rd = ready * abs(ds - dn);

    float sum = glow + edge + comp;
    float total = rd + sum + texture2D(touchHoverRT, uv).r;
    if (total - 0.0001 < 0.0) { gl_FragColor = texture2D(screenTexture, uv); return; }

    vec3 rgb = vec3(0.0);
    float alpha = 0.0;

    if (sum > 0.0001) {
        float edgeTerm = edge * edgeOpacity;
        float glowAdj = glow * (1.0 - (edge + comp));
        float glowTerm = glowAdj * glowIntensity;

        vec2 dir = normalize(activeDisplaceDirection);
        vec2 perp = vec2(-dir.y, dir.x);
        float t = (time / 20.0) * activeDisplaceSpeed;

        vec2 duv = uv * activeDisplaceMapST;
        float a1 = texture2D(blockNoise, pixelCenter(duv + dir  * t, backgroundPixelScale)).r;
        float a2 = texture2D(blockNoise, pixelCenter(duv + perp * t, backgroundPixelScale)).r;
        float dispAvg = (a1 + a2) * 0.5;
        vec2 disp = dir * (a1 - 0.5) + perp * (a2 - 0.5);

        vec2 sceneUV = pixelCenter(uv, backgroundPixelScale) + disp * activeDisplaceStrength;
        vec2 sparkUV = uv * activeSparkMapST + disp * activeSparkDisplaceIntensity;

        float spark = texture2D(pointNoise, sparkUV).r;
        vec3 sparkVec = spark * nfSpark() * dispAvg * activeSparkMapOpacity;

        vec3 scene = texture2D(sceneColorRT, sceneUV).rgb;
        vec3 hsv = rgb2hsvFaithful(scene);
        hsv += sparkVec * activeSparkHueShiftAmount;
        vec3 shiftedScene = hsv2rgbFaithful(hsv);
        vec3 processed = overlayFaithful(shiftedScene, sparkVec);

        vec3 fillBase = nfFill() - vec3(dispAvg * displaceBlendIntensity);
        vec3 fill = fillBase + fillStrength * (processed - fillBase);

        rgb = fill * comp
            + nfEdge() * edgeTerm
            + nfGlow() * glowTerm;

        rgb *= 1.0 + nfTouchShine(uv, disp * activeDisplaceStrength);
        alpha = comp * fillOpacity + edgeTerm + glowTerm;
    }

    if (rd > 0.0001) {
        float pulse = sin(time * shineSpeed) * 0.5 + 1.0;
        vec3 shine = vec3(1.0) * shineBrightness * pulse;
        rgb += (rd * rd) * shine;
    }

    float hover = texture2D(touchHoverRT, uv).r;
    if (hover > 0.0001) rgb += nfTouchEffect(uv);

    vec4 behind = texture2D(screenTexture, uv);
    gl_FragColor = vec4(rgb + behind.rgb * (1.0 - alpha),
                         alpha + behind.a * (1.0 - alpha));
}
`;

    // ============================================================
    // WebGL 状态
    // ============================================================
    const GL = {
        ready: false,
        failed: false,
        canvas: null,
        gl: null,
        quad: null,
        programs: {},
        targets: {},
        textures: {},
        vw: 0, vh: 0
    };

    function compile(gl, type, src) {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(sh);
            console.error("[噪域][编译失败]\n" + log + "\n---源码片段---\n" + src.slice(0, 600));
            gl.deleteShader(sh);
            return null;
        }
        return sh;
    }

    function makeProgram(gl, fsSrc) {
        const vs = compile(gl, gl.VERTEX_SHADER, VS);
        const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
        if (!vs || !fs) return null;
        const p = gl.createProgram();
        gl.attachShader(p, vs);
        gl.attachShader(p, fs);
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
            console.error("[噪域][链接失败] " + gl.getProgramInfoLog(p));
            return null;
        }
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        return p;
    }

    function makeTarget(gl, w, h, filter) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        if (!ok) console.error("[噪域] FBO 不完整 " + w + "x" + h);
        return { fb: fb, tex: tex, w: w, h: h };
    }

    // ============================================================
    // 初始化
    // ============================================================
    function init() {
        if (GL.ready || GL.failed) return GL.ready;

        const cv = document.createElement("canvas");

        cv.width = 16;
        cv.height = 16;

        const gl = cv.getContext("webgl", {
            alpha: true,
            antialias: false,
            premultipliedAlpha: false,
            preserveDrawingBuffer: true,
            powerPreference: "high-performance"
        }) || cv.getContext("experimental-webgl", {
            alpha: true,
            antialias: false,
            premultipliedAlpha: false,
            preserveDrawingBuffer: true
        });

        if (!gl) {
            console.error("[噪域] 浏览器不支持 WebGL，回退到旧 CPU 渲染");

            GL.failed = true;

            return false;
        }

        GL.canvas = cv;
        GL.gl = gl;

        // 全屏三角形/四边形
        const buf = gl.createBuffer();

        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1,
            -1, 1, 1, -1, 1, 1
        ]), gl.STATIC_DRAW);
        GL.quad = buf;

        // 程序
        const defs = {
            composeActive: FS_COMPOSE_ACTIVE,
            composeDisabled: FS_COMPOSE_DISABLED,
            edge: FS_EDGE,
            glow: FS_GLOW,
            glowExtract: FS_GLOW_EXTRACT,
            edgeGlowMerge: FS_EDGE_GLOW_MERGE,
            disabled: FS_DISABLED,
            ready: FS_READY,
            copy: FS_COPY,
            touchMask: FS_TOUCH_MASK,
            main: FS_MAIN
        };

        let allOk = true;

        for (const k in defs) {
            const p = makeProgram(gl, defs[k]);

            if (!p) {
                allOk = false;
                console.error("[噪域] 程序编译失败: " + k);
            }

            GL.programs[k] = p;
        }

        if (!allOk) {
            GL.failed = true;

            return false;
        }

        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.BLEND);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

        GL.ready = true;

        // 贴图（异步）
        load_textures(gl);

        return true;
    }

    // ---- 贴图：NONE 采样在浏览器里用 NEAREST；mirror/repeat 用 REPEAT ----
    function load_textures(gl) {
        const specs = {
            blockNoise: { file: TEX_FILES.blockNoise, wrap: gl.MIRRORED_REPEAT },
            pointNoise: { file: TEX_FILES.pointNoise, wrap: gl.REPEAT },
            fieldNoise: { file: TEX_FILES.fieldNoise, wrap: gl.MIRRORED_REPEAT }
        };

        for (const key in specs) {
            const spec = specs[key];
            const tex = gl.createTexture();
            const img = new Image();

            GL.textures[key] = { tex: tex, loaded: false, w: 1, h: 1, wrap: spec.wrap };

            // 先给 1x1 占位，避免未加载时采到黑
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                new Uint8Array([128, 128, 128, 255]));

            img.onload = () => {
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, spec.wrap);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, spec.wrap);
                GL.textures[key].loaded = true;
                GL.textures[key].w = img.width;
                GL.textures[key].h = img.height;
            };
            img.onerror = () => console.error("[噪域] 贴图加载失败: " + spec.file);
            img.src = SKIN_PATH + spec.file;
        }
    }

    // ============================================================
    // 几何 → 6 位遮罩纹理
    //   位 0: A Normal（appear..enable 之后的 active 态几何）
    //   位 1: A Subtract
    //   位 2: D+R Normal
    //   位 3: D+R Subtract
    //   位 4: R Normal（ready：enable-0.5 .. enable 的预告框）
    //   位 5: R Subtract
    // 用一张 1/8 的 R8 纹理打包成一个字节（和 rpe 的 blockMask 语义一致）
    // ============================================================
    let maskCanvas = null, maskCtx = null;
    let planeCanvas = null, planeCtx = null;

    function ensure_mask_buffers(mw, mh) {
        if (!maskCanvas || maskCanvas.width !== mw || maskCanvas.height !== mh) {
            maskCanvas = document.createElement("canvas");
            maskCanvas.width = mw;
            maskCanvas.height = mh;
            maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
        }

        if (!planeCanvas || planeCanvas.width !== mw || planeCanvas.height !== mh) {
            planeCanvas = document.createElement("canvas");
            planeCanvas.width = mw;
            planeCanvas.height = mh;
            planeCtx = planeCanvas.getContext("2d", { willReadFrequently: true });
        }
    }

    // 在像素空间里取一个噪域区域的四角
    function area_corners(area, t, w, h, aspect) {
        const pose = area.pose(t, aspect);
        const ca = Math.cos(pose.angle), sa = Math.sin(pose.angle);
        const sx = pose.size[0], sy = pose.size[1];
        const cx = pose.center[0], cy = pose.center[1];

        const out = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];

        for (let i = 0; i < 4; i++) {
            const lx = out[i][0] * sx, ly = out[i][1] * sy;
            const rx = lx * ca - ly * sa;
            const ry = lx * sa + ly * ca;
            out[i] = worldToPixelLocal([cx + rx, cy + ry], w, h, aspect);
        }

        return out;
    }

    // worldToPixel：与 main.js 里同一套公式 [w/2 + x*h/10, h/2 - y*h/10]
    function worldToPixelLocal(pt, w, h) {
        return [w / 2 + pt[0] * h / 10, h / 2 - pt[1] * h / 10];
    }

    // 把一组多边形填进 planeCtx（白 = 1）
    function fill_planes(groups, mw, mh, scaleX, scaleY, w, h) {
        // groups: [{polys:[{pts, subtract}]}]
        // 返回每个位平面的 Uint8Array
        const planes = [];

        for (let bit = 0; bit < 6; bit++) {
            const grp = groups[bit];

            if (!grp || grp.length === 0) {
                planes[bit] = null;
                continue;
            }

            planeCtx.setTransform(1, 0, 0, 1, 0, 0);
            planeCtx.globalAlpha = 1;
            planeCtx.globalCompositeOperation = "source-over";
            planeCtx.clearRect(0, 0, mw, mh);
            planeCtx.fillStyle = "#fff";

            for (const piece of grp) {
                const pts = piece.pts;

                planeCtx.beginPath();
                planeCtx.moveTo(pts[0][0] * scaleX, pts[0][1] * scaleY);

                for (let i = 1; i < pts.length; i++) planeCtx.lineTo(pts[i][0] * scaleX, pts[i][1] * scaleY);

                planeCtx.closePath();
                // 挖孔用 xor，与 |normal - subtract| 的奇偶性一致
                planeCtx.globalCompositeOperation = piece.subtract ? "xor" : "source-over";
                planeCtx.fill();
            }

            planeCtx.globalCompositeOperation = "source-over";

            const d = planeCtx.getImageData(0, 0, mw, mh).data;
            const arr = new Uint8Array(mw * mh);

            for (let i = 0, j = 0; i < d.length; i += 4, j++) arr[j] = d[i + 3] > 127 ? 1 : 0;

            planes[bit] = arr;
        }

        return planes;
    }

    let mask_tex = null, mask_size = [0, 0];

    function build_mask_texture(areas, t, w, h, aspect, mw, mh) {
        const gl = GL.gl;

        ensure_mask_buffers(mw, mh);

        const scaleX = mw / w, scaleY = mh / h;

        // 6 个位对应的几何分组
        //  A(0,1)  : active 且非 ready 阶段的常规区域
        //  D+R(2,3): disabled 阶段（在 rpe 里是 ready 之前就存在的几何）
        //  R(4,5)  : ready 预告框
        const groups = [[], [], [], [], [], []];

        for (const area of areas) {
            const active = area.active ? area.active(t) : true;
            const ready = area.ready ? area.ready(t) : false;
            let bucketBase;

            if (ready) bucketBase = 4;           // R
            else if (active) bucketBase = 0;     // A
            else bucketBase = 2;                 // D+R

            const pts = area_corners(area, t, w, h, aspect);

            groups[bucketBase + (area.isSubtract ? 1 : 0)].push({ pts: pts, subtract: false });

            // 「subtract」位存的就是这个区域本身；normal 位也会存，
            // 最终由 |s - n| 在 shader 里做差集（与 rpe 一致）
            if (area.isSubtract) {
                groups[bucketBase].push({ pts: pts, subtract: true });
            }
        }

        const planes = fill_planes(groups, mw, mh, scaleX, scaleY, w, h);

        // 打包成 RGBA：R = 位掩码字节
        if (!mask_tex) mask_tex = gl.createTexture();

        const packed = new Uint8Array(mw * mh * 4);

        for (let i = 0, n = mw * mh; i < n; i++) {
            let word = 0;

            for (let bit = 0; bit < 6; bit++) {
                const p = planes[bit];

                if (p && p[i]) word |= (1 << bit);
            }

            const o = i * 4;

            packed[o] = word;       // R = maskWord
            packed[o + 1] = 0;
            packed[o + 2] = 0;
            packed[o + 3] = 255;
        }

        mask_size = [mw, mh];

        gl.bindTexture(gl.TEXTURE_2D, mask_tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, mw, mh, 0, gl.RGBA, gl.UNSIGNED_BYTE, packed);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        return mask_tex;
    }

    // ============================================================
    // 渲染小工具
    // ============================================================
    function bind_texture(gl, unit, tex, loc) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(loc, unit);
    }

    function bind_skin_tex(gl, unit, key, loc) {
        const rec = GL.textures[key];

        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, rec ? rec.tex : null);
        gl.uniform1i(loc, unit);
    }

    function draw_pass(prog, target, uniforms, texUniforms) {
        const gl = GL.gl;

        gl.useProgram(prog);

        // 顶点
        const loc = gl.getAttribLocation(prog, "aPos");

        gl.bindBuffer(gl.ARRAY_BUFFER, GL.quad);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

        // 通用 uniform
        gl.uniform2f(gl.getUniformLocation(prog, "screenSize"), GL.vw, GL.vh);
        gl.uniform2f(gl.getUniformLocation(prog, "effectRTSize"), GL.targets.effects.w, GL.targets.effects.h);

        // 材质
        const oc = gl.getUniformLocation(prog, "outlineColor");
        if (oc) gl.uniform4fv(oc, MAT.outlineColor);

        const matNames = [
            "fillOpacity", "fillStrength", "edgeOpacity", "glowIntensity",
            "backgroundPixelScale", "activeDisplaceSpeed", "activeDisplaceStrength",
            "activeSparkMapOpacity", "disabledFillOpacity", "shineBrightness",
            "shineSpeed", "touchHoverStrength", "touchPosBrightness",
            "touchReleaseDuration", "touchRadius"
        ];

        for (const n of matNames) {
            const l = gl.getUniformLocation(prog, n);

            if (l) gl.uniform1f(l, MAT[n]);
        }

        // 自定义 uniform
        if (uniforms) {
            for (const k in uniforms) {
                const l = gl.getUniformLocation(prog, k);

                if (!l) continue;

                const v = uniforms[k];

                if (typeof v === "number") gl.uniform1f(l, v);
                else if (typeof v === "boolean") gl.uniform1i(l, v ? 1 : 0);
                else if (v && v.length === 2) gl.uniform2fv(l, v);
                else if (v && v.length === 128) gl.uniform4fv(l, v);   // touchPoints[32]
                else if (v && v.length === 4) gl.uniform4fv(l, v);
            }
        }

        // 纹理
        if (texUniforms) {
            let unit = 0;

            for (const name in texUniforms) {
                const l = gl.getUniformLocation(prog, name);

                if (!l) continue;

                const spec = texUniforms[name];

                if (spec.skin) bind_skin_tex(gl, unit, spec.skin, l);
                else bind_texture(gl, unit, spec.tex, l);

                unit++;
            }
        }

        // 目标
        if (target) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
            gl.viewport(0, 0, target.w, target.h);
        } else {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, GL.vw, GL.vh);
        }

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // ============================================================
    // RT 尺寸
    // ============================================================
    function ensure_targets(vw, vh) {
        if (GL.vw === vw && GL.vh === vh && GL.targets.activeCompose) return;

        const gl = GL.gl;

        for (const k in GL.targets) {
            const t = GL.targets[k];

            if (t && t.fb) {
                gl.deleteFramebuffer(t.fb);
                gl.deleteTexture(t.tex);
            }
        }

        GL.targets = {};
        GL.vw = vw;
        GL.vh = vh;

        // 默认帧缓冲（$screen）尺寸必须与画布一致，否则 viewport 与绘制区域错位
        if (GL.canvas.width !== vw || GL.canvas.height !== vh) {
            GL.canvas.width = vw;
            GL.canvas.height = vh;
        }

        const mk = (name, linear) => {
            const s = RT_SCALE[name];
            const w = Math.max(1, Math.floor(vw * s));
            const h = Math.max(1, Math.floor(vh * s));

            GL.targets[name] = makeTarget(gl, w, h, linear ? gl.LINEAR : gl.NEAREST);
        };

        mk("activeCompose", false);
        mk("disabledCompose", false);
        mk("effects", true);
        mk("pingA", false);
        mk("pingB", false);
        mk("sceneColor", true);
        mk("touchHover", false);

        // 全尺寸 ping-pong（对应 rpe 的 $screen）
        const fullTarget = () => makeTarget(gl, vw, vh, gl.LINEAR);
        GL.targets.screenA = fullTarget();
        GL.targets.screenB = fullTarget();

        GL.targets._maskW = Math.max(1, Math.floor(vw / 8));
        GL.targets._maskH = Math.max(1, Math.floor(vh / 8));

        GL.touchVec = new Float32Array(32 * 4);
        GL.sceneVec = new Float32Array(32 * 4);
    }

    // ---- 触摸 → touchPoints[32] ----
    //   noiseState.positions / hovers[].position 存的是「主画布绝对坐标」（含 ox/oy），
    //   shader 里 uv 是画面局部 0..1，所以必须先减 ox/oy 再除以 w/h。
    function collect_touches(noiseState, w, h, ox, oy) {
        const arr = GL.touchVec;
        let n = 0;

        arr.fill(0);

        if (noiseState && Array.isArray(noiseState.hovers) && noiseState.hovers.length) {
            for (const hv of noiseState.hovers) {
                if (n >= 32) break;
                if (!hv || hv.scale <= 0.0001) continue;

                const o = n * 4;
                const pressed = hv.finger !== null;

                arr[o] = (hv.position[0] - ox) / w;
                arr[o + 1] = (hv.position[1] - oy) / h;
                arr[o + 2] = pressed ? 0.10 : Math.max(0, 0.10 - (hv.elapsed || 0));
                arr[o + 3] = pressed ? 1.0 : 0.0;

                n++;
            }
        }

        if (n === 0 && noiseState && Array.isArray(noiseState.positions)) {
            for (const pos of noiseState.positions) {
                if (n >= 32) break;

                const o = n * 4;

                arr[o] = (pos[0] - ox) / w;
                arr[o + 1] = (pos[1] - oy) / h;
                arr[o + 2] = 0.10;
                arr[o + 3] = 1.0;
                n++;
            }
        }

        return n;
    }

    let screen_tex = null;

    // ============================================================
    // 主渲染
    //   流程（与 NoiseField/config.json 的 passes 一一对应）：
    //     composeActive   → activeCompose
    //     composeDisabled → disabledCompose
    //     edge            → pingA        (只取 .r)
    //     glow×5          → pingB/pingA  (最终 glow 落在 glowSrc)
    //     edgeGlowMerge   → effects      = (edge, glow)
    //     disabled        → screen
    //     ready           → screen
    //     copy(scene)     → sceneColor
    //     touchMask       → touchHover
    //     main            → screen
    // ============================================================
    function render_noise_shader_webgl(ctx, noiseState, areas, t, w, h, ox, oy) {
        if (!areas || areas.length === 0) return false;
        if (!init()) return false;

        const gl = GL.gl;
        const vw = Math.max(8, Math.round(w));
        const vh = Math.max(8, Math.round(h));

        ensure_targets(vw, vh);

        const T = GL.targets;
        const P = GL.programs;
        const aspect = w / h;

        // ---------- 遮罩 ----------
        const maskTex = build_mask_texture(areas, t, w, h, aspect, T._maskW, T._maskH);

        // ---------- 噪域「下面的画面」（$screen）----------
        //   rpe 里噪域是叠加在游戏画面之上的，shader 用 screenTexture 取回底图做合成。
        //   本模板里噪域是画在 2D 主画布上的，所以这里把主画布当前内容上传成纹理。
        const underTex = upload_screen_texture(gl, ctx, vw, vh, w, h, ox, oy);

        // ---------- 触摸 ----------
        GL.touchCount = collect_touches(noiseState, w, h, ox || 0, oy || 0);
        const touchU = { touchCount: GL.touchCount, touchPoints: GL.touchVec, time: t };

        // 全局清屏
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, vw, vh);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // ================= 1. composeActive =================
        draw_pass(P.composeActive, T.activeCompose,
            { time: t },
            { blockMask: { tex: maskTex }, blockNoise: { skin: "blockNoise" } });

        // ================= 2. composeDisabled =================
        draw_pass(P.composeDisabled, T.disabledCompose,
            {},
            { blockMask: { tex: maskTex } });

        // ================= 3~5. edge + glow → effects =================
        //   pingA / pingB 全部让给 glow 的 ping-pong，
        //   edge 在 edgeGlowMerge 里顺带重算（3x3 max − comp，开销极小）。
        const edgeTexel = [1 / T.activeCompose.w, 1 / T.activeCompose.h];
        const glowW = [0.458567970132, 0.282861223139, 0.156589227109, 0.07305908496, 0.024947807942];

        let src = T.activeCompose;
        let glowDst = T.pingA;
        let other = T.pingB;

        for (let i = 0; i < glowW.length; i++) {
            draw_pass(P.glow, glowDst,
                { targetTexelSize: [1 / src.w, 1 / src.h], passWeight: glowW[i], firstPass: i === 0 ? 1 : 0 },
                { mainTex: { tex: src.tex }, composeRT: { tex: T.activeCompose.tex } });

            src = glowDst;

            const tmp = glowDst;

            glowDst = other;
            other = tmp;
        }

        // 最终 glow 落在 src 上（.g 通道）
        draw_pass(P.edgeGlowMerge, T.effects,
            { targetTexelSize: edgeTexel },
            {
                mainTex: { tex: T.activeCompose.tex },
                composeRT: { tex: T.activeCompose.tex },
                glowRT: { tex: src.tex }
            });

        // ================= 6. sceneColor（曲绘缩略图）=================
        //   rpe 用 copy.glsl 把 $screen 拷到 sceneColor。
        //   本模板主画布上噪域之下就是曲绘，这里用 2D 采样一小块曲绘即可。
        update_scene_color(gl, P, T, ctx, w, h, ox, oy);

        // ================= 7. touchMask → touchHover =================
        draw_pass(P.touchMask, T.touchHover, touchU, {});

        // ================= 8. disabled → screenA =================
        draw_pass(P.disabled, T.screenA, { time: t },
            {
                screenTexture: { tex: underTex },
                composeRT: { tex: T.disabledCompose.tex },
                blockNoise: { skin: "blockNoise" },
                pointNoise: { skin: "pointNoise" }
            });

        // ================= 9. ready → screenB =================
        draw_pass(P.ready, T.screenB, { time: t },
            {
                screenTexture: { tex: T.screenA.tex },
                composeRT: { tex: T.disabledCompose.tex },
                blockMask: { tex: maskTex }
            });

        // ================= 10. main → screenA =================
        draw_pass(P.main, T.screenA, touchU,
            {
                screenTexture: { tex: T.screenB.tex },
                composeRT: { tex: T.activeCompose.tex },
                effectRT: { tex: T.effects.tex },
                readyComposeRT: { tex: T.disabledCompose.tex },
                sceneColorRT: { tex: GL.sceneTex || T.sceneColor.tex },
                touchHoverRT: { tex: T.touchHover.tex },
                blockMask: { tex: maskTex },
                blockNoise: { skin: "blockNoise" },
                pointNoise: { skin: "pointNoise" },
                fieldNoise: { skin: "fieldNoise" }
            });

        // ================= 11. 贴回主画布 =================
        //   先把 screenA 的内容拷到默认帧缓冲（GL 画布），再整体 drawImage 上去。
        draw_pass(P.copy, null, {}, { mainTex: { tex: T.screenA.tex } });

        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(GL.canvas, 0, 0, vw, vh, 0, 0, w, h);
        ctx.restore();

        return true;
    }

    // 把主画布上噪域下方的画面上传成纹理（对应 rpe 的 $screen）
    let under_canvas = null, under_canvas_ctx = null;

    function upload_screen_texture(gl, ctx, vw, vh, w, h, ox, oy) {
        if (!under_canvas || under_canvas.width !== vw || under_canvas.height !== vh) {
            under_canvas = document.createElement("canvas");
            under_canvas.width = vw;
            under_canvas.height = vh;
            under_canvas_ctx = under_canvas.getContext("2d", { willReadFrequently: true });
        }

        under_canvas_ctx.setTransform(1, 0, 0, 1, 0, 0);
        under_canvas_ctx.clearRect(0, 0, vw, vh);

        // 主画布此刻在 (ox, oy, w, h) 上还没有画噪域
        try {
            under_canvas_ctx.drawImage(ctx.canvas, ox | 0, oy | 0, w | 0, h | 0, 0, 0, vw, vh);
        } catch (e) {
            // 跨源污染时跳过，用空底图
        }

        if (!GL.underTex) GL.underTex = gl.createTexture();

        gl.bindTexture(gl.TEXTURE_2D, GL.underTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);   // 画布 y 向下 → 纹理 y 向上
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, under_canvas);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        return GL.underTex;
    }

    // 曲绘缩略图 → sceneColor
    function update_scene_color(gl, P, T, ctx, w, h, ox, oy) {
        const sw = T.sceneColor.w, sh = T.sceneColor.h;

        if (!screen_tex || screen_tex.width !== sw || screen_tex.height !== sh) {
            screen_tex = document.createElement("canvas");
            screen_tex.width = sw;
            screen_tex.height = sh;
        }

        const sctx = screen_tex.getContext("2d", { willReadFrequently: true });

        sctx.clearRect(0, 0, sw, sh);

        // 主画布此刻在 (ox, oy, w, h) 上就是曲绘（噪域还没画上去）
        try {
            sctx.drawImage(ctx.canvas, ox | 0, oy | 0, w | 0, h | 0, 0, 0, sw, sh);
        } catch (e) {
            // 跨源污染时静默跳过，sceneColor 保留上一帧
        }

        const img = sctx.getImageData(0, 0, sw, sh);

        if (!GL.sceneTex) GL.sceneTex = gl.createTexture();

        gl.bindTexture(gl.TEXTURE_2D, GL.sceneTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    // ============================================================
    // 对外
    // ============================================================
    window.__noise_webgl_loaded = true;
    window.render_noise_shader_webgl = render_noise_shader_webgl;
    window.NOISE_MATERIAL = MAT;
})();
