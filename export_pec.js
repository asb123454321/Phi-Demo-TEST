// 从 res/chart/chart.json 导出 Phira 可读的 PEC
// 与 main.js 的 export_note_text 保持一致（严格按 prpr/src/parse/pec.rs）
const fs=require("fs");
const PEC_W=2048, PEC_H=1400, FIX=0.15, NX=115.2, PGR=32;
const PEC_HEIGHT_RATIO=0.83175;        // prpr/src/core.rs
const SP=5.85/PEC_HEIGHT_RATIO;        // ≈7.0334，不是 5.85
const TAG={1:"n1",2:"n4",3:"n2",4:"n3"};
const num=(v,d=3)=>{const s=(+v).toFixed(d).replace(/\.?0+$/,"");return s===""||s==="-0"?"0":s;};
const c=JSON.parse(fs.readFileSync("/workspace/res/chart/chart.json","utf8"));
const t=v=>num(v/PGR,3);
const valid=e=>Number(e.endTime??e.startTime)>0;
const clip=e=>({...e,startTime:Math.max(0,+e.startTime),endTime:Math.max(Math.max(0,+e.startTime),+(e.endTime??e.startTime))});

const out=[String(Math.round((c.offset+FIX)*1000)), `bp 0 ${num(c.judgeLineList[0].bpm,4)}`];
const linesOut=[];

c.judgeLineList.forEach((l,i)=>{
  const px=v=>Number((+v*PEC_W).toFixed(2));
  const py=v=>Number((+v*PEC_H).toFixed(2));
  const pick=k=>(l[k]||[]).filter(valid).map(clip);

  // ---- 位移：跳变时补 cp ----
  {
    let lx=null, ly=null;
    for(const e of pick("judgeLineMoveEvents")){
      const x1=px(e.start), y1=py(e.start2??.5), x2=px(e.end??e.start), y2=py(e.end2??e.start2??.5);
      if(lx===null||x1!==lx||y1!==ly){ linesOut.push(`cp ${i} ${t(e.startTime)} ${x1} ${y1}`); lx=x1; ly=y1; }
      if(x1===x2&&y1===y2){
        if(lx!==x2||ly!==y2){ linesOut.push(`cp ${i} ${t(e.startTime)} ${x2} ${y2}`); lx=x2; ly=y2; }
      } else { linesOut.push(`cm ${i} ${t(e.startTime)} ${t(e.endTime)} ${x2} ${y2} 1`); lx=x2; ly=y2; }
    }
  }
  // ---- 旋转：跳变时补 cd ----
  {
    let lr=null;
    for(const e of pick("judgeLineRotateEvents")){
      const r1=num(-(e.start??0),3), r2=num(-(e.end??e.start??0),3);
      if(lr===null||r1!==lr){ linesOut.push(`cd ${i} ${t(e.startTime)} ${r1}`); lr=r1; }
      if(r1===r2){ if(lr!==r2){ linesOut.push(`cd ${i} ${t(e.startTime)} ${r2}`); lr=r2; } }
      else { linesOut.push(`cr ${i} ${t(e.startTime)} ${t(e.endTime)} ${r2} 1`); lr=r2; }
    }
  }
  // ---- 透明度：跳变时补 ca；cf 无 tween ----
  {
    let la=null;
    for(const e of pick("judgeLineDisappearEvents")){
      const a1=Math.round(Math.max(0,Math.min(1,e.start??0))*255);
      const a2=Math.round(Math.max(0,Math.min(1,e.end??e.start??0))*255);
      if(la===null||a1!==la){ linesOut.push(`ca ${i} ${t(e.startTime)} ${a1}`); la=a1; }
      if(a1===a2){ if(la!==a2){ linesOut.push(`ca ${i} ${t(e.startTime)} ${a2}`); la=a2; } }
      else { linesOut.push(`cf ${i} ${t(e.startTime)} ${t(e.endTime)} ${a2}`); la=a2; }
    }
  }
  // ---- 线速 ----
  for(const e of pick("speedEvents")) linesOut.push(`cv ${i} ${t(e.startTime)} ${num((e.value??0)*SP,4)}`);
});

const rows=[];
c.judgeLineList.forEach((l,li)=>{
  [...(l.notesAbove||[]).map(n=>[n,1]),...(l.notesBelow||[]).map(n=>[n,2])].forEach(([n,s])=>{
    const sp = n.type===3 ? 1 : Number(n.speed??1);   // pgr.rs: Hold 的 speed 强制为 1
    const body=n.type===3?`${TAG[n.type]} ${li} ${t(n.time)} ${t(n.time+n.holdTime)} ${num(n.positionX*NX,2)} ${s} 0`
                          :`${TAG[n.type]} ${li} ${t(n.time)} ${num(n.positionX*NX,2)} ${s} 0`;
    rows.push({k:n.time,b:body+"\n# "+num(sp,3)+"\n& 1"});
  });
});
rows.sort((a,b)=>a.k-b.k);

fs.writeFileSync("/workspace/chart_phira.pec",[...out,...linesOut,...rows.map(r=>r.b)].join("\n")+"\n");
console.log("线条指令",linesOut.length,"音符",rows.length);
