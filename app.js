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
function db(){ if (DBP) return DBP; DBP = new Promise((res,rej)=>{ try{ const r=indexedDB.open('osmrev',2); r.onupgradeneeded=()=>{ const d=r.result; if (!d.objectStoreNames.contains('files')) d.createObjectStore('files',{keyPath:'id'}); if (!d.objectStoreNames.contains('handles')) d.createObjectStore('handles'); }; r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);}catch(e){rej(e);} }); return DBP; }
async function dbAll(){ try{ const d=await db(); return await new Promise((res)=>{ const q=d.transaction('files').objectStore('files').getAll(); q.onsuccess=()=>res(q.result||[]); q.onerror=()=>res([]); }); }catch(e){ return []; } }
async function dbPut(rec){ try{ const d=await db(); await new Promise((res)=>{ const t=d.transaction('files','readwrite'); t.objectStore('files').put(rec); t.oncomplete=res; t.onerror=res; }); }catch(e){} }
async function dbDel(id){ try{ const d=await db(); await new Promise((res)=>{ const t=d.transaction('files','readwrite'); t.objectStore('files').delete(id); t.oncomplete=res; t.onerror=res; }); }catch(e){} }
async function hGet(){ try{ const d=await db(); return await new Promise((res)=>{ const q=d.transaction('handles').objectStore('handles').get('folder'); q.onsuccess=()=>res(q.result||null); q.onerror=()=>res(null); }); }catch(e){ return null; } }
async function hPut(h){ try{ const d=await db(); await new Promise((res)=>{ const t=d.transaction('handles','readwrite'); h ? t.objectStore('handles').put(h,'folder') : t.objectStore('handles').delete('folder'); t.oncomplete=res; t.onerror=res; }); }catch(e){} }
async function dbClear(){ try{ const d=await db(); await new Promise((res)=>{ const t=d.transaction('files','readwrite'); t.objectStore('files').clear(); t.oncomplete=res; t.onerror=res; }); }catch(e){} }
let REV = {}; try { REV = JSON.parse(localStorage.getItem('osmrev:review')||'{}'); } catch(e){}
const saveRev = () => { try{ localStorage.setItem('osmrev:review', JSON.stringify(REV)); }catch(e){} };
const rev = P => REV[P.key] || {};

/* ---------- state ---------- */
// one dataset per uploaded workbook (circuit); the globals below always point at the selected one
let SETS = [], DS = null;
let FILE = '', HEAD = [], HIX = new Map(), POLES = [], WL = [], ISS = [];
let TAB = 'overview', CUR = null, MAP = null;
const SORT = {};
const NOFIL = () => ({q:'', fin:'', osm:'', sec:'', cond:'', rev:'', iss:''});
let FIL = NOFIL();
let IFIL = {sev:'', cat:''};
let DCOLS = 'summary', DQ = '', MAPBY = 'final', MAPBASE = 'streets', MAPSCOPE = 'circuit', MAPFULL = false, MAPVIEW = null, MARKERS = new Map();

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

function readWorkbook(bytes, name, fallbackId){
  const wb = XLSX.read(new Uint8Array(bytes), {type:'array', cellDates:true});
  const tabs = wb.SheetNames.map(n=>{ const ws = wb.Sheets[n], rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:null, raw:true, blankrows:true});
    const r0 = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s.r : 0;   // sheet row of rows[0], zero-based
    let hr = -1; for (let i=0;i<Math.min(10,rows.length);i++){ const ns = (rows[i]||[]).map(norm); if (ns.includes('poleno') || ns.includes('poleid') || ns.includes('polenumber')){ hr=i; break; } }
    return {name:n, ws, rows, hr, r0, c0: ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s.c : 0}; }).filter(t=>t.hr>=0);
  // the pole data sheet: the one with the most columns that has a pole number column
  const main = tabs.filter(t=>t.rows[t.hr].map(norm).some(x=>x==='poleno'||x==='polenumber')).sort((a,b)=>b.rows[b.hr].length-a.rows[a.hr].length)[0]
    || tabs.sort((a,b)=>b.rows[b.hr].length-a.rows[a.hr].length)[0];
  if (!main){ const e = new Error('No sheet with a POLE_NO or Pole ID column was found in this workbook.'); e.notOsmose = true; throw e; }
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
  const circs = [...new Set(POLES.map(P=>P.circuit).filter(Boolean))].sort(natural);
  const id = circs.join(', ') || fallbackId || name.replace(/\.[^.]+$/,'');
  // "CNP Initial Recommendation" columns that are Excel formulas (Sheet Rules) are worked out here as fields are filled in
  const initCol = colIx('CNP Initial Reccomendation','CNP Initial Recommendation');
  const calcInit = initCol>=0 && !!main.ws[XLSX.utils.encode_cell({r: main.r0+main.hr+1, c: main.c0+initCol})]?.f;
  POLES.forEach(P=>P.orig = P.a.slice());
  POLES = POLES.map(P=>applyEdits(P, id));   // unsaved edits kept in this browser
  if (calcInit) POLES.forEach(calcInitRec);
  // work lists: every other sheet keyed by pole
  WL = tabs.filter(t=>t!==main).map(t=>{ const head = t.rows[t.hr].map(h=>h==null?'':String(h).trim()); const pi = head.map(norm).findIndex(x=>x==='poleid'||x==='poleno'||x==='polenumber');
    const kind = /replace/i.test(t.name) ? 'replace' : /brace/i.test(t.name) ? 'brace' : /addl|additional|ovh/i.test(t.name) ? 'addl' : 'other';
    const rows = t.rows.slice(t.hr+1).map(r=>head.map((_,i)=>clean(r[i]))).filter(r=>r[pi]!=null).map(cells=>({pole:String(cells[pi]).trim(), cells}));
    return {name:t.name, kind, head, pi, rows}; }).filter(w=>w.rows.length);
  const byKey = new Map(); POLES.forEach(P=>{ if (!byKey.has(P.id)) byKey.set(P.id, []); byKey.get(P.id).push(P); });
  WL.forEach(w=>w.rows.forEach(r=>{ r.P = (byKey.get(r.pole)||[])[0]||null; if (r.P) r.P.wl.push({w, r}); }));
  runChecks();
  const lkName = wb.SheetNames.find(n=>/^lookups?$/i.test(n.trim())), lookups = {};
  if (lkName){ const lr = XLSX.utils.sheet_to_json(wb.Sheets[lkName], {header:1, defval:null, raw:false});
    (lr[0]||[]).forEach((h,c)=>{ if (h) lookups[norm(h)] = lr.slice(1).map(r=>r[c]).filter(x=>x!=null && String(x).trim()!=='').map(x=>String(x).trim()); }); }
  const ds = { id, file: name, head: HEAD, hix: HIX, poles: POLES, wl: WL, iss: ISS, bytes, sheetName: main.name, c0: main.c0, calcInit, lookups };
  POLES.forEach(P=>P.ds = ds); ISS.forEach(x=>x.ds = ds);
  return ds;
}
function useSet(ds){ DS = ds; FILE = ds.file; HEAD = ds.head; HIX = ds.hix; POLES = ds.poles; WL = ds.wl; ISS = ds.iss; }
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
  const hix = HIX, v = (...n) => { for (const k of n){ const j = hix.get(norm(k)); if (j!=null && a[j]!=null) return a[j]; } return null; };
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
  // first column that exists, even if blank (newer sheets have "CNP Final Reccomendation" plus a separate "...Type")
  const vc = (...n) => { for (const k of n){ const j = hix.get(norm(k)); if (j!=null) return a[j]; } return null; };
  P.cnpInit = vc('CNP Initial Reccomendation','CNP Initial Recommendation') || ''; P.cnpInitType = vc('CNP Initial Reccomendation Type','CNP Initial Recommendation Type') || '';
  P.designer = vc('Designer Reccommendation','Designer Recommendation') || '';
  P.final = vc('CNP Final Reccomendation','CNP Final Recommendation','CNP Final Reccomendation Type','CNP Final Recommendation Type') || '';
  P.finalType = hix.has(norm('CNP Final Reccomendation')) || hix.has(norm('CNP Final Recommendation')) ? (vc('CNP Final Reccomendation Type','CNP Final Recommendation Type') || '') : (v('CNP Final Reccomendation Type2') || '');
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
  const anyFinal = POLES.some(P=>P.bFin);
  POLES.forEach(P=>{
    const fin = BKL[P.bFin] || P.final;
    if (P.dup){ const rows = P.dup.rows, list = rows.length===2 ? `${rows[0]} and ${rows[1]}` : rows.join(', ');
      if (P.dup.same) add(P,'warn','Data',`Pole ${P.id} is in the sheet ${rows.length} times (rows ${list}) with identical data`,'Shown once here. The extra row can be removed from the sheet.');
      else add(P,'bad','Data',`Pole ${P.id} is on rows ${list} with different data (this is row ${P.row})`,`${P.dup.diff.length} column${P.dup.diff.length===1?'':'s'} differ: ${P.dup.diff.slice(0,10).map(i=>HEAD[i]).join(', ')}${P.dup.diff.length>10?`, and ${P.dup.diff.length-10} more`:''}. Each row is shown separately; see the comparison on the pole page.`); }
    // a sheet still being filled in has no CNP finals yet; only flag gaps once CNP has started giving them
    if (!P.bFin && anyFinal) add(P,'warn','Recommendation','No CNP final recommendation yet','The CNP Final Recommendation column is blank for this pole.');
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
  $('#hTitle').innerHTML = `${circ ? `Circuit ${esc(circ)}` : esc(DS.id)} <span class="who">Osmose pole inspection</span>`;
  const sel = $('#circSel'); sel.hidden = SETS.length<2; $('#rmCirc').hidden = SETS.length<2;
  sel.innerHTML = SETS.map(s=>`<option value="${esc(s.id)}" ${s===DS?'selected':''}>Circuit ${esc(s.id)} · ${s.poles.length} poles</option>`).join('');
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
    ...(fieldsOf(DS).length ? [k(`${POLES.filter(fillDone).length}/${n}`,'Designer rec filled', `${pct(POLES.filter(fillDone).length,n)}% · ${editTotal(DS)} unsaved`, POLES.every(fillDone)?'ok':'warn', {}, 'fill')] : []),
  ].join('');
}

function setStats(s){
  const P = s.poles, c = b => P.filter(x=>x.bFin===b).length;
  return { n:P.length, osm:P.filter(x=>x.osm).length, rej:P.filter(x=>/reject/i.test(x.status) && !/non\s*reject/i.test(x.status)).length,
    Replace:c('Replace'), Brace:c('Brace'), OK:c('OK'), 'Run SA':c('Run SA'), other:P.filter(x=>!['Replace','Brace','OK','Run SA'].includes(x.bFin)).length,
    over:overloaded(P).length, bad:s.iss.filter(x=>x.sev==='bad').length, warn:s.iss.filter(x=>x.sev==='warn').length, done:P.filter(x=>rev(x).ok).length };
}
function circuitsCard(){
  if (SETS.length<2) return '';
  const tot = {}; const st = SETS.map(s=>{ const t = setStats(s); Object.entries(t).forEach(([k,v])=>tot[k]=(tot[k]||0)+v); return [s,t]; });
  const cells = t => `<td class="num">${f0(t.n)}</td><td class="num">${f0(t.rej)}</td><td class="num">${f0(t.Replace)}</td><td class="num">${f0(t.Brace)}</td><td class="num">${f0(t.OK)}</td><td class="num">${f0(t['Run SA'])}</td><td class="num">${f0(t.over)}</td><td class="num">${f0(t.bad)}</td><td class="num">${f0(t.warn)}</td><td class="num">${t.done}/${t.n}</td>`;
  return `<div class="card"><h3>Uploaded circuits <span class="n muted sm">${SETS.length}</span></h3><div class="hint">Click a circuit to switch to it. Everything below is for circuit ${esc(DS.id)}.</div>
  <div class="tscroll"><table><thead><tr><th>Circuit</th><th>File</th><th class="num">Poles</th><th class="num">Osmose rejects</th><th class="num">Replace</th><th class="num">Brace</th><th class="num">Pole OK</th><th class="num">Run SA</th><th class="num">Over 99% w/o replace</th><th class="num">Errors</th><th class="num">Warnings</th><th class="num">Reviewed</th></tr></thead><tbody>
  ${st.map(([s,t])=>`<tr class="click ${s===DS?'curset':''}" data-circ="${esc(s.id)}"><td><b>${esc(s.id)}</b>${s===DS?' <span class="pill info">Selected</span>':''}</td><td class="muted">${esc(s.file)}</td>${cells(t)}</tr>`).join('')}
  <tr class="tot"><td><b>All circuits</b></td><td></td>${cells(tot)}</tr></tbody></table></div></div>`;
}

/* ---------- tabs ---------- */
const TABS = [['overview','Overview'],['map','Map'],['poles','Poles'],['fill','Fill in'],['recs','Recommendations'],['over','Over 99% load'],['findings','Findings'],['lists','Work lists'],['data','All data']];
function render(){
  if (MAP){ try{ MAP.remove(); }catch(e){} MAP = null; }
  const cnt = {poles: anyFilter() ? `${filtered().length}/${POLES.length}` : POLES.length, findings: ISS.filter(x=>x.sev!=='info').length, over: overloaded().length, lists: WL.reduce((s,w)=>s+w.rows.length,0)};
  cnt.fill = fieldsOf(DS).length ? `${POLES.filter(P=>fillDone(P)).length}/${POLES.length}` : null;
  renderEditBar();
  $('#tabs').innerHTML = TABS.filter(([k])=>(k!=='lists' || WL.length) && (k!=='fill' || fieldsOf(DS).length)).map(([k,l])=>`<button class="tab" role="tab" data-tab="${k}" aria-selected="${TAB===k}">${l}${cnt[k]!=null?`<span class="n">${cnt[k]}</span>`:''}</button>`).join('');
  const v = $('#view'), keepScroll = $('#plist') ? [$('#plist').scrollTop, $('#plist').scrollLeft] : null;
  v.innerHTML = TAB==='overview' ? vOverview() : TAB==='map' ? vMap() : TAB==='poles' ? vPoles() : TAB==='recs' ? vRecs() : TAB==='findings' ? vFindings() : TAB==='lists' ? vLists() : TAB==='over' ? vOver() : TAB==='fill' ? vFill() : vData();
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
  return `${circuitsCard()}<div class="grid2">
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
const hasGeo = P => P.lat!=null && P.lon!=null;
const mapAll = () => MAPSCOPE==='all' && SETS.length>1;
// all circuits: every pole of every circuit (Poles tab filters only apply to the selected circuit view)
const mapList = () => mapAll() ? SETS.flatMap(s=>s.poles) : filtered();
function vMap(){
  const all = mapAll(), list = mapList(), geo = list.filter(hasGeo);
  const by = [['final','CNP final'],['osmose','Osmose rec'],['designer','Designer rec'],['status','Inspection status'],['load','% load'],['findings','Findings'],['review','Reviewed']];
  return `<div class="mapwrap ${MAPFULL?'full':''}" id="mapWrap"><div class="viewbar mapbar"><h2>${MAPFULL?`Circuit ${esc(DS.id)}${all?` + ${SETS.length-1} more`:''}`:'Map'}</h2>
    ${SETS.length>1?`<div class="seg">${[['circuit',`Circuit ${DS.id}`],['all',`All circuits (${SETS.length})`]].map(([k,l])=>`<button data-mapscope="${k}" aria-pressed="${MAPSCOPE===k}">${esc(l)}</button>`).join('')}</div>`:''}
    <label class="sm muted">Color by <select class="fin" data-mapbysel="1">${by.map(([k,l])=>`<option value="${k}" ${MAPBY===k?'selected':''}>${l}</option>`).join('')}</select></label>
    <div class="seg">${[['streets','Streets'],['sat','Satellite']].map(([k,l])=>`<button data-mapbase="${k}" aria-pressed="${MAPBASE===k}">${l}</button>`).join('')}</div>
    <input type="search" class="fin" data-mapfind="1" placeholder="Find pole (Enter)" style="width:150px">
    <button class="btn sm" data-mapfit="1">Fit to poles</button>
    <button class="btn sm ${MAPFULL?'':'primary'}" data-mapfull="1">${MAPFULL?'Exit full screen (Esc)':'Full screen'}</button>
    <div class="hint">${all ? `${geo.length} poles with GPS across ${SETS.length} circuits. Circuit ${esc(DS.id)} is drawn larger; other circuits are smaller and lighter. Poles tab filters don't apply here.`
      : `${geo.length} of ${list.length} ${anyFilter()?'filtered ':''}poles have GPS points. ${anyFilter()?'<button class="link" data-clearf="1">Show all poles</button>':'Filters from the Poles tab apply here.'}`} Click a pole for details.</div></div>
    <div id="mapLegend" class="legend"></div><div id="map" class="map"></div></div>`;
}
function popupHtml(P){
  const other = P.ds!==DS;
  return `<div class="pop"><b>Pole ${esc(P.id)}</b>${SETS.length>1?` <span class="muted">· Circuit ${esc(P.ds.id)}</span>`:''}<div>${esc(P.hc||'')} · Section ${esc(P.sec)} · ${P.load!=null?`${P.load}% load`:'no load calc'}</div>
    <div style="margin:6px 0">Osmose: ${recPill(P.bOs,P.recOs||'—')} → Designer: ${recPill(P.bDes,P.designer||'—')} → CNP: ${recPill(P.bFin,P.final||'—')}</div>
    ${P.iss.filter(x=>x.sev!=='info').slice(0,3).map(x=>`<div class="iss ${x.sev}" style="padding:3px 8px;margin-top:3px;font-size:12px">${esc(x.title)}</div>`).join('')}
    <button class="btn sm" data-open="${P.i}" data-ds="${esc(P.ds.id)}" style="margin-top:8px">${other?`Open pole (switches to circuit ${esc(P.ds.id)})`:'Open pole'}</button></div>`;
}
function initMap(){
  if (!window.L){ $('#map').innerHTML = '<p class="muted" style="padding:16px">The map library could not be loaded.</p>'; return; }
  const all = mapAll(), geo = mapList().filter(hasGeo);
  MAP = L.map('map', {preferCanvas:true});
  const base = MAPBASE==='sat'
    ? L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom:20, maxNativeZoom:19, attribution:'Imagery &copy; Esri'})
    : L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:20, maxNativeZoom:19, attribution:'&copy; OpenStreetMap contributors'});
  base.addTo(MAP);
  const seen = new Map(), ring = MAPBASE==='sat' ? '#fff' : cssVar('--surface');
  MARKERS = new Map();
  // other circuits first so the selected circuit draws on top
  [...geo].sort((a,b)=>(a.ds===DS)-(b.ds===DS)).forEach(P=>{ const {k,c} = mapColour(P); seen.set(k, c); const mine = P.ds===DS;
    const m = L.circleMarker([P.lat,P.lon], {radius: mine?7:5, weight: mine?2:1, color: ring, fillColor: cssVar(BKV[c]), fillOpacity: mine||!all ? 1 : 0.55}).addTo(MAP);
    m.bindTooltip(`${all?`${P.ds.id} · `:''}${P.id} · ${MAPLBL(k)}`);
    m.bindPopup(()=>popupHtml(P));
    MARKERS.set(`${P.ds.id}|${P.id}${P.dup&&!P.dup.same?`@${P.row}`:''}`, {m, P});
  });
  if (all) SETS.forEach(s=>{ const g = s.poles.filter(hasGeo); if (!g.length) return;
    const med = a => { const x=[...a].sort((p,q)=>p-q); return x[Math.floor(x.length/2)]; };
    L.tooltip({permanent:true, direction:'center', className:`circlbl ${s===DS?'cur':''}`, interactive:false}).setLatLng([med(g.map(P=>P.lat)), med(g.map(P=>P.lon))]).setContent(`Circuit ${esc(s.id)}`).addTo(MAP); });
  $('#mapLegend').innerHTML = [...seen.entries()].sort((a,b)=>natural(a[0],b[0])).map(([k,c])=>`<span><i class="sw ${c}" style="border-radius:50%;width:10px;height:10px"></i>${esc(MAPLBL(k))} (${geo.filter(P=>mapColour(P).k===k).length})</span>`).join('');
  // keep the view when only the colors or base layer change
  const key = all ? 'all' : `c:${DS.id}:${JSON.stringify(FIL)}`;
  if (MAPVIEW && MAPVIEW.key===key) MAP.setView(MAPVIEW.c, MAPVIEW.z);
  else if (geo.length) MAP.fitBounds(L.latLngBounds(geo.map(P=>[P.lat,P.lon])).pad(0.05)); else MAP.setView([29.95,-95.3], 11);
  MAP.on('moveend', ()=>{ if (MAP) MAPVIEW = {key, c:MAP.getCenter(), z:MAP.getZoom()}; });
  setTimeout(()=>MAP && MAP.invalidateSize(), 50);
}
function mapFind(q){
  q = String(q||'').trim().toLowerCase(); if (!q || !MAP) return;
  const hits = [...MARKERS.values()].filter(x=>x.P.id.toLowerCase()===q).concat([...MARKERS.values()].filter(x=>x.P.id.toLowerCase().startsWith(q) && x.P.id.toLowerCase()!==q));
  const h = hits.find(x=>x.P.ds===DS) || hits[0];
  if (!h){ toast(`No pole ${q} on this map${mapAll()?'':' (try All circuits)'}`); return; }
  MAP.setView(h.m.getLatLng(), Math.max(MAP.getZoom(), 18)); h.m.openPopup();
}
function setMapFull(on){ MAPFULL = on; document.body.classList.toggle('mapfull-on', on); render(); }

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
    <div class="plist" id="plist">${list.length ? list.map(Q=>`<button class="pcard" data-pole="${Q.i}" aria-current="${Q.i===CUR}"><span class="dot ${sevDot(Q)}" title="${Q.iss.filter(x=>x.sev!=='info').length} findings"></span><b>${esc(Q.id)}${rev(Q).ok?' <span class="tick" title="Reviewed">✓</span>':''}</b>${recPill(Q.bFin, BKL[Q.bFin])}<span class="spec">${pcardSpec(Q)}</span></button>`).join('') : '<p class="muted">No poles match these filters.</p>'}</div>
    <div class="detail">${P ? poleDetail(P, list) : ''}</div></div>`;
}
const kv = (rows) => `<table class="kvt">${rows.filter(r=>r && r[1]!=null && r[1]!=='').map(([k,v,cls])=>`<tr><th>${esc(k)}</th><td class="${cls||''}">${v}</td></tr>`).join('')}</table>`;
const yn = v => v==null ? null : esc(show(v));
const pcardSpec = Q => `${editCount(Q)?'<b class="upd">Edited</b> · ':Q.ds.changed?.has(Q.key)?'<b class="upd">Updated</b> · ':''}${esc([Q.dup&&!Q.dup.same&&`Row ${Q.row}`, Q.hc, Q.sec&&`Sec ${Q.sec}`, Q.load!=null&&`${Q.load}%`].filter(Boolean).join(' · '))}`;
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
  ${fillForm(P)}
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
const overloaded = (poles=POLES) => poles.filter(P=>P.load!=null && P.load>OVER && P.bOs!=='Replace').sort((a,b)=>b.load-a.load || byPole(a,b));
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
const XLDEF = {scope:'current', summary:true, poles:true, over:true, findings:true, notes:false, recs:false, lists:false, data:false};
let XLOPT = {...XLDEF}; try { Object.assign(XLOPT, JSON.parse(localStorage.getItem('osmrev:xl')||'{}')); } catch(e){}
const XLSHEETS = [
  ['summary','Circuit summary','Counts by CNP final, Osmose rejects, over-99% poles, findings and review progress for each circuit.'],
  ['poles','Pole review','One row per pole: recommendations, load, height/class, conditions, finding counts and your review marks and notes.'],
  ['over','Over 99% load','Poles over 99% load that Osmose did not recommend replacing.'],
  ['findings','Findings','Errors and warnings from the checks.'],
  ['recs','Recommendation changes','Poles where the CNP final is lighter or heavier than the Osmose recommendation.'],
  ['lists','Osmose work lists','Resiliency Replaces, Braces and additional issue sheets, with each pole\'s CNP final.'],
  ['data','Full Osmose data','Every column of the pole data sheet, with the spreadsheet row.'],
];
function openExport(){
  const f = $('#xlForm'), all = XLOPT.scope==='all' && SETS.length>1;
  const ck = ([k,t,d]) => `<label class="opt"><input type="checkbox" name="${k}" ${XLOPT[k]?'checked':''}><span><b>${t}</b><small>${d}</small></span></label>${k==='findings'?`<label class="opt sub"><input type="checkbox" name="notes" ${XLOPT.notes?'checked':''}><span>Include notes (informational findings)</span></label>`:''}`;
  f.innerHTML = `<h2>Download review (Excel)</h2>
    ${SETS.length>1?`<fieldset><legend>Circuits</legend>
      <label class="opt"><input type="radio" name="scope" value="current" ${!all?'checked':''}><span><b>Circuit ${esc(DS.id)}</b><small>${DS.poles.length} poles, the circuit you're viewing</small></span></label>
      <label class="opt"><input type="radio" name="scope" value="all" ${all?'checked':''}><span><b>All uploaded circuits</b><small>${SETS.map(s=>esc(s.id)).join(', ')} (${SETS.reduce((n,s)=>n+s.poles.length,0)} poles), combined with a Circuit column</small></span></label></fieldset>`:''}
    <fieldset><legend>Sheets to include</legend>${XLSHEETS.map(ck).join('')}</fieldset>
    <div class="dlgbtns"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok" id="xlGo">Download</button></div>`;
  const sync = () => { const any = XLSHEETS.some(([k])=>f.elements[k].checked); $('#xlGo').disabled = !any; f.elements.notes.disabled = !f.elements.findings.checked; };
  f.onchange = sync; sync();
  $('#xlDlg').showModal();
}
// run on submit (not the dialog's close event, which some browsers delay while the window is in the background)
$('#xlForm').addEventListener('submit', e=>{
  if (e.submitter?.value!=='ok') return;
  const f = $('#xlForm'); XLSHEETS.forEach(([k])=>XLOPT[k] = f.elements[k].checked); XLOPT.notes = f.elements.notes.checked;
  if (f.elements.scope) XLOPT.scope = [...f.querySelectorAll('[name=scope]')].find(r=>r.checked)?.value || 'current';
  try{ localStorage.setItem('osmrev:xl', JSON.stringify(XLOPT)); }catch(e){}
  exportExcel(XLOPT);
});
function exportExcel(o){
  const sets = o.scope==='all' && SETS.length>1 ? SETS : [DS], poles = sets.flatMap(s=>s.poles);
  const wb = XLSX.utils.book_new(), used = new Set();
  const add = (rows, name) => {
    if (!rows.length) rows = [{'': 'Nothing to list'}];
    const ws = XLSX.utils.json_to_sheet(rows, {cellDates:true});
    ws['!cols'] = Object.keys(rows[0]).map(k=>({wch: /notes|conditions|remarks|finding|detail|description/i.test(k) ? 44 : Math.max(9, Math.min(28, k.length+2))}));
    ws['!autofilter'] = {ref: ws['!ref']};
    let n = name.replace(/[\\\/?*\[\]:]/g,'').slice(0,31), b = n, j = 2; while (used.has(n.toLowerCase())) n = `${b.slice(0,27)} (${j++})`; used.add(n.toLowerCase());
    XLSX.utils.book_append_sheet(wb, ws, n);
  };
  const base = P => ({ 'Circuit': P.ds.id, 'Pole': P.id, 'Sheet row': P.row, 'Section': P.sec });
  const lbl = {bad:'Error', warn:'Warning', info:'Note'};
  if (o.summary) add(sets.map(s=>{ const t = setStats(s); return { 'Circuit': s.id, 'File': s.file, 'Poles': t.n, 'With Osmose data': t.osm, 'Osmose rejects': t.rej, 'CNP final: Replace': t.Replace, 'CNP final: Brace': t.Brace, 'CNP final: Pole OK': t.OK, 'CNP final: Run SA': t['Run SA'], 'CNP final: other / not set': t.other, 'Over 99% load w/o Osmose replace': t.over, 'Errors': t.bad, 'Warnings': t.warn, 'Reviewed': t.done }; }), 'Summary');
  if (o.poles) add(poles.map(P=>({ ...base(P), 'Osmose status': P.status, 'Load calc status': P.loadStatus, '% load': P.load, 'Remaining strength': P.rs,
    'H/C (Osmose field)': P.hcField, 'H/C (designer)': P.hcDesigner, 'Year made': P.year, 'Age': P.age, 'Treatment': P.treat, 'Latitude': P.lat, 'Longitude': P.lon,
    'Osmose rec': P.recOs, 'Recommended truss': P.recRec, 'Truss size': P.truss, 'Designer rec': P.designer, 'CNP initial': P.cnpInit, 'CNP initial type': P.cnpInitType, 'CNP final': P.final,
    'Conditions': P.flags.map(f=>f.l).join('; '), 'Remarks': P.remarks.join('; '), 'Errors': P.iss.filter(x=>x.sev==='bad').length, 'Warnings': P.iss.filter(x=>x.sev==='warn').length,
    'Notes': P.notes, 'CNP notes': P.cnpNotes, 'Reviewed': rev(P).ok ? 'Yes' : '', 'Review note': rev(P).note || '' })), 'Pole review');
  if (o.over) add(sets.flatMap(s=>overloaded(s.poles)).map(P=>({ ...base(P), '% load': P.load, 'Osmose status': P.status, 'Load calc status': P.loadStatus, 'Remaining strength': P.rs,
    'H/C (Osmose field)': P.hcField, 'H/C (designer)': P.hcDesigner, 'Year made': P.year, 'Osmose rec': P.recOs, 'Recommended truss': P.recRec, 'Truss size': P.truss,
    'Designer rec': P.designer, 'CNP initial': P.cnpInit, 'CNP final': P.final, 'Conditions': P.flags.map(f=>f.l).join('; '), 'Notes': P.notes, 'CNP notes': P.cnpNotes,
    'Reviewed': rev(P).ok ? 'Yes' : '', 'Review note': rev(P).note || '', 'Latitude': P.lat, 'Longitude': P.lon })), 'Over 99% load');
  if (o.findings){ const ord = {bad:0, warn:1, info:2};
    add(sets.flatMap(s=>s.iss).filter(x=>o.notes || x.sev!=='info').sort((a,b)=>natural(a.ds.id,b.ds.id) || ord[a.sev]-ord[b.sev] || natural(a.cat,b.cat) || natural(a.P?.id,b.P?.id))
      .map(x=>({ 'Circuit': x.ds.id, 'Severity': lbl[x.sev], 'Category': x.cat, 'Pole': x.P?.id ?? '', 'Sheet row': x.P?.row ?? '', 'Section': x.P?.sec ?? '', 'Finding': x.title, 'Detail': x.detail, 'CNP final': x.P?.final ?? '' })), 'Findings'); }
  if (o.recs) add(poles.filter(P=>P.bOs in RANK && P.bFin in RANK && P.bOs!==P.bFin).map(P=>({ ...base(P), 'Osmose status': P.status, '% load': P.load,
    'Osmose rec': P.recOs, 'Recommended truss': P.recRec, 'Designer rec': P.designer, 'CNP final': P.final, 'Change': RANK[P.bFin]<RANK[P.bOs] ? 'Lighter than Osmose' : 'Heavier than Osmose', 'Notes': P.notes, 'CNP notes': P.cnpNotes })), 'Rec changes');
  if (o.lists){ const by = new Map();
    sets.forEach(s=>s.wl.forEach(w=>{ if (!by.has(w.name)) by.set(w.name, []);
      w.rows.forEach(r=>{ const row = {'Circuit': s.id}; w.head.forEach((h,i)=>{ if (h) row[h] = r.cells[i] ?? ''; }); row['CNP final'] = r.P ? (r.P.final || '') : 'Not in pole data'; by.get(w.name).push(row); }); }));
    by.forEach((rows, n)=>add(rows, n)); }
  if (o.data){ const cols = []; sets.forEach(s=>s.head.forEach(h=>{ if (h && !cols.includes(h)) cols.push(h); }));
    add(sets.flatMap(s=>s.poles.map(P=>{ const r = {'Circuit': s.id, 'Sheet row': P.row}; cols.forEach(h=>{ const i = s.head.indexOf(h); r[h] = i>=0 && P.a[i]!=null ? P.a[i] : ''; }); return r; })), 'Osmose data'); }
  if (!wb.SheetNames.length){ toast('Pick at least one sheet'); return; }
  const nm = sets.length===1 ? sets[0].id : sets.length<=3 ? sets.map(s=>s.id).join('_') : `${sets.length}_circuits`;
  XLSX.writeFile(wb, `${nm.replace(/[^\w-]+/g,'_')}_Osmose_Pole_Review.xlsx`);
  toast(`Downloaded ${wb.SheetNames.length} sheet${wb.SheetNames.length===1?'':'s'}`);
}

/* ---------- copy ---------- */
function copyTable(tbl){ if (!tbl) return; const t = [...tbl.rows].map(r=>[...r.cells].map(c=>c.innerText.replace(/[▲▼]/g,'').replace(/\s+/g,' ').trim()).join('\t')).join('\n'); navigator.clipboard.writeText(t).then(()=>toast('Table copied'), ()=>toast('Copy failed')); }

/* ---------- loading: several workbooks, one per circuit ---------- */
const isSheet = f => /\.(xlsx|xlsm|xls|csv)$/i.test(f.name);
async function loadFiles(files, select){
  files = files.filter(isSheet); if (!files.length) return;
  const first = !SETS.length, prev = DS, ul = $('#fileList'); if (first) ul.innerHTML = '';
  let last = null;
  for (const f of files){
    const li = document.createElement('li'); li.innerHTML = `<span>${esc(f.name)}</span><span class="st">Reading…</span>`; if (first) ul.appendChild(li);
    const st = (cls, t) => { const x = li.querySelector('span:last-child'); x.className = cls; x.textContent = t; };
    try {
      if (!window.XLSX) throw new Error('The Excel reader could not be loaded. Check your internet connection.');
      const bytes = f.saved || await f.arrayBuffer();   // not f.bytes: File has a built-in bytes() method
      const ds = readWorkbook(bytes, f.name);
      if (!ds.poles.length) throw new Error('No pole rows were found.');
      const old = SETS.findIndex(s=>s.id===ds.id);
      if (old>=0) SETS[old] = ds; else SETS.push(ds);
      SETS.sort((a,b)=>natural(a.id,b.id));
      if (f.recId!==ds.id){ if (f.recId) dbDel(f.recId); dbPut({id:ds.id, name:f.name, bytes, at:Date.now()}); }
      st('g', `Circuit ${ds.id} · ${ds.poles.length} poles${old>=0?' (replaced the earlier upload)':''}`);
      if (!first && !f.recId) toast(`Circuit ${ds.id} ${old>=0?'replaced':'added'}: ${ds.poles.length} poles`);
      last = last || ds;   // open the first workbook that loaded
    } catch(e){ console.error(e); st('e', e.message || 'Could not read this file'); if (!first) toast(`${f.name}: ${e.message || 'could not read this file'}`); }
  }
  if (!last){ if (prev) useSet(prev); return; }
  start(SETS.find(s=>s.id===select) || last, !first);
}
function start(ds, keepTab){
  useSet(ds); if (!keepTab) TAB = 'overview';
  CUR = null; FIL = NOFIL(); IFIL = {sev:'', cat:''}; MAPVIEW = null;
  try{ localStorage.setItem('osmrev:cur', ds.id); }catch(e){}
  $('#empty').hidden = true; $('#app').hidden = false; $('#clearAll').hidden = false; $('#openOther').hidden = false;
  renderHead(); renderKpis(); render();
}
function switchSet(id){ const s = SETS.find(x=>x.id===id); if (s && s!==DS) start(s, true); }
async function clearAll(){ await dbClear(); unlinkFolder(true); SETS=[]; DS=null; POLES=[]; WL=[]; ISS=[]; if (MAPFULL) setMapFull(false); $('#app').hidden=true; $('#empty').hidden=false; $('#clearAll').hidden=true; $('#openOther').hidden=true; $('#restore').hidden=true; $('#fileList').innerHTML=''; }
$('#pick').onclick = () => $('#file').click();
$('#openOther').onclick = () => $('#file').click();
$('#file').onchange = e => { const fs = [...e.target.files]; e.target.value=''; loadFiles(fs); };
$('#clearAll').onclick = () => { if (confirm(SETS.length>1 ? `Remove all ${SETS.length} circuits from this browser?` : 'Remove this circuit from this browser?')) clearAll(); };
$('#circSel').onchange = e => switchSet(e.target.value);
$('#rmCirc').onclick = () => { if (!DS || !confirm(`Remove circuit ${DS.id} from this browser? Your review marks stay saved.`)) return;
  const id = DS.id; dbDel(id); if (DS.src){ const ig = fdIgnore(); ig.add(DS.src.path); fdIgnoreSave(ig); }
  SETS = SETS.filter(s=>s.id!==id); if (!SETS.length){ clearAll(); return; } start(SETS[0], true); toast(`Circuit ${id} removed`); };
$('#restore').onclick = async () => { const recs = await dbAll(); let cur = null; try{ cur = localStorage.getItem('osmrev:cur'); }catch(e){}
  loadFiles(recs.map(r=>({name:r.name, saved:r.bytes, recId:r.id})), cur); };
dbAll().then(recs=>{ if (!recs.length) return; $('#restore').hidden=false;
  $('#restore').textContent = recs.length===1 ? `Reopen ${recs[0].name.length>40?recs[0].name.slice(0,38)+'…':recs[0].name}` : `Reopen ${recs.length} saved circuits`; });
/* ---------- linked folder (OneDrive-synced SharePoint library), checked on a timer ----------
   Uses the browser's File System Access API (Chrome / Edge). The folder handle is kept in IndexedDB; the browser
   may ask again for permission when the app is reopened. Each check compares every workbook's modified time and
   size, and only re-reads the ones that changed. */
let FOLDER = null, FDTIMER = null, LASTKEY = 0;
const POLLS = [[30,'30 seconds'],[60,'1 minute'],[120,'2 minutes'],[300,'5 minutes'],[900,'15 minutes'],[0,'Off (check by hand)']];
let POLL = 60; try { const x = localStorage.getItem('osmrev:poll'); if (x!=null) POLL = +x; } catch(e){}
const fdIgnore = () => { try { return new Set(JSON.parse(localStorage.getItem('osmrev:fdignore')||'[]')); } catch(e){ return new Set(); } };
const fdIgnoreSave = set => { try{ localStorage.setItem('osmrev:fdignore', JSON.stringify([...set])); }catch(e){} };
const hhmm = d => d ? d.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}) : '';
const canFolder = () => 'showDirectoryPicker' in window;
async function permState(h, ask, mode='read'){ try { if (!h.queryPermission) return 'granted'; let p = await h.queryPermission({mode}); if (p!=='granted' && ask) p = await h.requestPermission({mode}); return p; } catch(e){ return 'denied'; } }
async function scanDir(dir, prefix='', depth=0, out=[]){
  for await (const [name, h] of dir.entries()){
    if (h.kind==='directory'){ if (depth<3 && !name.startsWith('.') && !/^(_?archive|old|superseded|backup)/i.test(name)) await scanDir(h, `${prefix}${name}/`, depth+1, out); }
    else if (/\.(xlsx|xlsm|xls)$/i.test(name) && !name.startsWith('~$')) out.push({path:`${prefix}${name}`, name, h});
  }
  return out;
}
async function linkFolder(){
  if (!canFolder()){ toast('Linking a folder needs Chrome or Edge'); return; }
  let h; try { h = await window.showDirectoryPicker({id:'osmose-sheets', mode:'read'}); } catch(e){ return; }
  if (FOLDER && FOLDER.name!==h.name) fdIgnoreSave(new Set());
  await hPut(h); await connectFolder(h);
}
async function connectFolder(h){
  stopPolling(); FOLDER = {handle:h, name:h.name, files:new Map(), last:null, busy:false, need:false, errs:[]};
  renderFolder(); await checkFolder(true); startPolling();
}
function unlinkFolder(silent){
  stopPolling(); if (!FOLDER) return; const name = FOLDER.name; FOLDER = null; hPut(null); fdIgnoreSave(new Set());
  SETS.forEach(s=>{ delete s.src; }); renderFolder(); if (!silent) toast(`Unlinked ${name}. Its circuits stay open until you reload.`);
}
function startPolling(){ stopPolling(); if (POLL>0) FDTIMER = setInterval(()=>checkFolder(false), POLL*1000); }
function stopPolling(){ if (FDTIMER) clearInterval(FDTIMER); FDTIMER = null; }
// don't redraw the page while someone is typing or has the download dialog open
const uiBusy = () => $('#xlDlg').open || $('#edDlg').open || !!document.querySelector('.ec.editing') || (/^(input|textarea|select)$/i.test(document.activeElement?.tagName||'') && Date.now()-LASTKEY < 15000);
async function checkFolder(initial, manual){
  if (!FOLDER || FOLDER.busy) return;
  if (!initial && !manual && uiBusy()){ setTimeout(()=>checkFolder(false), 5000); return; }
  FOLDER.busy = true; renderFolder();
  try {
    if (await permState(FOLDER.handle, manual) !== 'granted'){ FOLDER.need = true; return; }
    FOLDER.need = false;
    const found = await scanDir(FOLDER.handle), ig = fdIgnore(), seen = new Set(), changed = [];
    FOLDER.errs = [];
    for (const f of found){ seen.add(f.path); if (ig.has(f.path)) continue;
      let file; try { file = await f.h.getFile(); } catch(e){ FOLDER.errs.push(`${f.path}: can't be read right now (open in Excel or still syncing?)`); continue; }
      const prev = FOLDER.files.get(f.path);
      if (!prev || prev.lm!==file.lastModified || prev.size!==file.size) changed.push({path:f.path, file}); }
    const removed = [...FOLDER.files.keys()].filter(k=>!seen.has(k) || ig.has(k));
    FOLDER.found = found.length;
    if (changed.length || removed.length) await applyFolder(changed, removed, initial);
    else if (manual) toast('No changes in the folder');
    FOLDER.last = new Date();
  } catch(e){ console.error(e); FOLDER.errs.push(e.message || 'Could not read the folder'); }
  finally { if (FOLDER){ FOLDER.busy = false; renderFolder(); } }
}
// compare values, not formatting: a date and the same day stored as a plain Excel number count as equal
const sigVal = v => v instanceof Date ? String(Math.round(((v.getTime() - v.getTimezoneOffset()*6e4)/864e5 + 25569)*1e3)/1e3) : typeof v==='number' ? String(Math.round(v*1e3)/1e3) : String(v ?? '');
const poleSig = P => JSON.stringify(P.a.map(sigVal));
async function applyFolder(changed, removed, initial){
  // read every changed file first; parsing below is synchronous so the page never sees half-swapped data
  changed.sort((a,b)=>a.file.lastModified-b.file.lastModified);   // newest wins when two files hold the same circuit
  const got = [];
  for (const c of changed){ try { got.push({...c, bytes: await c.file.arrayBuffer()}); } catch(e){ FOLDER.errs.push(`${c.path}: can't be read right now`); } }
  const curId = DS?.id, curKey = DS && CUR!=null ? POLES[CUR]?.key : null, msgs = [];
  for (const g of got){
    const prevEntry = FOLDER.files.get(g.path);
    try {
      // a workbook inside a circuit folder (e.g. "Osmose Data/AN11/...") falls back to that folder's name
      const ds = readWorkbook(g.bytes, g.file.name, g.path.includes('/') ? g.path.split('/').slice(-2)[0] : '');
      if (!ds.poles.length){ const e = new Error('no pole rows found'); e.notOsmose = true; throw e; }
      const owner = [...FOLDER.files.entries()].find(([k,x])=>k!==g.path && x.id===ds.id && x.lm>g.file.lastModified);
      FOLDER.files.set(g.path, {lm:g.file.lastModified, size:g.file.size, id:ds.id, name:g.file.name, shadow:!!owner});
      if (owner) continue;   // an older copy of a circuit another (newer) file already provides
      ds.src = {path:g.path, lm:g.file.lastModified}; ds.updatedAt = initial ? null : new Date();
      const old = SETS.findIndex(x=>x.id===ds.id);
      if (old>=0 && !initial){ const before = new Map(SETS[old].poles.map(P=>[P.key, poleSig(P)]));
        const ch = new Set(ds.poles.filter(P=>before.has(P.key) && before.get(P.key)!==poleSig(P)).map(P=>P.key)), add = ds.poles.filter(P=>!before.has(P.key)).length;
        const gone = [...before.keys()].filter(k=>!ds.poles.some(P=>P.key===k)).length;
        ds.changed = new Set([...ch, ...ds.poles.filter(P=>!before.has(P.key)).map(P=>P.key)]);
        msgs.push(ch.size||add||gone ? `${ds.id}: ${[ch.size&&`${ch.size} pole${ch.size===1?'':'s'} changed`, add&&`${add} added`, gone&&`${gone} removed`].filter(Boolean).join(', ')}` : `${ds.id}: re-read, no pole changes`);
      } else if (!initial) msgs.push(`${ds.id}: added from the folder`);
      if (old>=0) SETS[old] = ds; else SETS.push(ds);
    } catch(e){ console.error(e);
      // keep the old data and try again next check (a file can be mid-sync or open in Excel)
      // other Excel files kept beside the Osmose sheets: skip quietly until they change
      if (e.notOsmose){ FOLDER.files.set(g.path, {lm:g.file.lastModified, size:g.file.size, name:g.file.name, skip:true}); continue; }
      FOLDER.files.set(g.path, {lm:null, size:-1, id:prevEntry?.id, name:g.file.name, err:e.message});
      FOLDER.errs.push(`${g.path}: ${e.message || 'could not read'} (will retry)`); }
  }
  for (const k of removed){ const e = FOLDER.files.get(k); FOLDER.files.delete(k);
    if (e?.id && ![...FOLDER.files.values()].some(x=>x.id===e.id && !x.err)){ const i = SETS.findIndex(x=>x.id===e.id && x.src?.path===k); if (i>=0){ SETS.splice(i,1); msgs.push(`${e.id}: file removed from the folder`); } } }
  SETS.sort((a,b)=>natural(a.id,b.id));
  if (!SETS.length){ if (DS) useSet(DS); return; }
  if ($('#app').hidden){ let pick = null; try{ pick = localStorage.getItem('osmrev:cur'); }catch(e){} start(SETS.find(x=>x.id===pick) || SETS[0]); return; }
  refreshInPlace(curId, curKey);
  if (msgs.length) toast(`Updated from ${FOLDER.name}: ${msgs.join(' · ')}`, 6000);
}
function renderFolder(){
  const chip = $('#folderChip'), F = FOLDER;
  $('#linkFolder').hidden = !canFolder(); $('#linkFolder2').hidden = !canFolder() || !!F;
  if (!F){ chip.hidden = true; return; }
  chip.hidden = false; chip.classList.toggle('warn', F.need || F.errs.length>0);
  chip.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>${esc(F.name)} · ${F.need ? 'click to reconnect' : F.busy ? 'checking…' : F.errs.length ? `${F.errs.length} file${F.errs.length===1?'':'s'} not read` : F.last ? `checked ${hhmm(F.last)}` : 'linked'}`;
  if ($('#fdDlg').open) fdDialog();
}
function fdDialog(){
  const F = FOLDER, ig = fdIgnore(); if (!F) return;
  const rows = [...F.files.entries()].sort((a,b)=>natural(a[0],b[0])).map(([k,x])=>`<tr><td>${esc(k)}</td><td>${x.err?'<span class="pill bad">Not read</span>':x.skip?'<span class="pill none">Not an Osmose sheet (skipped)</span>':x.shadow?`<span class="pill none">Older copy of ${esc(x.id)}</span>`:`<b>${esc(x.id||'')}</b>`}</td><td>${x.lm?`${fmtDate(new Date(x.lm))} ${hhmm(new Date(x.lm))}`:''}</td></tr>`).join('');
  $('#fdBody').innerHTML = `<h2>Linked folder</h2>
    <p class="muted" style="margin:0 0 10px">${esc(F.name)} is checked for changed workbooks (including subfolders). Changed circuits reload in place. Keep the folder synced by OneDrive so it matches SharePoint.</p>
    ${F.need?`<div class="iss warn" style="margin-bottom:10px"><b>The browser needs your permission to read this folder again.</b><div class="w">Click Check now to allow it.</div></div>`:''}
    <div class="filters"><label class="sm">Check for changes every <select class="fin" data-fdpoll="1">${POLLS.map(([v,l])=>`<option value="${v}" ${POLL===v?'selected':''}>${l}</option>`).join('')}</select></label>
      <button class="btn sm primary" data-fd="check">Check now</button><span class="muted sm">${F.last?`Last checked ${hhmm(F.last)}`:''}</span></div>
    ${F.errs.length?`<div class="issues" style="margin-bottom:10px">${F.errs.map(e=>`<div class="iss warn" style="font-size:13px">${esc(e)}</div>`).join('')}</div>`:''}
    <div class="tscroll" style="max-height:40vh"><table><thead><tr><th>File</th><th>Circuit</th><th>Modified</th></tr></thead><tbody>${rows || `<tr><td colspan="3" class="muted">${F.found===0?'No Excel workbooks found in this folder.':'Nothing read yet.'}</td></tr>`}</tbody></table></div>
    ${ig.size?`<p class="sm" style="margin:10px 0 4px"><b>Hidden files</b> (removed with Remove circuit)</p>${[...ig].map(k=>`<div class="sm">${esc(k)} <button class="link" data-fdunhide="${esc(k)}">Show again</button></div>`).join('')}`:''}
    <div class="dlgbtns" style="margin-top:14px"><button class="btn" data-fd="relink">Link a different folder</button><button class="btn" data-fd="unlink">Unlink</button><span class="spacer"></span><button class="btn primary" data-fd="close">Close</button></div>`;
}
$('#folderChip').onclick = () => { if (FOLDER?.need){ checkFolder(false, true); return; } fdDialog(); $('#fdDlg').showModal(); };
$('#linkFolder').onclick = () => linkFolder();
$('#linkFolder2').onclick = () => linkFolder();
$('#reconnect').onclick = async () => { const h = await hGet(); if (!h) return; if (await permState(h, true)==='granted'){ $('#reconnect').hidden = true; connectFolder(h); } else toast('Permission to read the folder was not given'); };
document.addEventListener('visibilitychange', ()=>{ if (document.visibilityState==='visible' && FOLDER && POLL>0 && (!FOLDER.last || Date.now()-FOLDER.last > 15000)) checkFolder(false); });
// on open: reconnect the saved folder if the browser still allows it, otherwise offer a one-click reconnect
hGet().then(async h=>{ renderFolder(); if (!h) return;
  if (await permState(h, false)==='granted') connectFolder(h);
  else { $('#reconnect').hidden = false; $('#reconnect').textContent = `Reconnect folder ${h.name}`; } });
if (location.hostname==='localhost') window.__osmTest = { connectFolder, checkFolder, folder: () => FOLDER };   // local testing only
const drop = $('#drop');
['dragenter','dragover'].forEach(ev=>document.addEventListener(ev,e=>{ e.preventDefault(); drop.classList.add('over'); }));
['dragleave','drop'].forEach(ev=>document.addEventListener(ev,e=>{ e.preventDefault(); drop.classList.remove('over'); }));
document.addEventListener('drop', e=>{ const fs = [...(e.dataTransfer?.files||[])].filter(isSheet); if (fs.length) loadFiles(fs); else if (e.dataTransfer?.files?.length) toast('Drop an Excel workbook (.xlsx)'); });
$('#xlsxBtn').onclick = () => openExport();
$('#themeBtn').onclick = () => { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'); const n = cur==='dark'?'light':'dark'; document.documentElement.dataset.theme = n; try{ localStorage.setItem('osmrev:theme', n); }catch(e){} if (TAB==='map' && POLES.length) render(); };
try{ const t = localStorage.getItem('osmrev:theme'); if (t) document.documentElement.dataset.theme = t; }catch(e){}

/* ---------- events ---------- */
// change the selected pole without rebuilding the list, so the sidebar keeps its scroll position
function rerenderDetail(){ const det = document.querySelector('.detail'); if (TAB!=='poles' || !det || CUR==null) return; det.innerHTML = poleDetail(POLES[CUR], filtered().sort(byPole));
  const card = document.querySelector(`.pcard[data-pole="${CUR}"]`); if (card){ const Q = POLES[CUR]; card.querySelector('.spec').outerHTML = `<span class="spec">${pcardSpec(Q)}</span>`; } }
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
function openPole(i){ CUR = +i; if (!filtered().some(P=>P.i===CUR)) FIL = NOFIL(); TAB = 'poles'; render(); revealCard(document.querySelector('.pcard[aria-current="true"]')); window.scrollTo({top: $('#kpis').offsetTop-70}); }
document.addEventListener('click', e=>{
  const t = e.target.closest('button,[data-open],[data-kf],th[data-sort],[data-copytext],td[data-kf],i[data-kf],td[data-ec]'); if (!t) return;
  if (t.dataset.ec && !t.classList.contains('editing')){ openCell(t); return; }
  if (t.dataset.fseg){ const [i,k] = t.dataset.fseg.split('|'); const P = POLES[+i], f = fieldsOf(DS)[+k]; setEdit(P, f, t.getAttribute('aria-pressed')==='true' ? '' : t.dataset.val); afterEdit(); return; }
  if (t.dataset.useosm){ const [i,k] = t.dataset.useosm.split('|'); const P = POLES[+i], f = fieldsOf(DS)[+k]; setEdit(P, f, f.osm(P)); afterEdit(); return; }
  if (t.dataset.undo){ const [i,k] = t.dataset.undo.split('|'); const P = POLES[+i], f = fieldsOf(DS)[+k]; setEdit(P, f, P.orig[f.idx]); afterEdit(); return; }
  if (t.dataset.saveed){ openSave(); return; }
  if (t.dataset.discard){ if (confirm(`Discard all ${editTotal(DS)} unsaved changes for circuit ${DS.id}?`)) discardEdits(DS); return; }
  if (t.dataset.fillshow!=null){ FILLF.show = t.dataset.fillshow; render(); return; }
  if (t.dataset.bulkapply){ bulkApply(); return; }
  if (t.dataset.bulkosm){ bulkOsmose(); return; }
  if (t.dataset.fselall!=null){ const on = !fillList().every(P=>FILLSEL.has(P.key)); fillList().forEach(P=>on?FILLSEL.add(P.key):FILLSEL.delete(P.key)); render(); return; }
  if (t.dataset.tab){ TAB = t.dataset.tab; render(); return; }
  if (t.dataset.kf){ setFilter(JSON.parse(t.dataset.kf), t.dataset.kt); return; }
  if (t.dataset.open!=null && t.dataset.open!==''){ if (MAP) MAP.closePopup();
    if (t.dataset.ds && t.dataset.ds!==DS.id){ const s = SETS.find(x=>x.id===t.dataset.ds); if (s){ useSet(s); FIL = NOFIL(); IFIL = {sev:'', cat:''}; try{ localStorage.setItem('osmrev:cur', s.id); }catch(e){} renderHead(); renderKpis(); } }
    if (MAPFULL){ MAPFULL = false; document.body.classList.remove('mapfull-on'); }
    openPole(t.dataset.open); return; }
  if (t.dataset.circ){ switchSet(t.dataset.circ); return; }
  if (t.dataset.fd){ const a = t.dataset.fd; if (a==='close') $('#fdDlg').close(); else if (a==='check') checkFolder(false, true); else if (a==='unlink'){ $('#fdDlg').close(); unlinkFolder(); } else if (a==='relink'){ $('#fdDlg').close(); linkFolder(); } return; }
  if (t.dataset.fdunhide){ const ig = fdIgnore(); ig.delete(t.dataset.fdunhide); fdIgnoreSave(ig); FOLDER?.files.delete(t.dataset.fdunhide); checkFolder(false, true); return; }
  if (t.dataset.mapscope){ MAPSCOPE = t.dataset.mapscope; render(); return; }
  if (t.dataset.mapfull){ setMapFull(!MAPFULL); return; }
  if (t.dataset.mapfit){ MAPVIEW = null; render(); return; }
  if (t.dataset.pole!=null && t.dataset.pole!==''){ selectPole(+t.dataset.pole, !t.closest('#plist')); return; }
  if (t.dataset.clearf){ FIL = NOFIL(); render(); return; }
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
  if (t.dataset.mapbysel){ MAPBY = t.value; render(); return; }
  if (t.dataset.fe){ const [i,k] = t.dataset.fe.split('|'); const P = POLES[+i], f = fieldsOf(DS)[+k]; setEdit(P, f, t.value); afterEdit(); return; }
  if (t.dataset.fillq!=null){ FILLF.q = t.value; render(); return; }
  if (t.dataset.fillsec!=null){ FILLF.sec = t.value; render(); return; }
  if (t.dataset.bulkf!=null){ FILLBULK.k = t.value; FILLBULK.v = ''; render(); return; }
  if (t.dataset.bulkv!=null){ FILLBULK.v = t.value; return; }
  if (t.dataset.fsel){ t.checked ? FILLSEL.add(t.dataset.fsel) : FILLSEL.delete(t.dataset.fsel); const b = document.querySelector('[data-bulkapply]'); renderBulkCount(); return; }
  if (t.dataset.fdpoll){ POLL = +t.value; try{ localStorage.setItem('osmrev:poll', POLL); }catch(e){} startPolling(); toast(POLL ? `Checking every ${POLLS.find(x=>x[0]===POLL)[1]}` : 'Automatic checks off'); return; }
  if (t.dataset.icat){ IFIL.cat = t.value; render(); return; }
  if (t.dataset.rev!=null){ const P = POLES[+t.dataset.rev]; REV[P.key] = {...rev(P), ok: t.checked}; saveRev(); renderKpis(); const y = window.scrollY; render(); window.scrollTo(0,y); toast(t.checked ? `Pole ${P.id} marked reviewed` : `Pole ${P.id} unmarked`); return; }
  if (t.dataset.revnote!=null){ const P = POLES[+t.dataset.revnote]; REV[P.key] = {...rev(P), note: t.value.trim()}; saveRev(); toast('Note saved'); }
});
let qT; document.addEventListener('input', e=>{
  const t = e.target;
  if (t.dataset.f==='q' || t.dataset.dq){ clearTimeout(qT); qT = setTimeout(()=>{ if (t.dataset.dq) DQ = t.value; else FIL.q = t.value; const pos = t.selectionStart; render(); const n = document.querySelector(t.dataset.dq?'[data-dq]':'[data-f="q"]'); if (n){ n.focus(); try{ n.setSelectionRange(pos,pos); }catch(err){} } }, 200); }
});
document.addEventListener('keydown', e=>{
  LASTKEY = Date.now();
  if (e.key==='Enter' && e.target.dataset?.mapfind){ e.preventDefault(); mapFind(e.target.value); return; }
  if (e.key==='Escape' && MAPFULL && !$('#xlDlg').open){ setMapFull(false); return; }
  if (TAB!=='poles' || /input|select|textarea/i.test(document.activeElement?.tagName||'')) return;
  if (e.key==='ArrowDown' || e.key==='ArrowUp' || e.key==='j' || e.key==='k'){ const list = filtered().sort(byPole); const i = list.findIndex(P=>P.i===CUR); const n = list[i + ((e.key==='ArrowDown'||e.key==='j')?1:-1)]; if (n){ e.preventDefault(); selectPole(n.i, true); } }
});

/* ---------- tooltip ---------- */
const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; document.body.appendChild(tip);
document.addEventListener('mouseover', e=>{ const t = e.target.closest('[data-tip]'); if (!t){ tip.hidden = true; return; } tip.textContent = t.dataset.tip; tip.hidden = false; });
document.addEventListener('mousemove', e=>{ if (tip.hidden) return; const w = tip.offsetWidth; tip.style.left = Math.min(window.innerWidth-w-8, e.clientX+14)+'px'; tip.style.top = (e.clientY+16)+'px'; });

/* ---------- filling in the designer / CNP columns ----------
   Edits are kept in this browser (localStorage) until saved. Saving patches only the edited cells inside the .xlsx
   (plus the cached results of the CNP Initial formula cells on those rows), so formatting, drop-down lists, tables,
   formulas and SharePoint metadata in the workbook are left as they were. */
let EDITS = {}; try { EDITS = JSON.parse(localStorage.getItem('osmrev:edits')||'{}'); } catch(e){}
const saveEditsLS = () => { try{ localStorage.setItem('osmrev:edits', JSON.stringify(EDITS)); }catch(e){ toast('Could not keep edits in this browser (storage full?)'); } };
const sameVal = (a,b) => String(a??'').trim() === String(b??'').trim();
const YN = 'Tree Trimming/Conductor/Feeder';
const LISTS = {   // used when a workbook has no Lookups sheet
  'Major Equipment Type':['≥3-250kVA Bank','3ph TP','Cap Bank','IGSD','PTS','Regulator'], 'Major Scenario Type':['First Section','Double Stack','Junction Pole','Slack 3ph Across Road, Etc.','Standing Water Area'],
  'Equipment Type':['URD TP','≥3-167kVA Bank','≥3-100kVA Bank','Primary Metering Pole','4G/5G Antenna Pole'], 'Pole Composition':['Wood','FBGL','DI','Concrete','Steel'],
  'Wood Pecker Damage':['Low','Moderate','Severe'], 'Crossing Type':['Railroad','FWY X','Water/Drainage'], [YN]:['Yes','No'],
  'Design Reccommendations':['Brace','N/A','Pole OK','Replace'], 'CNP Recommendation':['Brace','N/A','Pole Ok','Remove','Replace','Run SA','See Note'] };
const comp = P => { const m = String(P.v('StructMat')||P.v('Pole Composition')||''); return /fiber|fbgl/i.test(m)?'FBGL':/wood/i.test(m)?'Wood':/steel/i.test(m)?'Steel':/concrete/i.test(m)?'Concrete':/ductile|^di$/i.test(m)?'DI':''; };
const FIELDDEFS = [
  {g:'Designer survey', h:['Major Equipment Type'], list:'Major Equipment Type'},
  {g:'Designer survey', h:['Major Equipment Stencil']},
  {g:'Designer survey', h:['Major Scenario Type'], list:'Major Scenario Type'},
  {g:'Designer survey', h:['Equipment Type'], list:'Equipment Type'},
  {g:'Designer survey', h:['Equipment Stencil']},
  {g:'Designer survey', h:['Pole Composition'], list:'Pole Composition', osm:comp},
  {g:'Designer survey', h:['Height & Class'], ph:'e.g. 55-2', osm:P=>P.hcField && !hcUnknown(P.hcField) ? P.hcField : ''},
  {g:'Designer survey', h:['Wood Pecker Damage'], list:'Wood Pecker Damage'},
  {g:'Designer survey', h:['Crossing Type'], list:'Crossing Type'},
  {g:'Designer survey', h:['OVH Issues']},
  {g:'Designer survey', h:['Tree Trimming Needed'], list:YN, short:'Tree trim'},
  {g:'Designer survey', h:['Is Primary Conductor <600 AAC'], list:YN, short:'Primary <600 AAC'},
  {g:'Designer survey', h:['Truck Access?'], list:YN, short:'Truck access'},
  {g:'Designer survey', h:['Valid Feeder Pole & Circuit'], list:YN, short:'Valid feeder'},
  {g:'Designer survey', h:['Circuit Section'], osm:P=>P.v('CIRC_SECT') ?? ''},
  {g:'Designer survey', h:['Permit Type'], suggest:true},
  {g:'Designer survey', h:['Notes'], long:true},
  {g:'Designer survey', h:['Designer Reccommendation','Designer Recommendation'], list:'Design Reccommendations', key:true, short:'Designer rec'},
  {g:'CNP review', h:['CNP Final Reccomendation','CNP Final Recommendation','CNP Final Reccomendation Type'], list:'CNP Recommendation', short:'CNP final'},
  {g:'CNP review', h:['CNP Final Reccomendation Type','CNP Final Recommendation Type'], needs:['CNP Final Reccomendation','CNP Final Recommendation'], suggest:['Fiberglass','Ductile Iron'], short:'CNP final type'},
  {g:'CNP review', h:['CNP Notes'], long:true},
];
const SUBS = [['Equipment', ['majorequipmenttype','majorequipmentstencil','majorscenariotype','equipmenttype','equipmentstencil']],
  ['Pole condition', ['polecomposition','heightandclass','woodpeckerdamage','ovhissues']],
  ['Site & access', ['treetrimmingneeded','isprimaryconductor600aac','truckaccess','validfeederpoleandcircuit','crossingtype','permittype','circuitsection']],
  ['Designer recommendation', ['designerreccommendation','designerrecommendation','notes']]];
const subOf = (h, g) => g==='CNP review' ? 'CNP review' : (SUBS.find(([,l])=>l.includes(norm(h))) || ['Other'])[0];
const niceLabel = h => h.trim().replace(/Recc?omm?endation/gi,'Recommendation').replace(/^Is /,'').replace(/\?$/,'');
// the editable columns present in a circuit's workbook
function fieldsOf(ds){
  if (!ds) return []; if (ds.fields) return ds.fields;
  const used = new Set(), out = [];
  FIELDDEFS.forEach(d=>{ if (d.needs && !d.needs.some(n=>ds.hix.has(norm(n)))) return;
    const header = d.h.find(n=>ds.hix.has(norm(n))); if (!header) return; const idx = ds.hix.get(norm(header)); if (used.has(idx)) return; used.add(idx);
    const opts = d.list ? (ds.lookups?.[norm(d.list)]?.length ? ds.lookups[norm(d.list)] : LISTS[d.list] || []) : null;
    out.push({...d, header: ds.head[idx], idx, label: niceLabel(ds.head[idx]), short: d.short || niceLabel(ds.head[idx]), opts, sub: subOf(ds.head[idx], d.g),
      seg: !!opts && opts.length<=4 && opts.every(o=>o.length<=16) }); });
  return ds.fields = out;
}
const keyField = ds => fieldsOf(ds).find(f=>f.key);
const fillDone = P => { const f = keyField(P.ds); return !f || P.a[f.idx]!=null; };
const editCount = P => Object.keys(EDITS[P.ds.id]?.[P.key] || {}).length;
const editTotal = ds => ds ? Object.values(EDITS[ds.id] || {}).reduce((n,e)=>n+Object.keys(e).length, 0) : 0;
const editPoles = ds => ds ? Object.keys(EDITS[ds.id] || {}).length : 0;
const conflictTotal = ds => ds ? Object.values(EDITS[ds.id] || {}).reduce((n,e)=>n+Object.values(e).filter(x=>x.conflict).length, 0) : 0;
function applyEdits(P, id){
  const E = EDITS[id]?.[P.key]; if (!E) return P;
  Object.entries(E).forEach(([h,e])=>{ const j = HIX.get(norm(h)); if (j==null) return; e.conflict = !sameVal(P.orig[j], e.was); P.a[j] = e.v; });
  const Q = buildPole(P.a, P.i); Q.row = P.row; Q.dup = P.dup; Q.key = P.key; Q.orig = P.orig; return Q;
}
// Sheet Rules: the workbook's CNP Initial Recommendation / Type formulas, worked out the same way Excel does
function calcInitRec(P){
  const v = P.v, eq = (a,b) => String(a??'').trim().toLowerCase()===String(b).toLowerCase(), any = (x,l) => l.some(y=>eq(x,y));
  const FW = P.recRec, HA = P.designer, GH = v('Major Equipment Type'), GJ = v('Major Scenario Type'), GM = v('Pole Composition');
  const big = ['≥3-250kVA Bank','IGSD','Regulator'], slack = ['Double Stack','Slack 3ph Across Road, Etc.'], tp = ['3ph TP','Cap Bank','PTS'], sec = ['First Section','Junction Pole','Standing Water Area'];
  let r = '';
  if (eq(FW,'Pole OK') && eq(HA,'Pole OK')) r = 'Pole OK';
  else if ((GH!=null || GJ!=null) && eq(GM,'Wood')) r = 'Replace';
  else if (any(GH,big) || any(GJ,slack)) r = eq(GM,'DI') ? 'Pole OK' : 'Replace';
  else if (any(GH,tp)) r = eq(GM,'FBGL') ? 'Pole OK' : 'Replace';
  else if (any(GJ,sec)) r = eq(GM,'FBGL') ? 'Pole OK' : 'Replace';
  let t = '';
  if (any(GH,big) && (eq(GM,'Wood') || eq(GM,'FBGL'))) t = 'Ductile Iron';
  else if (any(GH,tp) && (eq(GM,'Wood') || eq(GM,'DI'))) t = 'Fiberglass';
  else if (any(GJ,sec)) t = 'Fiberglass';
  else if (any(GJ,slack)) t = 'Ductile Iron';
  const ci = colIx('CNP Initial Reccomendation','CNP Initial Recommendation'), ti = colIx('CNP Initial Reccomendation Type','CNP Initial Recommendation Type');
  if (ci>=0) P.a[ci] = r || null; if (ti>=0) P.a[ti] = t || null;
  P.cnpInit = r; P.cnpInitType = t; P.bInit = bucket(r);
}
// rebuild a circuit's derived data after its values change
function rebuildSet(ds){
  const prev = DS; useSet(ds);
  POLES = ds.poles.map(P=>{ const Q = buildPole(P.a, P.i); Q.row = P.row; Q.dup = P.dup; Q.key = P.key; Q.orig = P.orig; Q.ds = ds; return Q; });
  if (ds.calcInit) POLES.forEach(calcInitRec);
  const byKey = new Map(); POLES.forEach(P=>{ if (!byKey.has(P.id)) byKey.set(P.id, P); });
  WL.forEach(w=>w.rows.forEach(r=>{ r.P = byKey.get(r.pole) || null; if (r.P) r.P.wl.push({w, r}); }));
  ds.poles = POLES; runChecks(); ds.iss = ISS; ISS.forEach(x=>x.ds = ds);
  useSet(prev && prev!==ds ? prev : ds);
}
function setEdit(P, f, raw){
  const ds = P.ds; let val = raw==null ? '' : String(raw).trim();
  const v = val==='' ? null : (!f.list && /^(0|[1-9]\d*)(\.\d+)?$/.test(val)) ? +val : val;   // numbers (e.g. circuit section) stay numbers
  const E = (EDITS[ds.id] ||= {}), PE = (E[P.key] ||= {}), orig = P.orig[f.idx];
  if (sameVal(v, orig)) delete PE[f.header];
  else PE[f.header] = {v, was: PE[f.header] ? PE[f.header].was : (orig ?? null), conflict: PE[f.header]?.conflict || false, at: Date.now()};
  if (!Object.keys(PE).length) delete E[P.key]; if (!Object.keys(E).length) delete EDITS[ds.id];
  saveEditsLS(); P.a[f.idx] = v; rebuildSet(ds);
}
function discardEdits(ds){
  Object.entries(EDITS[ds.id] || {}).forEach(([k,E])=>{ const P = ds.poles.find(x=>x.key===k); if (P) Object.keys(E).forEach(h=>{ const j = ds.hix.get(norm(h)); if (j!=null) P.a[j] = P.orig[j]; }); });
  delete EDITS[ds.id]; saveEditsLS(); rebuildSet(ds); afterEdit(true); toast('Unsaved changes discarded');
}
// after an edit: refresh what depends on it without losing the field you tabbed to
function afterEdit(full){
  const a = document.activeElement?.dataset?.fe;
  renderKpis(); renderEditBar();
  if (full || TAB!=='poles'){ const y = window.scrollY, sc = document.querySelector('.fillscroll'), st = sc && [sc.scrollTop, sc.scrollLeft]; render(); window.scrollTo(0,y); const sc2 = document.querySelector('.fillscroll'); if (sc2 && st){ sc2.scrollTop = st[0]; sc2.scrollLeft = st[1]; } return; }
  setTimeout(()=>{ rerenderDetail(); if (a) document.querySelector(`[data-fe="${a}"]`)?.focus(); const tb = document.querySelector('.tab[data-tab="fill"] .n'); if (tb) tb.textContent = `${POLES.filter(fillDone).length}/${POLES.length}`; }, 0);
}
function control(P, f, k, attr){
  const val = P.a[f.idx], sv = show(val);
  if (f.opts){ const opts = [...f.opts]; if (sv && !opts.some(o=>sameVal(o,sv))) opts.unshift(sv);
    return `<select ${attr}><option value=""${sv?'':' selected'}>—</option>${opts.map(o=>`<option ${sameVal(o,sv)?'selected':''}>${esc(o)}</option>`).join('')}</select>`; }
  const list = f.suggest ? `list="dl-${k}"` : '';
  if (f.long) return `<textarea ${attr} rows="2">${esc(sv)}</textarea>`;
  return `<input type="text" ${attr} ${list} value="${esc(sv)}" placeholder="${esc(f.ph||'')}">`;
}
function datalists(ds){
  return fieldsOf(ds).map((f,k)=>{ if (!f.suggest) return ''; const seen = new Set(Array.isArray(f.suggest) ? f.suggest : []); SETS.forEach(s=>s.poles.forEach(P=>{ const j = s.hix.get(norm(f.header)); if (j!=null && P.a[j]!=null) seen.add(show(P.a[j])); }));
    return `<datalist id="dl-${k}">${[...seen].sort(natural).map(x=>`<option value="${esc(x)}">`).join('')}</datalist>`; }).join('');
}
function segControl(P, f, k){
  const cur = show(P.a[f.idx]);
  return `<div class="fseg" role="group" aria-label="${esc(f.label)}">${f.opts.map(o=>{ const on = sameVal(o, cur), b = f.key || /recommendation/i.test(f.label) ? bucket(o) : '';
    return `<button type="button" class="${on?`on ${b?BKC[b]:''}`:''}" aria-pressed="${on}" data-fseg="${P.i}|${k}" data-val="${esc(o)}" title="${on?'Click again to clear':''}">${esc(o)}</button>`; }).join('')}
    ${cur && !f.opts.some(o=>sameVal(o,cur)) ? `<span class="pill none">${esc(cur)}</span>` : ''}</div>`;
}
function fillForm(P){
  const fs = fieldsOf(P.ds); if (!fs.length) return '';
  const E = EDITS[P.ds.id]?.[P.key] || {}, subs = [...new Set(fs.map(f=>f.sub))];
  const filled = fs.filter(f=>P.a[f.idx]!=null).length, nE = Object.keys(E).length;
  const field = (f) => { const k = fs.indexOf(f), e = E[f.header], o = f.osm && f.osm(P), was = P.orig[f.idx];
    const useO = !e && o!=null && o!=='' && !sameVal(o, P.a[f.idx]) ? `<button type="button" class="osm" data-useosm="${P.i}|${k}" title="Fill with the Osmose value">Osmose: ${esc(o)}</button>` : '';
    // button groups that won't fit one column get two, so their choices stay on one line
    const span2 = f.seg && f.opts.reduce((n,o)=>n + o.length*8.5 + 36, 0) > 250;
    return `<div class="ff ${f.long?'wide':''} ${span2?'span2':''} ${e?'pend':''} ${e?.conflict?'conf':''}">
      <div class="flrow"><label class="fl" ${f.seg?'':`for="fe-${P.i}-${k}"`}>${esc(f.label)}${f.key?' <b class="req" title="Required">*</b>':''}</label>${useO}</div>
      ${f.seg ? segControl(P, f, k) : control(P, f, k, `id="fe-${P.i}-${k}" data-fe="${P.i}|${k}"`)}
      ${e ? `<div class="fh">${e.conflict ? `<b class="badtxt">Changed in the file since you edited it: now "${esc(show(was))}".</b>` : `Unsaved · was ${was==null?'blank':`"${esc(show(was))}"`}.`} <button type="button" class="link sm" data-undo="${P.i}|${k}">Undo</button></div>` : ''}</div>`; };
  return `<details class="fill sec" ${filled<fs.length || nE ? 'open' : ''}><summary><b>Fill in</b> <span class="muted sm">${filled} of ${fs.length} filled${nE?` · <span class="upd">${nE} unsaved</span>`:''}</span></summary>
    <div class="fcards">${subs.map(g=>`<section class="fcard ${g==='CNP review'?'cnp':''}"><h4>${esc(g)}</h4><div class="fgrid">${fs.filter(f=>f.sub===g).sort((x,y)=>(x.long?1:0)-(y.long?1:0)).map(field).join('')}</div>
      ${g==='CNP review' && P.ds.calcInit ? `<div class="calcline">CNP initial recommendation from the workbook's Sheet Rules: ${P.cnpInit ? recPill(P.bInit, P.cnpInit) : '<span class="muted">none yet</span>'}${P.cnpInitType?` <span class="muted">· ${esc(P.cnpInitType)}</span>`:''}</div>` : ''}</section>`).join('')}</div>
    ${datalists(P.ds)}</details>`;
}
function renderEditBar(){
  const bar = $('#editBar'); if (!DS){ bar.hidden = true; return; }
  const n = editTotal(DS), c = conflictTotal(DS);
  bar.hidden = !n; if (!n) return;
  const toFile = DS.src && FOLDER;
  bar.innerHTML = `<span><b>${n} unsaved change${n===1?'':'s'}</b> on ${editPoles(DS)} pole${editPoles(DS)===1?'':'s'} in circuit ${esc(DS.id)}${c?` · <span class="badtxt">${c} changed in the file since you edited</span>`:''} <span class="muted">· kept in this browser until saved</span></span>
    <span class="spacer"></span><button class="btn sm primary" data-saveed="1">${toFile ? 'Save to workbook…' : 'Download updated workbook…'}</button><button class="btn sm" data-discard="1">Discard</button>`;
}

/* ---------- Fill in tab: a grid for working through many poles ---------- */
let FILLF = {show:'', q:'', sec:''}, FILLSEL = new Set(), FILLBULK = {k:'', v:''};
function fillList(){
  const fs = fieldsOf(DS), q = FILLF.q.trim().toLowerCase();
  return POLES.filter(P=>{
    if (FILLF.show==='missing' && fillDone(P)) return false;
    if (FILLF.show==='blanks' && fs.every(f=>f.long || f.g!=='Designer survey' || P.a[f.idx]!=null)) return false;
    if (FILLF.show==='edited' && !editCount(P)) return false;
    if (FILLF.sec && String(P.v('CIRC_SECT') ?? P.sec)!==FILLF.sec) return false;
    if (q && !`${P.id} ${show(P.v('CIRC_SECT'))} ${P.recOs}`.toLowerCase().includes(q)) return false;
    return true; }).sort(byPole);
}
function renderBulkCount(){ const el = $('#bulkN'); if (el) el.textContent = `${FILLSEL.size} selected`; document.querySelectorAll('[data-needsel]').forEach(b=>b.disabled = !FILLSEL.size); }
function cellHtml(P, f, k){ const e = EDITS[DS.id]?.[P.key]?.[f.header], v = P.a[f.idx];
  return `<td class="ec ${e?'pend':''} ${e?.conflict?'conf':''} ${f.long?'long':''}" data-ec="${P.i}|${k}" title="${esc(e ? `Unsaved · was ${P.orig[f.idx]==null?'blank':show(P.orig[f.idx])}` : f.label)}">${v==null?'<span class="blank">·</span>':esc(show(v))}</td>`; }
function rowHtml(P){ const fs = fieldsOf(DS);
  return `<tr data-frow="${P.i}"><td class="sel"><input type="checkbox" data-fsel="${esc(P.key)}" ${FILLSEL.has(P.key)?'checked':''} aria-label="Select pole ${esc(P.id)}"></td><th class="pid"><button class="link" data-open="${P.i}">${esc(P.id)}</button>${P.dup&&!P.dup.same?` <span class="muted sm">r${P.row}</span>`:''}</th>
    <td>${esc(show(P.v('CIRC_SECT')))}</td><td>${P.recOs?recPill(P.bOs,P.recOs):'<span class="muted">—</span>'}</td><td class="num">${P.load??''}</td><td>${esc(P.hcField)}</td>
    ${fs.map((f,k)=>cellHtml(P,f,k)).join('')}${DS.calcInit?`<td class="calc">${P.cnpInit?recPill(P.bInit,P.cnpInit):''}${P.cnpInitType?` <span class="sm muted">${esc(P.cnpInitType)}</span>`:''}</td>`:''}</tr>`; }
function vFill(){
  const fs = fieldsOf(DS), list = fillList(), done = POLES.filter(fillDone).length, kf = keyField(DS);
  FILLSEL.forEach(k=>{ if (!POLES.some(P=>P.key===k)) FILLSEL.delete(k); });
  const secs = [...new Set(POLES.map(P=>String(P.v('CIRC_SECT') ?? P.sec)).filter(x=>x && x!=='null'))].sort(natural);
  const bf = fs[+FILLBULK.k], bctl = !bf ? '' : bf.opts ? `<select class="fin" data-bulkv="1"><option value="">(blank)</option>${bf.opts.map(o=>`<option ${sameVal(o,FILLBULK.v)?'selected':''}>${esc(o)}</option>`).join('')}</select>` : `<input class="fin" data-bulkv="1" value="${esc(FILLBULK.v)}" placeholder="value" ${bf.suggest?`list="dl-${FILLBULK.k}"`:''}>`;
  return `<div class="viewbar"><h2>Fill in</h2>
    <div class="seg">${[['','All poles'],['missing',`No ${kf?esc(kf.short.toLowerCase()):'value'} (${POLES.length-done})`],['blanks','Any survey blank'],['edited',`Unsaved (${editPoles(DS)})`]].map(([k,l])=>`<button data-fillshow="${k}" aria-pressed="${FILLF.show===k}">${l}</button>`).join('')}</div>
    <select class="fin" data-fillsec="1" aria-label="Section"><option value="">All sections</option>${secs.map(x=>`<option ${FILLF.sec===x?'selected':''}>${esc(x)}</option>`).join('')}</select>
    <input type="search" class="fin" data-fillq="1" placeholder="Find pole…" value="${esc(FILLF.q)}" style="width:140px">
    <div class="hint">${kf?`${esc(kf.short)} filled on ${done} of ${POLES.length} poles. `:''}Click a cell to edit; Enter moves down, Tab moves right, Esc cancels. Changes are kept in this browser until you save them to the workbook.</div></div>
  <div class="bulk"><span id="bulkN">${FILLSEL.size} selected</span> <button class="link sm" data-fselall="1">Select / clear all shown (${list.length})</button>
    <span class="sep"></span><label class="sm">Set <select class="fin" data-bulkf="1"><option value="">field…</option>${fs.map((f,k)=>`<option value="${k}" ${FILLBULK.k===String(k)?'selected':''}>${esc(f.label)}</option>`).join('')}</select></label> ${bf?`to ${bctl}`:''}
    <button class="btn sm" data-bulkapply="1" data-needsel="1" ${!FILLSEL.size||!bf?'disabled':''}>Apply to selected</button>
    <span class="sep"></span><button class="btn sm" data-bulkosm="1" data-needsel="1" ${FILLSEL.size?'':'disabled'} title="Fills only blank cells">Fill blanks from Osmose</button><span class="sm muted">height/class, circuit section, pole composition</span></div>
  <div class="tscroll fillscroll"><table class="fillt"><thead><tr><th class="sel"></th><th class="pid">Pole</th><th>Osmose section</th><th>Osmose rec</th><th class="num">% load</th><th>Osmose H/C</th>${fs.map(f=>`<th class="${f.g==='CNP review'?'cnp':''}">${esc(f.short)}${f.key?' *':''}</th>`).join('')}${DS.calcInit?'<th>CNP initial (calc)</th>':''}</tr></thead>
  <tbody>${list.map(rowHtml).join('') || `<tr><td colspan="${fs.length+7}" class="muted">No poles match.</td></tr>`}</tbody></table></div>${datalists(DS)}`;
}
function openCell(td){
  const [i,k] = td.dataset.ec.split('|').map(Number), P = POLES[i], f = fieldsOf(DS)[k]; if (!P || !f) return;
  td.classList.add('editing'); const prev = td.innerHTML; td.innerHTML = control(P, f, k, `data-ce="1"`);
  const el = td.querySelector('[data-ce]'); el.focus(); if (el.select) try{ el.select(); }catch(e){}
  let closed = false;
  const finish = (save, move) => { if (closed) return; closed = true;
    if (save && !sameVal(el.value, show(P.a[f.idx]))) setEdit(P, f, el.value);
    const tr = td.closest('tr'), Q = POLES[i]; tr.outerHTML = rowHtml(Q); renderEditBar(); renderKpis();
    const tb = document.querySelector('.tab[data-tab="fill"] .n'); if (tb) tb.textContent = `${POLES.filter(fillDone).length}/${POLES.length}`;
    if (move){ const rows = [...document.querySelectorAll('.fillt tbody tr[data-frow]')], r = rows.findIndex(x=>+x.dataset.frow===i);
      const tgt = move==='down' ? rows[r+1]?.querySelector(`[data-ec="${rows[r+1].dataset.frow}|${k}"]`) : document.querySelector(`[data-ec="${i}|${k+1}"]`);
      if (tgt){ tgt.scrollIntoView({block:'nearest', inline:'nearest'}); openCell(tgt); } } };
  el.addEventListener('keydown', e=>{ if (e.key==='Enter' && !(f.long && e.shiftKey)){ e.preventDefault(); finish(true,'down'); } else if (e.key==='Tab'){ e.preventDefault(); finish(true, e.shiftKey ? null : 'right'); } else if (e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); closed = true; td.classList.remove('editing'); td.innerHTML = prev; } });
  el.addEventListener('blur', ()=>setTimeout(()=>finish(true), 0));
  if (f.opts) el.addEventListener('change', ()=>finish(true));
}
function bulkApply(){
  const f = fieldsOf(DS)[+FILLBULK.k]; if (!f) return; const ps = POLES.filter(P=>FILLSEL.has(P.key)); if (!ps.length) return;
  const v = document.querySelector('[data-bulkv]')?.value ?? FILLBULK.v;
  if (ps.length>20 && !confirm(`Set ${f.label} to "${v||'(blank)'}" on ${ps.length} poles?`)) return;
  ps.forEach(P=>setEdit(POLES.find(x=>x.key===P.key), f, v)); afterEdit(true); toast(`${f.label} set on ${ps.length} poles (unsaved)`);
}
function bulkOsmose(){
  const fs = fieldsOf(DS).filter(f=>f.osm); let n = 0;
  [...FILLSEL].forEach(key=>fs.forEach(f=>{ const P = POLES.find(x=>x.key===key); if (!P || P.a[f.idx]!=null) return; const o = f.osm(P); if (o!=null && o!==''){ setEdit(P, f, o); n++; } }));
  afterEdit(true); toast(n ? `Filled ${n} blank cell${n===1?'':'s'} from Osmose (unsaved)` : 'No blank cells to fill on the selected poles');
}

/* ---------- saving edits into the workbook ---------- */
let JSZIPP = null;
function jszip(){ if (window.JSZip) return Promise.resolve(window.JSZip); if (!JSZIPP) JSZIPP = new Promise((res,rej)=>{ const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'; s.onload = ()=>res(window.JSZip); s.onerror = ()=>{ JSZIPP = null; rej(new Error('Could not load the zip library. Check your internet connection.')); }; document.head.appendChild(s); }); return JSZIPP; }
const xmlEsc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const xmlUnesc = s => String(s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
const attrOf = (tag, name) => (new RegExp(`\\s${name.replace(':','\\:')}="([^"]*)"`).exec(tag) || [])[1];
const colNum = ref => ref.match(/^[A-Z]+/)[0].split('').reduce((n,c)=>n*26+c.charCodeAt(0)-64, 0);
function cellXml(ref, c, old){
  const s = old ? attrOf(old.match(/^<c\b[^>]*>/)[0], 's') : null, sa = s!=null ? ` s="${s}"` : '';
  if (c.formula){ const f = old && (old.match(/<f\b[^>]*\/>|<f\b[^>]*>[\s\S]*?<\/f>/) || [])[0]; if (!f) return old; return `<c r="${ref}"${sa} t="str">${f}<v>${xmlEsc(c.v ?? '')}</v></c>`; }
  if (c.v==null || c.v==='') return `<c r="${ref}"${sa}/>`;
  if (typeof c.v==='number') return `<c r="${ref}"${sa}><v>${c.v}</v></c>`;
  return `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(c.v)}</t></is></c>`;
}
function setCellInRow(body, ref, c){
  const re = new RegExp(`<c r="${ref}"(?=[\\s>/])[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`);
  const m = re.exec(body); if (m) return body.slice(0, m.index) + cellXml(ref, c, m[0]) + body.slice(m.index + m[0].length);
  if (c.formula) return body;
  const want = colNum(ref), cre = /<c r="([A-Z]+)\d+"/g; let x;
  while ((x = cre.exec(body))){ if (colNum(x[1]) > want) return body.slice(0, x.index) + cellXml(ref, c, null) + body.slice(x.index); }
  return body + cellXml(ref, c, null);
}
// change only the given cells of one sheet inside the .xlsx; everything else in the file is kept byte for byte
async function patchWorkbook(bytes, sheetName, cells){
  const JSZip = await jszip(), zip = await JSZip.loadAsync(bytes);
  const wbx = await zip.file('xl/workbook.xml').async('string');
  const tag = (wbx.match(/<sheet\b[^>]*>/g) || []).find(t=>xmlUnesc(attrOf(t,'name')||'')===sheetName);
  if (!tag) throw new Error(`Sheet "${sheetName}" was not found in the workbook`);
  const rid = attrOf(tag, 'r:id'), rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const rel = (rels.match(/<Relationship\b[^>]*>/g) || []).find(t=>attrOf(t,'Id')===rid), target = attrOf(rel||'', 'Target');
  if (!target) throw new Error('Could not find the sheet inside the workbook');
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//,'')}`;
  let xml = await zip.file(path).async('string');
  const byRow = new Map(); cells.forEach((c, ref)=>{ const r = +ref.match(/\d+$/)[0]; if (!byRow.has(r)) byRow.set(r, new Map()); byRow.get(r).set(ref, c); });
  const done = new Set();
  xml = xml.replace(/<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g, (all, attrs, tail, inner) => {
    const r = +((attrs.match(/\sr="(\d+)"/) || [])[1]); const want = byRow.get(r); if (!want) return all;
    done.add(r); let body = inner || ''; want.forEach((c, ref)=>{ body = setCellInRow(body, ref, c); });
    return `<row${attrs.replace(/\s*$/,'')}>${body}</row>`; });
  for (const [r, want] of byRow){ if (done.has(r)) continue;
    let body = ''; [...want.entries()].filter(([,c])=>!c.formula).sort((a,b)=>colNum(a[0])-colNum(b[0])).forEach(([ref,c])=>body += cellXml(ref, c, null));
    if (!body) continue; const rowXml = `<row r="${r}">${body}</row>`;
    const rre = /<row\b[^>]*\sr="(\d+)"/g; let x, at = -1; while ((x = rre.exec(xml))){ if (+x[1] > r){ at = x.index; break; } }
    xml = at>=0 ? xml.slice(0, at) + rowXml + xml.slice(at) : xml.replace('</sheetData>', rowXml + '</sheetData>'); }
  if (new DOMParser().parseFromString(xml, 'application/xml').querySelector('parsererror')) throw new Error('The edited sheet did not come out as valid XML; nothing was saved.');
  zip.file(path, xml, {createFolders:false});   // don't add folder entries Excel never writes
  if (/<calcPr\b/.test(wbx) && !/fullCalcOnLoad=/.test(wbx)) zip.file('xl/workbook.xml', wbx.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"'), {createFolders:false});   // Excel recalculates the formulas when opened
  return zip.generateAsync({type:'uint8array', compression:'DEFLATE', compressionOptions:{level:6}});
}
async function fileByPath(dir, path){ const parts = path.split('/'); let d = dir; for (const p of parts.slice(0,-1)) d = await d.getDirectoryHandle(p); return d.getFileHandle(parts[parts.length-1]); }
// cells to write for a circuit: every pending edit, plus the CNP Initial formula results on those rows
function cellsFor(ds, cur, overwrite){
  const ws = cur.Sheets[ds.sheetName], cells = new Map(), conflicts = [], written = [];
  const ci = ds.hix.get(norm('CNP Initial Reccomendation')) ?? ds.hix.get(norm('CNP Initial Recommendation')), ti = ds.hix.get(norm('CNP Initial Reccomendation Type')) ?? ds.hix.get(norm('CNP Initial Recommendation Type'));
  Object.entries(EDITS[ds.id] || {}).forEach(([key, E])=>{ const P = ds.poles.find(x=>x.key===key); if (!P) return;
    const rows = P.dup?.same ? P.dup.rows : [P.row];
    Object.entries(E).forEach(([h, e])=>{ const j = ds.hix.get(norm(h)); if (j==null) return; const col = XLSX.utils.encode_col(ds.c0 + j);
      const now = ws?.[`${col}${rows[0]}`]?.v ?? null;
      if (!sameVal(now, e.was) && !sameVal(now, e.v)){ conflicts.push({P, h, now, e}); if (!overwrite) return; }
      rows.forEach(r=>cells.set(`${col}${r}`, {v: e.v})); written.push({key, h}); });
    if (ds.calcInit) rows.forEach(r=>{ if (ci!=null) cells.set(`${XLSX.utils.encode_col(ds.c0+ci)}${r}`, {formula:true, v:P.cnpInit}); if (ti!=null) cells.set(`${XLSX.utils.encode_col(ds.c0+ti)}${r}`, {formula:true, v:P.cnpInitType}); }); });
  return {cells, conflicts, written};
}
function openSave(){
  const ds = DS, n = editTotal(ds); if (!n) return; const toFile = ds.src && FOLDER;
  const rows = []; Object.entries(EDITS[ds.id] || {}).forEach(([key,E])=>{ const P = ds.poles.find(x=>x.key===key); Object.entries(E).forEach(([h,e])=>rows.push({P, key, h, e})); });
  rows.sort((a,b)=>byPole(a.P||{}, b.P||{}));
  $('#edBody').innerHTML = `<h2>${toFile ? 'Save to workbook' : 'Download updated workbook'}</h2>
    <p class="muted" style="margin:0 0 10px">${toFile ? `Writes ${n} change${n===1?'':'s'} into <b>${esc(FOLDER.name)}/${esc(ds.src.path)}</b>. OneDrive then uploads it to SharePoint. Only the changed cells are touched; formatting, drop-downs and formulas stay as they are. Avoid saving while someone else is editing this workbook in Excel.`
      : `Makes a copy of <b>${esc(ds.file)}</b> with your ${n} change${n===1?'':'s'} for you to upload to SharePoint. Only the changed cells are touched. Link the synced folder instead to save straight into the workbook.`}</p>
    <div class="tscroll" style="max-height:44vh"><table><thead><tr><th>Pole</th><th>Field</th><th>Was</th><th>New</th></tr></thead><tbody>
    ${rows.slice(0,400).map(r=>`<tr class="${r.e.conflict?'confrow':''}"><td><b>${esc(r.P?.id ?? r.key)}</b></td><td>${esc(niceLabel(r.h))}</td><td class="muted">${r.e.was==null?'blank':esc(show(r.e.was))}${r.e.conflict&&r.P?` <span class="badtxt">· file now: ${esc(show(r.P.orig[ds.hix.get(norm(r.h))])||'blank')}</span>`:''}</td><td><b>${r.e.v==null?'blank':esc(show(r.e.v))}</b></td></tr>`).join('')}
    ${rows.length>400?`<tr><td colspan="4" class="muted">…and ${rows.length-400} more</td></tr>`:''}</tbody></table></div>
    <label class="opt"><input type="checkbox" name="overwrite"><span><b>Overwrite cells someone else changed</b><small>If a cell changed in the workbook since you edited it, it's skipped (and kept here) unless this is ticked.</small></span></label>
    <div class="dlgbtns"><button class="btn" value="cancel">Cancel</button><button class="btn primary" value="ok">${toFile ? 'Save to workbook' : 'Download'}</button></div>`;
  $('#edDlg').showModal();
}
$('#edBody').addEventListener('submit', e=>{ if (e.submitter?.value!=='ok') return; saveWorkbook(DS, $('#edBody').elements.overwrite.checked); });
async function saveWorkbook(ds, overwrite){
  const toFile = ds.src && FOLDER, curId = DS?.id, curKey = DS && CUR!=null ? POLES[CUR]?.key : null;
  try {
    let fh = null, bytes;
    if (toFile){
      if (await permState(FOLDER.handle, true, 'readwrite')!=='granted'){ toast('Permission to save into the folder was not given'); return; }
      fh = await fileByPath(FOLDER.handle, ds.src.path); bytes = await (await fh.getFile()).arrayBuffer();
    } else bytes = ds.bytes;
    toast('Saving…', 20000);
    const cur = XLSX.read(new Uint8Array(bytes), {type:'array', sheets:[ds.sheetName]});
    const {cells, conflicts, written} = cellsFor(ds, cur, overwrite);
    if (!cells.size){ toast(conflicts.length ? `Nothing saved: all ${conflicts.length} changes conflict with newer values in the file` : 'Nothing to save'); return; }
    const out = await patchWorkbook(bytes, ds.sheetName, cells);
    // check the result reads back with the new values before it replaces anything
    const chk = XLSX.read(out, {type:'array', sheets:[ds.sheetName]}).Sheets[ds.sheetName];
    for (const [ref, c] of cells){ if (!c.formula && !sameVal(chk[ref]?.v ?? null, c.v)) throw new Error(`Cell ${ref} did not save correctly; nothing was written.`); }
    if (fh){ const w = await fh.createWritable(); await w.write(out); await w.close(); }
    else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})); a.download = ds.file; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 60000); }
    // drop the saved edits (conflicts that were skipped stay pending), then reload the circuit from what was written
    written.forEach(({key, h})=>{ const E = EDITS[ds.id]?.[key]; if (E){ delete E[h]; if (!Object.keys(E).length) delete EDITS[ds.id][key]; } });
    if (EDITS[ds.id] && !Object.keys(EDITS[ds.id]).length) delete EDITS[ds.id]; saveEditsLS();
    const prev = DS, nds = readWorkbook(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength), ds.file, ds.id); if (prev) useSet(prev);
    if (toFile){ const nf = await fh.getFile(); nds.src = {path: ds.src.path, lm: nf.lastModified}; const fe = FOLDER.files.get(ds.src.path); FOLDER.files.set(ds.src.path, {...(fe||{}), lm: nf.lastModified, size: nf.size, id: nds.id, err: null}); }
    else dbPut({id: nds.id, name: ds.file, bytes: nds.bytes, at: Date.now()});
    const i = SETS.findIndex(x=>x===ds); if (i>=0) SETS[i] = nds; else SETS.push(nds);
    refreshInPlace(curId, curKey);
    const skipped = overwrite ? 0 : conflicts.length;
    toast(`${toFile ? 'Saved' : 'Downloaded'} ${written.length} change${written.length===1?'':'s'}${skipped?`; ${skipped} skipped because the file changed (still pending)`:''}`, 6000);
  } catch(e){ console.error(e); toast(/NoModification|InvalidState|NotReadable|lock/i.test(e.name+e.message) ? 'The workbook is locked (open in Excel?). Close it and try again.' : `Save failed: ${e.message}`, 8000); }
}
function refreshInPlace(curId, curKey){
  const ds = SETS.find(x=>x.id===curId) || SETS[0]; if (!ds) return;
  useSet(ds); if (ds.id!==curId){ CUR = null; FIL = NOFIL(); }
  else if (curKey){ const P = POLES.find(x=>x.key===curKey); CUR = P ? P.i : null; }
  const y = window.scrollY, sc = document.querySelector('.fillscroll'), st = sc && [sc.scrollTop, sc.scrollLeft];
  renderHead(); renderKpis(); render(); window.scrollTo(0, y);
  const sc2 = document.querySelector('.fillscroll'); if (sc2 && st){ sc2.scrollTop = st[0]; sc2.scrollLeft = st[1]; }
}
if (location.hostname==='localhost') Object.assign(window.__osmTest || (window.__osmTest = {}), { patchWorkbook, sets: () => SETS, edits: () => EDITS });

let tt; function toast(t, ms){ const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(tt); tt = setTimeout(()=>el.classList.remove('show'), ms || 2400); }
})();
