import { useState, useEffect, useRef, useCallback } from "react";

const STORAGE_KEY = "ironlog_workouts";

const PRESET_EXERCISES = [
  "Bench Press","Squat","Deadlift","Overhead Press","Barbell Row",
  "Pull-Up","Dip","Incline Bench Press","Romanian Deadlift","Leg Press",
  "Lat Pulldown","Cable Row","Dumbbell Curl","Tricep Pushdown",
  "Lateral Raise","Face Pull","Hip Thrust","Leg Curl","Leg Extension","Calf Raise"
];

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_NAMES_SHORT = ["S","M","T","W","T","F","S"];

// ─── STORAGE ──────────────────────────────────────────────────────────────────
function useStorage() {
  const [workouts, setWorkouts] = useState(() => {
    try { const s=localStorage.getItem(STORAGE_KEY); return s?JSON.parse(s):[]; }
    catch { return []; }
  });
  const save = (data) => {
    setWorkouts(data);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
  };
  return [workouts, save];
}

function genId() { return Date.now().toString(36)+Math.random().toString(36).slice(2); }
function fmtDate(iso) { return new Date(iso).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}); }
function fmtDateShort(iso) { const p=fmtDate(iso).split(" "); return `${p[0]} ${p[1]}`; }
function totalVol(ex) { return ex.sets.reduce((s,set)=>s+(parseFloat(set.weight)||0)*(parseInt(set.reps)||0),0); }
function bestSet(ex) {
  if (!ex.sets.length) return null;
  return ex.sets.reduce((b,s)=>{
    const [w,r,bw,br]=[parseFloat(s.weight)||0,parseInt(s.reps)||0,parseFloat(b.weight)||0,parseInt(b.reps)||0];
    return w>bw||(w===bw&&r>br)?s:b;
  }, ex.sets[0]);
}
function calcE1rm(set) {
  if (!set) return 0;
  return Math.round((parseFloat(set.weight)||0)*(1+(parseInt(set.reps)||0)/30));
}

// Catmull-Rom spline through pts → SVG path
function catmullRomPath(pts) {
  if (pts.length < 2) return "";
  const d = [];
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) {
      d.push(`M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`);
    } else {
      const p0 = pts[Math.max(i-2, 0)];
      const p1 = pts[i-1];
      const p2 = pts[i];
      const p3 = pts[Math.min(i+1, pts.length-1)];
      const cp1x = p1[0] + (p2[0]-p0[0])/6;
      const cp1y = p1[1] + (p2[1]-p0[1])/6;
      const cp2x = p2[0] - (p3[0]-p1[0])/6;
      const cp2y = p2[1] - (p3[1]-p1[1])/6;
      d.push(`C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`);
    }
  }
  return d.join(" ");
}

// ─── HIGH FIDELITY LINE CHART ─────────────────────────────────────────────────
function LineChart({ data, color, valueKey, label }) {
  const svgRef = useRef(null);
  const [tip, setTip] = useState(null); // index
  const [mouseX, setMouseX] = useState(null);

  if (!data || data.length < 2) return null;

  const W=560, H=200, T=24, R=20, B=42, L=52;
  const cW=W-L-R, cH=H-T-B;

  const vals = data.map(d=>d[valueKey]);
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  // Pad range for breathing room
  const pad = (maxV - minV) * 0.12 || maxV * 0.1 || 5;
  const lo = Math.max(0, minV - pad), hi = maxV + pad;
  const rng = hi - lo || 1;

  const px = i => L + (i/(data.length-1))*cW;
  const py = v => T + cH - ((v-lo)/rng)*cH;
  const pts = data.map((d,i)=>[px(i), py(d[valueKey])]);

  const linePath = catmullRomPath(pts);
  // Close area: follow line then drop to baseline
  const areaPath = linePath + ` L${pts[pts.length-1][0].toFixed(2)},${(T+cH).toFixed(2)} L${pts[0][0].toFixed(2)},${(T+cH).toFixed(2)} Z`;

  // Nice y-axis ticks
  const range = hi - lo;
  const rawStep = range / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const niceStep = Math.ceil(rawStep/mag)*mag;
  const yTicks = [];
  let t = Math.ceil(lo/niceStep)*niceStep;
  while (t <= hi) { if (t >= lo) yTicks.push(t); t += niceStep; }

  // X-axis: show ~6 labels max
  const xStep = Math.max(1, Math.floor(data.length/6));
  const xLabels = data.reduce((acc,d,i)=>{
    if (i===0||i===data.length-1||i%xStep===0) acc.push(i);
    return acc;
  },[]);

  const fmt = v => valueKey==="volume" ? (v/1000).toFixed(1)+"t" : valueKey==="rpe" ? v.toFixed(1) : Math.round(v)+"";

  const handleMouseMove = useCallback((e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const relX = svgX - L;
    const frac = relX / cW;
    const idx = Math.round(frac * (data.length-1));
    const clamped = Math.max(0, Math.min(data.length-1, idx));
    setTip(clamped);
    setMouseX(svgX);
  }, [data.length]);

  const tipVal = tip !== null ? data[tip][valueKey] : null;
  const tipX = tip !== null ? pts[tip][0] : null;
  const tipY = tip !== null ? pts[tip][1] : null;

  const gradId = `grad-${valueKey}-${color.replace("#","")}`;
  const filterId = `glow-${valueKey}`;

  return (
    <div style={{position:"relative", userSelect:"none"}}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{width:"100%",height:"auto",display:"block",overflow:"visible"}}
        onMouseMove={handleMouseMove}
        onMouseLeave={()=>{setTip(null);setMouseX(null);}}
        onTouchMove={(e)=>{e.preventDefault();handleMouseMove(e.touches[0]);}}
        onTouchEnd={()=>{setTip(null);setMouseX(null);}}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".35"/>
            <stop offset="60%" stopColor={color} stopOpacity=".08"/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </linearGradient>
          <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/>
            <feComposite in="SourceGraphic" in2="blur" operator="over"/>
          </filter>
          <clipPath id={`clip-${valueKey}`}>
            <rect x={L} y={T} width={cW} height={cH}/>
          </clipPath>
        </defs>

        {/* Y grid lines + labels */}
        {yTicks.map((v,i)=>(
          <g key={i}>
            <line x1={L} y1={py(v)} x2={L+cW} y2={py(v)}
              stroke={i===0?"#282828":"#1e1e1e"} strokeWidth={i===0?"1.5":"1"} strokeDasharray={i===0?"":"3,4"}/>
            <text x={L-8} y={py(v)} fill="#404040" fontSize="10" textAnchor="end"
              dominantBaseline="middle" fontFamily="'Barlow Condensed',sans-serif" letterSpacing="0.5">
              {fmt(v)}
            </text>
          </g>
        ))}

        {/* X axis line */}
        <line x1={L} y1={T+cH} x2={L+cW} y2={T+cH} stroke="#282828" strokeWidth="1.5"/>

        {/* Area fill */}
        <path d={areaPath} fill={`url(#${gradId})`} clipPath={`url(#clip-${valueKey})`}/>

        {/* Glow line (thicker, blurred) */}
        <path d={linePath} fill="none" stroke={color} strokeWidth="5" strokeOpacity=".2"
          strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#clip-${valueKey})`}/>

        {/* Main line */}
        <path d={linePath} fill="none" stroke={color} strokeWidth="2.5"
          strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#clip-${valueKey})`}/>

        {/* X axis labels */}
        {xLabels.map(i=>(
          <text key={i} x={px(i)} y={H-6} fill="#3a3a3a" fontSize="9.5" textAnchor="middle"
            fontFamily="'Barlow Condensed',sans-serif" letterSpacing="0.3">
            {fmtDateShort(data[i].date)}
          </text>
        ))}

        {/* Crosshair */}
        {tip!==null&&(
          <g>
            <line x1={tipX} y1={T} x2={tipX} y2={T+cH}
              stroke={color} strokeWidth="1" strokeOpacity=".4" strokeDasharray="3,3"/>
            <line x1={L} y1={tipY} x2={L+cW} y2={tipY}
              stroke={color} strokeWidth="1" strokeOpacity=".2" strokeDasharray="2,4"/>
            {/* Outer ring */}
            <circle cx={tipX} cy={tipY} r="8" fill={color} fillOpacity=".15" stroke={color} strokeWidth="1.5" strokeOpacity=".5"/>
            {/* Inner dot */}
            <circle cx={tipX} cy={tipY} r="4" fill={color} stroke="#111" strokeWidth="2"/>
          </g>
        )}

        {/* Static dots for small datasets */}
        {data.length <= 20 && tip===null && pts.map(([x,y],i)=>(
          <circle key={i} cx={x} cy={y} r="3" fill={color} stroke="#111" strokeWidth="1.5" opacity=".7"/>
        ))}
      </svg>

      {/* Floating tooltip */}
      {tip!==null&&tipX!==null&&(()=>{
        const pct = (tipX/W)*100;
        const flipLeft = pct > 70;
        return (
          <div style={{
            position:"absolute",
            top:"4px",
            left: flipLeft ? "auto" : `${pct}%`,
            right: flipLeft ? `${100-pct}%` : "auto",
            transform: flipLeft ? "translateX(50%)" : "translateX(-50%)",
            background:"#0d0d0d",
            border:`1px solid ${color}`,
            borderRadius:"6px",
            padding:"7px 12px",
            pointerEvents:"none",
            zIndex:20,
            minWidth:"90px",
            boxShadow:`0 4px 20px ${color}33`,
          }}>
            <div style={{fontFamily:"'Barlow Condensed'",fontSize:"10px",color:"#555",letterSpacing:"1.5px",marginBottom:"2px"}}>
              {fmtDate(data[tip].date)}
            </div>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:"26px",color,lineHeight:1}}>
              {valueKey==="volume"
                ? (data[tip][valueKey]/1000).toFixed(2)+"t"
                : valueKey==="rpe"
                ? data[tip][valueKey]
                : data[tip][valueKey]+"kg"}
            </div>
            {data[tip].rpe && (
              <div style={{fontFamily:"'Barlow Condensed'",fontSize:"10px",color:"#666",letterSpacing:"1px",marginTop:2}}>
                RPE {data[tip].rpe}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ─── CALENDAR MONTH ───────────────────────────────────────────────────────────
function CalMonth({ year, month, workoutDates, selected, onSelect }) {
  const first=new Date(year,month,1).getDay();
  const days=new Date(year,month+1,0).getDate();
  const today=new Date().toISOString().split("T")[0];
  const cells=[];
  for(let i=0;i<first;i++) cells.push(null);
  for(let d=1;d<=days;d++){
    const iso=`${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    cells.push({d,iso});
  }
  return (
    <div style={{marginBottom:20}}>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"17px",color:"#999",letterSpacing:"1px",marginBottom:"7px"}}>
        {MONTH_NAMES[month]} <span style={{color:"#333"}}>{year}</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"2px",marginBottom:"3px"}}>
        {DAY_NAMES_SHORT.map((n,i)=>(
          <div key={i} style={{textAlign:"center",fontFamily:"'Barlow Condensed',sans-serif",
            fontSize:"10px",color:"#2e2e2e",fontWeight:700,letterSpacing:"1px",padding:"2px 0"}}>{n}</div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"3px"}}>
        {cells.map((cell,i)=>{
          if(!cell) return <div key={i}/>;
          const has=workoutDates.has(cell.iso);
          const isToday=cell.iso===today;
          const isSel=cell.iso===selected;
          return (
            <div key={i} onClick={()=>has&&onSelect(isSel?null:cell.iso)}
              style={{
                aspectRatio:"1",display:"flex",flexDirection:"column",alignItems:"center",
                justifyContent:"center",borderRadius:"5px",fontFamily:"'Barlow Condensed',sans-serif",
                fontSize:"12px",fontWeight:600,cursor:has?"pointer":"default",transition:"all .15s",gap:"2px",
                background:isSel?"#2a0e00":has?"#1c1008":"transparent",
                color:isSel?"#FF3D00":has?"#e8c880":isToday?"#666":"#262626",
                border:isSel?"1px solid #FF3D00":isToday?"1px solid #2a2a2a":"1px solid transparent",
                boxShadow:has&&!isSel?"inset 0 0 0 1px #3a2510":"none",
              }}>
              <span>{cell.d}</span>
              {has&&<div style={{width:3,height:3,borderRadius:"50%",background:"#FF3D00",opacity:isSel?1:.8}}/>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── LONG TERM SCREEN ─────────────────────────────────────────────────────────
function LongTermScreen({ workouts }) {
  const now=new Date();
  const [yr, setYr]=useState(now.getFullYear());
  const [mo, setMo]=useState(now.getMonth());
  const [selDate, setSelDate]=useState(null);

  const wDates=new Set(workouts.map(w=>w.date));
  const selWorkout=selDate?workouts.find(w=>w.date===selDate):null;

  const prevMo=()=>{ if(mo===0){setYr(y=>y-1);setMo(11);}else setMo(m=>m-1); };
  const nextMo=()=>{ if(mo===11){setYr(y=>y+1);setMo(0);}else setMo(m=>m+1); };

  const sorted=[...wDates].sort();
  let longest=0,cur=0;
  for(let i=0;i<sorted.length;i++){
    cur=i===0?1:(new Date(sorted[i])-new Date(sorted[i-1]))/86400000===1?cur+1:1;
    if(cur>longest)longest=cur;
  }
  let curStreak=0;
  for(let i=sorted.length-1;i>=0;i--){
    if(Math.round((now-new Date(sorted[i]))/86400000)===curStreak)curStreak++;
    else break;
  }

  const months=[];
  for(let offset=-5;offset<=0;offset++){
    let m=mo+offset,y=yr;
    while(m<0){m+=12;y--;} while(m>11){m-=12;y++;}
    months.push({y,m});
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <div className="screen-label">LONG TERM VIEW</div>
          <div className="screen-date">Workout Calendar</div>
        </div>
        <div className="volume-chip">
          <span className="volume-num">{workouts.length}</span>
          <span className="volume-unit">sessions</span>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:20}}>
        {[{v:curStreak,l:"CURRENT STREAK"},{v:longest,l:"LONGEST STREAK"},{v:workouts.length,l:"TOTAL SESSIONS"}].map((s,i)=>(
          <div key={i} style={{background:"#141414",border:"1px solid #1e1e1e",borderRadius:6,padding:"11px 7px",textAlign:"center"}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"30px",color:"#FF3D00",lineHeight:1,marginBottom:3}}>{s.v}</div>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"9px",color:"#484848",letterSpacing:"2px"}}>{s.l}</div>
          </div>
        ))}
      </div>

      <div className="section-heading">
        <span>CALENDAR</span>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <button className="cal-nav-btn" onClick={prevMo}>‹</button>
          <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"12px",fontWeight:700,color:"#777",letterSpacing:"1px",minWidth:78,textAlign:"center"}}>
            {MONTH_NAMES[mo]} {yr}
          </span>
          <button className="cal-nav-btn" onClick={nextMo}>›</button>
        </div>
      </div>

      <div style={{background:"#141414",border:"1px solid #1e1e1e",borderRadius:8,padding:"15px 13px 10px",marginBottom:14}}>
        {months.map(({y,m},i)=>(
          <CalMonth key={`${y}-${m}`} year={y} month={m} workoutDates={wDates} selected={selDate} onSelect={setSelDate}/>
        ))}
        <div style={{display:"flex",alignItems:"center",gap:7,paddingTop:8,borderTop:"1px solid #181818",
          fontFamily:"'Barlow Condensed',sans-serif",fontSize:"10px",color:"#333",letterSpacing:"1px"}}>
          <div style={{width:10,height:10,borderRadius:2,background:"#1c1008",border:"1px solid #3a2510"}}/>
          <span>WORKOUT LOGGED</span>
          <div style={{width:10,height:10,borderRadius:2,background:"#2a0e00",border:"1px solid #FF3D00",marginLeft:8}}/>
          <span>SELECTED</span>
        </div>
      </div>

      {selWorkout&&(
        <div style={{background:"#141414",border:"1px solid #2e2e2e",borderLeft:"3px solid #FF3D00",
          borderRadius:6,padding:13,marginBottom:14,animation:"slideIn .15s ease"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:11}}>
            <div>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"16px",fontWeight:700,color:"#eee",letterSpacing:"1px"}}>{fmtDate(selDate)}</div>
              <div style={{fontSize:"11px",color:"#555",fontFamily:"'Barlow Condensed',sans-serif",marginTop:2}}>
                {selWorkout.exercises.length} exercises · {selWorkout.exercises.reduce((s,e)=>s+totalVol(e),0).toLocaleString()} kg total
              </div>
            </div>
            <button className="icon-btn" onClick={()=>setSelDate(null)}>✕</button>
          </div>
          {selWorkout.exercises.map(e=>(
            <div key={e.id} style={{paddingBottom:7,marginBottom:7,borderBottom:"1px solid #1c1c1c"}}>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"12px",fontWeight:700,
                color:"#FF3D00",textTransform:"uppercase",letterSpacing:"1px",marginBottom:5}}>{e.name}</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                {e.sets.map(s=>(
                  <span key={s.id} style={{background:"#1a1a1a",border:"1px solid #222",borderRadius:4,
                    fontFamily:"'Barlow Condensed',sans-serif",fontSize:"11px",color:"#bbb",padding:"3px 7px"}}>
                    {s.weight||"—"}kg × {s.reps||"—"}{s.rpe?` · RPE ${s.rpe}`:""}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {workouts.length===0&&(
        <div className="empty-state" style={{paddingTop:10}}>
          <div className="empty-icon">📅</div>
          <div className="empty-text">Log workouts to see your calendar fill up.</div>
        </div>
      )}
    </div>
  );
}

// ─── PROGRESS SCREEN ─────────────────────────────────────────────────────────
function ProgressScreen({ workouts }) {
  const [selEx, setSelEx]=useState(null);
  const [metric, setMetric]=useState("e1rm");

  const allNames=[...new Set(workouts.flatMap(w=>w.exercises.map(e=>e.name)))].sort();

  useEffect(()=>{
    if(allNames.length&&!selEx) setSelEx(allNames[0]);
  },[allNames.length]);

  const chartData=workouts
    .filter(w=>w.exercises.find(e=>e.name===selEx))
    .map(w=>{
      const ex=w.exercises.find(e=>e.name===selEx);
      const bs=bestSet(ex);
      const rpeVals=ex.sets.map(s=>parseFloat(s.rpe)).filter(v=>!isNaN(v)&&v>0);
      return {
        date:w.date,
        bestWeight:parseFloat(bs?.weight)||0,
        volume:totalVol(ex),
        e1rm:calcE1rm(bs),
        rpe:rpeVals.length?Math.round(rpeVals.reduce((a,b)=>a+b,0)/rpeVals.length*10)/10:null,
      };
    })
    .sort((a,b)=>a.date.localeCompare(b.date));

  const metricMap={
    e1rm:   {key:"e1rm",       color:"#FF3D00", label:"Est. 1RM (kg)"},
    weight: {key:"bestWeight", color:"#00E5FF", label:"Best Weight (kg)"},
    volume: {key:"volume",     color:"#FFB300", label:"Session Volume"},
    rpe:    {key:"rpe",        color:"#C850FF", label:"Avg RPE"},
  };
  const cm=metricMap[metric];

  // For RPE chart, only include sessions that have RPE data
  const activeChartData = metric==="rpe"
    ? chartData.filter(d=>d.rpe!==null)
    : chartData;

  const rpeValsAll=chartData.map(d=>d.rpe).filter(v=>v!==null);
  const pbs={
    w:Math.max(...chartData.map(d=>d.bestWeight),0),
    e:Math.max(...chartData.map(d=>d.e1rm),0),
    v:Math.max(...chartData.map(d=>d.volume),0),
    r:rpeValsAll.length ? Math.max(...rpeValsAll) : null,
  };

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <div className="screen-label">LIFT PROGRESSION</div>
          <div className="screen-date">Performance Over Time</div>
        </div>
      </div>

      {allNames.length===0?(
        <div className="empty-state">
          <div className="empty-icon">📈</div>
          <div className="empty-text">Log workouts to track your lift progression.</div>
        </div>
      ):(
        <>
          <div className="ex-selector-scroll" style={{marginBottom:16}}>
            {allNames.map(n=>(
              <button key={n} className={`ex-chip ${selEx===n?"active":""}`} onClick={()=>setSelEx(n)}>{n}</button>
            ))}
          </div>

          {chartData.length>0?(
            <>
              <div className="pb-row" style={{gridTemplateColumns:"1fr 1fr 1fr 1fr"}}>
                <div className="pb-card"><div className="pb-val">{pbs.w}<span className="pb-unit">kg</span></div><div className="pb-label">BEST WT</div></div>
                <div className="pb-card"><div className="pb-val">{pbs.e}<span className="pb-unit">kg</span></div><div className="pb-label">BEST E1RM</div></div>
                <div className="pb-card"><div className="pb-val">{(pbs.v/1000).toFixed(1)}<span className="pb-unit">t</span></div><div className="pb-label">BEST VOL</div></div>
                <div className="pb-card" style={{borderColor: pbs.r?"#2a1040":"#1c1c1c"}}>
                  <div className="pb-val" style={{color: pbs.r?"#C850FF":"#333",fontSize:"22px"}}>
                    {pbs.r !== null ? pbs.r : "—"}
                  </div>
                  <div className="pb-label" style={{color: pbs.r?"#7a3a99":"#2e2e2e"}}>PEAK RPE</div>
                </div>
              </div>

              <div className="metric-tabs">
                {Object.entries(metricMap).map(([k,v])=>(
                  <button key={k} className={`metric-tab ${metric===k?"active":""}`}
                    style={metric===k?{borderColor:v.color,color:v.color}:{}}
                    onClick={()=>setMetric(k)}>
                    {v.label}
                  </button>
                ))}
              </div>

              <div className="chart-wrap">
                <div className="chart-title" style={{color:cm.color}}>{selEx} — {cm.label}</div>
                {activeChartData.length===0?(
                  <div className="chart-single">
                    <div className="chart-single-sub" style={{paddingTop:10}}>No RPE data logged for this exercise yet.</div>
                  </div>
                ):activeChartData.length<2?(
                  <div className="chart-single">
                    <div className="chart-single-val" style={{color:cm.color}}>
                      {cm.key==="volume"?(activeChartData[0][cm.key]/1000).toFixed(2)+"t"
                        :cm.key==="rpe"?activeChartData[0][cm.key]
                        :activeChartData[0][cm.key]+"kg"}
                    </div>
                    <div className="chart-single-sub">1 session logged — keep training!</div>
                  </div>
                ):(
                  <LineChart data={activeChartData} color={cm.color} valueKey={cm.key} label={cm.label}/>
                )}
              </div>

              {activeChartData.length>=2&&(()=>{
                const first=activeChartData[0][cm.key],last=activeChartData[activeChartData.length-1][cm.key];
                const pct=first>0?Math.round(((last-first)/first)*100):0;
                // For RPE: going up is neutral/bad, going down is good — flip colour logic
                const isRpe=cm.key==="rpe";
                const positive=isRpe?(pct<=0):(pct>=0);
                return (
                  <div className={`trend-banner ${positive?"up":"down"}`}>
                    <span className="trend-arrow">{pct>=0?"↑":"↓"}</span>
                    <span>
                      {Math.abs(pct)}% {pct>=0?"increase":"decrease"} across {activeChartData.length} sessions
                      {isRpe && pct<0?" — getting more efficient 💪":""}
                    </span>
                  </div>
                );
              })()}
            </>
          ):(
            <div className="empty-state" style={{paddingTop:20}}>
              <div className="empty-text">No data for {selEx} yet.</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── WORKOUT SCREEN ───────────────────────────────────────────────────────────
function WorkoutScreen({ workouts, saveWorkouts }) {
  const today=new Date().toISOString().split("T")[0];
  const existing=workouts.find(w=>w.date===today);
  const [draft,setDraft]=useState(existing||{id:genId(),date:today,exercises:[]});
  const [dirty,setDirty]=useState(false);
  const [saveState,setSaveState]=useState("idle");
  const [showPicker,setShowPicker]=useState(false);
  const [customEx,setCustomEx]=useState("");
  const [showRpe,setShowRpe]=useState(false);

  useEffect(()=>{
    const w=workouts.find(w=>w.date===today);
    if(w&&!dirty) setDraft(w);
  },[workouts]);

  const update=(u)=>{setDraft(u);setDirty(true);setSaveState("idle");};
  const commitSave=()=>{
    saveWorkouts([...workouts.filter(w=>w.date!==today),draft].sort((a,b)=>b.date.localeCompare(a.date)));
    setDirty(false);setSaveState("saved");
    setTimeout(()=>setSaveState("idle"),2000);
  };

  const addEx=(name)=>{
    update({...draft,exercises:[...draft.exercises,{id:genId(),name,sets:[{id:genId(),weight:"",reps:"",rpe:""}]}]});
    setShowPicker(false);setCustomEx("");
  };
  const remEx=(id)=>update({...draft,exercises:draft.exercises.filter(e=>e.id!==id)});
  const addSet=(eid)=>update({...draft,exercises:draft.exercises.map(e=>e.id===eid?{...e,sets:[...e.sets,{id:genId(),weight:"",reps:"",rpe:""}]}:e)});
  const remSet=(eid,sid)=>update({...draft,exercises:draft.exercises.map(e=>e.id===eid?{...e,sets:e.sets.filter(s=>s.id!==sid)}:e)});
  const updSet=(eid,sid,f,v)=>update({...draft,exercises:draft.exercises.map(e=>e.id===eid?{...e,sets:e.sets.map(s=>s.id===sid?{...s,[f]:v}:s)}:e)});

  const vol=draft.exercises.reduce((s,e)=>s+totalVol(e),0);

  const gridCols = showRpe ? "28px 1fr 1fr 1fr 28px" : "28px 1fr 1fr 28px";

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <div className="screen-label">TODAY'S WORKOUT</div>
          <div className="screen-date">{fmtDate(today)}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {vol>0&&(
            <div className="volume-chip">
              <span className="volume-num">{vol.toLocaleString()}</span>
              <span className="volume-unit">kg vol</span>
            </div>
          )}
          <button
            onClick={()=>setShowRpe(r=>!r)}
            style={{
              background:showRpe?"#1a0e00":"#141414",
              border:`1px solid ${showRpe?"#FF3D00":"#2a2a2a"}`,
              borderRadius:4,color:showRpe?"#FF3D00":"#555",
              cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif",
              fontSize:"10px",fontWeight:700,letterSpacing:"1.5px",padding:"5px 9px",
              transition:"all .15s",
            }}
            title="Toggle RPE column"
          >RPE</button>
        </div>
      </div>

      {draft.exercises.length===0&&(
        <div className="empty-state">
          <div className="empty-icon">🏋️</div>
          <div className="empty-text">No exercises yet.<br/>Add one to start logging.</div>
        </div>
      )}

      {draft.exercises.map(ex=>(
        <div key={ex.id} className="exercise-card">
          <div className="exercise-header">
            <div className="exercise-name">{ex.name}</div>
            <div style={{display:"flex",gap:7,alignItems:"center"}}>
              <div className="ex-vol">{totalVol(ex).toLocaleString()} kg</div>
              <button className="icon-btn danger" onClick={()=>remEx(ex.id)}>✕</button>
            </div>
          </div>

          {/* Sets header */}
          <div style={{display:"grid",gridTemplateColumns:gridCols,gap:"5px",marginBottom:"5px",
            fontFamily:"'Barlow Condensed',sans-serif",fontSize:"9px",color:"#3a3a3a",letterSpacing:"2px",fontWeight:700}}>
            <span>#</span>
            <span>KG</span>
            <span>REPS</span>
            {showRpe&&<span style={{color:"#FF3D00aa"}}>RPE</span>}
            <span/>
          </div>

          {ex.sets.map((s,i)=>(
            <div key={s.id} style={{display:"grid",gridTemplateColumns:gridCols,gap:"5px",marginBottom:"5px",alignItems:"center"}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:"14px",color:"#FF3D00",textAlign:"center"}}>{i+1}</div>
              <input className="set-input" type="number" placeholder="0" min="0" step="0.5"
                value={s.weight} onChange={e=>updSet(ex.id,s.id,"weight",e.target.value)}/>
              <input className="set-input" type="number" placeholder="0" min="0"
                value={s.reps} onChange={e=>updSet(ex.id,s.id,"reps",e.target.value)}/>
              {showRpe&&(
                <input className="set-input rpe-input" type="number" placeholder="—"
                  min="1" max="10" step="0.5"
                  value={s.rpe||""} onChange={e=>updSet(ex.id,s.id,"rpe",e.target.value)}/>
              )}
              <button className="icon-btn" onClick={()=>remSet(ex.id,s.id)}>−</button>
            </div>
          ))}
          <button className="add-set-btn" onClick={()=>addSet(ex.id)}>+ ADD SET</button>
        </div>
      ))}

      <button className="add-exercise-btn" onClick={()=>setShowPicker(true)}>+ ADD EXERCISE</button>

      <button
        className={`save-workout-btn ${saveState==="saved"?"saved":""} ${!dirty&&saveState!=="saved"?"idle":""}`}
        onClick={commitSave}
        disabled={!dirty&&saveState!=="saved"}
      >
        {saveState==="saved"?"✓  WORKOUT SAVED":dirty?"SAVE WORKOUT":"NO CHANGES"}
      </button>

      {showPicker&&(
        <div className="modal-overlay" onClick={()=>setShowPicker(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">SELECT EXERCISE</div>
            <div className="custom-ex-row">
              <input className="custom-ex-input" placeholder="Custom exercise name..."
                value={customEx} onChange={e=>setCustomEx(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&customEx.trim()&&addEx(customEx.trim())}/>
              <button className="custom-ex-add" disabled={!customEx.trim()}
                onClick={()=>customEx.trim()&&addEx(customEx.trim())}>ADD</button>
            </div>
            <div className="preset-list">
              {PRESET_EXERCISES.filter(p=>!draft.exercises.find(e=>e.name===p)).map(p=>(
                <button key={p} className="preset-item" onClick={()=>addEx(p)}>{p}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── HISTORY SCREEN ───────────────────────────────────────────────────────────
function HistoryScreen({ workouts }) {
  const sorted=[...workouts].sort((a,b)=>b.date.localeCompare(a.date));
  const [exp,setExp]=useState(null);
  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <div className="screen-label">WORKOUT HISTORY</div>
          <div className="screen-date">{workouts.length} sessions logged</div>
        </div>
      </div>
      {sorted.length===0&&(
        <div className="empty-state"><div className="empty-icon">📋</div>
          <div className="empty-text">No workouts logged yet.<br/>Start training to build your history.</div>
        </div>
      )}
      {sorted.map(w=>{
        const vol=w.exercises.reduce((s,e)=>s+totalVol(e),0),open=exp===w.id;
        return (
          <div key={w.id} className={`history-card ${open?"open":""}`}>
            <button className="history-card-header" onClick={()=>setExp(open?null:w.id)}>
              <div>
                <div className="history-date">{fmtDate(w.date)}</div>
                <div className="history-meta">{w.exercises.length} exercises · {vol.toLocaleString()} kg total</div>
              </div>
              <div className="expand-arrow">{open?"▲":"▼"}</div>
            </button>
            {open&&(
              <div className="history-detail">
                {w.exercises.map(e=>(
                  <div key={e.id} className="history-exercise">
                    <div className="history-ex-name">{e.name}</div>
                    <div className="history-sets">
                      {e.sets.map((s,i)=>(
                        <div key={s.id} className="history-set">
                          <span className="hs-num">S{i+1}</span>
                          <span className="hs-weight">{s.weight||"—"}kg</span>
                          <span className="hs-x">×</span>
                          <span className="hs-reps">{s.reps||"—"}</span>
                          {s.rpe&&<span className="hs-rpe">RPE {s.rpe}</span>}
                        </div>
                      ))}
                    </div>
                    <div className="history-ex-vol">{totalVol(e).toLocaleString()} kg</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── APP SHELL ────────────────────────────────────────────────────────────────
export default function App() {
  const [workouts,saveWorkouts]=useStorage();
  const [screen,setScreen]=useState("workout");

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@400;600;700&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        body{background:#0a0a0a;color:#e0d8cc;font-family:'Barlow',sans-serif;min-height:100vh;overflow-x:hidden;}
        #root{max-width:480px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column;background:#0e0e0e;}

        .topbar{background:#0e0e0e;border-bottom:2px solid #FF3D00;padding:12px 16px 10px;display:flex;align-items:flex-end;gap:10px;flex-shrink:0;}
        .app-logo{font-family:'Bebas Neue',sans-serif;font-size:26px;color:#FF3D00;letter-spacing:2px;line-height:1;}
        .app-tagline{font-family:'Barlow Condensed',sans-serif;font-size:10px;color:#3a3a3a;letter-spacing:3px;text-transform:uppercase;margin-bottom:1px;}

        .screen{flex:1;padding:18px 14px 108px;overflow-y:auto;}
        .screen-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;padding-bottom:13px;border-bottom:1px solid #1c1c1c;}
        .screen-label{font-family:'Barlow Condensed',sans-serif;font-size:10px;color:#FF3D00;letter-spacing:3px;font-weight:700;margin-bottom:3px;}
        .screen-date{font-family:'Bebas Neue',sans-serif;font-size:21px;color:#ddd;letter-spacing:1px;}
        .volume-chip{background:#161616;border:1px solid #252525;border-radius:4px;padding:4px 9px;display:flex;flex-direction:column;align-items:center;}
        .volume-num{font-family:'Bebas Neue',sans-serif;font-size:17px;color:#FFB300;line-height:1;}
        .volume-unit{font-family:'Barlow Condensed',sans-serif;font-size:9px;color:#484848;letter-spacing:1px;}

        .section-heading{display:flex;justify-content:space-between;align-items:center;font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:700;color:#FF3D00;letter-spacing:3px;text-transform:uppercase;margin-bottom:10px;padding-bottom:7px;border-bottom:1px solid #181818;}
        .cal-nav-btn{background:#161616;border:1px solid #222;border-radius:4px;color:#777;cursor:pointer;font-size:15px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;transition:all .15s;}
        .cal-nav-btn:hover{border-color:#FF3D00;color:#FF3D00;}
        @keyframes slideIn{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:translateY(0)}}

        .empty-state{text-align:center;padding:52px 20px;}
        .empty-icon{font-size:42px;margin-bottom:13px;}
        .empty-text{font-size:14px;color:#3e3e3e;line-height:1.7;}

        .exercise-card{background:#131313;border:1px solid #1c1c1c;border-left:3px solid #FF3D00;border-radius:6px;padding:13px;margin-bottom:11px;}
        .exercise-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;}
        .exercise-name{font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;color:#eee;letter-spacing:1px;text-transform:uppercase;}
        .ex-vol{font-family:'Barlow Condensed',sans-serif;font-size:12px;color:#FFB300;font-weight:600;}
        .set-input{background:#0a0a0a;border:1px solid #1e1e1e;border-radius:4px;color:#ddd;font-family:'Barlow',sans-serif;font-size:15px;font-weight:600;padding:7px 4px;text-align:center;width:100%;outline:none;transition:border-color .15s;-moz-appearance:textfield;}
        .set-input::-webkit-inner-spin-button,.set-input::-webkit-outer-spin-button{-webkit-appearance:none;}
        .set-input:focus{border-color:#FF3D00;}
        .rpe-input{border-color:#2a1500 !important;color:#FFB300 !important;}
        .rpe-input:focus{border-color:#FF3D00 !important;}
        .icon-btn{background:#161616;border:1px solid #222;border-radius:4px;color:#555;cursor:pointer;font-size:14px;height:32px;width:32px;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0;}
        .icon-btn:hover{background:#1e1e1e;color:#ddd;}
        .icon-btn.danger:hover{background:#1c0000;color:#FF3D00;border-color:#FF3D00;}
        .add-set-btn{background:transparent;border:1px dashed #222;border-radius:4px;color:#383838;cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-size:10px;letter-spacing:2px;font-weight:700;padding:6px;text-align:center;width:100%;margin-top:4px;transition:all .15s;}
        .add-set-btn:hover{border-color:#FF3D00;color:#FF3D00;}
        .add-exercise-btn{background:transparent;border:1px solid #252525;border-radius:6px;color:#555;cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:700;letter-spacing:3px;padding:11px;width:100%;margin-top:8px;transition:all .15s;}
        .add-exercise-btn:hover{border-color:#555;color:#aaa;}

        .save-workout-btn{display:block;width:100%;margin-top:9px;padding:14px;border-radius:6px;border:none;font-family:'Bebas Neue',sans-serif;font-size:19px;letter-spacing:3px;cursor:pointer;transition:all .2s;background:#FF3D00;color:#fff;box-shadow:0 4px 18px #FF3D0030;}
        .save-workout-btn:hover:not(:disabled){background:#ff5020;transform:translateY(-1px);box-shadow:0 6px 22px #FF3D0050;}
        .save-workout-btn.saved{background:#0c1a0c;color:#4CAF50;border:1px solid #1a3a1a;box-shadow:none;cursor:default;}
        .save-workout-btn.idle:disabled{background:#111;color:#282828;border:1px solid #1a1a1a;box-shadow:none;cursor:default;}

        .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.9);display:flex;align-items:flex-end;z-index:100;}
        .modal{background:#131313;border:1px solid #222;border-radius:12px 12px 0 0;border-top:2px solid #FF3D00;padding:18px 14px;width:100%;max-width:480px;margin:0 auto;max-height:72vh;display:flex;flex-direction:column;}
        .modal-title{font-family:'Bebas Neue',sans-serif;font-size:20px;color:#FF3D00;letter-spacing:2px;margin-bottom:12px;}
        .custom-ex-row{display:flex;gap:7px;margin-bottom:12px;}
        .custom-ex-input{flex:1;background:#0a0a0a;border:1px solid #222;border-radius:5px;color:#ddd;font-family:'Barlow',sans-serif;font-size:15px;padding:9px 11px;outline:none;}
        .custom-ex-input:focus{border-color:#FF3D00;}
        .custom-ex-add{background:#FF3D00;border:none;border-radius:5px;color:#fff;cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-weight:700;letter-spacing:1px;padding:9px 14px;font-size:13px;}
        .custom-ex-add:disabled{background:#222;color:#3e3e3e;cursor:not-allowed;}
        .preset-list{overflow-y:auto;display:flex;flex-direction:column;gap:3px;}
        .preset-item{background:#181818;border:1px solid #1e1e1e;border-radius:5px;color:#aaa;cursor:pointer;font-family:'Barlow',sans-serif;font-size:14px;font-weight:500;padding:10px 13px;text-align:left;transition:all .1s;}
        .preset-item:hover{background:#1c1c1c;border-color:#FF3D00;color:#eee;}

        .history-card{background:#131313;border:1px solid #1c1c1c;border-radius:6px;margin-bottom:8px;overflow:hidden;}
        .history-card.open{border-color:#252525;}
        .history-card-header{background:transparent;border:none;width:100%;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;text-align:left;}
        .history-date{font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;color:#ccc;letter-spacing:1px;margin-bottom:2px;}
        .history-meta{font-size:11px;color:#4a4a4a;font-family:'Barlow Condensed',sans-serif;letter-spacing:1px;}
        .expand-arrow{color:#383838;font-size:11px;}
        .history-detail{padding:0 14px 11px;border-top:1px solid #181818;}
        .history-exercise{padding:8px 0;border-bottom:1px solid #181818;display:flex;align-items:flex-start;gap:8px;}
        .history-exercise:last-child{border-bottom:none;}
        .history-ex-name{font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:700;color:#FF3D00;text-transform:uppercase;letter-spacing:1px;min-width:95px;flex-shrink:0;}
        .history-sets{display:flex;flex-wrap:wrap;gap:3px;flex:1;}
        .history-set{background:#181818;border-radius:3px;padding:3px 6px;font-size:11px;color:#aaa;font-family:'Barlow Condensed',sans-serif;display:flex;gap:3px;align-items:center;}
        .hs-num{color:#383838;font-size:9px;} .hs-weight{color:#FFB300;font-weight:700;} .hs-x{color:#2e2e2e;} .hs-reps{color:#777;} .hs-rpe{color:#FF3D0099;font-size:9px;margin-left:1px;}
        .history-ex-vol{font-family:'Barlow Condensed',sans-serif;font-size:11px;color:#383838;flex-shrink:0;margin-top:2px;}

        .ex-selector-scroll{display:flex;gap:7px;overflow-x:auto;padding-bottom:10px;scrollbar-width:none;}
        .ex-selector-scroll::-webkit-scrollbar{display:none;}
        .ex-chip{background:#161616;border:1px solid #1e1e1e;border-radius:16px;color:#555;cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:600;letter-spacing:1px;padding:6px 13px;white-space:nowrap;flex-shrink:0;transition:all .15s;}
        .ex-chip.active{background:#FF3D00;border-color:#FF3D00;color:#fff;}
        .ex-chip:hover:not(.active){border-color:#3a3a3a;color:#aaa;}

        .pb-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-bottom:14px;}
        .pb-card{background:#131313;border:1px solid #1c1c1c;border-radius:6px;padding:10px 7px;text-align:center;}
        .pb-val{font-family:'Bebas Neue',sans-serif;font-size:24px;color:#FFB300;line-height:1;margin-bottom:3px;}
        .pb-unit{font-size:13px;color:#FF3D00;margin-left:1px;}
        .pb-label{font-family:'Barlow Condensed',sans-serif;font-size:9px;color:#3a3a3a;letter-spacing:2px;}

        .metric-tabs{display:flex;gap:5px;margin-bottom:12px;}
        .metric-tab{flex:1;background:#131313;border:1px solid #1e1e1e;border-radius:4px;color:#444;cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:700;letter-spacing:1px;padding:8px 3px;text-align:center;transition:all .15s;}
        .metric-tab.active{background:#181818;}

        .chart-wrap{background:#111;border:1px solid #1c1c1c;border-radius:8px;padding:14px 8px 6px;margin-bottom:12px;overflow:hidden;}
        .chart-title{font-family:'Barlow Condensed',sans-serif;font-size:11px;letter-spacing:2px;font-weight:700;text-transform:uppercase;margin-bottom:8px;padding:0 6px;}
        .chart-single{text-align:center;padding:20px 0;}
        .chart-single-val{font-family:'Bebas Neue',sans-serif;font-size:48px;line-height:1;}
        .chart-single-sub{font-family:'Barlow Condensed',sans-serif;font-size:12px;color:#3e3e3e;margin-top:5px;}

        .trend-banner{border-radius:5px;padding:10px 13px;display:flex;align-items:center;gap:9px;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:600;letter-spacing:1px;margin-bottom:14px;}
        .trend-banner.up{background:#071207;border:1px solid #122612;color:#4CAF50;}
        .trend-banner.down{background:#120707;border:1px solid #261212;color:#ef5350;}
        .trend-arrow{font-size:18px;}

        .bottom-nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:#0b0b0b;border-top:1px solid #181818;display:flex;z-index:50;}
        .nav-btn{flex:1;background:transparent;border:none;color:#303030;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;padding:11px 0 9px;transition:all .15s;position:relative;}
        .nav-btn.active{color:#FF3D00;}
        .nav-btn.active::after{content:'';position:absolute;top:0;left:20%;width:60%;height:2px;background:#FF3D00;border-radius:0 0 2px 2px;}
        .nav-icon{font-size:18px;line-height:1;}
        .nav-label{font-family:'Barlow Condensed',sans-serif;font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;}
      `}</style>

      <div className="topbar">
        <div className="app-logo">IRONLOG</div>
        <div className="app-tagline">Strength Tracker</div>
      </div>

      {screen==="workout"  && <WorkoutScreen  workouts={workouts} saveWorkouts={saveWorkouts}/>}
      {screen==="history"  && <HistoryScreen  workouts={workouts}/>}
      {screen==="longterm" && <LongTermScreen workouts={workouts}/>}
      {screen==="progress" && <ProgressScreen workouts={workouts}/>}

      <nav className="bottom-nav">
        <button className={`nav-btn ${screen==="workout"?"active":""}`}  onClick={()=>setScreen("workout")}>
          <span className="nav-icon">🏋️</span><span className="nav-label">Today</span>
        </button>
        <button className={`nav-btn ${screen==="history"?"active":""}`}  onClick={()=>setScreen("history")}>
          <span className="nav-icon">📋</span><span className="nav-label">History</span>
        </button>
        <button className={`nav-btn ${screen==="longterm"?"active":""}`} onClick={()=>setScreen("longterm")}>
          <span className="nav-icon">📅</span><span className="nav-label">Calendar</span>
        </button>
        <button className={`nav-btn ${screen==="progress"?"active":""}`} onClick={()=>setScreen("progress")}>
          <span className="nav-icon">📈</span><span className="nav-label">Progress</span>
        </button>
      </nav>
    </>
  );
}
