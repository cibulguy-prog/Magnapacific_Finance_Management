/* ===================== Magna Pacific · Financial Dashboard ===================== */

/* Paste the Web App URL you get from Apps Script > Deploy > New deployment here.
   Until this is filled in, the app just runs on the embedded starting data below
   (edits still work in the browser, they just won't be saved anywhere). */
const APPS_SCRIPT_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";

const BUSINESS_GROUPS = {
  "Magna Pacific": ["Mortgage/Rent","aya water both villas","Electricity","ccss","accounting","daiana","Internet","instagram","gas","workers pay","gas for car","Repairs","Other"],
  "Suppliers": ["terra eqipos","san miguel","rafa","concept","ac","Other"],
};
const PERSONAL_GROUPS = {
  "Israel": ["rent","electricity","car gasoline","food","Public transport","loans","child care","insurance","nitay school","Other"],
  "Mal Pais / Hermosa (CR residence)": ["rent","condominum payment","water","electricity","internet","Other"],
  "Children": ["Clothes","Creche fees","School / College Expenses","Gifts","Other"],
  "Other": ["Other"],
};
const PERSONAL_INCOME_CATEGORIES = ["Salary","Pension Income","State Benefits","Investment income","Other"];
const VILLAS = ["Elu","Nalani","Elu + Nalani"];
const PLATFORMS = ["airbnb","direct","vrbo","journey","isle blue","my private villas","travel pioneers","origin","booking.com"];
const CAT_COLORS = ["var(--c1)","var(--c2)","var(--c3)","var(--c4)","var(--c5)","var(--c6)","var(--c7)","var(--c8)"];
const MONTHS_EN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const NEW_CATEGORY_VALUE = "__new__";

/* legacy Hebrew group keys -> current English keys, for DBs that already
   persisted a categoryStore (and records referencing it) before translation */
const LEGACY_GROUP_RENAMES = {
  "Mal Pais / Hermosa (מגורים בקוסטה ריקה)": "Mal Pais / Hermosa (CR residence)",
  "אחר": "Other",
};
const LEGACY_NOTE_PREFIXES = [
  [/תאריך מקורי:/g, "Original date:"],
  [/מע"מ:/g, "VAT:"],
  [/עמלה:/g, "Commission:"],
];

function categoryOptionsHtml(list, selected){
  const opts = list.map(c=>`<option value="${escHtml(c)}" ${selected===c?"selected":""}>${escHtml(c)}</option>`).join("");
  return opts + `<option value="${NEW_CATEGORY_VALUE}">+ New category…</option>`;
}
function ensureCategoryStore(){
  if(!DB.categoryStore){
    DB.categoryStore = {
      businessGroups: JSON.parse(JSON.stringify(BUSINESS_GROUPS)),
      personalGroups: JSON.parse(JSON.stringify(PERSONAL_GROUPS)),
      personalIncomeCategories: PERSONAL_INCOME_CATEGORIES.slice(),
    };
  }
}

/* one-time cleanup so a DB persisted before the English translation still
   displays consistently: rename legacy Hebrew group keys and translate the
   auto-generated note prefixes that were baked into historical records */
function migrateLegacyLabels(){
  const groupMaps = [DB.categoryStore.businessGroups, DB.categoryStore.personalGroups];
  groupMaps.forEach(groups=>{
    Object.keys(LEGACY_GROUP_RENAMES).forEach(oldKey=>{
      if(Object.prototype.hasOwnProperty.call(groups, oldKey)){
        const newKey = LEGACY_GROUP_RENAMES[oldKey];
        if(!groups[newKey]) groups[newKey] = groups[oldKey];
        delete groups[oldKey];
      }
    });
  });
  [DB.incomeRecords, DB.expenseRecords].forEach(list=>{
    list.forEach(r=>{
      if(r.group && LEGACY_GROUP_RENAMES[r.group]) r.group = LEGACY_GROUP_RENAMES[r.group];
      if(r.notes){
        LEGACY_NOTE_PREFIXES.forEach(([pat,rep])=>{ r.notes = r.notes.replace(pat, rep); });
      }
    });
  });
}

let DB = null;
let filters = { sector: "all", year: "all" };
let persistTimer = null;
let incomeColFilter = { villa: "", platform: "", currency: "" };
let expenseColFilter = { group: "", category: "", currency: "" };

function resolveCssVar(v){
  if(typeof v !== "string" || !v.startsWith("var(")) return v;
  const name = v.slice(4, -1);
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#999";
}

function uid(prefix){ return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

function fmtMoney(amount, currency){
  const n = Math.round(amount || 0);
  const sym = currency === "ILS" ? "₪" : (currency === "USD" ? "$" : (currency ? currency + " " : ""));
  const neg = n < 0;
  const abs = Math.abs(n).toLocaleString("en-US");
  return (neg ? "-" : "") + sym + abs;
}
function fmtNum(n){ return Math.round(n||0).toLocaleString("en-US"); }

/* ---------------- data load / persist ---------------- */
function scriptUrlConfigured(){
  return typeof APPS_SCRIPT_URL === "string" && APPS_SCRIPT_URL && !APPS_SCRIPT_URL.startsWith("PASTE_");
}

async function loadData(){
  let seed = null;
  try{ seed = JSON.parse(document.getElementById("seed-data").textContent); }catch(e){ seed = {version:1, incomeRecords:[], expenseRecords:[]}; }
  if(scriptUrlConfigured()){
    try{
      const res = await fetch(APPS_SCRIPT_URL, {cache:"no-store"});
      if(res.ok){
        const data = await res.json();
        if(data && data.ok !== false && Array.isArray(data.incomeRecords)){
          DB = data;
          ensureCategoryStore();
          migrateLegacyLabels();
          setSaveStatus("ok", "Synced with Google Sheet");
          return;
        }
      }
    }catch(e){ /* offline or misconfigured — fall back to the embedded seed below */ }
  }
  DB = seed;
  ensureCategoryStore();
  migrateLegacyLabels();
  setSaveStatus(scriptUrlConfigured() ? "err" : "", scriptUrlConfigured() ? "Couldn't reach the Sheet — showing last-known data" : "Loaded starting data (not connected to a Sheet yet)");
}

function setSaveStatus(state, text){
  const dot = document.getElementById("saveDot");
  const t = document.getElementById("saveText");
  dot.className = "save-dot" + (state ? " " + state : "");
  t.textContent = text;
}

/* Whole-database overwrite, same model the app always used: every save sends the
   complete current dataset and the Apps Script backend rewrites the three sheet
   tabs from it. There's no per-field diffing or conflict detection — if the Sheet
   is being edited by hand or from two open tabs at once, the last save wins. */
function persist(){
  clearTimeout(persistTimer);
  if(!scriptUrlConfigured()){
    setSaveStatus("err", "Not connected to a Google Sheet — see APPS_SCRIPT_URL in app.js");
    return;
  }
  setSaveStatus("busy", "Saving…");
  persistTimer = setTimeout(async () => {
    DB.updatedAt = new Date().toISOString();
    try{
      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: {"Content-Type": "text/plain;charset=utf-8"}, // avoids a CORS preflight against Apps Script
        body: JSON.stringify(DB),
      });
      const out = await res.json().catch(()=>null);
      if(out && out.ok === false){
        setSaveStatus("err", "Save failed: " + (out.error || "unknown error"));
      } else {
        setSaveStatus("ok", "Saved");
      }
    }catch(err){
      setSaveStatus("err", "Save failed — check your connection and try again");
    }
  }, 700);
}

/* ---------------- filters / derived data ---------------- */
function allYears(){
  const ys = new Set();
  DB.incomeRecords.forEach(r => ys.add(r.date.slice(0,4)));
  DB.expenseRecords.forEach(r => ys.add(r.date.slice(0,4)));
  return Array.from(ys).sort();
}
function inFilter(r){
  if(filters.sector !== "all" && r.sector !== filters.sector) return false;
  if(filters.year !== "all" && r.date.slice(0,4) !== filters.year) return false;
  return true;
}
function filteredIncome(){ return DB.incomeRecords.filter(inFilter); }
function filteredExpense(){ return DB.expenseRecords.filter(inFilter); }

function sumByCurrency(arr, field){
  const out = {};
  arr.forEach(r => { const c = r.currency || "USD"; out[c] = (out[c]||0) + (r[field]||0); });
  return out;
}
function currenciesPresent(...arrs){
  const s = new Set();
  arrs.forEach(a => a.forEach(r => s.add(r.currency || "USD")));
  return Array.from(s).sort();
}

/* ================= KPI ================= */
function renderKPIs(){
  const inc = filteredIncome(), exp = filteredExpense();
  const bizInc = inc.filter(r=>r.sector==="business"), bizExp = exp.filter(r=>r.sector==="business");
  const perInc = inc.filter(r=>r.sector==="personal"), perExp = exp.filter(r=>r.sector==="personal");

  const showBiz = filters.sector !== "personal";
  const showPer = filters.sector !== "business";

  document.getElementById("ovBusinessKpi").innerHTML = showBiz ? renderKpiBlock("Business · Magna Pacific", "var(--biz)", bizInc, bizExp, true) : "";
  document.getElementById("ovPersonalKpi").innerHTML = showPer ? renderKpiBlock("Personal", "var(--per)", perInc, perExp, false) : "";
}

function renderKpiBlock(title, color, incArr, expArr, withNights){
  const incByC = sumByCurrency(incArr, "grossAmount");
  const expByC = sumByCurrency(expArr, "amount");
  const currencies = currenciesPresent(incArr, expArr);
  let cards = "";
  currencies.forEach(c => {
    const i = incByC[c] || 0, e = expByC[c] || 0, net = i - e;
    cards += `
      <div class="kpi-card">
        <div class="kpi-label">Income (${c})</div>
        <div class="kpi-value">${fmtMoney(i,c)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Expenses (${c})</div>
        <div class="kpi-value">${fmtMoney(e,c)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Net profit (${c})</div>
        <div class="kpi-value ${net<0?'neg':''}">${fmtMoney(net,c)}</div>
      </div>`;
  });
  if(withNights){
    const nights = incArr.reduce((s,r)=>s+(r.nights||0),0);
    cards += `
      <div class="kpi-card">
        <div class="kpi-label">Bookings · nights</div>
        <div class="kpi-value">${incArr.length}</div>
        <div class="kpi-sub">${fmtNum(nights)} nights booked</div>
      </div>`;
  }
  if(!currencies.length && !withNights) return "";
  return `<div class="kpi-heading"><span class="swatch" style="background:${color}"></span>${title}</div><div class="kpi-grid">${cards}</div>`;
}

/* ================= chart helpers (SVG) ================= */
function niceMax(v){
  if(v <= 0) return 10;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  let f;
  if(n <= 1) f = 1; else if(n<=2) f=2; else if(n<=5) f=5; else f=10;
  return f*mag;
}

function tooltip(evt, html){
  const tt = document.getElementById("chartTooltip");
  tt.innerHTML = html;
  tt.style.left = evt.clientX + "px";
  tt.style.top = evt.clientY + "px";
  tt.classList.add("show");
}
function hideTooltip(){ document.getElementById("chartTooltip").classList.remove("show"); }

/* vertical bar chart: data=[{label,value,color}] */
function vBarChart(data, opts){
  opts = opts || {};
  const w = opts.width || 420, h = opts.height || 220;
  const padL = 44, padB = 34, padT = 10, padR = 10;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const max = niceMax(Math.max(...data.map(d=>d.value), 1));
  const bw = innerW / data.length;
  const barW = Math.min(46, bw*0.55);
  let gridSvg = "";
  const steps = 4;
  for(let i=0;i<=steps;i++){
    const y = padT + innerH - (innerH*i/steps);
    const val = max*i/steps;
    gridSvg += `<line class="grid" x1="${padL}" x2="${w-padR}" y1="${y}" y2="${y}"/>`;
    gridSvg += `<text x="${padL-8}" y="${y+4}" text-anchor="end" font-size="10.5">${fmtCompact(val)}</text>`;
  }
  let bars = "";
  data.forEach((d,i)=>{
    const x = padL + bw*i + (bw-barW)/2;
    const bh = max>0 ? (d.value/max)*innerH : 0;
    const y = padT + innerH - bh;
    const color = resolveCssVar(d.color);
    bars += `<rect class="mark" data-label="${escAttr(d.label)}" data-value="${d.value}" data-currency="${d.currency||''}" x="${x}" y="${y}" width="${barW}" height="${Math.max(bh,1)}" rx="4" fill="${color}"/>`;
    bars += `<text class="cat-label" x="${x+barW/2}" y="${h-padB+16}" text-anchor="middle">${truncateLabel(d.label,10)}</text>`;
    if(data.length <= 10){
      bars += `<text class="bar-label" x="${x+barW/2}" y="${y-6}" text-anchor="middle">${fmtCompact(d.value)}</text>`;
    }
  });
  return `<svg class="chart" dir="ltr" viewBox="0 0 ${w} ${h}" width="100%" height="${h}">${gridSvg}${bars}</svg>`;
}

/* horizontal bar chart, sorted desc by caller: data=[{label,value,currency,color}] */
function hBarChart(data, opts){
  opts = opts || {};
  const w = opts.width || 480;
  const rowH = 26, gap = 8, padL = 4, padR = 60, labelW = opts.labelW || 150;
  const innerW = w - padL - padR - labelW;
  const h = data.length * (rowH+gap) + 6;
  const max = niceMax(Math.max(...data.map(d=>Math.abs(d.value)), 1));
  let rows = "";
  data.forEach((d,i)=>{
    const y = i*(rowH+gap)+4;
    const bw = max>0 ? (Math.abs(d.value)/max)*innerW : 0;
    const color = resolveCssVar(d.color || CAT_COLORS[i % CAT_COLORS.length]);
    const x0 = padL + labelW;
    rows += `<text x="${padL+labelW-8}" y="${y+rowH*0.68}" text-anchor="end" class="cat-label">${truncateLabel(d.label,20)}</text>`;
    rows += `<rect class="mark" data-label="${escAttr(d.label)}" data-value="${d.value}" data-currency="${d.currency||''}" x="${x0}" y="${y}" width="${Math.max(bw,2)}" height="${rowH}" rx="4" fill="${color}"/>`;
    rows += `<text x="${x0+bw+8}" y="${y+rowH*0.68}" class="bar-label">${fmtMoney(d.value, d.currency)}</text>`;
  });
  return `<svg class="chart" dir="ltr" viewBox="0 0 ${w} ${h}" width="100%" height="${h}">${rows}</svg>`;
}

/* multi-series line/area chart: series=[{name,color,points:[{x(label),y}]}] */
function lineChart(series, xLabels, opts){
  opts = opts || {};
  const w = opts.width || 520, h = opts.height || 220;
  const padL = 48, padB = 28, padT = 14, padR = 14;
  const innerW = w-padL-padR, innerH = h-padT-padB;
  const allVals = series.flatMap(s=>s.points.map(p=>p.y));
  const max = niceMax(Math.max(...allVals, 1));
  const n = xLabels.length;
  const stepX = n>1 ? innerW/(n-1) : innerW;
  const xAt = i => padL + stepX*i;
  const yAt = v => padT + innerH - (v/max)*innerH;

  let gridSvg = "";
  const steps = 4;
  for(let i=0;i<=steps;i++){
    const y = padT + innerH - (innerH*i/steps);
    gridSvg += `<line class="grid" x1="${padL}" x2="${w-padR}" y1="${y}" y2="${y}"/>`;
    gridSvg += `<text x="${padL-8}" y="${y+4}" text-anchor="end" font-size="10.5">${fmtCompact(max*i/steps)}</text>`;
  }
  let xLabelsSvg = "";
  xLabels.forEach((lab,i)=>{
    if(n>14 && i%2!==0) return;
    xLabelsSvg += `<text x="${xAt(i)}" y="${h-padB+16}" text-anchor="middle" class="cat-label">${lab}</text>`;
  });

  let marksSvg = "";
  series.forEach(s => {
    const color = resolveCssVar(s.color);
    const pts = s.points.map((p,i)=>`${xAt(i)},${yAt(p.y)}`).join(" ");
    if(opts.area){
      const areaPts = `${xAt(0)},${yAt(0)} ${pts} ${xAt(n-1)},${yAt(0)}`;
      marksSvg += `<polygon points="${areaPts}" fill="${color}" opacity="0.12"/>`;
    }
    marksSvg += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    s.points.forEach((p,i)=>{
      marksSvg += `<circle class="mark" data-label="${escAttr(s.name+' · '+xLabels[i])}" data-value="${p.y}" data-currency="${opts.currency||''}" cx="${xAt(i)}" cy="${yAt(p.y)}" r="8" fill="transparent"/>`;
      marksSvg += `<circle cx="${xAt(i)}" cy="${yAt(p.y)}" r="3" fill="${color}"/>`;
    });
  });
  return `<svg class="chart" dir="ltr" viewBox="0 0 ${w} ${h}" width="100%" height="${h}">${gridSvg}${marksSvg}${xLabelsSvg}</svg>`;
}

function fmtCompact(v){
  const abs = Math.abs(v);
  if(abs >= 1000000) return (v/1000000).toFixed(1).replace(/\.0$/,'') + "M";
  if(abs >= 1000) return (v/1000).toFixed(1).replace(/\.0$/,'') + "K";
  return Math.round(v).toString();
}
function truncateLabel(s, n){ s = String(s||""); return s.length>n ? s.slice(0,n-1)+"…" : s; }
function escAttr(s){ return String(s||"").replace(/"/g,"&quot;"); }

function wireChartTooltips(container){
  container.querySelectorAll(".mark").forEach(el=>{
    el.addEventListener("mousemove", (e)=>{
      const label = el.getAttribute("data-label");
      const value = parseFloat(el.getAttribute("data-value"));
      const currency = el.getAttribute("data-currency");
      tooltip(e, `<b>${label}</b><br>${fmtMoney(value, currency)}`);
    });
    el.addEventListener("mouseleave", hideTooltip);
  });
}

function legendHtml(items){ // items=[{label,color, line}]
  return `<div class="legend">${items.map(it=>`<div class="legend-item">${it.line?`<span class="legend-line" style="background:${resolveCssVar(it.color)}"></span>`:`<span class="legend-swatch" style="background:${resolveCssVar(it.color)}"></span>`}${it.label}</div>`).join("")}</div>`;
}

/* label callout for a pie slice: name + percentage, halo-stroked so it reads over any background */
function pieLabelText(x, y, anchor, name, pct){
  const haloStyle = `paint-order:stroke; stroke:var(--surface); stroke-width:3; stroke-linejoin:round;`;
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" style="${haloStyle} fill:var(--ink); font-weight:700; font-size:11.5px;">${escHtml(truncateLabel(name,15))}</text>` +
    `<text x="${x}" y="${y+13}" text-anchor="${anchor}" style="${haloStyle} fill:var(--ink-2); font-size:10px;">${pct}%</text>`;
}
/* pie chart with every slice labeled by a callout line (name + %) — no side legend.
   data=[{label,value,currency,color}], values are taken as shares of their sum.
   Labels are laid out in two vertical stacks (right half / left half of the circle) with a
   minimum gap enforced between neighbors, so adjacent slim slices never collide. */
function pieChart(data, opts){
  opts = opts || {};
  const pieD = opts.size || 260;
  const r = pieD/2 - 10;
  const padX = 150, padY = 36;
  const w = pieD + padX*2, h = pieD + padY*2;
  const cx = w/2, cy = h/2;
  const total = data.reduce((s,d)=>s+Math.abs(d.value), 0) || 1;

  let angle = -Math.PI/2;
  const slices = data.map((d,i)=>{
    const frac = Math.abs(d.value)/total;
    const theta = frac * 2*Math.PI;
    const start = angle, end = angle+theta, mid = angle+theta/2;
    angle = end;
    return { d, i, frac, pct: Math.round(frac*1000)/10, start, end, mid };
  });

  let wedges = "";
  slices.forEach(s=>{
    const color = resolveCssVar(s.d.color || CAT_COLORS[s.i % CAT_COLORS.length]);
    if(s.frac >= 0.9995){
      wedges += `<circle class="mark" data-label="${escAttr(s.d.label)}" data-value="${s.d.value}" data-currency="${s.d.currency||''}" cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`;
    } else {
      const x1 = cx + r*Math.cos(s.start), y1 = cy + r*Math.sin(s.start);
      const x2 = cx + r*Math.cos(s.end), y2 = cy + r*Math.sin(s.end);
      const largeArc = (s.end - s.start) > Math.PI ? 1 : 0;
      wedges += `<path class="mark" data-label="${escAttr(s.d.label)}" data-value="${s.d.value}" data-currency="${s.d.currency||''}" d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${color}" stroke="var(--surface)" stroke-width="2"/>`;
    }
  });

  // lay out callouts in two stacks (right half / left half), each sorted top-to-bottom with a min gap
  const minGap = 28, minY = padY + 8, maxY = h - padY + 8;
  function layoutHalf(list){
    let ys = list.map(s => cy + r*Math.sin(s.mid));
    for(let k=1;k<ys.length;k++){
      if(ys[k] - ys[k-1] < minGap) ys[k] = ys[k-1] + minGap;
    }
    if(ys.length && ys[ys.length-1] > maxY) { const shift = ys[ys.length-1]-maxY; ys = ys.map(y=>y-shift); }
    if(ys.length && ys[0] < minY) { const shift = minY-ys[0]; ys = ys.map(y=>y+shift); }
    return ys;
  }
  const rightSlices = slices.filter(s=>Math.cos(s.mid) >= 0).sort((a,b)=>a.mid-b.mid);
  const leftSlices = slices.filter(s=>Math.cos(s.mid) < 0).sort((a,b)=>Math.sin(a.mid)-Math.sin(b.mid));
  const rightY = layoutHalf(rightSlices);
  const leftY = layoutHalf(leftSlices);

  let labels = "";
  function drawSide(list, ys, dir){
    const elbowX = cx + dir*(r+16);
    const textX = cx + dir*(r+38);
    const anchor = dir > 0 ? "start" : "end";
    list.forEach((s,idx)=>{
      const finalY = ys[idx];
      const edgeX = cx + r*Math.cos(s.mid), edgeY = cy + r*Math.sin(s.mid);
      labels += `<polyline points="${edgeX},${edgeY} ${elbowX},${finalY} ${textX-dir*4},${finalY}" fill="none" stroke="var(--ink-muted)" stroke-width="1"/>`;
      labels += pieLabelText(textX, finalY+4, anchor, s.d.label, s.pct);
    });
  }
  drawSide(rightSlices, rightY, 1);
  drawSide(leftSlices, leftY, -1);

  return `<svg class="chart" dir="ltr" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" style="max-width:480px; display:block; margin:0 auto;">${wedges}${labels}</svg>`;
}
/* keep a pie chart readable: top N entries plus one aggregated slice for the rest */
function topNWithOther(entries, n, otherLabel){
  if(entries.length <= n) return entries;
  const top = entries.slice(0, n);
  const restSum = entries.slice(n).reduce((s,[,v])=>s+v, 0);
  return [...top, [otherLabel || "Other categories", restSum]];
}
/* a full panel: title + pie with in-chart labels, capped to maxSlices with an "Other" bucket for the remainder */
function pieSummaryPanel(title, sub, entries, currency, maxSlices){
  if(!entries.length) return "";
  const capped = topNWithOther(entries, maxSlices || 6);
  const data = capped.map(([label,value],i)=>({
    label, value, currency,
    color: (label==="Other categories") ? "var(--ink-muted)" : CAT_COLORS[i % CAT_COLORS.length],
  }));
  return `<div class="panel">
    <div class="panel-title">${title}</div>
    ${sub?`<div class="panel-sub">${sub}</div>`:""}
    ${pieChart(data,{size:280})}
  </div>`;
}

/* ================= overview: simple summary tables (no charts) ================= */
function monthKeysInRange(records){
  const keys = new Set();
  records.forEach(r=>keys.add(r.date.slice(0,7)));
  return Array.from(keys).sort();
}
function monthLabel(key){ const [y,m] = key.split("-"); return MONTHS_EN[parseInt(m,10)-1] + " " + y; }

function groupSumBars(records, keyFn, valueFn){
  const map = {};
  records.forEach(r=>{
    const k = keyFn(r);
    const cur = r.currency || "USD";
    map[cur] = map[cur] || {};
    map[cur][k] = (map[cur][k]||0) + valueFn(r);
  });
  return map; // {currency: {label: value}}
}

/* a plain two-column summary table: rows=[[label,value]], with a faint proportional bar behind the label for quick scanning */
function summaryTable(title, sub, entries, currency, barColor){
  if(!entries.length) return "";
  const max = Math.max(...entries.map(e=>Math.abs(e[1])), 1);
  const rows = entries.map(([label,value])=>{
    const pct = Math.min(100, Math.abs(value)/max*100);
    return `<tr>
      <td class="label-cell bar-wrap">${escHtml(label)}<span class="bar-fill" style="width:${pct}%; background:${barColor}"></span></td>
      <td class="num">${fmtMoney(value, currency)}</td>
    </tr>`;
  }).join("");
  return `<div class="panel">
    <div class="panel-title">${title}</div>
    ${sub?`<div class="panel-sub">${sub}</div>`:""}
    <table class="mini-table"><thead><tr><th>Description</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}

function monthlyTable(title, incArr, expArr){
  const currencies = currenciesPresent(incArr, expArr);
  if(!currencies.length) return "";
  let panels = "";
  currencies.forEach(cur=>{
    const incC = incArr.filter(r=>(r.currency||"USD")===cur);
    const expC = expArr.filter(r=>(r.currency||"USD")===cur);
    const months = monthKeysInRange([...incC, ...expC]);
    if(!months.length) return;
    const incByM = {}, expByM = {};
    incC.forEach(r=>{ const k=r.date.slice(0,7); incByM[k]=(incByM[k]||0)+r.grossAmount; });
    expC.forEach(r=>{ const k=r.date.slice(0,7); expByM[k]=(expByM[k]||0)+r.amount; });
    const rows = months.slice().reverse().map(m=>{
      const inc = incByM[m]||0, expn = expByM[m]||0, net = inc-expn;
      return `<tr><td>${monthLabel(m)}</td><td class="num">${fmtMoney(inc,cur)}</td><td class="num">${fmtMoney(expn,cur)}</td><td class="num" style="color:${net<0?'var(--crit)':'var(--good)'}">${fmtMoney(net,cur)}</td></tr>`;
    }).join("");
    panels += `<div class="panel">
      <div class="panel-title">${title}${currencies.length>1?" ("+cur+")":""}</div>
      <table class="mini-table"><thead><tr><th>Month</th><th class="num">Income</th><th class="num">Expenses</th><th class="num">Net</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  });
  return panels;
}

function renderOverviewCharts(){
  const inc = filteredIncome(), exp = filteredExpense();
  const bizInc = inc.filter(r=>r.sector==="business"), bizExp = exp.filter(r=>r.sector==="business");
  const perInc = inc.filter(r=>r.sector==="personal"), perExp = exp.filter(r=>r.sector==="personal");

  /* ---- manager view: a handful of charts giving the big-picture read ---- */
  let charts = "";
  if(filters.sector !== "personal"){
    const villaMapC = groupSumBars(bizInc.filter(r=>r.villa), r=>r.villa, r=>r.grossAmount);
    Object.keys(villaMapC).forEach(cur=>{
      const entries = Object.entries(villaMapC[cur]).sort((a,b)=>b[1]-a[1]);
      charts += pieSummaryPanel("Income by villa", cur, entries, cur, 8);
    });

    const catMapC = groupSumBars(bizExp, r=>r.category, r=>r.amount);
    Object.keys(catMapC).forEach(cur=>{
      const entries = Object.entries(catMapC[cur]).sort((a,b)=>b[1]-a[1]).slice(0,8);
      if(entries.length){
        const data = entries.map(([label,value],i)=>({label,value,currency:cur,color:CAT_COLORS[i%8]}));
        charts += `<div class="panel"><div class="panel-title">Top business expenses</div><div class="panel-sub">${cur} · top 8</div>${hBarChart(data,{labelW:120})}</div>`;
      }
    });
  }

  /* ---- detailed breakdown tables (the full numbers behind the charts above) ---- */
  let out = `<div class="panels">`;

  if(filters.sector !== "personal"){
    const platMap = groupSumBars(bizInc.filter(r=>r.platform), r=>r.platform, r=>r.grossAmount);
    Object.keys(platMap).forEach(cur=>{
      const entries = Object.entries(platMap[cur]).sort((a,b)=>b[1]-a[1]);
      out += summaryTable("Income by platform", cur, entries, cur, "var(--biz)");
    });

    const catMap = groupSumBars(bizExp, r=>r.category, r=>r.amount);
    Object.keys(catMap).forEach(cur=>{
      const entries = Object.entries(catMap[cur]).sort((a,b)=>b[1]-a[1]);
      out += pieSummaryPanel("Business expenses by category", cur, entries, cur, 6);
    });

    out += monthlyTable("Monthly trend table · Business", bizInc, bizExp);
  }

  out += `</div>`;

  const chartsWrap = document.getElementById("ovManagerCharts");
  if(charts){
    chartsWrap.innerHTML = `<div class="kpi-heading"><span class="swatch" style="background:var(--biz)"></span>Manager view</div><div class="panels">${charts}</div>`;
    wireChartTooltips(chartsWrap);
  } else {
    chartsWrap.innerHTML = "";
  }
  const tablesWrap = document.getElementById("ovTables");
  tablesWrap.innerHTML = out;
  wireChartTooltips(tablesWrap);
}

/* ================= tables ================= */
function sectorPill(sector){ return `<span class="pill ${sector==='business'?'biz':'per'}">${sector==='business'?'Business':'Personal'}</span>`; }

function escHtml(s){ return String(s??"").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ================= column filters (in addition to search + the global sector/year filter) ================= */
function distinctValues(arr, field){
  return Array.from(new Set(arr.map(r=>r[field]).filter(v=>v))).sort();
}
function fillSelect(sel, values, current, allLabel){
  if(!sel) return current;
  const keep = values.includes(current) ? current : "";
  sel.innerHTML = `<option value="">${allLabel}</option>` + values.map(v=>`<option value="${escHtml(v)}" ${v===keep?"selected":""}>${escHtml(v)}</option>`).join("");
  return keep;
}
function populateIncomeFilters(){
  const base = filteredIncome();
  incomeColFilter.villa = fillSelect(document.getElementById("incomeVillaFilter"), distinctValues(base,"villa"), incomeColFilter.villa, "All villas");
  incomeColFilter.platform = fillSelect(document.getElementById("incomePlatformFilter"), distinctValues(base,"platform"), incomeColFilter.platform, "All platforms");
  incomeColFilter.currency = fillSelect(document.getElementById("incomeCurrencyFilter"), distinctValues(base,"currency"), incomeColFilter.currency, "All currencies");
}
function populateExpenseFilters(){
  const base = filteredExpense();
  expenseColFilter.group = fillSelect(document.getElementById("expenseGroupFilter"), distinctValues(base,"group"), expenseColFilter.group, "All groups");
  const catBase = expenseColFilter.group ? base.filter(r=>r.group===expenseColFilter.group) : base;
  expenseColFilter.category = fillSelect(document.getElementById("expenseCategoryFilter"), distinctValues(catBase,"category"), expenseColFilter.category, "All categories");
  expenseColFilter.currency = fillSelect(document.getElementById("expenseCurrencyFilter"), distinctValues(base,"currency"), expenseColFilter.currency, "All currencies");
}
function clearIncomeFilters(){
  incomeColFilter = { villa:"", platform:"", currency:"" };
  const search = document.getElementById("incomeSearch");
  if(search) search.value = "";
  renderIncomeTable();
}
function clearExpenseFilters(){
  expenseColFilter = { group:"", category:"", currency:"" };
  const search = document.getElementById("expenseSearch");
  if(search) search.value = "";
  renderExpenseTable();
}

/* ================= editable sheet-style grids ================= */
function incomeRowHtml(r){
  const isBiz = r.sector === "business";
  return `<tr data-id="${r.id}">
    <td class="cell"><input class="cell-input" type="date" data-field="date" value="${r.date}"></td>
    <td class="cell"><select class="cell-input" data-field="sector">
        <option value="business" ${isBiz?'selected':''}>Business</option>
        <option value="personal" ${!isBiz?'selected':''}>Personal</option>
      </select></td>
    <td class="cell">${isBiz
        ? `<input class="cell-input" data-field="client" placeholder="Client name" value="${escHtml(r.client)}">`
        : `<select class="cell-input" data-field="category">${categoryOptionsHtml(DB.categoryStore.personalIncomeCategories, r.category)}</select>`}</td>
    <td class="cell">${isBiz ? `<select class="cell-input" data-field="villa"><option value=""></option>${VILLAS.map(v=>`<option ${r.villa===v?'selected':''}>${v}</option>`).join("")}</select>` : ""}</td>
    <td class="cell">${isBiz ? `<input class="cell-input num" type="number" min="0" data-field="nights" value="${r.nights??''}">` : ""}</td>
    <td class="cell">${isBiz ? `<input class="cell-input num" type="number" min="0" step="0.01" data-field="pricePerNight" value="${r.pricePerNight??''}">` : ""}</td>
    <td class="cell">${isBiz ? `<input class="cell-input" list="platformList" data-field="platform" value="${escHtml(r.platform)}">` : ""}</td>
    <td class="cell">${isBiz ? `<input class="cell-input num" type="number" min="0" max="100" data-field="commissionRate" value="${r.commissionRate!=null?Math.round(r.commissionRate*100):''}">` : ""}</td>
    <td class="cell"><input class="cell-input num" type="number" step="0.01" data-field="grossAmount" value="${r.grossAmount||0}"></td>
    <td class="cell"><select class="cell-input" data-field="currency"><option ${r.currency==='USD'?'selected':''}>USD</option><option ${r.currency==='ILS'?'selected':''}>ILS</option></select></td>
    <td class="cell"><input class="cell-input" data-field="notes" value="${escHtml(r.notes)}"></td>
    <td class="row-actions"><button class="icon-btn" title="Delete" onclick="deleteRecord('income','${r.id}')">🗑</button></td>
  </tr>`;
}

const INCOME_COLUMNS = [
  {field:"date", label:"Date"}, {field:"sector", label:"Type"}, {field:"client", label:"Client / Category"},
  {field:"villa", label:"Villa"}, {field:"nights", label:"Nights"}, {field:"pricePerNight", label:"Price/night"},
  {field:"platform", label:"Platform"}, {field:"commissionRate", label:"Commission %"}, {field:"grossAmount", label:"Gross amount"},
  {field:"currency", label:"Currency"}, {field:"notes", label:"Notes"},
];
const EXPENSE_COLUMNS = [
  {field:"date", label:"Month"}, {field:"sector", label:"Type"}, {field:"group", label:"Group"},
  {field:"category", label:"Category"}, {field:"amount", label:"Amount"}, {field:"currency", label:"Currency"}, {field:"notes", label:"Notes"},
];
let incomeSort = { field: null, dir: 1 };
let expenseSort = { field: null, dir: 1 };

function sortableTheadHtml(columns, sortState, tableName){
  return "<tr>" + columns.map(c=>{
    const active = sortState.field === c.field;
    const arrow = active ? (sortState.dir===1?"▲":"▼") : "";
    return `<th class="sortable" data-sort-field="${c.field}" data-sort-table="${tableName}">${c.label}${active?` <span class="arrow">${arrow}</span>`:""}</th>`;
  }).join("") + "<th></th></tr>";
}
function applySort(rows, sortState){
  if(!sortState.field) return rows;
  const f = sortState.field;
  return rows.slice().sort((a,b)=>{
    let va = a[f], vb = b[f];
    if(va==null) va = "";
    if(vb==null) vb = "";
    if(typeof va === "number" && typeof vb === "number") return (va-vb)*sortState.dir;
    return String(va).localeCompare(String(vb)) * sortState.dir;
  });
}
function handleSortClick(e){
  const th = e.target.closest("th.sortable");
  if(!th) return;
  const field = th.dataset.sortField;
  const tableName = th.dataset.sortTable;
  const state = tableName === "income" ? incomeSort : expenseSort;
  if(state.field === field){ state.dir *= -1; } else { state.field = field; state.dir = 1; }
  if(tableName==="income") renderIncomeTable(); else renderExpenseTable();
}

function renderIncomeTable(){
  populateIncomeFilters();
  const search = (document.getElementById("incomeSearch").value||"").toLowerCase();
  let rows = filteredIncome().filter(r =>
    (!search || (r.client+r.villa+r.platform+r.category+r.notes).toLowerCase().includes(search))
    && (!incomeColFilter.villa || r.villa===incomeColFilter.villa)
    && (!incomeColFilter.platform || r.platform===incomeColFilter.platform)
    && (!incomeColFilter.currency || r.currency===incomeColFilter.currency)
  );
  rows = applySort(rows, incomeSort);
  const thead = sortableTheadHtml(INCOME_COLUMNS, incomeSort, "income");
  const tbody = rows.length ? rows.map(incomeRowHtml).join("") : `<tr class="empty-row"><td colspan="12">No matching records — click "New row" to get started</td></tr>`;
  document.getElementById("incomeTable").innerHTML = `<thead>${thead}</thead><tbody>${tbody}</tbody>`;
}

function expenseRowHtml(r){
  const isBiz = r.sector === "business";
  const groups = isBiz ? DB.categoryStore.businessGroups : DB.categoryStore.personalGroups;
  const cats = groups[r.group] || ["Other"];
  return `<tr data-id="${r.id}">
    <td class="cell"><input class="cell-input" type="month" data-field="date" value="${r.date.slice(0,7)}"></td>
    <td class="cell"><select class="cell-input" data-field="sector">
        <option value="business" ${isBiz?'selected':''}>Business</option>
        <option value="personal" ${!isBiz?'selected':''}>Personal</option>
      </select></td>
    <td class="cell"><select class="cell-input" data-field="group">${Object.keys(groups).map(g=>`<option ${r.group===g?'selected':''}>${escHtml(g)}</option>`).join("")}</select></td>
    <td class="cell"><select class="cell-input" data-field="category">${categoryOptionsHtml(cats, r.category)}</select></td>
    <td class="cell"><input class="cell-input num" type="number" step="0.01" data-field="amount" value="${r.amount||0}"></td>
    <td class="cell"><select class="cell-input" data-field="currency"><option ${r.currency==='USD'?'selected':''}>USD</option><option ${r.currency==='ILS'?'selected':''}>ILS</option></select></td>
    <td class="cell"><input class="cell-input" data-field="notes" value="${escHtml(r.notes)}"></td>
    <td class="row-actions"><button class="icon-btn" title="Delete" onclick="deleteRecord('expense','${r.id}')">🗑</button></td>
  </tr>`;
}

function renderExpenseTable(){
  populateExpenseFilters();
  const search = (document.getElementById("expenseSearch").value||"").toLowerCase();
  let rows = filteredExpense().filter(r =>
    (!search || (r.group+r.category+r.notes).toLowerCase().includes(search))
    && (!expenseColFilter.group || r.group===expenseColFilter.group)
    && (!expenseColFilter.category || r.category===expenseColFilter.category)
    && (!expenseColFilter.currency || r.currency===expenseColFilter.currency)
  );
  rows = applySort(rows, expenseSort);
  const thead = sortableTheadHtml(EXPENSE_COLUMNS, expenseSort, "expense");
  const tbody = rows.length ? rows.map(expenseRowHtml).join("") : `<tr class="empty-row"><td colspan="8">No matching records — click "New row" to get started</td></tr>`;
  document.getElementById("expenseTable").innerHTML = `<thead>${thead}</thead><tbody>${tbody}</tbody>`;
}

function refreshAggregates(){
  renderKPIs(); renderOverviewCharts();
}

function handleIncomeChange(e){
  const el = e.target.closest("[data-field]");
  const tr = el && el.closest("tr[data-id]");
  if(!tr) return;
  const rec = DB.incomeRecords.find(r=>r.id===tr.dataset.id);
  if(!rec) return;
  const field = el.dataset.field;
  let rerenderRow = false;
  switch(field){
    case "sector": rec.sector = el.value; rerenderRow = true; break;
    case "date": rec.date = el.value; break;
    case "client": rec.client = el.value; break;
    case "category": {
      if(el.value === NEW_CATEGORY_VALUE){
        const name = (prompt("New category name:")||"").trim();
        if(name){
          if(!DB.categoryStore.personalIncomeCategories.includes(name)) DB.categoryStore.personalIncomeCategories.push(name);
          rec.category = name;
        }
        rerenderRow = true;
      } else {
        rec.category = el.value;
      }
      break;
    }
    case "villa": rec.villa = el.value; break;
    case "nights": rec.nights = el.value===""?null:parseFloat(el.value); break;
    case "pricePerNight": rec.pricePerNight = el.value===""?null:parseFloat(el.value); break;
    case "platform": rec.platform = el.value; break;
    case "commissionRate": rec.commissionRate = el.value===""?null:parseFloat(el.value)/100; break;
    case "grossAmount": rec.grossAmount = parseFloat(el.value)||0; break;
    case "currency": rec.currency = el.value; break;
    case "notes": rec.notes = el.value; break;
  }
  if(rec.nights && rec.pricePerNight){ rec.grossAmount = rec.nights * rec.pricePerNight; }
  rec.netAmount = rec.commissionRate!=null ? rec.grossAmount*(1-rec.commissionRate) : rec.grossAmount;
  if(rerenderRow){
    const wrap = document.createElement("tbody");
    wrap.innerHTML = incomeRowHtml(rec);
    tr.replaceWith(wrap.firstElementChild);
  } else {
    const grossInput = tr.querySelector('[data-field="grossAmount"]');
    if(grossInput && document.activeElement !== grossInput) grossInput.value = rec.grossAmount;
  }
  persist();
  refreshAggregates();
}

function handleExpenseChange(e){
  const el = e.target.closest("[data-field]");
  const tr = el && el.closest("tr[data-id]");
  if(!tr) return;
  const rec = DB.expenseRecords.find(r=>r.id===tr.dataset.id);
  if(!rec) return;
  const field = el.dataset.field;
  let rerenderRow = false;
  switch(field){
    case "sector": {
      rec.sector = el.value;
      const groups = rec.sector==="business" ? DB.categoryStore.businessGroups : DB.categoryStore.personalGroups;
      rec.group = Object.keys(groups)[0];
      rec.category = groups[rec.group][0];
      rerenderRow = true;
      break;
    }
    case "group": {
      rec.group = el.value;
      const groups = rec.sector==="business" ? DB.categoryStore.businessGroups : DB.categoryStore.personalGroups;
      rec.category = (groups[rec.group]||["Other"])[0];
      rerenderRow = true;
      break;
    }
    case "category": {
      if(el.value === NEW_CATEGORY_VALUE){
        const name = (prompt("New category name:")||"").trim();
        if(name){
          const groups = rec.sector==="business" ? DB.categoryStore.businessGroups : DB.categoryStore.personalGroups;
          if(!groups[rec.group]) groups[rec.group] = [];
          if(!groups[rec.group].includes(name)) groups[rec.group].push(name);
          rec.category = name;
        }
        rerenderRow = true;
      } else {
        rec.category = el.value;
      }
      break;
    }
    case "amount": rec.amount = parseFloat(el.value)||0; break;
    case "currency": rec.currency = el.value; break;
    case "notes": rec.notes = el.value; break;
    case "date": rec.date = el.value + "-01"; break;
  }
  if(rerenderRow){
    const wrap = document.createElement("tbody");
    wrap.innerHTML = expenseRowHtml(rec);
    tr.replaceWith(wrap.firstElementChild);
  }
  persist();
  refreshAggregates();
}

function addIncomeRow(){
  const sector = filters.sector !== "personal" ? "business" : "personal";
  const rec = {
    id: uid("inc"), sector, date: new Date().toISOString().slice(0,10),
    client: "", villa: sector==="business" ? "Elu" : "", nights: null, pricePerNight: null,
    platform: "", commissionRate: null, category: sector==="business" ? "Villa booking" : DB.categoryStore.personalIncomeCategories[0],
    grossAmount: 0, netAmount: 0, currency: sector==="business" ? "USD" : "ILS", notes: "",
  };
  DB.incomeRecords.push(rec);
  renderIncomeTable();
  refreshAggregates();
  persist();
  focusNewRow(rec.id, "incomeTable");
}
function addExpenseRow(){
  const sector = filters.sector !== "personal" ? "business" : "personal";
  const groups = sector==="business" ? DB.categoryStore.businessGroups : DB.categoryStore.personalGroups;
  const group = Object.keys(groups)[0];
  const rec = { id: uid("exp"), sector, date: new Date().toISOString().slice(0,7)+"-01", group, category: groups[group][0], amount: 0, currency: sector==="business" ? "USD" : "ILS", notes: "" };
  DB.expenseRecords.push(rec);
  renderExpenseTable();
  refreshAggregates();
  persist();
  focusNewRow(rec.id, "expenseTable");
}
function focusNewRow(id, tableId){
  requestAnimationFrame(()=>{
    const tr = document.querySelector(`#${tableId} tr[data-id="${id}"]`);
    if(tr){
      tr.scrollIntoView({block:"center", behavior:"smooth"});
      const inp = tr.querySelector(".cell-input");
      if(inp) inp.focus();
    }
  });
}

function handleSheetKeydown(e){
  if(e.key !== "Enter") return;
  const el = e.target.closest(".cell-input");
  if(!el) return;
  e.preventDefault();
  const tr = el.closest("tr");
  const td = el.closest("td");
  const colIndex = tr && td ? Array.from(tr.children).indexOf(td) : -1;
  const nextRow = tr && tr.nextElementSibling;
  el.blur();
  if(nextRow && colIndex>=0){
    const nextInput = nextRow.children[colIndex] && nextRow.children[colIndex].querySelector(".cell-input");
    if(nextInput) setTimeout(()=>nextInput.focus(), 0);
  }
}

window.deleteRecord = function(type, id){
  if(!confirm("Delete this record?")) return;
  const key = type==="income" ? "incomeRecords" : "expenseRecords";
  DB[key] = DB[key].filter(r=>r.id!==id);
  renderAll();
  persist();
  showToast("Record deleted");
};

function showToast(text){
  const wrap = document.getElementById("toastWrap");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  wrap.appendChild(el);
  requestAnimationFrame(()=>el.classList.add("show"));
  setTimeout(()=>{ el.classList.remove("show"); setTimeout(()=>el.remove(), 300); }, 2200);
}

/* ================= wiring ================= */
function renderAll(){
  renderKPIs();
  renderOverviewCharts();
  renderIncomeTable();
  renderExpenseTable();
  const upd = DB.updatedAt ? new Date(DB.updatedAt).toLocaleString("en-US") : "";
  document.getElementById("updatedAt").textContent = upd ? "Last updated: " + upd : "";
}

function setupYearFilter(){
  const sel = document.getElementById("yearFilter");
  const years = allYears();
  sel.innerHTML = `<option value="all">All years</option>` + years.map(y=>`<option value="${y}">${y}</option>`).join("");
  sel.addEventListener("change", ()=>{ filters.year = sel.value; renderAll(); });
}

function setupSectorSeg(){
  document.getElementById("sectorSeg").addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-sector]");
    if(!btn) return;
    document.querySelectorAll("#sectorSeg button").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    filters.sector = btn.dataset.sector;
    renderAll();
  });
}

function setupTabs(){
  document.querySelectorAll(".tab").forEach(tab=>{
    tab.addEventListener("click", ()=>{
      document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
      document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("view-"+tab.dataset.view).classList.add("active");
    });
  });
}

/* ================= EXPORT TO EXCEL =================
   Plain UTF-8 CSV, downloaded directly via a Blob URL. Excel opens a .csv by
   double-click exactly like a workbook, so "export to Excel" is satisfied even
   though the file on disk is CSV, not a true .xlsx.
*/
function round2(n){ return Math.round((n||0)*100)/100; }
function csvCell(v){
  if(v == null) v = "";
  v = String(v);
  if(/[",\n\r]/.test(v)) v = '"' + v.replace(/"/g,'""') + '"';
  return v;
}
function rowsToCsv(rows){
  return "﻿" + rows.map(r => r.map(csvCell).join(",")).join("\r\n");
}

function incomeRecordToRow(r){
  const isBiz = r.sector === "business";
  return [
    r.date || "",
    isBiz ? "Business" : "Personal",
    isBiz ? (r.client||"") : (r.category||""),
    isBiz ? (r.villa||"") : "",
    isBiz ? (r.nights ?? "") : "",
    isBiz ? (r.pricePerNight ?? "") : "",
    isBiz ? (r.platform||"") : "",
    (isBiz && r.commissionRate!=null) ? Math.round(r.commissionRate*100) : "",
    round2(r.grossAmount||0),
    r.currency || "USD",
    r.notes || "",
  ];
}
function expenseRecordToRow(r){
  return [
    (r.date||"").slice(0,7),
    r.sector === "business" ? "Business" : "Personal",
    r.group || "",
    r.category || "",
    round2(r.amount||0),
    r.currency || "USD",
    r.notes || "",
  ];
}
function incomeSheetRows(){
  return [INCOME_COLUMNS.map(c=>c.label), ...applySort(filteredIncome(), incomeSort).map(incomeRecordToRow)];
}
function expenseSheetRows(){
  return [EXPENSE_COLUMNS.map(c=>c.label), ...applySort(filteredExpense(), expenseSort).map(expenseRecordToRow)];
}

function summarySheetRows(){
  const inc = filteredIncome(), exp = filteredExpense();
  const bizInc = inc.filter(r=>r.sector==="business"), bizExp = exp.filter(r=>r.sector==="business");
  const perInc = inc.filter(r=>r.sector==="personal"), perExp = exp.filter(r=>r.sector==="personal");
  const rows = [];
  const title = t => rows.push([t]);
  const blank = () => rows.push([]);
  const entriesBlock = (heading, entries, currency) => {
    rows.push([heading, "Amount (" + currency + ")"]);
    entries.forEach(([label,value]) => rows.push([label, round2(value)]));
    blank();
  };
  const monthlyBlock = (heading, incArr, expArr) => {
    const currencies = currenciesPresent(incArr, expArr);
    currencies.forEach(cur=>{
      const incC = incArr.filter(r=>(r.currency||"USD")===cur);
      const expC = expArr.filter(r=>(r.currency||"USD")===cur);
      const months = monthKeysInRange([...incC, ...expC]);
      if(!months.length) return;
      const incByM = {}, expByM = {};
      incC.forEach(r=>{ const k=r.date.slice(0,7); incByM[k]=(incByM[k]||0)+r.grossAmount; });
      expC.forEach(r=>{ const k=r.date.slice(0,7); expByM[k]=(expByM[k]||0)+r.amount; });
      rows.push([heading + (currencies.length>1?" ("+cur+")":"")]);
      rows.push(["Month","Income","Expenses","Net"]);
      months.forEach(m=>{
        const i = incByM[m]||0, e = expByM[m]||0;
        rows.push([monthLabel(m), round2(i), round2(e), round2(i-e)]);
      });
      blank();
    });
  };

  title("Summary — Magna Pacific"); blank();

  if(filters.sector !== "personal"){
    title("Business");
    currenciesPresent(bizInc, bizExp).forEach(cur=>{
      const incSum = sumByCurrency(bizInc.filter(r=>(r.currency||"USD")===cur), "grossAmount")[cur] || 0;
      const expSum = sumByCurrency(bizExp.filter(r=>(r.currency||"USD")===cur), "amount")[cur] || 0;
      rows.push(["Income " + cur, round2(incSum)]);
      rows.push(["Expenses " + cur, round2(expSum)]);
      rows.push(["Net profit " + cur, round2(incSum-expSum)]);
    });
    blank();

    const villaMap = groupSumBars(bizInc.filter(r=>r.villa), r=>r.villa, r=>r.grossAmount);
    Object.keys(villaMap).forEach(cur=>{
      const entries = Object.entries(villaMap[cur]).sort((a,b)=>b[1]-a[1]);
      entriesBlock("Income by villa (" + cur + ")", entries, cur);
    });
    const platMap = groupSumBars(bizInc.filter(r=>r.platform), r=>r.platform, r=>r.grossAmount);
    Object.keys(platMap).forEach(cur=>{
      const entries = Object.entries(platMap[cur]).sort((a,b)=>b[1]-a[1]);
      entriesBlock("Income by platform (" + cur + ")", entries, cur);
    });
    const catMap = groupSumBars(bizExp, r=>r.category, r=>r.amount);
    Object.keys(catMap).forEach(cur=>{
      const entries = Object.entries(catMap[cur]).sort((a,b)=>b[1]-a[1]);
      entriesBlock("Business expenses by category (" + cur + ")", entries, cur);
    });
    monthlyBlock("Monthly trend · Business", bizInc, bizExp);
  }

  if(filters.sector !== "business"){
    title("Personal");
    currenciesPresent(perInc, perExp).forEach(cur=>{
      const incSum = sumByCurrency(perInc.filter(r=>(r.currency||"USD")===cur), "grossAmount")[cur] || 0;
      const expSum = sumByCurrency(perExp.filter(r=>(r.currency||"USD")===cur), "amount")[cur] || 0;
      rows.push(["Income " + cur, round2(incSum)]);
      rows.push(["Expenses " + cur, round2(expSum)]);
      rows.push(["Balance " + cur, round2(incSum-expSum)]);
    });
    blank();
    const grpMap = groupSumBars(perExp, r=>r.group, r=>r.amount);
    Object.keys(grpMap).forEach(cur=>{
      const entries = Object.entries(grpMap[cur]).sort((a,b)=>b[1]-a[1]);
      entriesBlock("Personal expenses by group (" + cur + ")", entries, cur);
    });
    monthlyBlock("Monthly trend · Personal", perInc, perExp);
  }

  return rows;
}

function saveCsv(filename, rows){
  const content = rowsToCsv(rows);
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
  showToast("File saved: " + filename);
}

function exportIncomeCsv(){ saveCsv("magna-pacific-income.csv", incomeSheetRows()); }
function exportExpenseCsv(){ saveCsv("magna-pacific-expenses.csv", expenseSheetRows()); }
function exportAllCsv(){
  const rows = [];
  rows.push(["Summary sheet"], []);
  rows.push(...summarySheetRows());
  rows.push([], ["Income sheet"], []);
  rows.push(...incomeSheetRows());
  rows.push([], ["Expenses sheet"], []);
  rows.push(...expenseSheetRows());
  saveCsv("magna-pacific-all.csv", rows);
}

function wireColFilter(id, state, key, renderFn){
  const el = document.getElementById(id);
  if(!el) return;
  el.addEventListener("change", ()=>{ state[key] = el.value; renderFn(); });
}

function setupButtons(){
  document.getElementById("addIncomeBtn").addEventListener("click", addIncomeRow);
  document.getElementById("addExpenseBtn").addEventListener("click", addExpenseRow);
  document.getElementById("incomeSearch").addEventListener("input", renderIncomeTable);
  document.getElementById("expenseSearch").addEventListener("input", renderExpenseTable);
  document.getElementById("exportIncomeBtn").addEventListener("click", exportIncomeCsv);
  document.getElementById("exportExpenseBtn").addEventListener("click", exportExpenseCsv);
  document.getElementById("exportAllBtn").addEventListener("click", exportAllCsv);

  wireColFilter("incomeVillaFilter", incomeColFilter, "villa", renderIncomeTable);
  wireColFilter("incomePlatformFilter", incomeColFilter, "platform", renderIncomeTable);
  wireColFilter("incomeCurrencyFilter", incomeColFilter, "currency", renderIncomeTable);
  wireColFilter("expenseGroupFilter", expenseColFilter, "group", renderExpenseTable);
  wireColFilter("expenseCategoryFilter", expenseColFilter, "category", renderExpenseTable);
  wireColFilter("expenseCurrencyFilter", expenseColFilter, "currency", renderExpenseTable);

  const incomeClear = document.getElementById("incomeClearFiltersBtn");
  if(incomeClear) incomeClear.addEventListener("click", clearIncomeFilters);
  const expenseClear = document.getElementById("expenseClearFiltersBtn");
  if(expenseClear) expenseClear.addEventListener("click", clearExpenseFilters);

  const incomeTableEl = document.getElementById("incomeTable");
  incomeTableEl.addEventListener("change", handleIncomeChange);
  incomeTableEl.addEventListener("keydown", handleSheetKeydown);
  incomeTableEl.addEventListener("click", handleSortClick);

  const expenseTableEl = document.getElementById("expenseTable");
  expenseTableEl.addEventListener("change", handleExpenseChange);
  expenseTableEl.addEventListener("keydown", handleSheetKeydown);
  expenseTableEl.addEventListener("click", handleSortClick);
}

(async function init(){
  document.getElementById("platformList").innerHTML = PLATFORMS.map(p=>`<option value="${p}">`).join("");
  setupTabs(); setupSectorSeg(); setupButtons();
  await loadData();
  setupYearFilter();
  renderAll();
})();
