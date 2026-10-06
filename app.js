(function(){
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const natural = (a,b) => String(a??'').localeCompare(String(b??''),undefined,{numeric:true});
const f0 = n => n==null||isNaN(n) ? '–' : Math.round(n).toLocaleString('en-US');
// "&" is kept as "and" so "Height & Class" (designer) doesn't collide with HEIGHT_CLASS (Osmose yes/no)
const norm = s => String(s??'').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]/g,'');
const num = v => { if (v==null || v==='') return null; const n = typeof v==='number' ? v : parseFloat(String(v).replace(/[,%]/g,'')); return isNaN(n) ? null : n; };
const byPole = (a,b) => natural(a.id,b.id) || (a.row||0)-(b.row||0);
const pct = (a,b) => b ? Math.round(a/b*100) : 0;

/* ---------- limits used by the checks ---------- */
const LOAD_LIMIT = 100;   // Osmose % load at or above this with a Pole OK final is flagged
const RS_LIMIT = 67;      // remaining strength (%) below this with a Pole OK final is flagged
const GPS_MILES = 3;      // a pole this far from the middle of the circuit is flagged

/* ---------- storage ---------- */
let DBP = null;
function db(){ if (DBP) return DBP; DBP = new Promise((res,rej)=>{ try{ const r=indexedDB.open('osmrev',1); r.onupgradeneeded=()=>r.result.createObjectStore('files',{keyPath:'id'}); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);}catch(e){rej(e);} }); return DBP; }
async function dbGet(){ try{ const d=await db(); return await new Promise((res)=>{ const q=d.transaction('files').objectStore('files').get('last'); q.onsuccess=()=>res(q.result||null); q.onerror=()=>res(null); }); }catch(e){ return null; } }
async function dbPut(rec){ try{ const d=await db(); await new Promise((res)=>{ const t=d.transaction('files','readwrite'); t.objectStore('files').put({id:'last',...rec}); t.oncomplete=res; t.onerror=res; }); }catch(e){} }
async function dbClear(){ try{ const d=await db(); await new Promise((res)=>{ const t=d.transaction('files','readwrite'); t.objectStore('files').clear(); t.oncomplete=res; t.onerror=res; }); }catch(e){} }
let REV = {}; try { REV = JSON.parse(localStorage.getItem('osmrev:review')||'{}'); } catch(e){}
const saveRev = () => { try{ localStorage.setItem('osmrev:review', JSON.stringify(REV)); }catch(e){} };
const rev = P => REV[P.key] || {};

/* ---------- state ---------- */
let FILE = '', HEAD = [], HIX = new Map(), POLES = [], WL = [], ISS = [];
let TAB = 'overview', CUR = null, MAP = null;
const SORT = {};
let FIL = {q:'', fin:'', osm:'', sec:'', cond:'', rev:'', iss:''};
let IFIL = {sev:'', cat:''};
let DCOLS = 'summary', DQ = '', MAPBY = 'final', MAPBASE = 'streets';

/* ---------- recommendations ---------- */
const BK = ['Replace','Brace','OK','Run SA','N/A','Other',''];
const BKL = {Replace:'Replace', Brace:'Brace / truss', OK:'Pole OK', 'Run SA':'Run SA', 'N/A':'N/A', Other:'Other', '':'Not set'};
const BKC = {Replace:'bad', Brace:'warn', OK:'ok', 'Run SA':'info', 'N/A':'none', Other:'c', '':'none'};
const RANK = {OK:0, Brace:1, Replace:2};
function bucket(s){ s = String(s??'').trim(); if (!s) return '';
  if (/replace|remove/i.test(s)) return 'Replace'; if (/truss|ttu|brace/i.test(s)) return 'Brace'; if (/\bok\b/i.test(s)) return 'OK';
  if (/run\s*sa/i.test(s)) return 'Run SA'; if (/^n\/?a$/i.test(s)) return 'N/A'; return 'Other'; }
const recPill = (b, label) => `<span class="pill ${BKC[b]}">${esc(label ?? BKL[b])}</span>`;

/* ---------- reading the workbook ---------- */
function clean(v){
  if (v==null) return null;
  if (v instanceof Date) return v;
  if (typeof v==='string'){ v = v.replace(/_x000D_/g,'').replace(/\u00a0/g,' ').replace(/\r/g,'').trim(); if (!v || v==='00/00/0000') return null; }
  return v;
}
const serialDate = n => new Date(Math.round((n-25569)*864e5) + new Date().getTimezoneOffset()*6e4);
function fmtDate(d){ if (!(d instanceof Date) || isNaN(d)) return ''; const x = new Date(d.getTime()+3600e3); return `${x.getMonth()+1}/${x.getDate()}/${x.getFullYear()}`; }
function show(v){ if (v==null) return ''; if (v instanceof Date) return fmtDate(v); return String(v); }
function hcNorm(s){ if (s==null) return ''; const m = String(s).toUpperCase().match(/(\d{2})\s*[-\/;:, ]\s*([A-Z]*\d*[A-Z]*)/); if (!m) return ''; let c = m[2]; if (/^UNK/.test(c)) c='UNK'; return `${m[1]}-${c}`; }
const hcUnknown = s => !s || /UNK|FG/.test(s);

function readWorkbook(bytes, name){
  const wb = XLSX.read(new Uint8Array(bytes), {type:'array', cellDates:true});
  const tabs = wb.SheetNames.map(n=>{ const ws = wb.Sheets[n], rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:null, raw:true, blankrows:true});
    const r0 = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s.r : 0;   // sheet row of rows[0], zero-based
    let hr = -1; for (let i=0;i<Math.min(10,rows.length);i++){ const ns = (rows[i]||[]).map(norm); if (ns.includes('poleno') || ns.includes('poleid') || ns.includes('polenumber')){ hr=i; break; } }
    return {name:n, rows, hr, r0}; }).filter(t=>t.hr>=0);
  // the pole data sheet: the one with the most columns that has a pole number column
  const main = tabs.filter(t=>t.rows[t.hr].map(norm).some(x=>x==='poleno'||x==='polenumber')).sort((a,b)=>b.rows[b.hr].length-a.rows[a.hr].length)[0]
    || tabs.sort((a,b)=>b.rows[b.hr].length-a.rows[a.hr].length)[0];
  if (!main) throw new Error('No sheet with a POLE_NO or Pole ID column was found in this workbook.');
  FILE = name; HEAD = main.rows[main.hr].map(h=>h==null?'':String(h).trim()); HIX = new Map();
  HEAD.forEach((h,i)=>{ const k=norm(h); if (k && !HIX.has(k)) HIX.set(k,i); });
  const dateCols = HEAD.map((h,i)=>/date|inserted|downloaded|uploaded|processed|invoiced|installed/i.test(h) ? i : -1).filter(i=>i>=0);
  const pci = colIx('POLE_NO','Pole Number','Pole ID');
  const data = main.rows.slice(main.hr+1).map((r,j)=>{ const a = HEAD.map((_,i)=>clean(r[i])); dateCols.forEach(i=>{ if (typeof a[i]==='number' && a[i]>10000 && a[i]<80000) a[i]=serialDate(a[i]); });
      return {a, row: main.r0 + main.hr + j + 2}; })   // spreadsheet row number as Excel shows it
    .filter(d=>d.a[pci]!=null);
  // duplicate pole numbers: identical rows are shown once, rows that differ are each shown with their row number
  const groups = new Map(); data.forEach(d=>{ const k = String(d.a[pci]).trim(); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); });
  const keep = [];
  data.forEach(d=>{ const g = groups.get(String(d.a[pci]).trim()); if (g.length===1){ keep.push(d); return; }
    if (g.done) return; g.done = true;
    const sig = x => JSON.stringify(x.a.map(show)), same = g.every(x=>sig(x)===sig(g[0]));
    const rows = g.map(x=>x.row), diff = same ? [] : HEAD.map((h,i)=>i).filter(i=>new Set(g.map(x=>show(x.a[i]))).size>1);
    const dup = {rows, same, diff, all: g};
    if (same) keep.push({...g[0], dup}); else g.forEach(x=>keep.push({...x, dup})); });
  POLES = keep.map((d,i)=>{ const P = buildPole(d.a,i); P.row = d.row; P.dup = d.dup || null; if (P.dup && !P.dup.same) P.key = `${P.id}@row${P.row}`; return P; });
  // work lists: every other sheet keyed by pole
  WL = tabs.filter(t=>t!==main).map(t=>{ const head = t.rows[t.hr].map(h=>h==null?'':String(h).trim()); const pi = head.map(norm).findIndex(x=>x==='poleid'||x==='poleno'||x==='polenumber');
    const kind = /replace/i.test(t.name) ? 'replace' : /brace/i.test(t.name) ? 'brace' : /addl|additional|ovh/i.test(t.name) ? 'addl' : 'other';
    const rows = t.rows.slice(t.hr+1).map(r=>head.map((_,i)=>clean(r[i]))).filter(r=>r[pi]!=null).map(cells=>({pole:String(cells[pi]).trim(), cells}));
    return {name:t.name, kind, head, pi, rows}; }).filter(w=>w.rows.length);
  const byKey = new Map(); POLES.forEach(P=>{ if (!byKey.has(P.id)) byKey.set(P.id, []); byKey.get(P.id).push(P); });
  WL.forEach(w=>w.rows.forEach(r=>{ r.P = (byKey.get(r.pole)||[])[0]||null; if (r.P) r.P.wl.push({w, r}); }));
  runChecks();
}
function colIx(...names){ for (const n of names){ const j = HIX.get(norm(n)); if (j!=null) return j; } return -1; }

const FLAGS = [
  // [label, test, group]  test gets the getter
  ['Groundwire cut', v=>/^y/i.test(v('GROUNDWIRE_CUT')), 'Osmose'],
  ['Woodpecker damage', v=>/^y/i.test(v('POLEDAMAGE_WOODPECKER')) || !!v('Wood Pecker Damage'), 'Osmose'],
  ['Guying not adequate', v=>/^not/i.test(v('GuyStatus')), 'Osmose'],
  ['Guy damaged', v=>/^y/i.test(v('GUY_DAMAGED')), 'Osmose'],
  ['Guy wire slack', v=>/^no/i.test(v('GUY_WIRE_TIGHT')), 'Osmose'],
  ['Guy marker missing', v=>/^no/i.test(v('GUY_MARKER_PRESENT')), 'Osmose'],
  ['Guy improperly grounded', v=>/^y/i.test(v('GUY_IMPROPERLY_GROUNDED')), 'Osmose'],
  ['Foreign guy broken', v=>/^y/i.test(v('FOREIGN_GUY_WIRE_BROKEN')), 'Osmose'],
  ['Anchor damaged', v=>/^y/i.test(v('ANCHOR_DAMAGED')), 'Osmose'],
  ['Vegetation at pole', v=>/^f/i.test(v('VEGETATION AT POLE')), 'Osmose'],
  ['Vegetation in span', v=>/^f/i.test(v('VEGETATION IN SPAN')), 'Osmose'],
  ['Insulator tie issue', v=>/^y/i.test(v('INSULATOR_TIES')), 'Osmose'],
  ['Insulator damage', v=>/^y/i.test(v('INSULATOR_DAMAGE')), 'Osmose'],
  ['Glass insulators', v=>/^y/i.test(v('Glass Insulator Present')), 'Osmose'],
  ['Leaking equipment', v=>/^y/i.test(v('LEAKING_EQUIP')) || /^y/i.test(v('TRANSF_LEAK')), 'Osmose'],
  ['Fuse damage', v=>/^y/i.test(v('FUSE_DAMAGE')), 'Osmose'],
  ['Conductor broken', v=>/^y/i.test(v('CONDUCTOR_BROKEN')), 'Osmose'],
  ['Crossarm rotten / bowed', v=>/^y/i.test(v('CROSS_ROTTEN')) || /^y/i.test(v('CROSS_BOWED')), 'Osmose'],
  ['Vertical damage', v=>/^y/i.test(v('VERT_DAMAGE')) || /^y/i.test(v('VERT_ROTTEN')), 'Osmose'],
  ['Pole top extension', v=>/^y/i.test(v('POLE_TOP_EXTENSION')), 'Osmose'],
  ['Pole leaning', v=>/^y/i.test(v('POLE_LEANING')), 'Osmose'],
  ['Pole not sound', v=>/^n/i.test(v('POLE_SOUND')), 'Osmose'],
  ['Stray voltage', v=>/^y/i.test(v('STRAY_VOLTAGE')), 'Osmose'],
  ['Live vine', v=>/^y/i.test(v('LIVE_VINE_PRESENT')), 'Osmose'],
  ['Transformer ground bad', v=>/^bad/i.test(v('GROUND FROM TRANSFORMER')), 'Osmose'],
  ['Broken conduit', v=>/^y/i.test(v('BROKEN_CONDUIT')), 'Osmose'],
  ['Lead bracket damage', v=>/^y/i.test(v('LEAD_BRACKET_DAM')), 'Osmose'],
  ['Abandoned facility', v=>/^y/i.test(v('FACILITY_ABANDON')), 'Osmose'],
  ['Tree trimming needed', v=>/^y/i.test(v('Tree Trimming Needed')), 'Survey'],
  ['No truck access', v=>/^n/i.test(v('Truck Access?')), 'Survey'],
  ['Primary < 600 AAC', v=>/^y/i.test(v('Is Primary Conductor <600 AAC')), 'Survey'],
  ['Not a valid feeder pole / circuit', v=>/^n/i.test(v('Valid Feeder Pole & Circuit')), 'Survey'],
  ['Crossing', v=>!!v('Crossing Type'), 'Survey'],
  ['Permit needed', v=>!!v('Permit Type'), 'Survey'],
  ['OVH issue noted', v=>!!v('OVH Issues'), 'Survey'],
];

function buildPole(a, i){
  const v = (...n) => { for (const k of n){ const j = HIX.get(norm(k)); if (j!=null && a[j]!=null) return a[j]; } return null; };
  const id = String(v('POLE_NO','Pole Number','Pole ID')).trim();
  const P = { i, a, v, id, key: id, wl: [], iss: [] };
  P.osm = v('INSPECTION_ID','INSPECTIONSTATUS','PercntLoad')!=null;
  P.status = v('INSPECTIONSTATUS','LoadCalcRejtStatus') || '';
  P.loadStatus = v('LoadCalcStatus') || '';
  P.load = num(v('PercntLoad'));
  P.rs = num(v('REMAINING STRENGTH'));
  P.circuit = v('CIRCUIT') || '';
  P.sec = String(v('Circuit Section','CIRC_SECT') ?? '');
  P.lat = num(v('GPS_Y','Latitude','LAT')); P.lon = num(v('GPS_X','Longitude','LONG','LON'));
  if (P.lat!=null && P.lon!=null && Math.abs(P.lat)>90){ const t=P.lat; P.lat=P.lon; P.lon=t; }
  P.year = num(v('YearManufa','POLE_BDAY','CONT_BDAY'));
  P.yearKind = v('YearManuAE') || '';
  const insp = v('DATE_INSPECTED','INSPECTIONDATE','DateTime'); P.insp = insp instanceof Date ? insp : null;
  P.age = P.year && P.insp ? P.insp.getFullYear()-P.year : P.year ? new Date().getFullYear()-P.year : null;
  P.len = v('FIELD_LENGTH','POLE_SIZE'); P.cls = String(v('FIELD_CLASS') ?? String(v('CLASS')??'').replace(/^class\s*/i,'')) || '';
  P.hcField = P.len!=null && P.cls ? hcNorm(`${P.len}-${P.cls}`) : '';
  P.hcDesigner = hcNorm(v('Height & Class'));
  P.hcCorrect = hcNorm(v('CORRECT_HC'));
  P.hc = P.hcField || P.hcDesigner;
  P.treat = v('OrigTreat','OrigTreatmnet') || '';
  P.remarks = String(v('COMMENTS','STRAND_1') ?? '').split(';').map(s=>s.trim()).filter(Boolean);
  P.recOs = v('OSMOSE REC TRUSS TYPE') || ''; P.recRec = v('RECOMMENDED TRUSS TYPE') || '';
  P.truss = v('RECOMMENDED TRUSS SIZE') || '';
  P.cnpInit = v('CNP Initial Reccomendation','CNP Initial Recommendation') || ''; P.cnpInitType = v('CNP Initial Reccomendation Type','CNP Initial Recommendation Type') || '';
  P.designer = v('Designer Reccommendation','Designer Recommendation') || '';
  P.final = v('CNP Final Reccomendation Type','CNP Final Recommendation Type','CNP Final Recommendation') || '';
  P.final2 = v('CNP Final Reccomendation Type2') || '';
  P.notes = v('Notes') || ''; P.cnpNotes = v('CNP Notes') || '';
  P.bOs = bucket(P.recOs); P.bRec = bucket(P.recRec); P.bDes = bucket(P.designer); P.bInit = bucket(P.cnpInit); P.bFin = bucket(P.final);
  P.media = ['Media','Media_2','Media_3','Media_4','Media_5','Media_6','Media_7'].map(k=>v(k)).filter(Boolean);
  P.flags = FLAGS.filter(([,t])=>{ try { return t(v); } catch(e){ return false; } }).map(([l,,g])=>({l,g}));
  P.wp = v('Wood Pecker Damage') || '';
  return P;
}

/* ---------- checks ---------- */
function runChecks(){
  ISS = [];
  const add = (P, sev, cat, title, detail) => { const x = {P, sev, cat, title, detail:detail||''}; ISS.push(x); if (P) P.iss.push(x); };
  const geo = POLES.filter(P=>P.lat!=null && P.lon!=null);
  const med = arr => { const s=[...arr].sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; };
  const cLat = geo.length ? med(geo.map(P=>P.lat)) : null, cLon = geo.length ? med(geo.map(P=>P.lon)) : null;
  const miles = (la,lo) => { const R=3958.8, r=Math.PI/180, dLa=(la-cLat)*r, dLo=(lo-cLon)*r; const h=Math.sin(dLa/2)**2+Math.cos(cLat*r)*Math.cos(la*r)*Math.sin(dLo/2)**2; return 2*R*Math.asin(Math.sqrt(h)); };
  const onList = (P, kind) => P.wl.some(e=>e.w.kind===kind);
  const hasList = kind => WL.some(w=>w.kind===kind);
  POLES.forEach(P=>{
    const fin = BKL[P.bFin] || P.final;
    if (P.dup){ const rows = P.dup.rows, list = rows.length===2 ? `${rows[0]} and ${rows[1]}` : rows.join(', ');
      if (P.dup.same) add(P,'warn','Data',`Pole ${P.id} is in the sheet ${rows.length} times (rows ${list}) with identical data`,'Shown once here. The extra row can be removed from the sheet.');
      else add(P,'bad','Data',`Pole ${P.id} is on rows ${list} with different data (this is row ${P.row})`,`${P.dup.diff.length} column${P.dup.diff.length===1?'':'s'} differ: ${P.dup.diff.slice(0,10).map(i=>HEAD[i]).join(', ')}${P.dup.diff.length>10?`, and ${P.dup.diff.length-10} more`:''}. Each row is shown separately; see the comparison on the pole page.`); }
    if (!P.bFin) add(P,'bad','Recommendation','No CNP final recommendation','The CNP Final Recommendation column is blank for this pole.');
    if (!P.osm) add(P,'info','Data','No Osmose inspection data for this pole', P.notes ? `Notes: ${P.notes}` : 'Only the designer survey columns are filled in.');
    if (P.bOs in RANK && P.bFin in RANK){
      if (RANK[P.bFin] < RANK[P.bOs]) add(P,'warn','Recommendation',`CNP final (${fin}) is lighter than Osmose (${P.recOs})`, P.cnpNotes ? `CNP notes: ${P.cnpNotes}` : 'No CNP note explains the change.');
      else if (RANK[P.bFin] > RANK[P.bOs]) add(P,'info','Recommendation',`CNP final (${fin}) goes beyond Osmose (${P.recOs})`, [P.notes&&`Notes: ${P.notes}`, P.cnpNotes&&`CNP notes: ${P.cnpNotes}`].filter(Boolean).join(' · '));
    }
    if ((P.bOs==='Replace' || P.bOs==='Brace') && P.bFin==='N/A') add(P,'warn','Recommendation',`Osmose recommends ${P.recOs} but CNP final is N/A`, P.cnpNotes ? `CNP notes: ${P.cnpNotes}` : 'No CNP note explains the change.');
    if (P.bDes && P.bDes!=='N/A' && P.bFin && P.bDes!==P.bFin) add(P,'info','Recommendation',`CNP final (${fin}) differs from the designer (${P.designer})`, P.cnpNotes ? `CNP notes: ${P.cnpNotes}` : '');
    if (/reject/i.test(P.status) && !/non\s*reject/i.test(P.status) && P.bFin==='OK') add(P,'bad','Inspection',`Osmose rated this pole "${P.status}" but CNP final is Pole OK`, P.loadStatus ? `Load calc status: ${P.loadStatus}` : '');
    if (/priority/i.test(P.status) && P.bFin && P.bFin!=='Replace') add(P,'bad','Inspection',`Priority reject is not set to Replace (CNP final: ${fin})`,'');
    if (P.load!=null && P.load>=LOAD_LIMIT && P.bFin==='OK') add(P,'warn','Inspection',`Osmose % load is ${P.load}% but CNP final is Pole OK`,`Flagged at ${LOAD_LIMIT}% and above.`);
    if (P.rs!=null && P.rs<RS_LIMIT && P.bFin==='OK') add(P,'warn','Inspection',`Remaining strength is ${P.rs}% but CNP final is Pole OK`,`Flagged below ${RS_LIMIT}%.`);
    if (P.flags.some(f=>f.l==='Guying not adequate') && P.bFin==='OK') add(P,'warn','Inspection','Osmose found guying not adequate but CNP final is Pole OK','');
    if (/moderate|severe/i.test(P.wp) && P.bFin==='OK') add(P,'warn','Inspection',`${P.wp} woodpecker damage but CNP final is Pole OK`,'');
    if (P.flags.some(f=>f.l==='Pole not sound') && P.bFin==='OK') add(P,'warn','Inspection','Osmose marked the pole not sound but CNP final is Pole OK','');
    if (P.hcField && P.hcDesigner && !hcUnknown(P.hcField) && !hcUnknown(P.hcDesigner) && P.hcField!==P.hcDesigner) add(P,'warn','Height / class',`Designer height/class ${P.hcDesigner} doesn't match Osmose field ${P.hcField}`, P.hcCorrect ? `Osmose correct H/C: ${P.hcCorrect}` : '');
    if (/^[3-9]$/.test(P.cls) && P.bFin==='OK') add(P,'info','Height / class',`Class ${P.cls} pole kept as Pole OK`,'Resiliency poles are normally class 2 or better.');
    const s1 = P.v('CIRC_SECT'), s2 = P.v('Circuit Section'); if (s1!=null && s2!=null && String(s1)!==String(s2)) add(P,'warn','Location',`Circuit section differs: Osmose ${s1}, designer ${s2}`,'');
    if (P.osm && (P.lat==null || P.lon==null)) add(P,'warn','Location','No GPS coordinates','');
    else if (P.lat!=null && cLat!=null){ const m = miles(P.lat,P.lon); if (m>GPS_MILES) add(P,'warn','Location',`GPS point is ${m.toFixed(1)} miles from the rest of the circuit`,`${P.lat}, ${P.lon}`); }
    if (P.flags.some(f=>f.l==='Not a valid feeder pole / circuit')) add(P,'info','Location','Designer marked this as not a valid feeder pole / circuit','');
    if (hasList('replace')){
      if (onList(P,'replace') && P.bFin && P.bFin!=='Replace') add(P,'info','Work lists',`On the Osmose replace list, but CNP final is ${fin}`,'');
      if (P.osm && P.bFin==='Replace' && !onList(P,'replace')) add(P,'info','Work lists','CNP final is Replace but the pole is not on the Osmose replace list','');
    }
    if (hasList('brace')){
      if (onList(P,'brace') && P.bFin && P.bFin!=='Brace') add(P,'info','Work lists',`On the Osmose brace list, but CNP final is ${fin}`,'');
      if (P.osm && P.bFin==='Brace' && !onList(P,'brace')) add(P,'info','Work lists','CNP final is Brace but the pole is not on the Osmose brace list','');
    }
  });
  WL.forEach(w=>w.rows.filter(r=>!r.P).forEach(r=>add(null,'warn','Work lists',`Pole ${r.pole} on "${w.name}" is not in the pole data sheet`,'')));
}

/* ---------- filters ---------- */
function filtered(){
  const q = FIL.q.trim().toLowerCase();
  return POLES.filter(P=>{
    if (FIL.fin && P.bFin!==FIL.fin) return false;
    if (FIL.osm && (FIL.osm==='none' ? P.osm : P.bOs!==FIL.osm)) return false;
    if (FIL.sec && P.sec!==FIL.sec) return false;
    if (FIL.cond && !P.flags.some(f=>f.l===FIL.cond)) return false;
    if (FIL.rev==='done' && !rev(P).ok) return false;
    if (FIL.rev==='todo' && rev(P).ok) return false;
    if (FIL.iss==='any' && !P.iss.some(x=>x.sev!=='info')) return false;
    if (FIL.iss==='bad' && !P.iss.some(x=>x.sev==='bad')) return false;
    if (FIL.iss && FIL.iss.startsWith('m:')){ const [o,f] = FIL.iss.slice(2).split('|'); if (P.bOs!==o || P.bFin!==f) return false; }
    if (FIL.iss && FIL.iss.startsWith('d:')){ const [o,f] = FIL.iss.slice(2).split('|'); if (P.bDes!==o || P.bFin!==f) return false; }
    if (FIL.iss==='status' && !(/reject/i.test(P.status) && !/non\s*reject/i.test(P.status))) return false;
    if (q && !(`${P.id} ${P.sec} ${P.notes} ${P.cnpNotes} ${P.remarks.join(' ')} ${P.v('Major Equipment Stencil')??''} ${P.v('Equipment Stencil')??''}`.toLowerCase().includes(q))) return false;
    return true;
  });
}
const anyFilter = () => Object.values(FIL).some(Boolean);
function setFilter(f, tab){ FIL = {q:'', fin:'', osm:'', sec:'', cond:'', rev:'', iss:'', ...f}; CUR = null; TAB = tab || 'poles'; render(); window.scrollTo({top: $('#kpis').offsetTop-70, behavior:'smooth'}); }

/* ---------- header + kpis ---------- */
function renderHead(){
  const circ = [...new Set(POLES.map(P=>P.circuit).filter(Boolean))].join(', ');
  const ins = POLES.map(P=>P.insp).filter(Boolean).sort((a,b)=>a-b);
  const deliv = [...new Set(POLES.map(P=>P.v('DeliveryDescip')).filter(Boolean))];
  const qc = [...new Set(POLES.map(P=>fmtDate(P.v('QC_COMPLETION_DATE'))).filter(Boolean))];
  $('#hTitle').innerHTML = `${circ ? `Circuit ${esc(circ)}` : 'Pole inspection'} <span class="who">Osmose pole inspection</span>`;
  $('#hSub').innerHTML = [esc(FILE), ins.length && `Inspected ${fmtDate(ins[0])} – ${fmtDate(ins[ins.length-1])}`, qc.length && `QC complete ${qc.join(', ')}`, deliv.length && esc(deliv[0])].filter(Boolean).join(' · ');
}
function renderKpis(){
  const n = POLES.length, c = b => POLES.filter(P=>P.bFin===b).length;
  const rej = POLES.filter(P=>/reject/i.test(P.status) && !/non\s*reject/i.test(P.status)).length;
  const bad = ISS.filter(x=>x.sev==='bad').length, warn = ISS.filter(x=>x.sev==='warn').length;
  const done = POLES.filter(P=>rev(P).ok).length;
  const k = (v,l,d,cls,f,tab) => `<div class="kpi"><button class="kpib" data-kf='${esc(JSON.stringify(f||{}))}' data-kt="${tab||'poles'}"><div class="v ${cls||''}">${v}</div><div class="l">${l}</div>${d?`<div class="d">${d}</div>`:''}</button></div>`;
  $('#kpis').innerHTML = [
    k(f0(n),'Poles', `${POLES.filter(P=>P.osm).length} with Osmose data`),
    k(f0(rej),'Osmose rejects', `${pct(rej,n)}% of poles`, rej?'bad':'', {iss:'status'}),
    k(f0(c('Replace')),'CNP final: Replace', `${pct(c('Replace'),n)}%`, 'bad', {fin:'Replace'}),
    k(f0(c('Brace')),'CNP final: Brace', `${pct(c('Brace'),n)}%`, 'warn', {fin:'Brace'}),
    k(f0(c('OK')),'CNP final: Pole OK', `${pct(c('OK'),n)}%`, 'ok', {fin:'OK'}),
    k(f0(c('Run SA')),'CNP final: Run SA', `${pct(c('Run SA'),n)}%`, '', {fin:'Run SA'}),
    k(f0(bad+warn),'Findings', `${bad} errors, ${warn} warnings`, bad?'bad':warn?'warn':'ok', {}, 'findings'),
    k(`${done}/${n}`,'Reviewed', `${pct(done,n)}%`, done===n?'ok':'', {rev:'todo'}),
  ].join('');
}

/* ---------- tabs ---------- */
const TABS = [['overview','Overview'],['map','Map'],['poles','Poles'],['recs','Recommendations'],['over','Over 99% load'],['findings','Findings'],['lists','Work lists'],['data','All data']];
function render(){
  if (MAP){ try{ MAP.remove(); }catch(e){} MAP = null; }
  const cnt = {poles: anyFilter() ? `${filtered().length}/${POLES.length}` : POLES.length, findings: ISS.filter(x=>x.sev!=='info').length, over: overloaded().length, lists: WL.reduce((s,w)=>s+w.rows.length,0)};
  $('#tabs').innerHTML = TABS.filter(([k])=>k!=='lists' || WL.length).map(([k,l])=>`<button class="tab" role="tab" data-tab="${k}" aria-selected="${TAB===k}">${l}${cnt[k]!=null?`<span class="n">${cnt[k]}</span>`:''}</button>`).join('');
  const v = $('#view'), keepScroll = $('#plist') ? [$('#plist').scrollTop, $('#plist').scrollLeft] : null;
  v.innerHTML = TAB==='overview' ? vOverview() : TAB==='map' ? vMap() : TAB==='poles' ? vPoles() : TAB==='recs' ? vRecs() : TAB==='findings' ? vFindings() : TAB==='lists' ? vLists() : TAB==='over' ? vOver() : vData();
  if (TAB==='map') initMap();
  if (keepScroll && $('#plist')){ $('#plist').scrollTop = keepScroll[0]; $('#plist').scrollLeft = keepScroll[1]; }
}

/* ---------- small charts (HTML bars) ---------- */
function barList(items, opts={}){
  // items: [{label, n, cls, f (filter), tab, tip}]
  const max = Math.max(1, ...items.map(i=>i.n)), tot = opts.total || items.reduce((s,i)=>s+i.n,0);
  return `<div class="bars">${items.map(i=>`<button class="brow" ${i.f?`data-kf='${esc(JSON.stringify(i.f))}' data-kt="${i.tab||'poles'}"`:'disabled'} data-tip="${esc(i.tip || `${i.label}: ${i.n} poles (${pct(i.n,tot)}%)`)}">
    <span class="bl">${esc(i.label)}</span><span class="bt"><i class="${i.cls||''}" style="width:${i.n/max*100}%"></i></span><span class="bn">${f0(i.n)}</span></button>`).join('')}</div>`;
}
function stackRows(groups, keyOf, order, filt){
  // groups: [{label, poles, f}] → stacked by bucket
  const max = Math.max(1, ...groups.map(g=>g.poles.length));
  return `<div class="bars">${groups.map(g=>{ const c = {}; g.poles.forEach(P=>{ const k=keyOf(P); c[k]=(c[k]||0)+1; });
    return `<div class="brow st"><button class="link bl" data-kf='${esc(JSON.stringify(g.f))}' data-kt="poles">${esc(g.label)}</button><span class="bt stack" style="--w:${g.poles.length/max*100}%">${order.filter(k=>c[k]).map(k=>`<i class="${BKC[k]}" style="flex:${c[k]}" data-tip="${esc(`${g.label}: ${c[k]} ${BKL[k]} (${pct(c[k],g.poles.length)}%)`)}" data-kf='${esc(JSON.stringify({...g.f, ...filt(k)}))}' data-kt="poles"></i>`).join('')}</span><span class="bn">${g.poles.length}</span></div>`; }).join('')}</div>`;
}
function columns(bins, opts={}){
  const max = Math.max(1, ...bins.map(b=>b.n));
  return `<div class="cols">${bins.map(b=>`<div class="ccol" data-tip="${esc(b.tip || `${b.label}: ${b.n} poles`)}"><span class="cn">${b.n||''}</span><span class="cb"><i class="${b.cls||''}" style="height:${b.n/max*100}%"></i></span><span class="cl">${esc(b.label)}</span></div>`).join('')}</div>${opts.note?`<div class="hint" style="margin-top:6px">${opts.note}</div>`:''}`;
}
const legendRec = keys => `<div class="legend">${keys.map(k=>`<span><i class="sw ${BKC[k]}"></i>${BKL[k]}</span>`).join('')}</div>`;
const count = (arr, f) => { const m = new Map(); arr.forEach(x=>{ const k=f(x); if (k==null||k==='') return; m.set(k,(m.get(k)||0)+1); }); return [...m.entries()]; };

function vOverview(){
  const n = POLES.length;
  const finItems = BK.map(b=>({label:BKL[b], n:POLES.filter(P=>P.bFin===b).length, cls:BKC[b], f:{fin:b}})).filter(i=>i.n);
  const stItems = count(POLES, P=>P.status || (P.osm?'':'No Osmose data')).sort((a,b)=>b[1]-a[1]).map(([l,c])=>({label:l, n:c, cls:/priority/i.test(l)?'bad':/non restorable/i.test(l)?'bad':/restorable/i.test(l)?'warn':/no osmose/i.test(l)?'none':'ok', f:/no osmose/i.test(l)?{osm:'none'}:undefined}));
  const secs = count(POLES, P=>P.sec||'—').sort((a,b)=>b[1]-a[1]).map(([s])=>({label:`Section ${s}`, poles:POLES.filter(P=>(P.sec||'—')===s), f:{sec:s==='—'?'':s}}));
  const usedFin = BK.filter(b=>POLES.some(P=>P.bFin===b));
  const flagItems = count(POLES.flatMap(P=>P.flags.map(f=>f.l)), x=>x).sort((a,b)=>b[1]-a[1]).map(([l,c])=>({label:l, n:c, cls:FLAGS.find(f=>f[0]===l)?.[2]==='Survey'?'c':'warn', f:{cond:l}}));
  const ageBins = []; for (let a=0;a<80;a+=10) ageBins.push({label:a>=70?'70+':`${a}–${a+9}`, n:POLES.filter(P=>P.age!=null && P.age>=a && (a>=70 || P.age<a+10)).length});
  const loadBins = []; for (let a=0;a<=100;a+=10){ const hi=a===100; loadBins.push({label:hi?'100+':`${a}s`, n:POLES.filter(P=>P.load!=null && (hi ? P.load>=100 : P.load>=a && P.load<a+10)).length, cls:hi?'bad':a>=80?'warn':''}); }
  const hc = count(POLES, P=>P.hc || null).sort((a,b)=>b[1]-a[1]);
  const hcItems = hc.slice(0,10).map(([l,c])=>({label:l, n:c, f:{q:''}})).map(i=>({...i, f:undefined}));
  const tr = count(POLES, P=>P.treat || null).sort((a,b)=>b[1]-a[1]).map(([l,c])=>({label:l, n:c}));
  const yrs = POLES.filter(P=>P.year!=null); const est = yrs.filter(P=>/estim/i.test(P.yearKind)).length;
  return `<div class="grid2">
    <div class="card"><h3>CNP final recommendation</h3><div class="hint">Click a bar to list those poles.</div>${barList(finItems,{total:n})}</div>
    <div class="card"><h3>Osmose inspection status</h3><div class="hint">Restorable rejects can be braced; non-restorable rejects need replacing.</div>${barList(stItems,{total:n})}</div>
  </div>
  <div class="card"><h3>CNP final recommendation by circuit section</h3>${legendRec(usedFin)}${stackRows(secs, P=>P.bFin, BK, k=>({fin:k}))}</div>
  <div class="grid2">
    <div class="card"><h3>Conditions found</h3><div class="hint"><i class="sw warn"></i> Osmose inspection · <i class="sw c"></i> designer survey. Click to list those poles.</div>${flagItems.length?barList(flagItems,{total:n}):'<p class="muted">No conditions recorded.</p>'}</div>
    <div>
      <div class="card"><h3>Osmose % load</h3>${columns(loadBins,{note:`${POLES.filter(P=>P.load!=null).length} poles with a load calculation. 100% and over is shaded red.`})}</div>
      <div class="card"><h3>Pole age at inspection (years)</h3>${columns(ageBins,{note:`${yrs.length} poles with a year of manufacture${est?`, ${est} of them estimated`:''}.`})}</div>
    </div>
  </div>
  <div class="grid2">
    <div class="card"><h3>Height / class</h3><div class="hint">Osmose field measurement, or the designer's when Osmose has none.</div>${barList(hcItems,{total:n})}</div>
    <div class="card"><h3>Original treatment</h3>${barList(tr,{total:n})}</div>
  </div>`;
}

/* ---------- map ---------- */
function cssVar(n){ return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
const BKV = {bad:'--bad', warn:'--amber-bar', ok:'--ok', info:'--blue', none:'--muted', c:'--c'};
function mapColour(P){
  if (MAPBY==='final') return {k:P.bFin, c:BKC[P.bFin]};
  if (MAPBY==='osmose') return {k:P.osm?P.bOs:'', c:P.osm?BKC[P.bOs]:'none'};
  if (MAPBY==='designer') return {k:P.bDes, c:BKC[P.bDes]};
  if (MAPBY==='status') return {k:P.status||'No Osmose data', c:/priority|non restorable/i.test(P.status)?'bad':/restorable/i.test(P.status)?'warn':P.status?'ok':'none'};
  if (MAPBY==='load') return {k:P.load==null?'No load calc':P.load>=100?'100% and over':P.load>=80?'80–99%':'Under 80%', c:P.load==null?'none':P.load>=100?'bad':P.load>=80?'warn':'ok'};
  if (MAPBY==='findings') return {k:P.iss.some(x=>x.sev==='bad')?'Errors':P.iss.some(x=>x.sev==='warn')?'Warnings':'None', c:P.iss.some(x=>x.sev==='bad')?'bad':P.iss.some(x=>x.sev==='warn')?'warn':'ok'};
  return {k:rev(P).ok?'Reviewed':'Not reviewed', c:rev(P).ok?'ok':'none'};
}
const MAPLBL = k => MAPBY==='final'||MAPBY==='osmose'||MAPBY==='designer' ? (BKL[k] ?? k) : k;
function vMap(){
  const list = filtered(), geo = list.filter(P=>P.lat!=null && P.lon!=null);
  const by = [['final','CNP final'],['osmose','Osmose rec'],['designer','Designer rec'],['status','Inspection status'],['load','% load'],['findings','Findings'],['review','Reviewed']];
  return `<div class="viewbar"><h2>Map</h2><div class="seg">${by.map(([k,l])=>`<button data-mapby="${k}" aria-pressed="${MAPBY===k}">${l}</button>`).join('')}</div>
    <div class="seg">${[['streets','Streets'],['sat','Satellite']].map(([k,l])=>`<button data-mapbase="${k}" aria-pressed="${MAPBASE===k}">${l}</button>`).join('')}</div>
    <div class="hint">${geo.length} of ${list.length} ${anyFilter()?'filtered ':''}poles have GPS points. ${anyFilter()?'<button class="link" data-clearf="1">Show all poles</button>':'Filters from the Poles tab apply here.'} Click a pole for details.</div></div>
    <div id="mapLegend" class="legend"></div><div id="map" class="map"></div>`;
}
function initMap(){
  if (!window.L){ $('#map').innerHTML = '<p class="muted" style="padding:16px">The map library could not be loaded.</p>'; return; }
  const geo = filtered().filter(P=>P.lat!=null && P.lon!=null);
  MAP = L.map('map', {preferCanvas:true});
  const base = MAPBASE==='sat'
    ? L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom:20, maxNativeZoom:19, attribution:'Imagery &copy; Esri'})
    : L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:20, maxNativeZoom:19, attribution:'&copy; OpenStreetMap contributors'});
  base.addTo(MAP);
  const seen = new Map();
  geo.forEach(P=>{ const {k,c} = mapColour(P); seen.set(k, c);
    const m = L.circleMarker([P.lat,P.lon], {radius:7, weight:2, color: MAPBASE==='sat' ? '#fff' : cssVar('--surface'), fillColor: cssVar(BKV[c]), fillOpacity:1}).addTo(MAP);
    m.bindTooltip(`${P.id} · ${MAPLBL(k)}`);
    m.bindPopup(()=>`<div class="pop"><b>Pole ${esc(P.id)}</b><div>${esc(P.hc||'')} · Section ${esc(P.sec)} · ${P.load!=null?`${P.load}% load`:'no load calc'}</div>
      <div style="margin:6px 0">Osmose: ${recPill(P.bOs,P.recOs||'—')} → Designer: ${recPill(P.bDes,P.designer||'—')} → CNP: ${recPill(P.bFin,P.final||'—')}</div>
      ${P.iss.filter(x=>x.sev!=='info').slice(0,3).map(x=>`<div class="iss ${x.sev}" style="padding:3px 8px;margin-top:3px;font-size:12px">${esc(x.title)}</div>`).join('')}
      <button class="btn sm" data-open="${P.i}" style="margin-top:8px">Open pole</button></div>`);
  });
  $('#mapLegend').innerHTML = [...seen.entries()].sort((a,b)=>natural(a[0],b[0])).map(([k,c])=>`<span><i class="sw ${c}" style="border-radius:50%;width:10px;height:10px"></i>${esc(MAPLBL(k))} (${geo.filter(P=>mapColour(P).k===k).length})</span>`).join('');
  if (geo.length) MAP.fitBounds(L.latLngBounds(geo.map(P=>[P.lat,P.lon])).pad(0.05)); else MAP.setView([29.95,-95.3], 11);
  setTimeout(()=>MAP && MAP.invalidateSize(), 50);
}

/* ---------- poles ---------- */
function filterBar(){
  const secs = [...new Set(POLES.map(P=>P.sec).filter(Boolean))].sort(natural);
  const conds = [...new Set(POLES.flatMap(P=>P.flags.map(f=>f.l)))].sort();
  const opt = (v,l,cur) => `<option value="${esc(v)}" ${cur===v?'selected':''}>${esc(l)}</option>`;
  const used = k => BK.filter(b=>b && POLES.some(P=>P[k]===b));
  const special = FIL.iss && (FIL.iss.startsWith('m:')||FIL.iss.startsWith('d:')||FIL.iss==='status');
  return `<div class="filters">
    <input type="search" placeholder="Search pole, note, remark…" data-f="q" value="${esc(FIL.q)}" style="min-width:200px">
    <select data-f="fin" aria-label="CNP final">${opt('','Any CNP final',FIL.fin)}${used('bFin').map(b=>opt(b,`CNP final: ${BKL[b]}`,FIL.fin)).join('')}</select>
    <select data-f="osm" aria-label="Osmose recommendation">${opt('','Any Osmose rec',FIL.osm)}${used('bOs').map(b=>opt(b,`Osmose: ${BKL[b]}`,FIL.osm)).join('')}${opt('none','No Osmose data',FIL.osm)}</select>
    <select data-f="sec" aria-label="Circuit section">${opt('','All sections',FIL.sec)}${secs.map(s=>opt(s,`Section ${s}`,FIL.sec)).join('')}</select>
    <select data-f="cond" aria-label="Condition">${opt('','Any condition',FIL.cond)}${conds.map(c=>opt(c,c,FIL.cond)).join('')}</select>
    <select data-f="iss" aria-label="Findings">${opt('','Any findings',FIL.iss)}${opt('any','Has errors or warnings',FIL.iss)}${opt('bad','Has errors',FIL.iss)}${special?opt(FIL.iss,'From a chart / matrix',FIL.iss):''}</select>
    <select data-f="rev" aria-label="Review">${opt('','Reviewed or not',FIL.rev)}${opt('todo','Not reviewed',FIL.rev)}${opt('done','Reviewed',FIL.rev)}</select>
    ${anyFilter()?'<button class="btn sm" data-clearf="1">Clear filters</button>':''}
  </div>`;
}
function vPoles(){
  const list = filtered().sort(byPole);
  if (CUR==null || !list.some(P=>P.i===CUR)) CUR = list[0]?.i ?? null;
  const P = POLES[CUR];
  const sevDot = P => P.iss.some(x=>x.sev==='bad') ? 'bad' : P.iss.some(x=>x.sev==='warn') ? 'warn' : 'ok';
  return `${filterBar()}<div class="md">
    <div class="plist" id="plist">${list.length ? list.map(Q=>`<button class="pcard" data-pole="${Q.i}" aria-current="${Q.i===CUR}"><span class="dot ${sevDot(Q)}" title="${Q.iss.filter(x=>x.sev!=='info').length} findings"></span><b>${esc(Q.id)}${rev(Q).ok?' <span class="tick" title="Reviewed">✓</span>':''}</b>${recPill(Q.bFin, BKL[Q.bFin])}<span class="spec">${esc([Q.dup&&!Q.dup.same&&`Row ${Q.row}`, Q.hc, Q.sec&&`Sec ${Q.sec}`, Q.load!=null&&`${Q.load}%`].filter(Boolean).join(' · '))}</span></button>`).join('') : '<p class="muted">No poles match these filters.</p>'}</div>
    <div class="detail">${P ? poleDetail(P, list) : ''}</div></div>`;
}
const kv = (rows) => `<table class="kvt">${rows.filter(r=>r && r[1]!=null && r[1]!=='').map(([k,v,cls])=>`<tr><th>${esc(k)}</th><td class="${cls||''}">${v}</td></tr>`).join('')}</table>`;
const yn = v => v==null ? null : esc(show(v));
function poleDetail(P, list){
  const v = P.v, R = rev(P), idx = list.findIndex(Q=>Q.i===P.i);
  const prev = list[idx-1], next = list[idx+1];
  const steps = [['Osmose rec', P.recOs, P.bOs], ['Recommended truss', P.recRec, P.bRec], ['Designer', P.designer, P.bDes], ['CNP initial', [P.cnpInit, P.cnpInitType].filter(Boolean).join(' · '), P.bInit], ['CNP final', P.final, P.bFin]];
  const gmap = P.lat!=null ? `https://www.google.com/maps?q=${P.lat},${P.lon}` : '';
  const flagsO = P.flags.filter(f=>f.g==='Osmose'), flagsS = P.flags.filter(f=>f.g==='Survey');
  const statusCls = /priority|non restorable/i.test(P.status)?'bad':/restorable/i.test(P.status)?'warn':P.status?'ok':'none';
  return `<div class="dhead"><h2>Pole ${esc(P.id)}</h2>${P.status?`<span class="pill ${statusCls}">${esc(P.status)}</span>`:'<span class="pill none">No Osmose data</span>'}${P.dup?(P.dup.same?`<span class="pill warn">In sheet ${P.dup.rows.length}× (identical)</span>`:`<span class="pill bad">Row ${P.row} · duplicate with different data</span>`):''}<span class="muted sm">Sheet row ${P.dup&&P.dup.same?P.dup.rows.join(', '):P.row}</span>
    <span class="spacer"></span>${gmap?`<a class="btn sm" href="${gmap}" target="_blank" rel="noopener">Google Maps</a>`:''}
    <button class="btn sm" data-pole="${prev?.i??''}" ${prev?'':'disabled'}>← Prev</button><button class="btn sm" data-pole="${next?.i??''}" ${next?'':'disabled'}>Next →</button></div>
  <div class="path">${steps.map(([l,t,b],i)=>`${i?'<span class="arr" aria-hidden="true">→</span>':''}<div class="step ${t?BKC[b]:'none'}"><div class="sl">${l}</div><div class="sv">${esc(t||'—')}</div></div>`).join('')}</div>
  ${P.truss||v('ReccLengthReplace')?`<p class="muted" style="margin:6px 0 0;font-size:13px">${P.truss?`Truss size: <b>${esc(P.truss)}</b>. `:''}${v('ReccLengthReplace')?`Osmose replacement size if replaced: <b>${esc(v('ReccLengthReplace'))}-${esc(v('ReccClassReplace')??'')}</b>.`:''}</p>`:''}
  <div class="review"><label class="ck"><input type="checkbox" data-rev="${P.i}" ${R.ok?'checked':''}> Reviewed</label><input type="text" class="revnote" data-revnote="${P.i}" placeholder="Your review note (saved in this browser)" value="${esc(R.note||'')}"></div>
  ${P.iss.length?`<div class="sec"><h3>Findings <span class="n muted sm">${P.iss.length}</span></h3><div class="issues">${P.iss.map(x=>`<div class="iss ${x.sev}"><b>${esc(x.title)}</b>${x.detail?`<div class="w">${esc(x.detail)}</div>`:''}</div>`).join('')}</div></div>`:''}
  ${(P.notes||P.cnpNotes)?`<div class="sec grid2s">${P.notes?`<div class="note"><b>Designer notes</b><p>${esc(P.notes)}</p></div>`:''}${P.cnpNotes?`<div class="note"><b>CNP notes</b><p>${esc(P.cnpNotes)}</p></div>`:''}</div>`:''}
  <div class="grid3 sec">
    <div class="note"><b>Structure</b>${kv([
      ['Height / class (Osmose field)', esc(P.hcField)], ['Height / class (designer)', esc(P.hcDesigner), P.hcField&&P.hcDesigner&&!hcUnknown(P.hcDesigner)&&!hcUnknown(P.hcField)&&P.hcField!==P.hcDesigner?'badtxt':''], ['Correct H/C (Osmose)', esc(P.hcCorrect)], ['Tag class', yn(v('CLASS'))],
      ['Composition', yn(v('Pole Composition','StructMat'))], ['Species', yn(v('SPECIES'))], ['Original treatment', esc(P.treat)],
      ['Year made', P.year!=null?`${P.year}${P.yearKind?` <span class="muted">(${esc(P.yearKind.toLowerCase())})</span>`:''}`:null], ['Age at inspection', P.age!=null?`${P.age} years`:null], ['Manufacturer', yn(v('Manufactur'))],
      ['Ground-line circumference', v('Orig_Circumference')!=null?`${esc(v('Orig_Circumference'))} in → ${esc(v('Current_Circumference')??'–')} in now`:null]])}</div>
    <div class="note"><b>Inspection</b>${kv([
      ['Inspected', fmtDate(P.insp)], ['Status', esc(P.status)], ['Load calc status', esc(P.loadStatus)],
      ['% load', P.load!=null?`<span class="pct ${P.load>=LOAD_LIMIT?'bad':P.load>=80?'warn':''}">${P.load}%</span>`:null], ['Remaining strength', P.rs!=null?`<span class="pct ${P.rs<RS_LIMIT?'bad':''}">${P.rs}%</span>`:null],
      ['Guy status', yn(v('GuyStatus'))], ['Treated', fmtDate(v('DATE_TREATED'))], ['Wind zone', v('Wind Speed Zone')!=null?`${esc(v('Wind Speed Zone'))} mph`:null], ['Line voltage', v('Line Voltage')!=null?`${esc(v('Line Voltage'))} kV`:null],
      ['Woodpecker', esc(P.wp)], ['Not inspected reason', yn(v('NInsReason'))],
      ['Remarks', P.remarks.length?`<span class="chips">${P.remarks.map(r=>`<span class="pill none">${esc(r)}</span>`).join('')}</span>`:null]])}</div>
    <div class="note"><b>Location</b>${kv([
      ['Circuit', esc(P.circuit)], ['Section', esc(P.sec)], ['Lambert grid', yn(v('LAMBERT'))], ['Location', yn(v('LOCATION'))], ['County', yn(v('County'))],
      ['GPS', P.lat!=null?`${P.lat.toFixed(6)}, ${P.lon.toFixed(6)}`:null], ['Crossing', yn(v('Crossing Type'))], ['Permit', yn(v('Permit Type'))], ['Truck access', yn(v('Truck Access?'))], ['Tree trimming', yn(v('Tree Trimming Needed'))]])}</div>
    <div class="note"><b>Equipment</b>${kv([
      ['Major equipment', [v('Major Equipment Type'), v('Major Equipment Stencil')].filter(x=>x!=null).map(esc).join(' · ')||null], ['Scenario', yn(v('Major Scenario Type'))],
      ['Equipment', [v('Equipment Type'), v('Equipment Stencil')].filter(x=>x!=null).map(esc).join(' · ')||null], ['Transformer', yn(v('TRANSFORMER'))], ['Transformer size', yn(v('SIZE_CONF_INFO'))], ['Transformer ground', yn(v('GROUND FROM TRANSFORMER'))],
      ['Primary / secondary', [/^y/i.test(v('PRIMARY_POLE'))&&'Primary', /^y/i.test(v('SECONDARY_POLE'))&&'Secondary'].filter(Boolean).join(' + ')||null], ['Steel crossarm', yn(v('CROSS_STEEL'))], ['Stencil change', yn(v('STENCIL CHANGE'))], ['Primary < 600 AAC', yn(v('Is Primary Conductor <600 AAC'))]])}</div>
    <div class="note"><b>Guying</b>${/^y/i.test(v('GUYED_POLE'))?kv([['Guyed','Yes'], ['Direction', yn(v('GUY_DIRECTION'))], ['Status', yn(v('GuyStatus'))], ['Wire tight', yn(v('GUY_WIRE_TIGHT'))], ['Damaged', yn(v('GUY_DAMAGED'))], ['Marker present', yn(v('GUY_MARKER_PRESENT'))], ['Strain insulator OK', yn(v('GUY_STRAIN_PROPERLY_INST'))], ['Anchor damaged', yn(v('ANCHOR_DAMAGED'))], ['Crosses sidewalk', yn(v('GUY_CROSSES_SIDEWALK'))]]):`<p class="muted">${v('GUYED_POLE')!=null?'Not guyed':'No guy data'}</p>`}</div>
    <div class="note"><b>Conditions found</b>${P.flags.length?`${flagsO.length?`<div class="sm muted" style="margin:2px 0">Osmose</div><div class="chips">${flagsO.map(f=>`<span class="pill warn">${esc(f.l)}</span>`).join('')}</div>`:''}${flagsS.length?`<div class="sm muted" style="margin:8px 0 2px">Designer survey</div><div class="chips">${flagsS.map(f=>`<span class="pill c">${esc(f.l)}${f.l==='Crossing'?`: ${esc(v('Crossing Type'))}`:f.l==='Permit needed'?`: ${esc(v('Permit Type'))}`:f.l==='OVH issue noted'?`: ${esc(v('OVH Issues'))}`:''}</span>`).join('')}</div>`:''}`:'<p class="muted">None recorded.</p>'}</div>
  </div>
  ${P.dup && !P.dup.same ? dupCompare(P) : ''}
  ${P.wl.length?`<div class="sec"><h3>Osmose work lists</h3><div class="issues">${P.wl.map(({w,r})=>{ const d = w.head.findIndex(h=>/description/i.test(h)), s = w.head.findIndex(h=>/short text|osmose rec/i.test(h)); return `<div class="iss ${w.kind==='replace'?'bad':w.kind==='brace'?'warn':''}"><b>${esc(w.name)}</b>${s>=0&&r.cells[s]?` · ${esc(r.cells[s])}`:''}${d>=0&&r.cells[d]?`<div class="w pre">${esc(r.cells[d])}</div>`:''}</div>`; }).join('')}</div></div>`:''}
  ${P.media.length?`<div class="sec"><h3>Osmose photos <span class="n muted sm">${P.media.length}</span></h3><div class="hint" style="margin-bottom:6px">Photo file names from the sheet. The images themselves come from Osmose separately.</div><div class="chips">${P.media.map(m=>`<span class="pill info" data-copytext="${esc(m)}" title="Click to copy the file name" style="cursor:pointer">${esc(m)}</span>`).join('')}</div></div>`:''}
  <details class="sec"><summary><b>All ${HEAD.filter((h,i)=>P.a[i]!=null).length} filled-in columns</b></summary><div class="tscroll" style="margin-top:8px"><table class="kvt full">${HEAD.map((h,i)=>P.a[i]!=null?`<tr><th>${esc(h)}</th><td>${esc(show(P.a[i]))}</td></tr>`:'').join('')}</table></div></details>`;
}

function dupCompare(P){
  const g = P.dup.all;
  return `<div class="sec"><h3>Duplicate rows compared <span class="n muted sm">${P.dup.diff.length} columns differ</span></h3><div class="hint" style="margin-bottom:6px">Pole ${esc(P.id)} is on ${g.length} rows of the sheet. Only the columns that differ are shown; this pole page is row ${P.row}.</div>
  <div class="tscroll"><table class="dupt"><thead><tr><th>Column</th>${g.map(x=>{ const Q = POLES.find(q=>q.id===P.id && q.row===x.row); return `<th class="${x.row===P.row?'cur':''}">${x.row===P.row?`Row ${x.row} (this one)`:`<button class="link" data-pole="${Q?Q.i:''}">Row ${x.row}</button>`}</th>`; }).join('')}</tr></thead><tbody>
  ${P.dup.diff.map(i=>`<tr><th>${esc(HEAD[i])}</th>${g.map(x=>`<td class="${x.row===P.row?'cur':''} ${x.a[i]==null?'muted':''}">${x.a[i]==null?'blank':esc(show(x.a[i]))}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div></div>`;
}

/* ---------- recommendations ---------- */
function matrix(rowKey, rowLabel, prefix){
  const rows = BK.filter(b=>POLES.some(P=>P[rowKey]===b)), cols = BK.filter(b=>POLES.some(P=>P.bFin===b));
  const n = (r,c) => POLES.filter(P=>P[rowKey]===r && P.bFin===c).length;
  const max = Math.max(1, ...rows.flatMap(r=>cols.map(c=>n(r,c))));
  return `<div class="tscroll"><table class="mx"><thead><tr><th>${rowLabel}</th>${cols.map(c=>`<th class="num">${recPill(c)}</th>`).join('')}<th class="num">Total</th></tr></thead><tbody>
    ${rows.map(r=>`<tr><th>${recPill(r, r===''?'Not set':BKL[r])}</th>${cols.map(c=>{ const x=n(r,c), same = r===c || (r==='' && false); const off = x && r in RANK && c in RANK && r!==c;
      return `<td class="num ${x?'click':''} ${same&&x?'same':''} ${off?(RANK[c]<RANK[r]?'down':'up'):''}" ${x?`data-kf='${esc(JSON.stringify({iss:`${prefix}:${r}|${c}`}))}' data-kt="poles"`:''} style="--a:${x/max}" data-tip="${esc(`${BKL[r]} → ${BKL[c]}: ${x} poles`)}">${x||''}</td>`; }).join('')}<td class="num"><b>${POLES.filter(P=>P[rowKey]===r).length}</b></td></tr>`).join('')}
  </tbody></table></div>`;
}
function vRecs(){
  const chg = POLES.filter(P=>P.bOs in RANK && P.bFin in RANK && P.bOs!==P.bFin);
  const key = 'recs', s = SORT[key] || {k:'id', d:1};
  const cols = [['id','Pole',P=>P.id],['sec','Section',P=>P.sec],['status','Status',P=>P.status],['load','% load',P=>P.load],['os','Osmose',P=>P.recOs],['rec','Recommended',P=>P.recRec],['des','Designer',P=>P.designer],['fin','CNP final',P=>P.final],['dir','Change',P=>RANK[P.bFin]-RANK[P.bOs]],['notes','Notes',P=>P.notes],['cnp','CNP notes',P=>P.cnpNotes]];
  const kf = cols.find(c=>c[0]===s.k)||cols[0]; chg.sort((a,b)=>{ const x=kf[2](a), y=kf[2](b); return (typeof x==='number'&&typeof y==='number' ? x-y : natural(x,y))*s.d; });
  return `<div class="viewbar"><h2>Recommendations</h2><div class="hint">How each pole's recommendation moved from Osmose to the CNP final. Shaded cells kept the same call; <span class="badtxt">red</span> cells went lighter than Osmose, <span style="color:var(--blue);font-weight:600">blue</span> cells went heavier. Click a number to list those poles.</div></div>
  <div class="grid2"><div class="card"><h3>Osmose recommendation → CNP final</h3>${matrix('bOs','Osmose','m')}</div><div class="card"><h3>Designer recommendation → CNP final</h3>${matrix('bDes','Designer','d')}</div></div>
  <div class="card"><h3>Poles where CNP final differs from Osmose <span class="n muted sm">${chg.length}</span></h3><div class="tscroll"><table data-sortkey="${key}"><thead><tr>${cols.map(([k,l])=>`<th class="s ${s.k===k?'sorted':''}" data-sort="${k}">${l}${s.k===k?(s.d>0?' ▲':' ▼'):''}</th>`).join('')}</tr></thead><tbody>
    ${chg.map(P=>`<tr class="click" data-open="${P.i}"><td><b>${esc(P.id)}</b></td><td>${esc(P.sec)}</td><td>${esc(P.status)}</td><td class="num">${P.load??''}</td><td>${recPill(P.bOs,P.recOs)}</td><td>${P.recRec?recPill(P.bRec,P.recRec):''}</td><td>${P.designer?recPill(P.bDes,P.designer):''}</td><td>${recPill(P.bFin,P.final)}</td><td>${RANK[P.bFin]<RANK[P.bOs]?'<span class="pill bad">Lighter</span>':'<span class="pill info">Heavier</span>'}</td><td class="wrapc">${esc(P.notes)}</td><td class="wrapc">${esc(P.cnpNotes)}</td></tr>`).join('')}
  </tbody></table></div></div>`;
}

/* ---------- findings ---------- */
function vFindings(){
  const cats = [...new Set(ISS.map(x=>x.cat))];
  const list = ISS.filter(x=>(!IFIL.sev || x.sev===IFIL.sev) && (!IFIL.cat || x.cat===IFIL.cat));
  const ord = {bad:0, warn:1, info:2}; list.sort((a,b)=>ord[a.sev]-ord[b.sev] || natural(a.cat,b.cat) || natural(a.P?.id,b.P?.id));
  const c = s => ISS.filter(x=>x.sev===s).length;
  const lbl = {bad:'Error', warn:'Warning', info:'Note'};
  return `<div class="viewbar"><h2>Findings</h2>
    <div class="seg">${[['','All'],['bad',`Errors (${c('bad')})`],['warn',`Warnings (${c('warn')})`],['info',`Notes (${c('info')})`]].map(([k,l])=>`<button data-isev="${k}" aria-pressed="${IFIL.sev===k}">${l}</button>`).join('')}</div>
    <div class="filters" style="margin:0"><select data-icat="1" aria-label="Category"><option value="">All categories</option>${cats.map(k=>`<option ${IFIL.cat===k?'selected':''}>${esc(k)}</option>`).join('')}</select></div>
    <button class="btn sm" data-copy="findings">Copy table</button>
    <div class="hint">Flags at ${LOAD_LIMIT}% load or more and remaining strength under ${RS_LIMIT}% when CNP final is Pole OK. Click a finding to open the pole.</div></div>
  <div class="tscroll"><table id="findTbl"><thead><tr><th>Severity</th><th>Category</th><th>Pole</th><th>Section</th><th>Finding</th><th>Detail</th><th>CNP final</th></tr></thead><tbody>
    ${list.map(x=>`<tr ${x.P?`class="click" data-open="${x.P.i}"`:''}><td><span class="pill ${x.sev}">${lbl[x.sev]}</span></td><td>${esc(x.cat)}</td><td><b>${esc(x.P?.id??'')}</b></td><td>${esc(x.P?.sec??'')}</td><td class="wrapc">${esc(x.title)}</td><td class="wrapc muted">${esc(x.detail)}</td><td>${x.P?recPill(x.P.bFin,x.P.final||'—'):''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nothing to show.</td></tr>'}
  </tbody></table></div>`;
}

/* ---------- work lists ---------- */
function vLists(){
  return WL.map(w=>{ const keep = w.head.map((h,i)=>i).filter(i=>w.rows.some(r=>r.cells[i]!=null));
    const match = w.rows.filter(r=>r.P).length;
    const agree = r => !r.P ? '' : w.kind==='replace' ? r.P.bFin==='Replace' : w.kind==='brace' ? r.P.bFin==='Brace' : null;
    return `<div class="card"><h3>${esc(w.name)} <span class="n muted sm">${w.rows.length} poles</span></h3><div class="hint">${match} of ${w.rows.length} found in the pole data sheet.${w.kind==='replace'||w.kind==='brace'?` ${w.rows.filter(r=>agree(r)===true).length} have a CNP final of ${w.kind==='replace'?'Replace':'Brace'}.`:''}</div>
    <div class="tscroll" style="margin-top:8px"><table><thead><tr>${keep.map(i=>`<th>${esc(w.head[i])}</th>`).join('')}<th>CNP final</th></tr></thead><tbody>
    ${w.rows.map(r=>`<tr ${r.P?`class="click" data-open="${r.P.i}"`:''}>${keep.map(i=>`<td class="${/description/i.test(w.head[i])?'wrapc pre':''}">${esc(show(r.cells[i]))}</td>`).join('')}<td>${r.P?recPill(r.P.bFin, r.P.final||'—')+(agree(r)===false?' <span class="pill warn">differs</span>':''):'<span class="pill bad">Not in data</span>'}</td></tr>`).join('')}
    </tbody></table></div></div>`; }).join('');
}

/* ---------- poles over 99% load that Osmose didn't recommend replacing ---------- */
const OVER = 99;
const overloaded = () => POLES.filter(P=>P.load!=null && P.load>OVER && P.bOs!=='Replace').sort((a,b)=>b.load-a.load || byPole(a,b));
const overCols = [['Pole',P=>`<b>${esc(P.id)}</b>`+(P.dup&&!P.dup.same?` <span class="muted">(row ${P.row})</span>`:'')],['Section',P=>esc(P.sec)],['% load',P=>`<span class="pct bad">${P.load}%</span>`],['Status',P=>esc(P.status)],['Load calc',P=>esc(P.loadStatus)],
  ['H / C',P=>esc(P.hc)],['Year',P=>P.year!=null?`${P.year}${/estim/i.test(P.yearKind)?' (est.)':''}`:''],['Osmose rec',P=>recPill(P.bOs,P.recOs||'—')],['Truss size',P=>esc(P.truss)],['Designer',P=>P.designer?recPill(P.bDes,P.designer):''],['CNP final',P=>recPill(P.bFin,P.final||'—')]];
function vOver(){
  const list = overloaded(), c = b => list.filter(P=>P.bFin===b).length;
  return `<div class="viewbar"><h2>Poles over ${OVER}% load without an Osmose replace</h2>
    <button class="btn sm primary" data-print="list">Print list</button><button class="btn sm" data-print="full">Print with a page per pole</button><button class="btn sm" data-copy="over">Copy table</button>
    <div class="hint">${list.length} pole${list.length===1?'':'s'} where the Osmose load calculation is over ${OVER}% but the Osmose recommendation is not Replace. CNP final: ${BK.filter(b=>c(b)).map(b=>`${c(b)} ${BKL[b]}`).join(', ')||'none'}. Click a row to open the pole.</div></div>
  <div class="tscroll"><table id="overTbl"><thead><tr>${overCols.map(([l])=>`<th>${l}</th>`).join('')}<th>Notes</th><th>CNP notes</th></tr></thead><tbody>
    ${list.map(P=>`<tr class="click" data-open="${P.i}">${overCols.map(([,f])=>`<td>${f(P)}</td>`).join('')}<td class="wrapc">${esc(P.notes)}</td><td class="wrapc">${esc(P.cnpNotes)}</td></tr>`).join('') || `<tr><td colspan="${overCols.length+2}" class="muted">No poles are over ${OVER}% load without an Osmose replace.</td></tr>`}
  </tbody></table></div>`;
}
function printOver(full){
  const list = overloaded(), circ = [...new Set(POLES.map(P=>P.circuit).filter(Boolean))].join(', ');
  const plain = (b,t) => esc(t || BKL[b] || '—');
  const row = P => `<tr><td><b>${esc(P.id)}</b>${P.dup&&!P.dup.same?` (row ${P.row})`:''}</td><td>${esc(P.sec)}</td><td><b>${P.load}%</b></td><td>${esc(P.status)}</td><td>${esc(P.hc)}</td><td>${P.year??''}</td><td>${plain(P.bOs,P.recOs)}</td><td>${esc(P.truss)}</td><td>${plain(P.bDes,P.designer)}</td><td>${plain(P.bFin,P.final)}</td><td>${esc([P.notes,P.cnpNotes].filter(Boolean).join(' / '))}</td></tr>`;
  const kvp = rows => `<table class="pkv">${rows.filter(r=>r[1]!=null&&r[1]!=='').map(([k,x])=>`<tr><th>${esc(k)}</th><td>${x}</td></tr>`).join('')}</table>`;
  const page = P => { const v = P.v;
    return `<section class="ppage"><h2>Pole ${esc(P.id)}${P.dup&&!P.dup.same?` <small>(sheet row ${P.row})</small>`:''} <span class="pload">${P.load}% load</span></h2>
    <div class="pcols"><div>${kvp([['Circuit / section', esc(`${P.circuit} / ${P.sec}`)], ['GPS', P.lat!=null?`${P.lat.toFixed(6)}, ${P.lon.toFixed(6)}`:''], ['Location', esc(show(v('LOCATION')))], ['Inspected', fmtDate(P.insp)], ['Status', esc(P.status)], ['Load calc status', esc(P.loadStatus)], ['Remaining strength', P.rs!=null?`${P.rs}%`:''], ['Guy status', esc(show(v('GuyStatus')))]])}</div>
    <div>${kvp([['Height / class (Osmose)', esc(P.hcField)], ['Height / class (designer)', esc(P.hcDesigner)], ['Year made', P.year!=null?`${P.year}${P.yearKind?` (${esc(P.yearKind.toLowerCase())})`:''}`:''], ['Treatment', esc(P.treat)], ['Major equipment', esc([v('Major Equipment Type'), v('Major Equipment Stencil')].filter(x=>x!=null).join(' · '))], ['Equipment', esc([v('Equipment Type'), v('Equipment Stencil')].filter(x=>x!=null).join(' · '))], ['Conditions', esc(P.flags.map(f=>f.l).join(', '))], ['Remarks', esc(P.remarks.join('; '))]])}</div></div>
    ${kvp([['Osmose recommendation', plain(P.bOs,P.recOs)], ['Recommended truss', esc([P.recRec, P.truss].filter(Boolean).join(' · '))], ['Designer', plain(P.bDes,P.designer)], ['CNP initial', esc([P.cnpInit,P.cnpInitType].filter(Boolean).join(' · '))], ['CNP final', plain(P.bFin,P.final)], ['Designer notes', esc(P.notes)], ['CNP notes', esc(P.cnpNotes)], ['Review note', esc(rev(P).note||'')]])}
    <div class="pnotes">Reviewer notes:<i></i><i></i><i></i></div></section>`; };
  let area = $('#printArea'); if (!area){ area = document.createElement('div'); area.id = 'printArea'; document.body.appendChild(area); }
  area.innerHTML = `<header class="phead"><h1>Circuit ${esc(circ)}: poles over ${OVER}% load without an Osmose replace</h1><p>${list.length} poles · ${esc(FILE)} · printed ${fmtDate(new Date())}</p></header>
    <table class="ptbl"><thead><tr><th>Pole</th><th>Section</th><th>% load</th><th>Status</th><th>H/C</th><th>Year</th><th>Osmose rec</th><th>Truss size</th><th>Designer</th><th>CNP final</th><th>Notes</th></tr></thead><tbody>${list.map(row).join('')}</tbody></table>
    ${full ? list.map(page).join('') : ''}`;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(()=>window.print(), 50);
}

/* ---------- all data ---------- */
const DSETS = {
  summary:['POLE_NO','Circuit Section','INSPECTIONSTATUS','LoadCalcStatus','PercntLoad','FIELD_LENGTH','FIELD_CLASS','Height & Class','YearManufa','OrigTreat','GuyStatus','OSMOSE REC TRUSS TYPE','RECOMMENDED TRUSS TYPE','RECOMMENDED TRUSS SIZE','Designer Reccommendation','CNP Initial Reccomendation','CNP Final Reccomendation Type','Notes','CNP Notes'],
  osmose:['POLE_NO','INSPECTIONSTATUS','LoadCalcStatus','PercntLoad','REMAINING STRENGTH','COMMENTS','CLASS','POLE_SIZE','FIELD_LENGTH','FIELD_CLASS','CORRECT_HC','SPECIES','OrigTreat','YearManufa','YearManuAE','Orig_Circumference','Current_Circumference','GuyStatus','DATE_INSPECTED','GPS_Y','GPS_X'],
  conditions:['POLE_NO','GROUNDWIRE_CUT','POLEDAMAGE_WOODPECKER','Wood Pecker Damage','GUYED_POLE','GuyStatus','GUY_WIRE_TIGHT','GUY_MARKER_PRESENT','VEGETATION AT POLE','INSULATOR_TIES','Glass Insulator Present','POLE_SOUND','TRANSFORMER','GROUND FROM TRANSFORMER','CROSSARM','STENCIL CHANGE','OVH Issues'],
  design:['POLE_NO','Major Equipment Type','Major Equipment Stencil','Major Scenario Type','Equipment Type','Equipment Stencil','Pole Composition','Height & Class','Crossing Type','Tree Trimming Needed','Is Primary Conductor <600 AAC','Truck Access?','Valid Feeder Pole & Circuit','Permit Type','Notes','Designer Reccommendation','CNP Initial Reccomendation','CNP Initial Reccomendation Type','CNP Final Reccomendation Type','CNP Notes'],
};
function dataCols(){ if (DCOLS==='all') return HEAD.map((h,i)=>i).filter(i=>HEAD[i] && POLES.some(P=>P.a[i]!=null)); return [...new Set(DSETS[DCOLS].map(n=>colIx(n)).filter(i=>i>=0))]; }
function vData(){
  const cols = dataCols(), key = 'data', s = SORT[key] || {k:cols[0], d:1};
  const q = DQ.trim().toLowerCase();
  const list = filtered().filter(P=>!q || cols.some(i=>show(P.a[i]).toLowerCase().includes(q)));
  list.sort((a,b)=>{ const x=a.a[s.k], y=b.a[s.k]; return (typeof x==='number'&&typeof y==='number' ? x-y : natural(show(x),show(y)))*s.d; });
  return `<div class="viewbar"><h2>All data</h2><div class="seg">${[['summary','Summary'],['osmose','Osmose inspection'],['conditions','Conditions'],['design','Designer & CNP'],['all','Every column']].map(([k,l])=>`<button data-dcols="${k}" aria-pressed="${DCOLS===k}">${l}</button>`).join('')}</div>
    <input type="search" class="fin" placeholder="Search these columns…" data-dq="1" value="${esc(DQ)}"><button class="btn sm" data-copy="data">Copy table</button>
    <div class="hint">${list.length} rows${anyFilter()?' (Poles tab filters apply). <button class="link" data-clearf="1">Clear filters</button>':''}. Click a column to sort, a row to open the pole.</div></div>
  <div class="tscroll dscroll"><table id="dataTbl" data-sortkey="${key}"><thead><tr>${cols.map(i=>`<th class="s ${s.k===i?'sorted':''}" data-sort="${i}">${esc(HEAD[i])}${s.k===i?(s.d>0?' ▲':' ▼'):''}</th>`).join('')}</tr></thead><tbody>
    ${list.map(P=>`<tr class="click" data-open="${P.i}">${cols.map(i=>`<td class="${typeof P.a[i]==='number'?'num':''} ${/notes|comments/i.test(HEAD[i])?'wrapc':''}">${esc(show(P.a[i]))}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>`;
}

/* ---------- Excel download ---------- */
function exportExcel(){
  const wb = XLSX.utils.book_new();
  const summary = POLES.map(P=>({ 'Pole': P.id, 'Circuit': P.circuit, 'Section': P.sec, 'Osmose status': P.status, 'Load calc status': P.loadStatus, '% load': P.load, 'Remaining strength': P.rs,
    'H/C (Osmose field)': P.hcField, 'H/C (designer)': P.hcDesigner, 'Year made': P.year, 'Age': P.age, 'Treatment': P.treat, 'Latitude': P.lat, 'Longitude': P.lon,
    'Osmose rec': P.recOs, 'Recommended truss': P.recRec, 'Truss size': P.truss, 'Designer rec': P.designer, 'CNP initial': P.cnpInit, 'CNP initial type': P.cnpInitType, 'CNP final': P.final,
    'Conditions': P.flags.map(f=>f.l).join('; '), 'Remarks': P.remarks.join('; '), 'Errors': P.iss.filter(x=>x.sev==='bad').length, 'Warnings': P.iss.filter(x=>x.sev==='warn').length,
    'Notes': P.notes, 'CNP notes': P.cnpNotes, 'Reviewed': rev(P).ok ? 'Yes' : '', 'Review note': rev(P).note || '' }));
  const ws1 = XLSX.utils.json_to_sheet(summary); ws1['!cols'] = Object.keys(summary[0]||{}).map(k=>({wch: /notes|conditions|remarks/i.test(k) ? 40 : Math.max(10, k.length+2)})); ws1['!autofilter'] = {ref: ws1['!ref']};
  XLSX.utils.book_append_sheet(wb, ws1, 'Pole review');
  const lbl = {bad:'Error', warn:'Warning', info:'Note'};
  const fr = ISS.map(x=>({ Severity: lbl[x.sev], Category: x.cat, Pole: x.P?.id ?? '', Section: x.P?.sec ?? '', Finding: x.title, Detail: x.detail, 'CNP final': x.P?.final ?? '' }));
  const ws2 = XLSX.utils.json_to_sheet(fr.length?fr:[{Severity:'',Category:'',Pole:'',Section:'',Finding:'No findings',Detail:'','CNP final':''}]); ws2['!cols'] = [{wch:10},{wch:16},{wch:12},{wch:10},{wch:60},{wch:50},{wch:14}]; ws2['!autofilter'] = {ref: ws2['!ref']};
  XLSX.utils.book_append_sheet(wb, ws2, 'Findings');
  const circ = [...new Set(POLES.map(P=>P.circuit).filter(Boolean))].join('_') || 'Poles';
  XLSX.writeFile(wb, `${circ}_Osmose_Pole_Review.xlsx`);
}

/* ---------- copy ---------- */
function copyTable(tbl){ if (!tbl) return; const t = [...tbl.rows].map(r=>[...r.cells].map(c=>c.innerText.replace(/[▲▼]/g,'').replace(/\s+/g,' ').trim()).join('\t')).join('\n'); navigator.clipboard.writeText(t).then(()=>toast('Table copied'), ()=>toast('Copy failed')); }

/* ---------- loading ---------- */
async function loadFile(f){
  const li = document.createElement('li'); li.innerHTML = `<span>${esc(f.name)}</span><span class="st">Reading…</span>`; $('#fileList').replaceChildren(li);
  try {
    if (!window.XLSX) throw new Error('The Excel reader could not be loaded. Check your internet connection.');
    const bytes = await f.arrayBuffer();
    readWorkbook(bytes, f.name);
    if (!POLES.length) throw new Error('No pole rows were found.');
    dbPut({name:f.name, bytes, at:Date.now()});
    start();
  } catch(e){ console.error(e); li.querySelector('.st').className='e'; li.querySelector('.e').textContent = e.message || 'Could not read this file'; }
}
function start(){ TAB = 'overview'; CUR = null; FIL = {q:'', fin:'', osm:'', sec:'', cond:'', rev:'', iss:''}; $('#empty').hidden = true; $('#app').hidden = false; $('#clearAll').hidden = false; $('#openOther').hidden = false; renderHead(); renderKpis(); render(); }
$('#pick').onclick = () => $('#file').click();
$('#openOther').onclick = () => $('#file').click();
$('#file').onchange = e => { const f = e.target.files[0]; e.target.value=''; if (f){ $('#app').hidden=true; $('#empty').hidden=false; loadFile(f); } };
$('#clearAll').onclick = async () => { await dbClear(); POLES=[]; WL=[]; ISS=[]; $('#app').hidden=true; $('#empty').hidden=false; $('#clearAll').hidden=true; $('#openOther').hidden=true; $('#restore').hidden=true; $('#fileList').innerHTML=''; };
$('#restore').onclick = async () => { const r = await dbGet(); if (r) loadFile(new File([r.bytes], r.name)); };
dbGet().then(r=>{ if (r){ $('#restore').hidden=false; $('#restore').textContent = `Reopen ${r.name.length>40?r.name.slice(0,38)+'…':r.name}`; } });
const drop = $('#drop');
['dragenter','dragover'].forEach(ev=>document.addEventListener(ev,e=>{ e.preventDefault(); drop.classList.add('over'); }));
['dragleave','drop'].forEach(ev=>document.addEventListener(ev,e=>{ e.preventDefault(); drop.classList.remove('over'); }));
document.addEventListener('drop', e=>{ const f = [...(e.dataTransfer?.files||[])].find(f=>/\.(xlsx|xlsm|xls|csv)$/i.test(f.name)); if (f){ $('#app').hidden=true; $('#empty').hidden=false; loadFile(f); } else if (e.dataTransfer?.files?.length) toast('Drop an Excel workbook (.xlsx)'); });
$('#xlsxBtn').onclick = () => exportExcel();
$('#themeBtn').onclick = () => { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'); const n = cur==='dark'?'light':'dark'; document.documentElement.dataset.theme = n; try{ localStorage.setItem('osmrev:theme', n); }catch(e){} if (TAB==='map' && POLES.length) render(); };
try{ const t = localStorage.getItem('osmrev:theme'); if (t) document.documentElement.dataset.theme = t; }catch(e){}

/* ---------- events ---------- */
// change the selected pole without rebuilding the list, so the sidebar keeps its scroll position
function selectPole(i, reveal){
  const list = $('#plist'), det = document.querySelector('.detail');
  if (TAB!=='poles' || !list || !det){ CUR = i; render(); return; }
  CUR = i;
  list.querySelectorAll('.pcard[aria-current="true"]').forEach(c=>c.setAttribute('aria-current','false'));
  const card = list.querySelector(`.pcard[data-pole="${i}"]`); if (card) card.setAttribute('aria-current','true');
  det.innerHTML = poleDetail(POLES[i], filtered().sort(byPole));
  if (reveal && card) revealCard(card);
  const top = $('.md').getBoundingClientRect().top; if (top < 60) window.scrollBy(0, top - 70);   // bring the detail top into view if scrolled past it
}
// scroll only the sidebar (not the page) so the card is visible
function revealCard(card){ const list = $('#plist'); if (!list || !card) return;
  const L = list.getBoundingClientRect(), C = card.getBoundingClientRect();
  if (getComputedStyle(list).flexDirection==='row'){ if (C.left < L.left) list.scrollLeft -= L.left - C.left + 8; else if (C.right > L.right) list.scrollLeft += C.right - L.right + 8; return; }
  if (C.top < L.top) list.scrollTop -= L.top - C.top + 4; else if (C.bottom > L.bottom) list.scrollTop += C.bottom - L.bottom + 4; }
function openPole(i){ CUR = +i; if (!filtered().some(P=>P.i===CUR)) FIL = {q:'', fin:'', osm:'', sec:'', cond:'', rev:'', iss:''}; TAB = 'poles'; render(); revealCard(document.querySelector('.pcard[aria-current="true"]')); window.scrollTo({top: $('#kpis').offsetTop-70}); }
document.addEventListener('click', e=>{
  const t = e.target.closest('button,[data-open],[data-kf],th[data-sort],[data-copytext],td[data-kf],i[data-kf]'); if (!t) return;
  if (t.dataset.tab){ TAB = t.dataset.tab; render(); return; }
  if (t.dataset.kf){ setFilter(JSON.parse(t.dataset.kf), t.dataset.kt); return; }
  if (t.dataset.open!=null && t.dataset.open!==''){ if (MAP) MAP.closePopup(); openPole(t.dataset.open); return; }
  if (t.dataset.pole!=null && t.dataset.pole!==''){ selectPole(+t.dataset.pole, !t.closest('#plist')); return; }
  if (t.dataset.clearf){ FIL = {q:'', fin:'', osm:'', sec:'', cond:'', rev:'', iss:''}; render(); return; }
  if (t.dataset.mapby){ MAPBY = t.dataset.mapby; render(); return; }
  if (t.dataset.mapbase){ MAPBASE = t.dataset.mapbase; render(); return; }
  if (t.dataset.isev!=null){ IFIL.sev = t.dataset.isev; render(); return; }
  if (t.dataset.dcols){ DCOLS = t.dataset.dcols; render(); return; }
  if (t.dataset.print){ printOver(t.dataset.print==='full'); return; }
  if (t.dataset.copy){ copyTable(t.dataset.copy==='findings' ? $('#findTbl') : t.dataset.copy==='over' ? $('#overTbl') : $('#dataTbl')); return; }
  if (t.dataset.copytext){ navigator.clipboard.writeText(t.dataset.copytext).then(()=>toast('File name copied')); return; }
  if (t.dataset.sort!=null){ const key = t.closest('table').dataset.sortkey; const k = key==='data' ? +t.dataset.sort : t.dataset.sort; const s = SORT[key]; SORT[key] = {k, d: s && s.k===k ? -s.d : 1}; render(); return; }
});
document.addEventListener('change', e=>{
  const t = e.target;
  if (t.dataset.f && t.dataset.f!=='q'){ FIL[t.dataset.f] = t.value; render(); return; }
  if (t.dataset.icat){ IFIL.cat = t.value; render(); return; }
  if (t.dataset.rev!=null){ const P = POLES[+t.dataset.rev]; REV[P.key] = {...rev(P), ok: t.checked}; saveRev(); renderKpis(); const y = window.scrollY; render(); window.scrollTo(0,y); toast(t.checked ? `Pole ${P.id} marked reviewed` : `Pole ${P.id} unmarked`); return; }
  if (t.dataset.revnote!=null){ const P = POLES[+t.dataset.revnote]; REV[P.key] = {...rev(P), note: t.value.trim()}; saveRev(); toast('Note saved'); }
});
let qT; document.addEventListener('input', e=>{
  const t = e.target;
  if (t.dataset.f==='q' || t.dataset.dq){ clearTimeout(qT); qT = setTimeout(()=>{ if (t.dataset.dq) DQ = t.value; else FIL.q = t.value; const pos = t.selectionStart; render(); const n = document.querySelector(t.dataset.dq?'[data-dq]':'[data-f="q"]'); if (n){ n.focus(); try{ n.setSelectionRange(pos,pos); }catch(err){} } }, 200); }
});
document.addEventListener('keydown', e=>{
  if (TAB!=='poles' || /input|select|textarea/i.test(document.activeElement?.tagName||'')) return;
  if (e.key==='ArrowDown' || e.key==='ArrowUp' || e.key==='j' || e.key==='k'){ const list = filtered().sort(byPole); const i = list.findIndex(P=>P.i===CUR); const n = list[i + ((e.key==='ArrowDown'||e.key==='j')?1:-1)]; if (n){ e.preventDefault(); selectPole(n.i, true); } }
});

/* ---------- tooltip ---------- */
const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; document.body.appendChild(tip);
document.addEventListener('mouseover', e=>{ const t = e.target.closest('[data-tip]'); if (!t){ tip.hidden = true; return; } tip.textContent = t.dataset.tip; tip.hidden = false; });
document.addEventListener('mousemove', e=>{ if (tip.hidden) return; const w = tip.offsetWidth; tip.style.left = Math.min(window.innerWidth-w-8, e.clientX+14)+'px'; tip.style.top = (e.clientY+16)+'px'; });

let tt; function toast(t){ const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(tt); tt = setTimeout(()=>el.classList.remove('show'), 2400); }
})();
