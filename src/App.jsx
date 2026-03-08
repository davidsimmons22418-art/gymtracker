import { useState, useEffect, useRef, useCallback } from "react";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const STORAGE_KEY   = "ironlog_workouts";
const PRO_KEY       = "ironlog_pro";
const ONBOARD_KEY   = "ironlog_onboarded";
const TEMPLATES_KEY = "ironlog_templates";

const FREE_HISTORY_LIMIT  = 4 * 7;
const FREE_CUSTOM_EX_LIMIT = 5;

const PRESET_EXERCISES = [
  "Bench Press","Squat","Deadlift","Overhead Press","Barbell Row",
  "Pull-Up","Dip","Incline Bench Press","Romanian Deadlift","Leg Press",
  "Lat Pulldown","Cable Row","Dumbbell Curl","Tricep Pushdown",
  "Lateral Raise","Face Pull","Hip Thrust","Leg Curl","Leg Extension","Calf Raise"
];

const BUILTIN_TEMPLATES = [
  { id:"t-push",  name:"Push Day",   icon:"push",  exercises:["Bench Press","Overhead Press","Incline Bench Press","Lateral Raise","Tricep Pushdown","Dip"] },
  { id:"t-pull",  name:"Pull Day",   icon:"pull",  exercises:["Deadlift","Barbell Row","Pull-Up","Lat Pulldown","Cable Row","Dumbbell Curl","Face Pull"] },
  { id:"t-legs",  name:"Leg Day",    icon:"legs",  exercises:["Squat","Romanian Deadlift","Leg Press","Leg Curl","Leg Extension","Hip Thrust","Calf Raise"] },
  { id:"t-upper", name:"Upper Body", icon:"upper", exercises:["Bench Press","Overhead Press","Barbell Row","Pull-Up","Dumbbell Curl","Tricep Pushdown"] },
  { id:"t-full",  name:"Full Body",  icon:"full",  exercises:["Squat","Bench Press","Deadlift","Overhead Press","Barbell Row","Pull-Up"] },
];

const MONTH_NAMES     = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_NAMES_SHORT = ["S","M","T","W","T","F","S"];

// ─── UTILS ────────────────────────────────────────────────────────────────────
function genId()         { return Date.now().toString(36)+Math.random().toString(36).slice(2); }
function todayISO()      { return new Date().toISOString().split("T")[0]; }
function fmtDate(iso)    { return new Date(iso).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}); }
function fmtDateShort(iso){ const p=fmtDate(iso).split(" "); return `${p[0]} ${p[1]}`; }
function totalVol(ex)    { return ex.sets.reduce((s,set)=>s+(parseFloat(set.weight)||0)*(parseInt(set.reps)||0),0); }
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

function usePro() {
  const [isPro, setIsPro] = useState(() => {
    try { return localStorage.getItem(PRO_KEY)==="true"; } catch { return false; }
  });
  const upgradeToPro = () => { setIsPro(true); try { localStorage.setItem(PRO_KEY,"true"); } catch {} };
  return [isPro, upgradeToPro];
}

function useTemplates() {
  const [templates, setTemplates] = useState(() => {
    try { const s=localStorage.getItem(TEMPLATES_KEY); return s?JSON.parse(s):[]; }
    catch { return []; }
  });
  const saveTemplates = (data) => {
    setTemplates(data);
    try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(data)); } catch {}
  };
  return [templates, saveTemplates];
}

// ─── EXPORT ───────────────────────────────────────────────────────────────────
function exportToCSV(workouts) {
  const rows=[["Date","Exercise","Superset","Set","Weight (kg)","Reps","RPE","Volume (kg)","E1RM (kg)"]];
  workouts.forEach(w=>{
    w.exercises.forEach(ex=>{
      ex.sets.forEach((s,i)=>{
        const w_=parseFloat(s.weight)||0,r=parseInt(s.reps)||0;
        rows.push([w.date,ex.name,ex.supersetGroup||"",i+1,s.weight||"",s.reps||"",s.rpe||"",(w_*r).toFixed(1),Math.round(w_*(1+r/30))]);
      });
    });
  });
  const csv=rows.map(r=>r.map(v=>`"${v}"`).join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download=`ironlog-export-${todayISO()}.csv`; a.click(); URL.revokeObjectURL(url);
}
function exportToJSON(workouts) {
  const blob=new Blob([JSON.stringify(workouts,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download=`ironlog-backup-${todayISO()}.json`; a.click(); URL.revokeObjectURL(url);
}

// ─── SVG ICON LIBRARY ─────────────────────────────────────────────────────────
const Icons = {
  // Nav icons
  Dumbbell: ({size=20,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="10" width="4" height="4" rx="1"/><rect x="18" y="10" width="4" height="4" rx="1"/>
      <rect x="5" y="8" width="3" height="8" rx="1"/><rect x="16" y="8" width="3" height="8" rx="1"/>
      <line x1="8" y1="12" x2="16" y2="12"/>
    </svg>
  ),
  History: ({size=20,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
      <path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>
    </svg>
  ),
  Calendar: ({size=20,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
      <rect x="7" y="14" width="2" height="2" rx="0.5" fill={color}/><rect x="11" y="14" width="2" height="2" rx="0.5" fill={color}/><rect x="15" y="14" width="2" height="2" rx="0.5" fill={color}/>
      <rect x="7" y="18" width="2" height="2" rx="0.5" fill={color}/><rect x="11" y="18" width="2" height="2" rx="0.5" fill={color}/>
    </svg>
  ),
  TrendUp: ({size=20,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
    </svg>
  ),
  Settings: ({size=20,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
  // UI icons
  Plus: ({size=16,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  ),
  X: ({size=14,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  Minus: ({size=14,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round">
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  ),
  ChevronDown: ({size=12,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  ),
  ChevronUp: ({size=12,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15"/>
    </svg>
  ),
  ChevronLeft: ({size=16,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  ),
  ChevronRight: ({size=16,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  ),
  ArrowRight: ({size=14,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
    </svg>
  ),
  Check: ({size=16,color="currentColor",stroke=2})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  Note: ({size=16,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>
    </svg>
  ),
  Template: ({size=16,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
    </svg>
  ),
  Lock: ({size=16,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  ),
  Bolt: ({size=24,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  Infinity: ({size=18,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 12c-2-2.5-4-4-6-4a4 4 0 0 0 0 8c2 0 4-1.5 6-4z"/>
      <path d="M12 12c2 2.5 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.5-6 4z"/>
    </svg>
  ),
  Grid: ({size=18,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    </svg>
  ),
  Cloud: ({size=18,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
    </svg>
  ),
  Upload: ({size=18,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  ),
  Download: ({size=18,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  ),
  Table: ({size=18,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18"/>
    </svg>
  ),
  Streak: ({size=18,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 3z"/>
    </svg>
  ),
  Trophy: ({size=18,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
      <path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>
    </svg>
  ),
  // Onboarding icons (larger)
  BarChart: ({size=64,color="currentColor",stroke=1.2})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>
    </svg>
  ),
  CalendarBig: ({size=64,color="currentColor",stroke=1.2})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
      <circle cx="8" cy="15" r="1" fill={color}/><circle cx="12" cy="15" r="1" fill={color}/><circle cx="16" cy="15" r="1" fill={color}/>
    </svg>
  ),
  DumbbellBig: ({size=64,color="currentColor",stroke=1.2})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="9.5" width="4" height="5" rx="1.5"/><rect x="18.5" y="9.5" width="4" height="5" rx="1.5"/>
      <rect x="5" y="7.5" width="3" height="9" rx="1"/><rect x="16" y="7.5" width="3" height="9" rx="1"/>
      <line x1="8" y1="12" x2="16" y2="12" strokeWidth="2"/>
    </svg>
  ),
  ClipboardBig: ({size=64,color="currentColor",stroke=1.2})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
      <rect x="8" y="2" width="8" height="4" rx="1"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/>
    </svg>
  ),
  // Template icons
  ArrowUp: ({size=18,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
    </svg>
  ),
  Rotate: ({size=18,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/>
    </svg>
  ),
  Layers: ({size=18,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2"/>
      <polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>
    </svg>
  ),
  Zap: ({size=18,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  Edit: ({size=14,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  ),
  Trash: ({size=14,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
    </svg>
  ),
  Save: ({size=14,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
    </svg>
  ),
  CopySet: ({size=12,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  ),
  Unlink: ({size=11,color="currentColor",stroke=1.5})=>(
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      <line x1="2" y1="2" x2="22" y2="22"/>
    </svg>
  ),

};
// ─── SPLINE CHART ─────────────────────────────────────────────────────────────
function catmullRomPath(pts) {
  if (pts.length < 2) return "";
  const d = [];
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) {
      d.push(`M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`);
    } else {
      const p0=pts[Math.max(i-2,0)], p1=pts[i-1], p2=pts[i], p3=pts[Math.min(i+1,pts.length-1)];
      const cp1x=p1[0]+(p2[0]-p0[0])/6, cp1y=p1[1]+(p2[1]-p0[1])/6;
      const cp2x=p2[0]-(p3[0]-p1[0])/6, cp2y=p2[1]-(p3[1]-p1[1])/6;
      d.push(`C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`);
    }
  }
  return d.join(" ");
}

function LineChart({ data, color, valueKey }) {
  const svgRef = useRef(null);
  const [tip, setTip] = useState(null);
  if (!data || data.length < 2) return null;

  const W=560, H=200, T=24, R=20, B=42, L=52;
  const cW=W-L-R, cH=H-T-B;
  const vals=data.map(d=>d[valueKey]);
  const minV=Math.min(...vals), maxV=Math.max(...vals);
  const pad=(maxV-minV)*0.15||maxV*0.1||5;
  const lo=Math.max(0,minV-pad), hi=maxV+pad, rng=hi-lo||1;

  const px=i=>L+(i/(data.length-1))*cW;
  const py=v=>T+cH-((v-lo)/rng)*cH;
  const pts=data.map((d,i)=>[px(i),py(d[valueKey])]);
  const linePath=catmullRomPath(pts);
  const areaPath=linePath+` L${pts[pts.length-1][0].toFixed(2)},${(T+cH).toFixed(2)} L${pts[0][0].toFixed(2)},${(T+cH).toFixed(2)} Z`;

  const rawStep=(hi-lo)/5, mag=Math.pow(10,Math.floor(Math.log10(rawStep)));
  const niceStep=Math.ceil(rawStep/mag)*mag;
  const yTicks=[]; let t=Math.ceil(lo/niceStep)*niceStep;
  while(t<=hi){if(t>=lo)yTicks.push(t);t+=niceStep;}

  const xStep=Math.max(1,Math.floor(data.length/6));
  const xLabels=data.reduce((acc,d,i)=>{if(i===0||i===data.length-1||i%xStep===0)acc.push(i);return acc;},[]);
  const fmt=v=>valueKey==="volume"?(v/1000).toFixed(1)+"t":valueKey==="rpe"?v.toFixed(1):Math.round(v)+"";

  const handleMouseMove=useCallback((e)=>{
    if(!svgRef.current)return;
    const rect=svgRef.current.getBoundingClientRect();
    const svgX=((e.clientX-rect.left)/rect.width)*W;
    const idx=Math.round(((svgX-L)/cW)*(data.length-1));
    setTip(Math.max(0,Math.min(data.length-1,idx)));
  },[data.length]);

  const gradId=`grad-${valueKey}`;
  const tipX=tip!==null?pts[tip][0]:null;
  const tipY=tip!==null?pts[tip][1]:null;

  return (
    <div style={{position:"relative",userSelect:"none"}}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
        style={{width:"100%",height:"auto",display:"block",overflow:"visible"}}
        onMouseMove={handleMouseMove} onMouseLeave={()=>setTip(null)}
        onTouchMove={e=>{e.preventDefault();handleMouseMove(e.touches[0]);}} onTouchEnd={()=>setTip(null)}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".3"/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </linearGradient>
          <clipPath id={`clip-${valueKey}`}><rect x={L} y={T} width={cW} height={cH}/></clipPath>
        </defs>
        {yTicks.map((v,i)=>(
          <g key={i}>
            <line x1={L} y1={py(v)} x2={L+cW} y2={py(v)} stroke="#3A4558" strokeWidth="1" strokeDasharray="3,4"/>
            <text x={L-8} y={py(v)} fill="#5C6478" fontSize="10" textAnchor="end" dominantBaseline="middle" fontFamily="'DM Mono',monospace">{fmt(v)}</text>
          </g>
        ))}
        <line x1={L} y1={T+cH} x2={L+cW} y2={T+cH} stroke="#465264" strokeWidth="1.5"/>
        <path d={areaPath} fill={`url(#${gradId})`} clipPath={`url(#clip-${valueKey})`}/>
        <path d={linePath} fill="none" stroke={color} strokeWidth="5" strokeOpacity=".15" strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#clip-${valueKey})`}/>
        <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#clip-${valueKey})`}/>
        {xLabels.map(i=>(
          <text key={i} x={px(i)} y={H-6} fill="#586070" fontSize="9.5" textAnchor="middle" fontFamily="'DM Mono',monospace">{fmtDateShort(data[i].date)}</text>
        ))}
        {tip!==null&&(
          <g>
            <line x1={tipX} y1={T} x2={tipX} y2={T+cH} stroke={color} strokeWidth="1" strokeOpacity=".4" strokeDasharray="3,3"/>
            <circle cx={tipX} cy={tipY} r="8" fill={color} fillOpacity=".15" stroke={color} strokeWidth="1.5" strokeOpacity=".5"/>
            <circle cx={tipX} cy={tipY} r="4" fill={color} stroke="#252B33" strokeWidth="2"/>
          </g>
        )}
        {data.length<=20&&tip===null&&pts.map(([x,y],i)=>(
          <circle key={i} cx={x} cy={y} r="3" fill={color} stroke="#252B33" strokeWidth="1.5" opacity=".7"/>
        ))}
      </svg>
      {tip!==null&&tipX!==null&&(()=>{
        const pct=(tipX/W)*100, flipLeft=pct>70;
        return (
          <div style={{position:"absolute",top:"4px",left:flipLeft?"auto":`${pct}%`,right:flipLeft?`${100-pct}%`:"auto",
            transform:flipLeft?"translateX(50%)":"translateX(-50%)",background:"#232830",border:`1px solid ${color}`,
            borderRadius:"8px",padding:"8px 13px",pointerEvents:"none",zIndex:20,minWidth:"90px",boxShadow:`0 4px 20px ${color}33`}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:"9px",color:"#8A9AB8",letterSpacing:"1px",marginBottom:"2px"}}>{fmtDate(data[tip].date)}</div>
            <div style={{fontFamily:"'itc-avant-garde-gothic-pro',sans-serif",fontWeight:300,fontStyle:"italic",fontSize:"28px",color,lineHeight:1}}>
              {valueKey==="volume"?(data[tip][valueKey]/1000).toFixed(2)+"t":valueKey==="rpe"?data[tip][valueKey]:data[tip][valueKey]+"kg"}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── PAYWALL MODAL ────────────────────────────────────────────────────────────
function PaywallModal({ onClose, onUpgrade }) {
  const features = [
    { icon: <Icons.Infinity size={18} color="#2196F3"/>, text: "Unlimited workout history" },
    { icon: <Icons.Grid size={18} color="#2196F3"/>, text: "Unlimited custom exercises" },
    { icon: <Icons.TrendUp size={18} color="#2196F3"/>, text: "All progress metrics & RPE charts" },
    { icon: <Icons.Template size={18} color="#2196F3"/>, text: "Workout templates (Push/Pull/Legs)" },
    { icon: <Icons.Cloud size={18} color="#2196F3"/>, text: "Cloud backup & sync" },
    { icon: <Icons.Upload size={18} color="#2196F3"/>, text: "Export to CSV & JSON" },
  ];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal paywall-modal" onClick={e=>e.stopPropagation()}>
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{width:56,height:56,borderRadius:"50%",background:"#2196F315",border:"1px solid #2196F333",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px"}}>
            <Icons.Bolt size={28} color="#2196F3" stroke={1.5}/>
          </div>
          <div style={{fontFamily:"'itc-avant-garde-gothic-pro',sans-serif",fontWeight:300,fontStyle:"italic",fontSize:"24px",color:"#2196F3",letterSpacing:"1px",fontWeight:600}}>IRONLOG PRO</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:"11px",color:"#8A9AB8",marginTop:4}}>Unlock your full potential</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:9,marginBottom:22}}>
          {features.map((f,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:11,background:"#2A3040",border:"1px solid #3A4558",borderRadius:7,padding:"10px 13px"}}>
              <span style={{flexShrink:0}}>{f.icon}</span>
              <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"14px",color:"#D0DAEC",fontWeight:600,letterSpacing:"0.5px"}}>{f.text}</span>
            </div>
          ))}
        </div>
        <div style={{background:"#2196F315",border:"1px solid #2196F333",borderRadius:8,padding:"13px",textAlign:"center",marginBottom:16}}>
          <div style={{fontFamily:"'itc-avant-garde-gothic-pro',sans-serif",fontWeight:300,fontStyle:"italic",fontSize:"28px",color:"#2196F3",lineHeight:1,fontWeight:600}}>£3.99<span style={{fontSize:"16px",color:"#2196F399"}}>/month</span></div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"#8A9AB8",marginTop:4}}>or £29.99/year · 7-day free trial</div>
        </div>
        <button className="save-workout-btn" style={{marginTop:0}} onClick={onUpgrade}>START FREE TRIAL</button>
        <button onClick={onClose} style={{background:"transparent",border:"none",color:"#586070",cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif",fontSize:"12px",letterSpacing:"2px",marginTop:12,width:"100%",textAlign:"center",padding:"6px"}}>MAYBE LATER</button>
      </div>
    </div>
  );
}

// ─── ONBOARDING ───────────────────────────────────────────────────────────────
function OnboardingScreen({ onDone }) {
  const [step, setStep] = useState(0);
  const steps = [
    { icon: <Icons.DumbbellBig size={64} color="#2196F3" stroke={1.2}/>, title: "WELCOME TO\nIRONLOG", sub: "The no-nonsense strength tracker built for serious lifters." },
    { icon: <Icons.ClipboardBig size={64} color="#2196F3" stroke={1.2}/>, title: "LOG YOUR\nWORKOUTS", sub: "Add exercises, track sets, weight and reps. Your data, your gains." },
    { icon: <Icons.BarChart size={64} color="#2196F3" stroke={1.2}/>, title: "TRACK YOUR\nPROGRESS", sub: "Visualise your 1RM, volume and RPE trends over time." },
    { icon: <Icons.CalendarBig size={64} color="#2196F3" stroke={1.2}/>, title: "BUILD YOUR\nSTREAK", sub: "Stay consistent. Watch your calendar fill up with wins." },
  ];
  const s = steps[step];
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",padding:"40px 24px",background:"#1A1F28",textAlign:"center"}}>
      <div style={{marginBottom:24,animation:"pulse 2s infinite",opacity:0.9}}>{s.icon}</div>
      <div style={{fontFamily:"'itc-avant-garde-gothic-pro',sans-serif",fontWeight:300,fontStyle:"italic",fontSize:"32px",color:"#EEF2FA",letterSpacing:"1px",lineHeight:1.15,fontWeight:600,marginBottom:14,whiteSpace:"pre-line"}}>{s.title}</div>
      <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"16px",color:"#8A9AB8",letterSpacing:"0.5px",lineHeight:1.6,maxWidth:280,marginBottom:40}}>{s.sub}</div>
      <div style={{display:"flex",gap:6,marginBottom:32}}>
        {steps.map((_,i)=>(
          <div key={i} style={{width:i===step?20:6,height:6,borderRadius:3,background:i===step?"#2196F3":"#3F4C5C",transition:"all .3s"}}/>
        ))}
      </div>
      {step < steps.length-1
        ? <button className="save-workout-btn" style={{maxWidth:280}} onClick={()=>setStep(s=>s+1)}>NEXT</button>
        : <button className="save-workout-btn" style={{maxWidth:280}} onClick={onDone}>LET'S GO</button>
      }
      {step > 0 && (
        <button onClick={()=>setStep(s=>s-1)} style={{background:"transparent",border:"none",color:"#586070",cursor:"pointer",fontFamily:"'Barlow Condensed',sans-serif",fontSize:"12px",letterSpacing:"2px",marginTop:14,padding:"6px"}}>BACK</button>
      )}
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
      <div style={{fontFamily:"'itc-avant-garde-gothic-pro',sans-serif",fontWeight:300,fontStyle:"italic",fontSize:"17px",color:"#B0BECC",letterSpacing:"1px",marginBottom:"7px"}}>
        {MONTH_NAMES[month]} <span style={{color:"#586070"}}>{year}</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"2px",marginBottom:"3px"}}>
        {DAY_NAMES_SHORT.map((n,i)=>(
          <div key={i} style={{textAlign:"center",fontFamily:"'DM Mono',monospace",fontSize:"9px",color:"#4C5870",fontWeight:700,letterSpacing:"1px",padding:"2px 0"}}>{n}</div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"3px"}}>
        {cells.map((cell,i)=>{
          if(!cell) return <div key={i}/>;
          const has=workoutDates.has(cell.iso),isToday=cell.iso===today,isSel=cell.iso===selected;
          return (
            <div key={i} onClick={()=>has&&onSelect(isSel?null:cell.iso)}
              style={{aspectRatio:"1",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                borderRadius:"5px",fontFamily:"'DM Mono',monospace",fontSize:"11px",fontWeight:600,cursor:has?"pointer":"default",
                transition:"all .15s",gap:"2px",background:isSel?"#0D2137":has?"#0A1929":"transparent",
                color:isSel?"#2196F3":has?"#90CAF9":isToday?"#8A9AB8":"#424F60",
                border:isSel?"1px solid #2196F3":isToday?"1px solid #485468":"1px solid transparent",
                boxShadow:has&&!isSel?"inset 0 0 0 1px #1565C0":"none"}}>
              <span>{cell.d}</span>
              {has&&<div style={{width:3,height:3,borderRadius:"50%",background:"#2196F3",opacity:isSel?1:.8}}/>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
// ─── LONG TERM / CALENDAR SCREEN ──────────────────────────────────────────────
function LongTermScreen({ workouts }) {
  const now=new Date();
  const [yr,setYr]=useState(now.getFullYear());
  const [mo,setMo]=useState(now.getMonth());
  const [selDate,setSelDate]=useState(null);

  const wDates=new Set(workouts.map(w=>w.date));
  const selWorkout=selDate?workouts.find(w=>w.date===selDate):null;
  const prevMo=()=>{if(mo===0){setYr(y=>y-1);setMo(11);}else setMo(m=>m-1);};
  const nextMo=()=>{if(mo===11){setYr(y=>y+1);setMo(0);}else setMo(m=>m+1);};

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
    while(m<0){m+=12;y--;}while(m>11){m-=12;y++;}
    months.push({y,m});
  }

  const streakCards = [
    {v:curStreak, l:"CURRENT STREAK", icon:<Icons.Streak size={18} color="#2196F3"/>},
    {v:longest,   l:"LONGEST STREAK", icon:<Icons.Trophy size={18} color="#38BDF8"/>},
    {v:workouts.length, l:"TOTAL SESSIONS", icon:<Icons.History size={18} color="#A78BFA"/>},
  ];

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
        {streakCards.map((s,i)=>(
          <div key={i} style={{background:"#2A3040",border:"1px solid #3A4558",borderRadius:8,padding:"13px 7px",textAlign:"center"}}>
            <div style={{display:"flex",justifyContent:"center",marginBottom:6}}>{s.icon}</div>
            <div style={{fontFamily:"'itc-avant-garde-gothic-pro',sans-serif",fontWeight:300,fontStyle:"italic",fontSize:"26px",color:"#2196F3",lineHeight:1,marginBottom:3,fontWeight:600}}>{s.v}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:"8px",color:"#627080",letterSpacing:"1px"}}>{s.l}</div>
          </div>
        ))}
      </div>

      <div className="section-heading">
        <span>CALENDAR</span>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <button className="cal-nav-btn" onClick={prevMo}><Icons.ChevronLeft size={14} color="#9BAAC8"/></button>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:"11px",color:"#8A9AB8",minWidth:78,textAlign:"center"}}>{MONTH_NAMES[mo]} {yr}</span>
          <button className="cal-nav-btn" onClick={nextMo}><Icons.ChevronRight size={14} color="#9BAAC8"/></button>
        </div>
      </div>

      <div style={{background:"#2A3040",border:"1px solid #3A4558",borderRadius:10,padding:"15px 13px 10px",marginBottom:14}}>
        {months.map(({y,m})=>(
          <CalMonth key={`${y}-${m}`} year={y} month={m} workoutDates={wDates} selected={selDate} onSelect={setSelDate}/>
        ))}
        <div style={{display:"flex",alignItems:"center",gap:7,paddingTop:8,borderTop:"1px solid #313848",
          fontFamily:"'DM Mono',monospace",fontSize:"9px",color:"#586070",letterSpacing:"1px"}}>
          <div style={{width:10,height:10,borderRadius:2,background:"#0A1929",border:"1px solid #1565C0"}}/>
          <span>LOGGED</span>
          <div style={{width:10,height:10,borderRadius:2,background:"#0D2137",border:"1px solid #2196F3",marginLeft:8}}/>
          <span>SELECTED</span>
        </div>
      </div>

      {selWorkout&&(
        <div style={{background:"#2A3040",border:"1px solid #4C5870",borderLeft:"3px solid #2196F3",borderRadius:8,padding:13,marginBottom:14,animation:"slideIn .15s ease"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:11}}>
            <div>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"16px",fontWeight:700,color:"#EEF2FA",letterSpacing:"1px"}}>{fmtDate(selDate)}</div>
              <div style={{fontSize:"11px",color:"#8A9AB8",fontFamily:"'DM Mono',monospace",marginTop:2}}>
                {selWorkout.exercises.length} exercises · {selWorkout.exercises.reduce((s,e)=>s+totalVol(e),0).toLocaleString()} kg total
              </div>
            </div>
            <button className="icon-btn" onClick={()=>setSelDate(null)}><Icons.X size={13} color="#7080A0"/></button>
          </div>
          {selWorkout.exercises.map(e=>(
            <div key={e.id} style={{paddingBottom:7,marginBottom:7,borderBottom:"1px solid #38444F"}}>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"12px",fontWeight:700,color:"#2196F3",textTransform:"uppercase",letterSpacing:"1px",marginBottom:5}}>{e.name}</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                {e.sets.map(s=>(
                  <span key={s.id} style={{background:"#35404F",border:"1px solid #3F4C5C",borderRadius:4,fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"#CAD4E4",padding:"3px 7px"}}>
                    {s.weight||"—"}kg × {s.reps||"—"}{s.rpe?` · RPE ${s.rpe}`:""}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {workouts.length===0&&(
        <div className="empty-state">
          <div className="empty-icon-svg"><Icons.Calendar size={40} color="#3A4558" stroke={1.2}/></div>
          <div className="empty-text">Log workouts to see your calendar fill up.</div>
        </div>
      )}
    </div>
  );
}

// ─── PROGRESS SCREEN ──────────────────────────────────────────────────────────
function ProgressScreen({ workouts, isPro, onPaywall }) {
  const [selEx,setSelEx]=useState(null);
  const [metric,setMetric]=useState("e1rm");

  const allNames=[...new Set(workouts.flatMap(w=>w.exercises.map(e=>e.name)))].sort();
  useEffect(()=>{ if(allNames.length&&!selEx) setSelEx(allNames[0]); },[allNames.length]);

  const chartData=workouts
    .filter(w=>w.exercises.find(e=>e.name===selEx))
    .map(w=>{
      const ex=w.exercises.find(e=>e.name===selEx);
      const bs=bestSet(ex);
      const rpeVals=ex.sets.map(s=>parseFloat(s.rpe)).filter(v=>!isNaN(v)&&v>0);
      return {date:w.date,bestWeight:parseFloat(bs?.weight)||0,volume:totalVol(ex),e1rm:calcE1rm(bs),
        rpe:rpeVals.length?Math.round(rpeVals.reduce((a,b)=>a+b,0)/rpeVals.length*10)/10:null};
    }).sort((a,b)=>a.date.localeCompare(b.date));

  const metricMap={
    e1rm:{key:"e1rm",color:"#2196F3",label:"Est. 1RM"},
    weight:{key:"bestWeight",color:"#A78BFA",label:"Best Weight"},
    volume:{key:"volume",color:"#38BDF8",label:"Volume"},
    rpe:{key:"rpe",color:"#34D399",label:"Avg RPE",pro:true},
  };
  const cm=metricMap[metric];
  const activeChartData=metric==="rpe"?chartData.filter(d=>d.rpe!==null):chartData;

  const rpeValsAll=chartData.map(d=>d.rpe).filter(v=>v!==null);
  const pbs={w:Math.max(...chartData.map(d=>d.bestWeight),0),e:Math.max(...chartData.map(d=>d.e1rm),0),
    v:Math.max(...chartData.map(d=>d.volume),0),r:rpeValsAll.length?Math.max(...rpeValsAll):null};

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
          <div className="empty-icon-svg"><Icons.TrendUp size={40} color="#3A4558" stroke={1.2}/></div>
          <div className="empty-text">Log workouts to track progression.</div>
        </div>
      ):(
        <>
          <div className="ex-selector-scroll" style={{marginBottom:16}}>
            {allNames.map(n=>(
              <button key={n} className={`ex-chip ${selEx===n?"active":""}`} onClick={()=>setSelEx(n)}>{n}</button>
            ))}
          </div>

          {chartData.length>0&&(
            <>
              <div className="pb-row">
                {[
                  {v:pbs.w+"kg",l:"BEST WEIGHT",c:"#A78BFA"},
                  {v:pbs.e+"kg",l:"BEST E1RM",c:"#2196F3"},
                  {v:(pbs.v/1000).toFixed(1)+"t",l:"BEST VOL",c:"#38BDF8"},
                  {v:pbs.r??"-",l:"PEAK RPE",c:"#34D399",pro:true},
                ].map((s,i)=>(
                  <div key={i} className="pb-card" onClick={s.pro&&!isPro?onPaywall:null}
                    style={{cursor:s.pro&&!isPro?"pointer":"default",position:"relative",overflow:"hidden"}}>
                    {s.pro&&!isPro&&<div style={{position:"absolute",top:4,right:4,background:"#2196F3",borderRadius:3,fontFamily:"'DM Mono',monospace",fontSize:"7px",color:"#fff",padding:"1px 4px",letterSpacing:"0.5px"}}>PRO</div>}
                    <div className="pb-val" style={{color:s.pro&&!isPro?"#485468":s.c,filter:s.pro&&!isPro?"blur(4px)":"none"}}>{s.v}</div>
                    <div className="pb-label">{s.l}</div>
                  </div>
                ))}
              </div>

              <div className="metric-tabs">
                {Object.entries(metricMap).map(([k,v])=>(
                  <button key={k} className={`metric-tab ${metric===k?"active":""}`}
                    style={metric===k?{borderColor:v.color,color:v.color}:{}}
                    onClick={()=>{if(v.pro&&!isPro){onPaywall();return;}setMetric(k);}}>
                    {v.label}{v.pro&&!isPro&&<span style={{marginLeft:3,fontSize:"8px",color:"#2196F3"}}>PRO</span>}
                  </button>
                ))}
              </div>

              <div className="chart-wrap">
                <div className="chart-title" style={{color:cm.color}}>{selEx} — {cm.label}</div>
                {activeChartData.length<2?(
                  <div className="chart-single">
                    <div className="chart-single-val" style={{color:cm.color}}>
                      {activeChartData[0]?cm.key==="volume"?(activeChartData[0][cm.key]/1000).toFixed(2)+"t":activeChartData[0][cm.key]+"kg":"—"}
                    </div>
                    <div className="chart-single-sub">Keep training to see trends</div>
                  </div>
                ):(
                  <LineChart data={activeChartData} color={cm.color} valueKey={cm.key}/>
                )}
              </div>

              {activeChartData.length>=2&&(()=>{
                const first=activeChartData[0][cm.key],last=activeChartData[activeChartData.length-1][cm.key];
                const pct=first>0?Math.round(((last-first)/first)*100):0;
                const positive=cm.key==="rpe"?pct<=0:pct>=0;
                return (
                  <div className={`trend-banner ${positive?"up":"down"}`}>
                    <span className="trend-arrow">{pct>=0?<Icons.ArrowUp size={16} color="#4CAF50"/>:<Icons.ArrowUp size={16} color="#ef5350" style={{transform:"rotate(180deg)"}}/>}</span>
                    <span>{Math.abs(pct)}% {pct>=0?"increase":"decrease"} across {activeChartData.length} sessions</span>
                  </div>
                );
              })()}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── WORKOUT SCREEN ───────────────────────────────────────────────────────────

// ─── CONFIRM DIALOG ───────────────────────────────────────────────────────────
function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{maxHeight:"auto",padding:"22px 18px"}} onClick={e=>e.stopPropagation()}>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"16px",color:"#D0DAEC",marginBottom:20,lineHeight:1.5}}>{message}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <button onClick={onCancel} style={{background:"#2A3040",border:"1px solid #3A4558",borderRadius:7,color:"#8A9AB8",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:"11px",letterSpacing:"1.5px",padding:"12px"}}>CANCEL</button>
          <button onClick={onConfirm} style={{background:"#1A0808",border:"1px solid #5A1A1A",borderRadius:7,color:"#ef5350",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:"11px",letterSpacing:"1.5px",padding:"12px"}}>CONFIRM</button>
        </div>
      </div>
    </div>
  );
}

// ─── SAVE-AS-TEMPLATE MODAL ───────────────────────────────────────────────────
function SaveTemplateModal({ exercises, onSave, onClose }) {
  const [name, setName] = useState("");
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="modal-title">SAVE AS TEMPLATE</div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"#7080A0",marginBottom:12,letterSpacing:"1px"}}>
          {exercises.length} EXERCISE{exercises.length!==1?"S":""}
        </div>
        <input className="custom-ex-input" style={{width:"100%",marginBottom:14,boxSizing:"border-box"}}
          placeholder="Template name..." value={name} onChange={e=>setName(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&name.trim()&&onSave(name.trim())}
        />
        <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:16,maxHeight:160,overflowY:"auto"}}>
          {exercises.map((ex,i)=>(
            <div key={i} style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"13px",color:"#8A9AB8",padding:"5px 0",borderBottom:"1px solid #2D3A50",letterSpacing:"0.5px"}}>{ex.name}</div>
          ))}
        </div>
        <button className="save-workout-btn" style={{marginTop:0}} disabled={!name.trim()} onClick={()=>name.trim()&&onSave(name.trim())}>SAVE TEMPLATE</button>
      </div>
    </div>
  );
}

// ─── WORKOUT EDITOR (shared by Today + past-edit) ─────────────────────────────
function WorkoutEditor({ initial, workouts, saveWorkouts, isPro, onPaywall, userTemplates, saveTemplates, onClose, isNew }) {
  const [draft, setDraft] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [showPicker, setShowPicker] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [customEx, setCustomEx] = useState("");
  const [showRpe, setShowRpe] = useState(false);
  const [showNotes, setShowNotes] = useState(!!initial.notes);
  const [editingExId, setEditingExId] = useState(null);
  const [editingExName, setEditingExName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [supersetMode, setSupersetMode] = useState(false);
  const [supersetSelected, setSupersetSelected] = useState([]);

  const update = (u) => { setDraft(u); setDirty(true); setSaveState("idle"); };

  const customExNames = workouts.flatMap(w=>w.exercises.map(e=>e.name)).filter(n=>!PRESET_EXERCISES.includes(n));
  const uniqueCustom  = [...new Set(customExNames)];

  const TEMPLATE_ICONS = {
    "Push Day":<Icons.ArrowUp size={20} color="#38BDF8"/>,
    "Pull Day":<Icons.Rotate size={20} color="#38BDF8"/>,
    "Leg Day":<Icons.Layers size={20} color="#38BDF8"/>,
    "Upper Body":<Icons.DumbbellBig size={20} color="#38BDF8" stroke={1.5}/>,
    "Full Body":<Icons.Zap size={20} color="#38BDF8"/>
  };

  const addEx = (name) => {
    if (!PRESET_EXERCISES.includes(name) && !isPro && uniqueCustom.length>=FREE_CUSTOM_EX_LIMIT && !draft.exercises.find(e=>e.name===name)) {
      onPaywall(); return;
    }
    update({...draft, exercises:[...draft.exercises,{id:genId(),name,sets:[{id:genId(),weight:"",reps:"",rpe:""}],supersetGroup:null}]});
    setShowPicker(false); setShowTemplates(false); setCustomEx("");
  };

  const loadTemplate = (tmpl) => {
    const exs = tmpl.exercises.map(name=>({id:genId(),name,sets:[{id:genId(),weight:"",reps:"",rpe:""}],supersetGroup:null}));
    update({...draft, exercises:exs});
    setShowTemplates(false);
  };

  const remEx  = (id) => update({...draft,exercises:draft.exercises.filter(e=>e.id!==id)});
  const addSet = (eid) => update({...draft,exercises:draft.exercises.map(e=>e.id===eid?{...e,sets:[...e.sets,{id:genId(),weight:"",reps:"",rpe:""}]}:e)});
  const remSet = (eid,sid) => update({...draft,exercises:draft.exercises.map(e=>e.id===eid?{...e,sets:e.sets.filter(s=>s.id!==sid)}:e)});
  const updSet = (eid,sid,f,v) => update({...draft,exercises:draft.exercises.map(e=>e.id===eid?{...e,sets:e.sets.map(s=>s.id===sid?{...s,[f]:v}:s)}:e)});

  const copyLastSet = (eid) => {
    const ex = draft.exercises.find(e=>e.id===eid);
    if (!ex||!ex.sets.length) return;
    const last = ex.sets[ex.sets.length-1];
    update({...draft,exercises:draft.exercises.map(e=>e.id===eid?{...e,sets:[...e.sets,{id:genId(),weight:last.weight,reps:last.reps,rpe:last.rpe||""}]}:e)});
  };

  const renameEx = (eid) => {
    if (!editingExName.trim()) return;
    update({...draft,exercises:draft.exercises.map(e=>e.id===eid?{...e,name:editingExName.trim()}:e)});
    setEditingExId(null); setEditingExName("");
  };

  // Superset grouping
  const toggleSupersetSelect = (eid) => {
    setSupersetSelected(prev => prev.includes(eid)?prev.filter(x=>x!==eid):[...prev,eid]);
  };
  const commitSuperset = () => {
    if (supersetSelected.length < 2) return;
    const groupId = genId();
    update({...draft,exercises:draft.exercises.map(e=>supersetSelected.includes(e.id)?{...e,supersetGroup:groupId}:e)});
    setSupersetMode(false); setSupersetSelected([]);
  };
  const removeFromSuperset = (eid) => {
    update({...draft,exercises:draft.exercises.map(e=>e.id===eid?{...e,supersetGroup:null}:e)});
  };
  const breakSuperset = (groupId) => {
    update({...draft,exercises:draft.exercises.map(e=>e.supersetGroup===groupId?{...e,supersetGroup:null}:e)});
  };

  const commitSave = () => {
    saveWorkouts([...workouts.filter(w=>w.id!==draft.id), draft].sort((a,b)=>b.date.localeCompare(a.date)));
    setDirty(false); setSaveState("saved");
    setTimeout(()=>{ setSaveState("idle"); if(onClose) onClose(); }, 1200);
  };

  const handleDeleteWorkout = () => {
    saveWorkouts(workouts.filter(w=>w.id!==draft.id));
    setConfirmDelete(false);
    if (onClose) onClose();
  };

  const handleSaveTemplate = (name) => {
    const tmpl = { id:genId(), name, exercises:draft.exercises.map(e=>e.name), custom:true, createdAt:todayISO() };
    saveTemplates([...userTemplates, tmpl]);
    setShowSaveTemplate(false);
  };

  const allTemplates = [...BUILTIN_TEMPLATES, ...userTemplates];

  const vol = draft.exercises.reduce((s,e)=>s+totalVol(e),0);
  const gridCols = showRpe ? "28px 1fr 1fr 1fr 32px 28px" : "28px 1fr 1fr 32px 28px";

  // Group exercises for rendering superset brackets
  const renderExercises = () => {
    const rendered = [];
    const seen = new Set();
    draft.exercises.forEach((ex, idx) => {
      if (seen.has(ex.id)) return;
      if (ex.supersetGroup) {
        const group = draft.exercises.filter(e=>e.supersetGroup===ex.supersetGroup);
        group.forEach(e=>seen.add(e.id));
        rendered.push(
          <div key={ex.supersetGroup} className="superset-group">
            <div className="superset-label">
              <Icons.Zap size={10} color="#38BDF8"/>
              <span>SUPERSET</span>
              <button className="superset-break-btn" onClick={()=>breakSuperset(ex.supersetGroup)}>UNGROUP</button>
            </div>
            {group.map(gex=>renderExCard(gex, true))}
          </div>
        );
      } else {
        seen.add(ex.id);
        rendered.push(renderExCard(ex, false));
      }
    });
    return rendered;
  };

  const renderExCard = (ex, inSuperset) => (
    <div key={ex.id} className={`exercise-card ${supersetMode&&supersetSelected.includes(ex.id)?"selected":""} ${inSuperset?"in-superset":""}`}
      onClick={supersetMode?()=>toggleSupersetSelect(ex.id):undefined}
      style={supersetMode?{cursor:"pointer",outline:supersetSelected.includes(ex.id)?"2px solid #38BDF8":"2px solid transparent",outlineOffset:"-2px"}:{}}>
      <div className="exercise-header">
        {editingExId===ex.id ? (
          <div style={{display:"flex",gap:6,flex:1,marginRight:8}}>
            <input className="custom-ex-input" style={{flex:1,fontSize:"13px",padding:"6px 10px"}}
              value={editingExName} onChange={e=>setEditingExName(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter")renameEx(ex.id);if(e.key==="Escape"){setEditingExId(null);setEditingExName("");}}}
              autoFocus/>
            <button className="custom-ex-add" style={{padding:"6px 10px",fontSize:"11px"}} onClick={()=>renameEx(ex.id)}>✓</button>
          </div>
        ) : (
          <button className="exercise-name-btn" onClick={()=>{setEditingExId(ex.id);setEditingExName(ex.name);}}>
            {ex.name}
            <Icons.Edit size={11} color="#485468"/>
          </button>
        )}
        <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
          {inSuperset && <button className="icon-btn" style={{width:26,height:26}} title="Remove from superset" onClick={()=>removeFromSuperset(ex.id)}><Icons.Unlink size={11} color="#38BDF8"/></button>}
          <div className="ex-vol">{totalVol(ex).toLocaleString()} kg</div>
          <button className="icon-btn danger" onClick={()=>remEx(ex.id)}><Icons.X size={13} color="#7080A0"/></button>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:gridCols,gap:"5px",marginBottom:"5px",
        fontFamily:"'DM Mono',monospace",fontSize:"9px",color:"#586070",letterSpacing:"1.5px"}}>
        <span>#</span><span>KG</span><span>REPS</span>{showRpe&&<span style={{color:"#2196F3aa"}}>RPE</span>}<span/><span/>
      </div>

      {ex.sets.map((s,i)=>(
        <div key={s.id} style={{display:"grid",gridTemplateColumns:gridCols,gap:"5px",marginBottom:"5px",alignItems:"center"}}>
          <div style={{fontFamily:"'itc-avant-garde-gothic-pro',sans-serif",fontWeight:300,fontStyle:"italic",fontSize:"14px",color:"#2196F3",textAlign:"center"}}>{i+1}</div>
          <input className="set-input" type="number" placeholder="0" min="0" step="0.5" value={s.weight} onChange={e=>updSet(ex.id,s.id,"weight",e.target.value)}/>
          <input className="set-input" type="number" placeholder="0" min="0" value={s.reps} onChange={e=>updSet(ex.id,s.id,"reps",e.target.value)}/>
          {showRpe&&<input className="set-input rpe-input" type="number" placeholder="—" min="1" max="10" step="0.5" value={s.rpe||""} onChange={e=>updSet(ex.id,s.id,"rpe",e.target.value)}/>}
          {i===ex.sets.length-1 ? (
            <button className="icon-btn copy-set-btn" title="Copy to next set" onClick={()=>copyLastSet(ex.id)}>
              <Icons.CopySet size={12} color="#38BDF8"/>
            </button>
          ) : <span/>}
          <button className="icon-btn" onClick={()=>remSet(ex.id,s.id)}><Icons.Minus size={13} color="#7080A0"/></button>
        </div>
      ))}
      <button className="add-set-btn" onClick={()=>addSet(ex.id)}>+ ADD SET</button>
    </div>
  );

  return (
    <div className="screen">
      {/* Header */}
      <div className="screen-header">
        <div style={{flex:1}}>
          <div className="screen-label">{isNew?"NEW WORKOUT":onClose?"EDIT WORKOUT":"TODAY'S WORKOUT"}</div>
          <button className="date-edit-btn" onClick={()=>setShowDatePicker(true)}>
            {fmtDate(draft.date)}
            <Icons.Edit size={11} color="#5C7090"/>
          </button>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          {vol>0&&<div className="volume-chip"><span className="volume-num">{vol.toLocaleString()}</span><span className="volume-unit">kg</span></div>}
          <button onClick={()=>setShowRpe(r=>!r)} className="toggle-btn" style={{borderColor:showRpe?"#2196F3":"#485468",color:showRpe?"#2196F3":"#8A9AB8",background:showRpe?"#0A1929":"#2A3040"}}>RPE</button>
          <button onClick={()=>setShowNotes(r=>!r)} className="toggle-btn" style={{display:"flex",alignItems:"center",justifyContent:"center",padding:"5px 8px",borderColor:showNotes?"#38BDF8":"#485468",background:showNotes?"#0A1929":"#2A3040"}}>
            <Icons.Note size={14} color={showNotes?"#38BDF8":"#8A9AB8"}/>
          </button>
          {!isNew&&onClose&&<button className="icon-btn danger" onClick={()=>setConfirmDelete(true)} title="Delete workout"><Icons.Trash size={14} color="#7080A0"/></button>}
        </div>
      </div>

      {showNotes&&<textarea className="notes-input" placeholder="Workout notes, how you felt, PRs, etc..."
        value={draft.notes||""} onChange={e=>update({...draft,notes:e.target.value})}/>}

      {/* Superset mode bar */}
      {supersetMode&&(
        <div style={{background:"#0A1929",border:"1px solid #38BDF8",borderRadius:8,padding:"10px 13px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"#38BDF8",letterSpacing:"1px"}}>
            {supersetSelected.length<2?"TAP 2+ EXERCISES TO GROUP":supersetSelected.length+" SELECTED"}
          </span>
          <div style={{display:"flex",gap:7}}>
            {supersetSelected.length>=2&&<button className="custom-ex-add" style={{padding:"5px 10px",fontSize:"10px",background:"#38BDF8",color:"#0A1929"}} onClick={commitSuperset}>GROUP</button>}
            <button className="custom-ex-add" style={{padding:"5px 10px",fontSize:"10px",background:"#2A3040",color:"#8A9AB8"}} onClick={()=>{setSupersetMode(false);setSupersetSelected([]);}}>CANCEL</button>
          </div>
        </div>
      )}

      {draft.exercises.length===0&&(
        <div className="empty-state">
          <div className="empty-icon-svg"><Icons.Dumbbell size={40} color="#3A4558" stroke={1.2}/></div>
          <div className="empty-text">No exercises yet.<br/>Add one or load a template.</div>
        </div>
      )}

      {renderExercises()}

      {/* Action row */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:8}}>
        <button className="add-exercise-btn" onClick={()=>setShowPicker(true)} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:7}}>
          <Icons.Plus size={13} color="#7080A0"/> EXERCISE
        </button>
        <button className="add-exercise-btn template-btn" onClick={()=>setShowTemplates(true)} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:7}}>
          <Icons.Template size={13} color="#38BDF8"/> TEMPLATE
        </button>
      </div>

      {draft.exercises.length>=2&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:8}}>
          <button className="add-exercise-btn" onClick={()=>{setSupersetMode(s=>!s);setSupersetSelected([]);}}
            style={{display:"flex",alignItems:"center",justifyContent:"center",gap:7,borderColor:supersetMode?"#38BDF8":"#3A4558",color:supersetMode?"#38BDF8":"#7080A0"}}>
            <Icons.Zap size={13} color={supersetMode?"#38BDF8":"#7080A0"}/> SUPERSET
          </button>
          <button className="add-exercise-btn" onClick={()=>setShowSaveTemplate(true)} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:7}}>
            <Icons.Save size={13} color="#7080A0"/> SAVE AS TEMPLATE
          </button>
        </div>
      )}

      <button className={`save-workout-btn ${saveState==="saved"?"saved":""} ${!dirty&&saveState!=="saved"?"idle":""}`}
        onClick={commitSave} disabled={!dirty&&saveState!=="saved"}>
        {saveState==="saved"
          ? <span style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8}}><Icons.Check size={18} color="#4CAF50"/> SAVED</span>
          : dirty?"SAVE WORKOUT":"NO CHANGES"}
      </button>
      {onClose&&<button onClick={onClose} style={{background:"transparent",border:"none",color:"#586070",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:"11px",letterSpacing:"2px",marginTop:8,width:"100%",textAlign:"center",padding:"6px"}}>CANCEL</button>}

      {/* Exercise Picker */}
      {showPicker&&(
        <div className="modal-overlay" onClick={()=>setShowPicker(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">ADD EXERCISE</div>
            <div className="custom-ex-row">
              <input className="custom-ex-input" placeholder="Custom exercise name..." value={customEx}
                onChange={e=>setCustomEx(e.target.value)} onKeyDown={e=>e.key==="Enter"&&customEx.trim()&&addEx(customEx.trim())}/>
              <button className="custom-ex-add" disabled={!customEx.trim()} onClick={()=>customEx.trim()&&addEx(customEx.trim())}>ADD</button>
            </div>
            <div className="preset-list">
              {PRESET_EXERCISES.filter(p=>!draft.exercises.find(e=>e.name===p)).map(p=>(
                <button key={p} className="preset-item" onClick={()=>addEx(p)}>{p}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Template Picker */}
      {showTemplates&&(
        <div className="modal-overlay" onClick={()=>setShowTemplates(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">LOAD TEMPLATE</div>

            {allTemplates.length===0&&(
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:"11px",color:"#586070",textAlign:"center",padding:"20px 0"}}>No templates yet. Save a workout as a template to get started.</div>
            )}

            {/* Built-in */}
            {BUILTIN_TEMPLATES.length>0&&(
              <>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:"9px",color:"#586070",letterSpacing:"2px",marginBottom:8}}>BUILT-IN</div>
                <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14}}>
                  {BUILTIN_TEMPLATES.map(t=>(
                    <button key={t.id} className="preset-item template-item" onClick={()=>loadTemplate(t)} style={{display:"flex",alignItems:"flex-start",gap:12}}>
                      <span style={{flexShrink:0,marginTop:2}}>{TEMPLATE_ICONS[t.name]||<Icons.Dumbbell size={20} color="#38BDF8"/>}</span>
                      <div style={{textAlign:"left"}}>
                        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"15px",fontWeight:700,color:"#EEF2FA",letterSpacing:"1px",marginBottom:2}}>{t.name}</div>
                        <div style={{fontFamily:"'DM Mono',monospace",fontSize:"9px",color:"#7080A0"}}>{t.exercises.slice(0,4).join(" · ")}{t.exercises.length>4?" ···":""}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* User templates */}
            {userTemplates.length>0&&(
              <>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:"9px",color:"#586070",letterSpacing:"2px",marginBottom:8}}>MY TEMPLATES</div>
                <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14}}>
                  {userTemplates.map(t=>(
                    <div key={t.id} style={{display:"flex",alignItems:"center",gap:6}}>
                      <button className="preset-item template-item" style={{flex:1,display:"flex",alignItems:"flex-start",gap:12,textAlign:"left"}} onClick={()=>loadTemplate(t)}>
                        <Icons.Template size={18} color="#38BDF8"/>
                        <div>
                          <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"15px",fontWeight:700,color:"#EEF2FA",letterSpacing:"1px",marginBottom:2}}>{t.name}</div>
                          <div style={{fontFamily:"'DM Mono',monospace",fontSize:"9px",color:"#7080A0"}}>{t.exercises.slice(0,4).join(" · ")}{t.exercises.length>4?" ···":""}</div>
                        </div>
                      </button>
                      <button className="icon-btn danger" style={{flexShrink:0}} onClick={()=>saveTemplates(userTemplates.filter(x=>x.id!==t.id))}>
                        <Icons.Trash size={13} color="#7080A0"/>
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Previous workouts as templates */}
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:"9px",color:"#586070",letterSpacing:"2px",marginBottom:8}}>FROM HISTORY</div>
            <div className="preset-list">
              {[...workouts].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,10).map(w=>(
                <button key={w.id} className="preset-item" style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}
                  onClick={()=>loadTemplate({exercises:w.exercises.map(e=>e.name)})}>
                  <span>{fmtDate(w.date)}</span>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:"9px",color:"#586070"}}>{w.exercises.length} ex</span>
                </button>
              ))}
              {workouts.length===0&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"#586070",padding:"8px 0",textAlign:"center"}}>No previous workouts</div>}
            </div>
          </div>
        </div>
      )}

      {/* Date picker */}
      {showDatePicker&&(
        <div className="modal-overlay" onClick={()=>setShowDatePicker(false)}>
          <div className="modal" style={{maxHeight:"auto"}} onClick={e=>e.stopPropagation()}>
            <div className="modal-title">CHANGE DATE</div>
            <input type="date" value={draft.date}
              max={todayISO()}
              onChange={e=>{ if(e.target.value) { update({...draft,date:e.target.value}); setShowDatePicker(false); }}}
              style={{background:"#161D28",border:"1px solid #2D3A50",borderRadius:7,color:"#E4EAF4",fontFamily:"'DM Mono',monospace",fontSize:"16px",padding:"12px",width:"100%",boxSizing:"border-box",outline:"none",colorScheme:"dark"}}
            />
          </div>
        </div>
      )}

      {showSaveTemplate&&<SaveTemplateModal exercises={draft.exercises} onSave={handleSaveTemplate} onClose={()=>setShowSaveTemplate(false)}/>}
      {confirmDelete&&<ConfirmDialog message={`Delete workout from ${fmtDate(draft.date)}? This cannot be undone.`} onConfirm={handleDeleteWorkout} onCancel={()=>setConfirmDelete(false)}/>}
    </div>
  );
}

// ─── TODAY SCREEN (wrapper for WorkoutEditor) ─────────────────────────────────
function WorkoutScreen({ workouts, saveWorkouts, isPro, onPaywall, userTemplates, saveTemplates }) {
  const today = todayISO();
  const existing = workouts.find(w=>w.date===today);
  const initial = existing || {id:genId(), date:today, exercises:[], notes:""};
  return <WorkoutEditor initial={initial} workouts={workouts} saveWorkouts={saveWorkouts} isPro={isPro} onPaywall={onPaywall}
    userTemplates={userTemplates} saveTemplates={saveTemplates} onClose={null} isNew={!existing}/>;
}


// ─── HISTORY SCREEN ───────────────────────────────────────────────────────────
function HistoryScreen({ workouts, isPro, onPaywall, saveWorkouts, userTemplates, saveTemplates }) {
  const sorted=[...workouts].sort((a,b)=>b.date.localeCompare(a.date));
  const [exp,setExp]=useState(null);
  const [editing,setEditing]=useState(null);
  const cutoff=new Date(); cutoff.setDate(cutoff.getDate()-FREE_HISTORY_LIMIT);
  const visibleWorkouts=isPro?sorted:sorted.filter(w=>new Date(w.date)>=cutoff);
  const hiddenCount=sorted.length-visibleWorkouts.length;

  if (editing) {
    if (editing==="__new__") {
      const yesterday=new Date(); yesterday.setDate(yesterday.getDate()-1);
      const yISO=yesterday.toISOString().split("T")[0];
      const blank={id:genId(),date:yISO,exercises:[],notes:""};
      return <WorkoutEditor initial={blank} workouts={workouts} saveWorkouts={saveWorkouts}
        isPro={isPro} onPaywall={onPaywall} userTemplates={userTemplates} saveTemplates={saveTemplates}
        onClose={()=>setEditing(null)} isNew={true}/>;
    }
    const w = workouts.find(x=>x.id===editing);
    if (!w) { setEditing(null); return null; }
    return <WorkoutEditor initial={w} workouts={workouts} saveWorkouts={saveWorkouts}
      isPro={isPro} onPaywall={onPaywall} userTemplates={userTemplates} saveTemplates={saveTemplates}
      onClose={()=>setEditing(null)} isNew={false}/>;
  }

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <div className="screen-label">WORKOUT HISTORY</div>
          <div className="screen-date">{workouts.length} sessions logged</div>
        </div>
        <button className="add-exercise-btn" style={{padding:"8px 12px",display:"flex",alignItems:"center",gap:6,width:"auto",fontSize:"9px",marginTop:0}}
          onClick={()=>setEditing("__new__")}>
          <Icons.Plus size={12} color="#7080A0"/> ADD PAST WORKOUT
        </button>
      </div>

      {sorted.length===0&&(
        <div className="empty-state">
          <div className="empty-icon-svg"><Icons.History size={40} color="#3A4558" stroke={1.2}/></div>
          <div className="empty-text">No workouts logged yet.<br/>Start training to build your history.</div>
        </div>
      )}

      {visibleWorkouts.map(w=>{
        const vol=w.exercises.reduce((s,e)=>s+totalVol(e),0),open=exp===w.id;
        const supersetGroups=[...new Set(w.exercises.map(e=>e.supersetGroup).filter(Boolean))];
        return (
          <div key={w.id} className={`history-card ${open?"open":""}`}>
            <button className="history-card-header" onClick={()=>setExp(open?null:w.id)}>
              <div>
                <div className="history-date">{fmtDate(w.date)}</div>
                <div className="history-meta">{w.exercises.length} exercises · {vol.toLocaleString()} kg{supersetGroups.length>0?` · ${supersetGroups.length} superset`:""}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                {w.notes&&<Icons.Note size={13} color="#5C6478"/>}
                <button className="icon-btn" style={{width:28,height:28}} onClick={e=>{e.stopPropagation();setEditing(w.id);}}>
                  <Icons.Edit size={13} color="#5C6478"/>
                </button>
                <div className="expand-arrow">{open?<Icons.ChevronUp size={13} color="#5C6478"/>:<Icons.ChevronDown size={13} color="#5C6478"/>}</div>
              </div>
            </button>
            {open&&(
              <div className="history-detail">
                {w.notes&&<div style={{padding:"8px 0 10px",borderBottom:"1px solid #2D3A50",fontFamily:"'Barlow Condensed',sans-serif",fontSize:"13px",color:"#7A90AA",fontStyle:"italic",letterSpacing:"0.3px"}}>"{w.notes}"</div>}
                {w.exercises.map((e,ei)=>(
                  <div key={e.id} className="history-exercise">
                    {e.supersetGroup&&ei>0&&w.exercises[ei-1]?.supersetGroup===e.supersetGroup&&(
                      <div style={{position:"absolute",left:0,top:0,bottom:0,width:2,background:"#38BDF844"}}/>
                    )}
                    <div className="history-ex-name">
                      {e.supersetGroup&&<Icons.Zap size={9} color="#38BDF8" style={{marginRight:3}}/>}
                      {e.name}
                    </div>
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

      {hiddenCount>0&&!isPro&&(
        <div className="pro-gate-card" onClick={onPaywall}>
          <div style={{display:"flex",justifyContent:"center",marginBottom:10}}><Icons.Lock size={28} color="#2196F3" stroke={1.2}/></div>
          <div style={{fontFamily:"'itc-avant-garde-gothic-pro',sans-serif",fontWeight:300,fontStyle:"italic",fontSize:"17px",color:"#2196F3",letterSpacing:"0.5px",fontWeight:600,marginBottom:4}}>{hiddenCount} OLDER SESSIONS LOCKED</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"#8A9AB8",letterSpacing:"0.5px",marginBottom:12}}>Upgrade to Pro to access full history</div>
          <div className="pro-badge">UPGRADE TO PRO</div>
        </div>
      )}
    </div>
  );
}

function SettingsScreen({ workouts, isPro, onPaywall, onUpgrade, saveWorkouts }) {
  const [exportDone, setExportDone] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");

  const handleExportCSV = () => {
    if(!isPro){onPaywall();return;}
    exportToCSV(workouts);
    setExportDone("csv");
    setTimeout(()=>setExportDone(null),2500);
  };
  const handleExportJSON = () => {
    exportToJSON(workouts);
    setExportDone("json");
    setTimeout(()=>setExportDone(null),2500);
  };
  const handleImport = () => {
    try {
      const data = JSON.parse(importText);
      if(!Array.isArray(data)) throw new Error("Invalid format");
      const merged = [...workouts];
      data.forEach(w=>{if(!merged.find(x=>x.id===w.id))merged.push(w);});
      saveWorkouts(merged.sort((a,b)=>b.date.localeCompare(a.date)));
      setShowImport(false);setImportText("");setImportError("");
    } catch { setImportError("Invalid backup file. Please use a valid IronLog JSON export."); }
  };

  const totalSets = workouts.reduce((s,w)=>s+w.exercises.reduce((ss,e)=>ss+e.sets.length,0),0);

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <div className="screen-label">SETTINGS</div>
          <div className="screen-date">Account & Data</div>
        </div>
        {isPro&&(
          <div style={{display:"flex",alignItems:"center",gap:6,background:"#2196F320",border:"1px solid #2196F340",borderRadius:6,padding:"5px 10px"}}>
            <Icons.Bolt size={14} color="#2196F3" stroke={1.5}/>
            <span style={{fontFamily:"'itc-avant-garde-gothic-pro',sans-serif",fontWeight:300,fontStyle:"italic",fontSize:"13px",color:"#2196F3",letterSpacing:"2px"}}>PRO</span>
          </div>
        )}
      </div>

      {!isPro&&(
        <div className="pro-gate-card" style={{marginBottom:20,cursor:"pointer"}} onClick={onPaywall}>
          <div style={{display:"flex",justifyContent:"center",marginBottom:10}}><Icons.Bolt size={28} color="#2196F3" stroke={1.2}/></div>
          <div style={{fontFamily:"'itc-avant-garde-gothic-pro',sans-serif",fontWeight:300,fontStyle:"italic",fontSize:"17px",color:"#2196F3",letterSpacing:"0.5px",fontWeight:600,marginBottom:4}}>UNLOCK IRONLOG PRO</div>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"#8A9AB8",marginBottom:12}}>Full history · Templates · RPE charts · CSV export</div>
          <div className="pro-badge">START 7-DAY FREE TRIAL</div>
        </div>
      )}

      <div className="section-heading" style={{marginTop:4}}>STATS</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:20}}>
        {[
          {v:workouts.length,l:"TOTAL SESSIONS"},
          {v:totalSets,l:"TOTAL SETS"},
          {v:[...new Set(workouts.flatMap(w=>w.exercises.map(e=>e.name)))].length,l:"EXERCISES LOGGED"},
          {v:workouts.length>0?fmtDateShort(workouts[workouts.length-1].date):"—",l:"FIRST WORKOUT"},
        ].map((s,i)=>(
          <div key={i} style={{background:"#2A3040",border:"1px solid #3A4558",borderRadius:8,padding:"12px 13px"}}>
            <div style={{fontFamily:"'itc-avant-garde-gothic-pro',sans-serif",fontWeight:300,fontStyle:"italic",fontSize:"22px",color:"#38BDF8",lineHeight:1,marginBottom:3,fontWeight:600}}>{s.v}</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:"8px",color:"#5C6478",letterSpacing:"1.5px"}}>{s.l}</div>
          </div>
        ))}
      </div>

      <div className="section-heading">DATA EXPORT</div>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
        {[
          { label:"Export Backup (JSON)", sub:"Full data backup · re-importable", icon:<Icons.Download size={18} color="#8A9AB8"/>, action:handleExportJSON, doneKey:"json" },
          { label:"Export to CSV", sub:"Open in Excel or Google Sheets", icon:<Icons.Table size={18} color={isPro?"#8A9AB8":"#5C6478"}/>, action:handleExportCSV, doneKey:"csv", pro:!isPro },
          { label:"Import Backup", sub:"Restore from JSON backup", icon:<Icons.Upload size={18} color="#8A9AB8"/>, action:()=>setShowImport(true) },
        ].map((btn,i)=>(
          <button key={i} className="settings-btn" onClick={btn.action} style={{opacity:btn.pro?0.7:1}}>
            <span style={{flexShrink:0}}>{btn.icon}</span>
            <div style={{flex:1}}>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:"15px",fontWeight:700,color:"#D0DAEC",letterSpacing:"1px"}}>
                {btn.label}{btn.pro&&<span style={{marginLeft:6,fontSize:"9px",color:"#2196F3",fontFamily:"'DM Mono',monospace"}}>PRO</span>}
              </div>
              <div style={{fontFamily:"'DM Mono',monospace",fontSize:"9px",color:"#7080A0",marginTop:2}}>{btn.sub}</div>
            </div>
            {exportDone===btn.doneKey
              ? <Icons.Check size={16} color="#4CAF50"/>
              : <Icons.ArrowRight size={14} color="#5C6478"/>}
          </button>
        ))}
      </div>

      <div className="section-heading">ABOUT</div>
      <div style={{background:"#2A3040",border:"1px solid #3A4558",borderRadius:8,padding:"14px",marginBottom:20}}>
        <div style={{fontFamily:"'itc-avant-garde-gothic-pro',sans-serif",fontWeight:300,fontStyle:"italic",fontSize:"18px",color:"#2196F3",letterSpacing:"0.5px",fontWeight:600,marginBottom:3}}>IRONLOG</div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"#7080A0",letterSpacing:"0.5px",lineHeight:1.7}}>
          Version 2.0 · Built for serious lifters<br/>
          Your data stays on your device.<br/>
          No account required for core features.
        </div>
      </div>

      {showImport&&(
        <div className="modal-overlay" onClick={()=>setShowImport(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">IMPORT BACKUP</div>
            <textarea value={importText} onChange={e=>{setImportText(e.target.value);setImportError("");}}
              className="notes-input" style={{height:140,marginBottom:8}} placeholder='Paste your JSON backup here...'/>
            {importError&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:"10px",color:"#ef5350",marginBottom:8,letterSpacing:"0.3px"}}>{importError}</div>}
            <button className="save-workout-btn" style={{marginTop:0}} disabled={!importText.trim()} onClick={handleImport}>IMPORT DATA</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── APP SHELL ────────────────────────────────────────────────────────────────

// ─── APP SHELL ────────────────────────────────────────────────────────────────
export default function App() {
  const [workouts, saveWorkouts] = useStorage();
  const [isPro, upgradeToPro]    = usePro();
  const [userTemplates, saveTemplates] = useTemplates();
  const [screen, setScreen]      = useState("workout");
  const [showPaywall, setShowPaywall] = useState(false);
  const [onboarded, setOnboarded] = useState(()=>{
    try { return localStorage.getItem(ONBOARD_KEY)==="true"; } catch { return false; }
  });

  const completeOnboard = () => {
    setOnboarded(true);
    try { localStorage.setItem(ONBOARD_KEY,"true"); } catch {}
  };
  const handleUpgrade = () => { upgradeToPro(); setShowPaywall(false); };

  const NAV = [
    {id:"workout",  Icon:Icons.Dumbbell,  label:"TODAY"},
    {id:"history",  Icon:Icons.History,   label:"HISTORY"},
    {id:"longterm", Icon:Icons.Calendar,  label:"CALENDAR"},
    {id:"progress", Icon:Icons.TrendUp,   label:"PROGRESS"},
    {id:"settings", Icon:Icons.Settings,  label:"SETTINGS"},
  ];

  if (!onboarded) return (
    <><GlobalStyles/><OnboardingScreen onDone={completeOnboard}/></>
  );

  return (
    <>
      <GlobalStyles/>
      <div className="topbar">
        <div style={{display:"flex",alignItems:"flex-end",gap:10,flex:1}}>
          <div className="app-logo">IRONLOG</div>
          <div className="app-tagline">Strength Tracker</div>
        </div>
        {isPro&&(
          <div style={{display:"flex",alignItems:"center",gap:5,background:"#2196F320",border:"1px solid #2196F340",borderRadius:4,padding:"3px 8px"}}>
            <Icons.Bolt size={12} color="#2196F3" stroke={1.5}/>
            <span style={{fontFamily:"'itc-avant-garde-gothic-pro',sans-serif",fontWeight:300,fontStyle:"italic",fontSize:"12px",color:"#2196F3",letterSpacing:"2px"}}>PRO</span>
          </div>
        )}
      </div>

      {screen==="workout"  && <WorkoutScreen  workouts={workouts} saveWorkouts={saveWorkouts} isPro={isPro} onPaywall={()=>setShowPaywall(true)} userTemplates={userTemplates} saveTemplates={saveTemplates}/>}
      {screen==="history"  && <HistoryScreen  workouts={workouts} isPro={isPro} onPaywall={()=>setShowPaywall(true)} saveWorkouts={saveWorkouts} userTemplates={userTemplates} saveTemplates={saveTemplates}/>}
      {screen==="longterm" && <LongTermScreen workouts={workouts}/>}
      {screen==="progress" && <ProgressScreen workouts={workouts} isPro={isPro} onPaywall={()=>setShowPaywall(true)}/>}
      {screen==="settings" && <SettingsScreen workouts={workouts} isPro={isPro} onPaywall={()=>setShowPaywall(true)} onUpgrade={handleUpgrade} saveWorkouts={saveWorkouts}/>}

      <nav className="bottom-nav">
        {NAV.map(({id,Icon,label})=>(
          <button key={id} className={`nav-btn ${screen===id?"active":""}`} onClick={()=>setScreen(id)}>
            <span className="nav-icon"><Icon size={19} color={screen===id?"#2196F3":"#5C7090"} stroke={screen===id?1.8:1.5}/></span>
            <span className="nav-label">{label}</span>
          </button>
        ))}
      </nav>

      {showPaywall&&<PaywallModal onClose={()=>setShowPaywall(false)} onUpgrade={handleUpgrade}/>}
    </>
  );
}

// ─── GLOBAL STYLES ────────────────────────────────────────────────────────────
function GlobalStyles() {
  return (
    <style>{`
      @import url('https://use.typekit.net/owl2fvt.css');
      @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@400;600;700&family=DM+Mono:wght@400;500&display=swap');
      @keyframes slideIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
      @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
      @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
      *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
      body{background:#1A1F28;color:#D8E2F0;font-family:'Barlow',sans-serif;min-height:100vh;overflow-x:hidden;}
      #root{max-width:480px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column;background:#1C2230;}

      .topbar{background:#1C2230;border-bottom:1px solid #2D3A50;padding:12px 16px 10px;display:flex;align-items:flex-end;flex-shrink:0;position:sticky;top:0;z-index:40;backdrop-filter:blur(10px);}
      .app-logo{font-family:'itc-avant-garde-gothic-pro',sans-serif;font-weight:300;font-style:italic;font-size:22px;color:#2196F3;letter-spacing:4px;line-height:1;}
      .app-tagline{font-family:'DM Mono',monospace;font-size:9px;color:#505C74;letter-spacing:2px;text-transform:uppercase;margin-bottom:2px;}

      .screen{flex:1;padding:18px 14px 112px;overflow-y:auto;animation:fadeUp .2s ease;}
      .screen-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:14px;border-bottom:1px solid #2D3A50;}
      .screen-label{font-family:'DM Mono',monospace;font-size:9px;color:#2196F3;letter-spacing:3px;font-weight:500;margin-bottom:4px;}
      .screen-date{font-family:'itc-avant-garde-gothic-pro',sans-serif;font-weight:300;font-style:italic;font-size:18px;color:#E4EAF4;letter-spacing:1px;}
      .volume-chip{background:#2A3040;border:1px solid #3A4558;border-radius:5px;padding:4px 10px;display:flex;flex-direction:column;align-items:center;}
      .volume-num{font-family:'itc-avant-garde-gothic-pro',sans-serif;font-weight:300;font-style:italic;font-size:15px;color:#38BDF8;line-height:1;}
      .volume-unit{font-family:'DM Mono',monospace;font-size:8px;color:#627080;letter-spacing:1px;}

      .toggle-btn{background:#2A3040;border:1px solid #485468;border-radius:5px;color:#8A9AB8;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;font-weight:500;letter-spacing:1.5px;padding:5px 9px;transition:all .15s;flex-shrink:0;}

      .section-heading{display:flex;justify-content:space-between;align-items:center;font-family:'DM Mono',monospace;font-size:9px;font-weight:500;color:#2196F3;letter-spacing:3px;text-transform:uppercase;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #2E3545;}
      .cal-nav-btn{background:#2E3545;border:1px solid #3A4558;border-radius:4px;color:#9BAAC8;cursor:pointer;font-size:16px;width:27px;height:27px;display:flex;align-items:center;justify-content:center;transition:all .15s;}
      .cal-nav-btn:hover{border-color:#2196F3;color:#2196F3;}

      .empty-state{text-align:center;padding:56px 20px;}
      .empty-icon{font-size:44px;margin-bottom:14px;} .empty-icon-svg{display:flex;justify-content:center;margin-bottom:16px;}
      .empty-text{font-size:14px;color:#7A90AA;line-height:1.8;font-family:'Barlow Condensed',sans-serif;letter-spacing:"0.5px";}

      .exercise-card{background:#222A38;border:1px solid #2D3A50;border-left:3px solid #2196F3;border-radius:8px;padding:14px;margin-bottom:10px;animation:slideIn .15s ease;}
      .exercise-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:11px;}
      .exercise-name{font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;color:#EEF2FA;letter-spacing:1px;text-transform:uppercase;}
      .ex-vol{font-family:'DM Mono',monospace;font-size:11px;color:#38BDF8;font-weight:500;}

      .set-input{background:#161D28;border:1px solid #2D3A50;border-radius:5px;color:#E4EAF4;font-family:'DM Mono',monospace;font-size:15px;font-weight:500;padding:8px 4px;text-align:center;width:100%;outline:none;transition:border-color .15s;-moz-appearance:textfield;}
      .set-input::-webkit-inner-spin-button,.set-input::-webkit-outer-spin-button{-webkit-appearance:none;}
      .set-input:focus{border-color:#2196F3;}
      .rpe-input{border-color:#0A1929 !important;color:#38BDF8 !important;}
      .rpe-input:focus{border-color:#2196F3 !important;}

      .icon-btn{background:#2A3040;border:1px solid #3A4558;border-radius:5px;color:#7080A0;cursor:pointer;font-size:14px;height:33px;width:33px;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0;}
      .icon-btn:hover{background:#3A4558;color:#D0DAEC;}
      .icon-btn.danger:hover{background:#200A0A;color:#2196F3;border-color:#2196F3;}

      .add-set-btn{background:transparent;border:1px dashed #2D3A50;border-radius:5px;color:#5A7090;cursor:pointer;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:2px;font-weight:500;padding:7px;text-align:center;width:100%;margin-top:5px;transition:all .15s;}
      .add-set-btn:hover{border-color:#2196F3;color:#2196F3;}

      .add-exercise-btn{background:transparent;border:1px solid #3A4558;border-radius:7px;color:#7080A0;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;font-weight:500;letter-spacing:2px;padding:12px;width:100%;margin-top:0;transition:all .15s;}
      .add-exercise-btn:hover{border-color:#7080A0;color:#C0CCDC;}
      .template-btn:hover{border-color:#38BDF8;color:#38BDF8;}

      .notes-input{width:100%;background:#161D28;border:1px solid #2D3A50;border-radius:7px;color:#A0B4CC;font-family:'DM Mono',monospace;font-size:12px;padding:11px 13px;outline:none;resize:none;min-height:80px;margin-bottom:14px;line-height:1.6;transition:border-color .15s;}
      .notes-input:focus{border-color:#38BDF8;}

      .save-workout-btn{display:block;width:100%;margin-top:10px;padding:15px;border-radius:7px;border:none;font-family:'itc-avant-garde-gothic-pro',sans-serif;font-weight:300;font-style:italic;font-size:17px;letter-spacing:4px;letter-spacing:3px;cursor:pointer;transition:all .2s;background:#2196F3;color:#fff;box-shadow:0 4px 20px #2196F340;}
      .save-workout-btn:hover:not(:disabled){background:#42A5F5;transform:translateY(-1px);box-shadow:0 6px 24px #2196F340;}
      .save-workout-btn.saved{background:#0D2B1A;color:#4CAF50;border:1px solid #1A4A28;box-shadow:none;cursor:default;}
      .save-workout-btn.idle:disabled{background:#1C2230;color:#3A4A60;border:1px solid #2D3A50;box-shadow:none;cursor:default;}

      .modal-overlay{position:fixed;inset:0;background:rgba(15,20,30,.952);display:flex;align-items:flex-end;z-index:100;}
      .modal{background:#222A38;border:1px solid #3A4558;border-radius:14px 14px 0 0;border-top:2px solid #2196F3;padding:20px 14px;width:100%;max-width:480px;margin:0 auto;max-height:78vh;display:flex;flex-direction:column;}
      .modal-title{font-family:'itc-avant-garde-gothic-pro',sans-serif;font-weight:300;font-style:italic;font-size:18px;font-weight:600;color:#2196F3;letter-spacing:2px;margin-bottom:13px;}
      .paywall-modal{max-height:90vh;overflow-y:auto;}
      .custom-ex-row{display:flex;gap:7px;margin-bottom:12px;}
      .custom-ex-input{flex:1;background:#161D28;border:1px solid #2D3A50;border-radius:6px;color:#E4EAF4;font-family:'Barlow',sans-serif;font-size:15px;padding:10px 12px;outline:none;}
      .custom-ex-input:focus{border-color:#2196F3;}
      .custom-ex-add{background:#2196F3;border:none;border-radius:6px;color:#fff;cursor:pointer;font-family:'DM Mono',monospace;font-weight:500;letter-spacing:1px;padding:10px 14px;font-size:12px;}
      .custom-ex-add:disabled{background:#35404F;color:#586070;cursor:not-allowed;}
      .preset-list{overflow-y:auto;display:flex;flex-direction:column;gap:4px;}
      .preset-item{background:#222A38;border:1px solid #2D3A50;border-radius:6px;color:#C0CCDC;cursor:pointer;font-family:'Barlow',sans-serif;font-size:14px;font-weight:500;padding:11px 13px;text-align:left;transition:all .1s;}
      .preset-item:hover{background:#38444F;border-color:#2196F3;color:#EEF2FA;}
      .template-item{padding:12px 13px !important;}

      .history-card{background:#222A38;border:1px solid #2D3A50;border-radius:7px;margin-bottom:8px;overflow:hidden;transition:border-color .15s;}
      .history-card.open{border-color:#3A4558;}
      .history-card-header{background:transparent;border:none;width:100%;padding:13px 14px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;text-align:left;}
      .history-date{font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;color:#D0DAEC;letter-spacing:1px;margin-bottom:2px;}
      .history-meta{font-size:10px;color:"#7080A0";font-family:'DM Mono',monospace;letter-spacing:"0.5px";}
      .expand-arrow{color:"#586070";font-size:"11px";}
      .history-detail{padding:0 14px 12px;border-top:1px solid #2E3545;}
      .history-exercise{padding:9px 0;border-bottom:1px solid #2E3545;display:flex;align-items:flex-start;gap:8px;}
      .history-exercise:last-child{border-bottom:none;}
      .history-ex-name{font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;color:#2196F3;text-transform:uppercase;letter-spacing:1px;min-width:95px;flex-shrink:0;}
      .history-sets{display:flex;flex-wrap:wrap;gap:3px;flex:1;}
      .history-set{background:#2E3545;border-radius:4px;padding:3px 7px;font-size:10px;color:#C0CCDC;font-family:'DM Mono',monospace;display:flex;gap:3px;align-items:center;}
      .hs-num{color:#4C5870;font-size:8px;}.hs-weight{color:#38BDF8;font-weight:500;}.hs-x{color:#485468;}.hs-reps{color:#9BAAC8;}.hs-rpe{color:#2196F388;font-size:8px;margin-left:1px;}
      .history-ex-vol{font-family:'DM Mono',monospace;font-size:10px;color:#4C5870;flex-shrink:0;margin-top:2px;}

      .ex-selector-scroll{display:flex;gap:7px;overflow-x:auto;padding-bottom:10px;scrollbar-width:none;}
      .ex-selector-scroll::-webkit-scrollbar{display:none;}
      .ex-chip{background:#2A3040;border:1px solid #35404F;border-radius:20px;color:#7080A0;cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:600;letter-spacing:1px;padding:6px 14px;white-space:nowrap;flex-shrink:0;transition:all .15s;}
      .ex-chip.active{background:#2196F3;border-color:#2196F3;color:#fff;}
      .ex-chip:hover:not(.active){border-color:#586070;color:#B0BECC;}

      .pb-row{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:7px;margin-bottom:14px;}
      .pb-card{background:#222A38;border:1px solid #2D3A50;border-radius:7px;padding:11px 7px;text-align:center;transition:border-color .15s;}
      .pb-card:hover{border-color:#3F4C5C;}
      .pb-val{font-family:'itc-avant-garde-gothic-pro',sans-serif;font-weight:300;font-style:italic;font-size:20px;font-weight:600;color:#38BDF8;line-height:1;margin-bottom:3px;}
      .pb-unit{font-size:12px;color:#2196F3;margin-left:1px;}
      .pb-label{font-family:'DM Mono',monospace;font-size:8px;color:#505C74;letter-spacing:1.5px;}

      .metric-tabs{display:flex;gap:5px;margin-bottom:13px;}
      .metric-tab{flex:1;background:#222A38;border:1px solid #2D3A50;border-radius:5px;color:#7A90AA;cursor:pointer;font-family:'DM Mono',monospace;font-size:9px;font-weight:500;letter-spacing:1px;padding:9px 3px;text-align:center;transition:all .15s;}
      .metric-tab.active{background:#2E3545;}

      .chart-wrap{background:#1C2330;border:1px solid #2D3A50;border-radius:9px;padding:14px 8px 6px;margin-bottom:12px;overflow:hidden;}
      .chart-title{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:2px;font-weight:500;text-transform:uppercase;margin-bottom:9px;padding:0 6px;}
      .chart-single{text-align:center;padding:22px 0;}
      .chart-single-val{font-family:'itc-avant-garde-gothic-pro',sans-serif;font-weight:300;font-style:italic;font-size:42px;font-weight:600;line-height:1;}
      .chart-single-sub{font-family:'DM Mono',monospace;font-size:10px;color:#586070;margin-top:6px;}

      .trend-banner{border-radius:6px;padding:11px 14px;display:flex;align-items:center;gap:10px;font-family:'DM Mono',monospace;font-size:11px;font-weight:500;letter-spacing:0.5px;margin-bottom:14px;}
      .trend-banner.up{background:#072010;border:1px solid #1A4A28;color:#4CAF50;}
      .trend-banner.down{background:#200A0A;border:1px solid #4A1A1A;color:#ef5350;}
      .trend-arrow{font-size:18px;}

      .pro-gate-card{background:#2A3040;border:1px solid #3A4558;border-radius:10px;padding:20px;text-align:center;margin-bottom:8px;transition:border-color .15s;}
      .pro-gate-card:hover{border-color:#2196F344;}
      .pro-badge{display:inline-block;background:#2196F3;border-radius:5px;color:#fff;font-family:'itc-avant-garde-gothic-pro',sans-serif;font-weight:300;font-style:italic;font-size:12px;letter-spacing:2px;padding:8px 18px;}

      .settings-btn{background:#2A3040;border:1px solid #3A4558;border-radius:8px;padding:13px;display:flex;align-items:center;gap:12px;cursor:pointer;text-align:left;transition:all .15s;width:100%;font-size:20px;}
      .settings-btn:hover{border-color:#4C5870;background:#2E3545;}

      .bottom-nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:#1C2230;border-top:1px solid #2D3A50;display:flex;z-index:50;padding-bottom:env(safe-area-inset-bottom);}
      .nav-btn{flex:1;background:transparent;border:none;color:#5C7090;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;padding:11px 0 9px;transition:all .15s;position:relative;}
      .nav-btn.active{color:#2196F3;}
      .nav-btn.active::after{content:'';position:absolute;top:0;left:25%;width:50%;height:2px;background:#2196F3;border-radius:0 0 3px 3px;}
      .nav-icon{display:flex;align-items:center;justify-content:center;height:20px;}
      .nav-label{font-family:'DM Mono',monospace;font-size:8px;font-weight:500;letter-spacing:1.5px;text-transform:uppercase;}
    
      .exercise-name-btn{background:transparent;border:none;color:#D0DAEC;cursor:pointer;font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:700;letter-spacing:1px;padding:0;display:flex;align-items:center;gap:6px;text-align:left;flex:1;}
      .exercise-name-btn:hover{color:#2196F3;}

      .copy-set-btn{background:#0A1929;border-color:#1A3A50;}
      .copy-set-btn:hover{background:#0D2B3A;border-color:#38BDF8;}

      .superset-group{border:1px solid #38BDF844;border-radius:9px;padding:8px;margin-bottom:10px;background:#0A1520;}
      .superset-label{display:flex;align-items:center;gap:6px;margin-bottom:8px;font-family:'DM Mono',monospace;font-size:9px;color:#38BDF8;letter-spacing:2px;}
      .superset-break-btn{margin-left:auto;background:transparent;border:1px solid #38BDF833;border-radius:4px;color:#38BDF877;cursor:pointer;font-family:'DM Mono',monospace;font-size:8px;letter-spacing:1px;padding:3px 7px;}
      .superset-break-btn:hover{border-color:#38BDF8;color:#38BDF8;}
      .in-superset{margin-bottom:6px;background:#111A22;}
      .exercise-card.selected{outline:2px solid #38BDF8;outline-offset:-2px;}

      .date-edit-btn{background:transparent;border:none;color:#8A9AB8;cursor:pointer;font-family:'itc-avant-garde-gothic-pro',sans-serif;font-weight:300;font-style:italic;font-size:20px;display:flex;align-items:center;gap:7px;padding:0;margin-top:2px;}
      .date-edit-btn:hover{color:#D0DAEC;}
`}</style>
  );
}
