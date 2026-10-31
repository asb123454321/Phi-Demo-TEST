/* =============================================================
 * 开场动画 · 原版代码（WebGL 程序化三角网格 + 白屏）
 * 由项目中的 grid-transition.js / loading-sequence.js /
 * motion-easing.js / grid-transition-profile.js /
 * procedural-shaders.js 原样抽出。
 * 仅将 ES module 的 import/export 改为普通脚本作用域。
 * ============================================================= */
(function () {
'use strict';

/* ---------- motion-easing.js ---------- */
const clamp=value=>Math.max(0,Math.min(1,value));
function bezier(value,x1,y1,x2,y2){
 const x=clamp(value);if(x===0||x===1)return x;
 const point=(t,a,b)=>3*(1-t)*(1-t)*t*a+3*(1-t)*t*t*b+t*t*t;
 const slope=(t,a,b)=>3*(1-t)*(1-t)*a+6*(1-t)*t*(b-a)+3*t*t*(1-b);
 let t=x,lo=0,hi=1;
 for(let i=0;i<12;i++){
  const error=point(t,x1,x2)-x;if(Math.abs(error)<1e-7)break;
  if(error>0)hi=t;else lo=t;
  const derivative=slope(t,x1,x2),next=t-error/Math.max(1e-7,derivative);
  t=next>lo&&next<hi?next:(lo+hi)*.5;
 }
 return clamp(point(t,y1,y2));
}
const easeReveal=value=>bezier(value,.30,.04,.36,1);
const easeFade=value=>bezier(value,.32,0,.48,1);
const easeOut=value=>1-(1-clamp(value))**3;
const timedBezier=(time,delay,duration,x1,x2)=>bezier((time-delay)/duration,x1,0,x2,1);
function sampleCurve(keys,time,column){
 if(time<=keys[0][0])return keys[0][column];
 if(time>=keys.at(-1)[0])return keys.at(-1)[column];
 const secant=i=>(keys[i+1][column]-keys[i][column])/(keys[i+1][0]-keys[i][0]);
 const tangent=i=>{
  if(i===0||i===keys.length-1)return 0;
  const a=secant(i-1),b=secant(i);if(a*b<=0)return 0;
  const left=keys[i][0]-keys[i-1][0],right=keys[i+1][0]-keys[i][0];
  return 3*(left+right)/((2*right+left)/a+(right+2*left)/b);
 };
 for(let i=1;i<keys.length;i++)if(time<keys[i][0]){
  const a=keys[i-1],b=keys[i],duration=b[0]-a[0],p=(time-a[0])/duration;
  return (2*p**3-3*p*p+1)*a[column]+(p**3-2*p*p+p)*duration*tangent(i-1)
   +(-2*p**3+3*p*p)*b[column]+(p**3-p*p)*duration*tangent(i);
 }
}

/* ---------- grid-transition-profile.js ---------- */
const GRID_TRANSITION = {duration:1.68,referenceTimes:[0,1.68],periodX:152.4921875,periodY:186.19653497314454,slope:.61051171875,lens:-.09787109375,origin:[638.671875,327.21875]};

/* ---------- loading-profile.js ---------- */
const LOADING_PROFILE = {minimumDuration:1.1,logoOut:.20,whiteHold:1.68,revealDuration:1.30,loadingKeys:[[0,0,0,0,0],[.18,1,1,.15,.15],[.4,1,.15,1,.15],[.7,1,.15,.15,1],[1.1,1,1,.15,.15]],whiteKeys:[[0,1],[.118,.878],[.316,.660],[.517,.439],[.717,.214],[.913,0],[1.30,0]]};

/* ---------- procedural-shaders.js (模糊层) ---------- */
const PROCEDURAL_LAYER_BLUR = `precision highp float;varying vec2 uv;uniform sampler2D uTexture;uniform vec2 uDirection;
void main(){vec4 c=texture2D(uTexture,uv)*.227027;
c+=(texture2D(uTexture,uv+uDirection*1.384615)+texture2D(uTexture,uv-uDirection*1.384615))*.316216;
c+=(texture2D(uTexture,uv+uDirection*3.230769)+texture2D(uTexture,uv-uDirection*3.230769))*.070270;
gl_FragColor=c;}`;

/* ---------- grid-transition.js ---------- */
const vertex='attribute vec2 position;varying vec2 uv;void main(){uv=(position+1.)*.5;gl_Position=vec4(position,0.,1.);}';
const lattice=`float periodic(float x,float period){return abs(mod(x+period*.5,period)-period*.5);}
vec4 coarseField(vec2 uv,vec2 view,float time){
 vec2 p=vec2(uv.x,1.-uv.y)*view+(vec2(1280.,840.)-view)*.5;
 vec2 n=(p-vec2(640.,420.))/(view*.5);float r=dot(n,n);
 p=vec2(640.,420.)+(p-vec2(640.,420.))*(1.+${GRID_TRANSITION.lens}*r);
 float cell=${GRID_TRANSITION.periodX},height=${GRID_TRANSITION.periodY};vec2 g=p-vec2(${GRID_TRANSITION.origin[0]},${GRID_TRANSITION.origin[1]});
 vec3 sides=vec3(periodic(g.x,cell),periodic(g.y+g.x*${GRID_TRANSITION.slope},height)/${Math.sqrt(1+GRID_TRANSITION.slope*GRID_TRANSITION.slope)},periodic(g.y-g.x*${GRID_TRANSITION.slope},height)/${Math.sqrt(1+GRID_TRANSITION.slope*GRID_TRANSITION.slope)});
 float d=min(sides.x,min(sides.y,sides.z)),far=max(sides.x,max(sides.y,sides.z)),second=sides.x+sides.y+sides.z-d-far;
 float y=1.-uv.y,rise=smoothstep(0.,.50,time),front=1.1-rise*1.25;float reveal=smoothstep(front-.13,front+.13,y);
 float brightFront=1.05-smoothstep(.47,1.17,time)*1.25;float brighten=smoothstep(brightFront-.15,brightFront+.15,y);
 return vec4(d,second,reveal,brighten);
}`;
const fragment=`precision highp float;varying vec2 uv;uniform vec2 view;uniform float time;
${lattice}
void main(){
 vec4 field=coarseField(uv,view,time);float d=field.x,second=field.y,reveal=field.z,brighten=field.w;
 float glowGrowth=smoothstep(.55,1.06,time);
 float core=exp(-.5*pow(d/mix(.8,.9,glowGrowth),2.)),inside=exp(-.5*pow((d-10.5)/mix(.8,1.2,glowGrowth),2.));
 float inward=exp(-d/9.5),broad=exp(-d/mix(26.,80.4,glowGrowth));
 float exposure=1.+mix(4.2,3.82,glowGrowth)*brighten*smoothstep(.48,1.12,time);
 vec3 color=vec3(.011,.046,.059)+vec3(.17,.34,.37)*inward+vec3(.14,.27,.30)*broad*mix(1.,3.7,glowGrowth);
 float innerDiffuse=exp(-max(0.,d-10.5)/20.)*smoothstep(9.,13.,d);
 color+=vec3(.11,.17,.185)*innerDiffuse*(1.-glowGrowth);
 float knotRadius=mix(12.,18.,glowGrowth),knot=exp(-.5*(d*d+second*second)/(knotRadius*knotRadius));
 color+=mix(vec3(.46,.69,.71),vec3(.82,1.,1.),glowGrowth)*core+mix(vec3(.40,.79,.83),vec3(.45,.66,.69),glowGrowth)*inside*(mix(.40,.60,glowGrowth)+brighten*1.1)+vec3(.10,.18,.20)*knot*(1.+brighten*3.5);
 color*=exposure*reveal;
 // Compress highlights while the glow spreads; the final exposure still reaches white.
 color/=1.+.78*glowGrowth*color;
 float white=smoothstep(1.,1.68,time);color=mix(color,vec3(1.),white);
 gl_FragColor=vec4(color,1.);
}`;
const optical=`precision highp float;varying vec2 uv;uniform sampler2D uTexture;uniform vec2 view;uniform float time;
${lattice}
void main(){
 float growth=smoothstep(.55,1.1,time),white=smoothstep(1.,1.68,time);
 vec3 color=texture2D(uTexture,uv).rgb;
 color=pow(max(color,vec3(0.)),vec3(mix(1.,.83,growth)));
 // Diffuse light is blurred independently of the two thin luminous boundaries.
 // Reconstruct their distance field after the RGBA blur so clipping in the
 // intermediate target cannot erase the white peaks of the narrow lines.
 vec4 field=coarseField(uv,view,time);
 float outerLine=exp(-.5*pow(field.x/.65,2.)),innerLine=exp(-.5*pow((field.x-10.5)/.70,2.));
 float sharp=field.z*(1.-growth)*(1.-white);
 color+=vec3(.80,1.,1.)*(outerLine*(.18+.28*field.w)+innerLine*(.035+.145*field.w))*sharp;
 // Before exposure, diffuse ambient light fills the dark triangle interiors.
 // Near-edge tint keeps the thin outline pale rather than saturated blue.
 float early=field.z*(1.-growth)*(1.-white),edgeTint=exp(-.5*pow((field.x-2.)/2.4,2.));
 color+=vec3(.14,.09,.055)*(1.-exp(-field.x/14.))*early;
 color+=vec3(.10*exp(-field.x/3.),-.09*edgeTint,-.13*edgeTint)*early;
 color*=mix(.90,1.,growth);
 // During exposure the dark interval between the two luminous boundaries
 // remains readable against the diffuse light, then disappears into white.
 float interval=exp(-.5*pow((field.x-5.5)/2.4,2.));
 float crease=exp(-.5*pow(field.x/.85,2.));
 // Preserve cyan exposure between the contours: their red attenuation is
 // stronger than green/blue attenuation, not a neutral-grey subtraction.
 color-=(vec3(.115,.039,.042)*crease+vec3(.35,.018,.040)*interval)*growth*field.z*(1.-white);
 float grain=fract(sin(dot(floor(gl_FragCoord.xy)+floor(time*30.),vec2(12.9898,78.233)))*43758.5453)-.5;
 color+=grain*.0025*(1.-white);
 color*=1.-exp(-.5*pow(periodic((1.-uv.y)*view.y,8.5)/.45,2.))*.025*(1.-white);
 gl_FragColor=vec4(color,1.);
}`;
class GridTransition{
 constructor(canvas){
  this.canvas=canvas;const gl=this.gl=canvas.getContext('webgl',{alpha:false,antialias:false});if(!gl)throw new Error('进入动画无法初始化');
  const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));return shader;};
  const program=source=>{const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,source));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));return p;};
  this.program=program(fragment);this.blur=program(PROCEDURAL_LAYER_BLUR);this.optical=program(optical);const p=this.program;gl.useProgram(p);
  const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const loc=gl.getAttribLocation(p,'position');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
  this.buffer=b;this.time=gl.getUniformLocation(p,'time');this.view=gl.getUniformLocation(p,'view');this.ready=true;
 }
 target(width,height){
  const gl=this.gl,texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  const framebuffer=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('入场柔化缓冲创建失败');return{texture,framebuffer};
 }
 bind(program,target){
  const gl=this.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,target?.framebuffer??null);gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
  const location=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,2,gl.FLOAT,false,0,0);
 }
 async load(){this.draw(0);this.gl.finish();this.canvas.dataset.prewarmed='true';}
 draw(time){
  const gl=this.gl,w=innerWidth,h=innerHeight,ratio=Math.min(1.5,devicePixelRatio||1),width=Math.round(w*ratio),height=Math.round(h*ratio);
  if(this.canvas.width!==width||this.canvas.height!==height||!this.field){
   this.canvas.width=width;this.canvas.height=height;
   for(const target of [this.field,this.blurA,this.blurB])if(target){gl.deleteTexture(target.texture);gl.deleteFramebuffer(target.framebuffer);}
   this.field=this.target(width,height);this.blurA=this.target(width,height);this.blurB=this.target(width,height);
  }
  const logicalHeight=h/w*1280,grow=Math.max(0,Math.min(1,(time-.40)/.70)),softness=.8+7.2*grow*grow*(3.-2.*grow);
  gl.viewport(0,0,width,height);this.bind(this.program,this.field);gl.uniform2f(this.view,1280,logicalHeight);gl.uniform1f(this.time,time);gl.drawArrays(gl.TRIANGLES,0,6);
  this.bind(this.blur,this.blurA);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.field.texture);gl.uniform1i(gl.getUniformLocation(this.blur,'uTexture'),0);gl.uniform2f(gl.getUniformLocation(this.blur,'uDirection'),softness/(1.633*1280),0);gl.drawArrays(gl.TRIANGLES,0,6);
  this.bind(this.blur,this.blurB);gl.bindTexture(gl.TEXTURE_2D,this.blurA.texture);gl.uniform2f(gl.getUniformLocation(this.blur,'uDirection'),0,softness/(1.633*logicalHeight));gl.drawArrays(gl.TRIANGLES,0,6);
  this.bind(this.optical,null);gl.bindTexture(gl.TEXTURE_2D,this.blurB.texture);gl.uniform1i(gl.getUniformLocation(this.optical,'uTexture'),0);gl.uniform2f(gl.getUniformLocation(this.optical,'view'),1280,logicalHeight);gl.uniform1f(gl.getUniformLocation(this.optical,'time'),time);gl.drawArrays(gl.TRIANGLES,0,6);
  this.canvas.dataset.opticalBlur=softness.toFixed(6);this.canvas.dataset.opticalMode='separable-gaussian';
  this.canvas.dataset.time=time.toFixed(6);this.canvas.dataset.rendering='procedural-distance-field';this.canvas.dataset.pushProgress='0';this.canvas.dataset.latticeMotion='stationary';this.canvas.dataset.latticePeriod=String(GRID_TRANSITION.periodX);this.canvas.dataset.gridView=`1280,${(h/w*1280).toFixed(6)}`;
 }
}

/* ---------- loading-sequence.js ---------- */
// clamp 沿用 motion-easing.js 中的定义，此处不再重复声明
const smooth=x=>{const t=clamp(x);return t*t*(3-2*t);};
const sample=sampleCurve;
class LoadingSequence{
 constructor(element,options={},reducedMotion=false){
  this.element=element;this.started=performance.now();this.active=options!==false&&options?.enabled!==false&&!reducedMotion;
  this.duration=Math.max(.5,Math.min(12,Number(options?.duration)||LOADING_PROFILE.minimumDuration));
  this.dots=[...element.querySelectorAll('.loading-dots span')];
  if(this.active)this.grid=new GridTransition(element.querySelector('#loading-grid'));
  if(!this.active){element.hidden=true;this.phase='complete';}
 }
 async preload(){if(this.grid)await this.grid.load();}
 update(now,ready){
  if(!this.active){if(ready&&!this.sceneStarted)this.sceneStarted=now;return;}
  const elapsed=Math.max(0,(now-this.started)/1000);let black=1,white=0,grid=0,logo=sample(LOADING_PROFILE.loadingKeys,Math.min(elapsed,LOADING_PROFILE.loadingKeys.at(-1)[0]),1);
  const imagesReady=[...this.element.querySelectorAll('img')].every(image=>image.complete&&image.naturalWidth);
  if(ready&&imagesReady&&elapsed>=this.duration&&!this.exitStarted)this.exitStarted=now;
  this.phase='loading';
  if(this.exitStarted){
   const t=(now-this.exitStarted)/1000,riseEnd=GRID_TRANSITION.duration,revealAt=riseEnd+LOADING_PROFILE.whiteHold;
   logo*=1-smooth(t/LOADING_PROFILE.logoOut);grid=1;this.grid.draw(Math.min(t,GRID_TRANSITION.referenceTimes.at(-1)));this.phase='grid';
   if(t>=riseEnd){white=1;this.phase='white';}
   if(t>=riseEnd)black=0;
   if(t>=revealAt){
    if(!this.sceneStarted)this.sceneStarted=this.exitStarted+revealAt*1000;
    const reveal=t-revealAt;white=sample(LOADING_PROFILE.whiteKeys,reveal,1);grid=0;this.phase='revealing';
    if(reveal>=LOADING_PROFILE.revealDuration){this.active=false;this.phase='complete';this.element.hidden=true;this.element.setAttribute('aria-hidden','true');}
   }
  }
  this.element.style.setProperty('--loading-black',String(black));this.element.style.setProperty('--loading-white',String(white));this.element.style.setProperty('--loading-logo',String(logo));
  this.element.style.setProperty('--loading-grid',String(grid));
  const dotIntro=LOADING_PROFILE.loadingKeys[1][0],dotKeys=LOADING_PROFILE.loadingKeys.slice(1),dotPeriod=dotKeys.at(-1)[0]-dotIntro;
  const dotTime=elapsed<dotIntro?elapsed:dotIntro+(elapsed-dotIntro)%dotPeriod;
  for(let i=0;i<this.dots.length;i++)this.dots[i].style.opacity=String(sample(elapsed<dotIntro?LOADING_PROFILE.loadingKeys.slice(0,2):dotKeys,dotTime,i+2));
  this.element.dataset.phase=this.phase;this.element.dataset.elapsed=elapsed.toFixed(6);this.element.dataset.white=white.toFixed(6);this.element.dataset.logo=logo.toFixed(6);this.element.dataset.grid=grid.toFixed(6);this.element.dataset.exitElapsed=this.exitStarted?((now-this.exitStarted)/1000).toFixed(6):'0';
 }
}

window.OrgOpening={GridTransition,LoadingSequence,LOADING_PROFILE,GRID_TRANSITION};
})();
