/* ===================== Magna Pacific · Financial Dashboard ===================== */

/* Web App URL from Apps Script > Deploy > New deployment. Until this is filled in, the app just
   runs on the embedded starting data (edits work in the browser but are not saved anywhere). */
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwyj14i5sTlYBjtbdbi4kkdNdcT2lYT6FBb6LDvcuGS_cvtO_1bGxmTWfDnfcnKe07u/exec";

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
const PLATFORMS = ["airbnb","direct","vrbo","journey","isle blue","my private villas","travel pioneers","origin","booking.com","lee","brett","romi","rinat","yuli","frederick soutbys","freddie luxery travel"];
const PAYMENT_METHODS = ["Bank transfer","Credit card","Cash","Airbnb payout","Agency payment","Other"];
const CLIENT_TYPES = [["paying","Paying guest"],["influencer","Influencer (complimentary)"]];
const CAT_COLORS = ["var(--c1)","var(--c2)","var(--c3)","var(--c4)","var(--c5)","var(--c6)","var(--c7)","var(--c8)"];
const MONTHS_EN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const NEW_CATEGORY_VALUE = "__new__";
const DEFAULT_ILS_PER_USD = 3.5;
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;

/* record "type": the business (villas), or a private person (Moti / Sivan).
   Stored as sector ("business"|"personal") + owner ("Moti"|"Sivan"|"" = not assigned yet). */
const TYPE_LABEL = { business:"Business – Villas", moti:"Private – Moti", sivan:"Private – Sivan", private:"Private – not assigned" };
const TYPE_SHORT = { business:"Business", moti:"Moti", sivan:"Sivan", private:"Unassigned" };
function recType(r){
  if(r.sector === "business") return "business";
  const o = String(r.owner || "").toLowerCase();
  return o === "moti" ? "moti" : (o === "sivan" ? "sivan" : "private");
}
function applyType(r, t){
  if(t === "business"){ r.sector = "business"; r.owner = ""; }
  else { r.sector = "personal"; r.owner = t === "moti" ? "Moti" : (t === "sivan" ? "Sivan" : ""); }
}
function typeOptionsHtml(current){
  const opts = ["business","moti","sivan"];
  if(current === "private") opts.push("private");
  return opts.map(t=>`<option value="${t}" ${current===t?"selected":""}>${TYPE_LABEL[t]}</option>`).join("");
}
function typePill(t){
  const cls = t === "business" ? "biz" : (t === "private" ? "warn" : "per");
  return `<span class="pill ${cls}">${TYPE_SHORT[t]}</span>`;
}

/* legacy Hebrew group keys -> current English keys, for DBs persisted before the translation */
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

/* fill in any field an older save (or the Sheet) doesn't have yet, so every code path can rely on them */
function normalizeDB(){
  DB.incomeRecords = DB.incomeRecords || [];
  DB.expenseRecords = DB.expenseRecords || [];
  DB.paymentRecords = DB.paymentRecords || [];
  DB.recurringExpenses = DB.recurringExpenses || [];
  DB.settings = DB.settings || {};
  if(!(Number(DB.settings.ilsPerUsd) > 0)) DB.settings.ilsPerUsd = DEFAULT_ILS_PER_USD;
  DB.incomeRecords.forEach(r=>{
    r.owner = r.owner || "";
    r.clientType = r.clientType === "influencer" ? "influencer" : "paying";
    r.checkIn = r.checkIn || "";
    r.checkOut = r.checkOut || "";
    r.date = r.date || r.checkIn || "";
    r.client = r.client || ""; r.villa = r.villa || ""; r.platform = r.platform || ""; r.notes = r.notes || "";
    r.currency = r.currency || "USD";
    r.grossAmount = Number(r.grossAmount) || 0;
    r.nights = (r.nights === "" || r.nights == null) ? null : Number(r.nights);
    r.pricePerNight = (r.pricePerNight === "" || r.pricePerNight == null) ? null : Number(r.pricePerNight);
    r.commissionRate = (r.commissionRate === "" || r.commissionRate == null) ? null : Number(r.commissionRate);
    r.netAmount = incNet(r);
  });
  DB.expenseRecords.forEach(r=>{
    r.owner = r.owner || "";
    r.recurringId = r.recurringId || "";
    r.date = r.date || "";
    r.currency = r.currency || "USD";
    r.amount = Number(r.amount) || 0;
    r.notes = r.notes || "";
  });
  DB.paymentRecords.forEach(p=>{
    p.amount = Number(p.amount) || 0;
    p.currency = p.currency || "USD";
    ["date","method","notes","receiptUrl","receiptName","incomeId"].forEach(k=>{ p[k] = p[k] || ""; });
  });
  DB.recurringExpenses.forEach(t=>{
    t.owner = t.owner || "";
    t.sector = t.sector === "personal" ? "personal" : "business";
    t.active = !(t.active === false || String(t.active).toUpperCase() === "FALSE");
    t.amount = Number(t.amount) || 0;
    t.currency = t.currency || "USD";
    t.startMonth = String(t.startMonth || "").slice(0,7);
    t.endMonth = String(t.endMonth || "").slice(0,7);
    t.skipMonths = String(t.skipMonths || "");
    t.notes = t.notes || "";
  });
}

let DB = null;
let LOADED_FROM_SHEET = false;
let filters = { sector: "all", year: "all" };
let persistTimer = null;
let incomeColFilter = { villa: "", platform: "", currency: "", clientType: "" };
let expenseColFilter = { group: "", category: "", currency: "" };
let paymentFilter = { client: "", search: "" };

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

/* ---------------- currency: everything in the overall numbers is shown in USD ---------------- */
function fxRate(){ return Number(DB && DB.settings && DB.settings.ilsPerUsd) || DEFAULT_ILS_PER_USD; }
function toUSD(amount, cur){ amount = Number(amount) || 0; return cur === "ILS" ? amount / fxRate() : amount; }
function convertCur(amount, from, to){
  if(from === to) return Number(amount) || 0;
  const usd = toUSD(amount, from);
  return to === "ILS" ? usd * fxRate() : usd;
}

/* ---------------- income maths ----------------
   gross = the price of the stay · net = gross after the platform / agency commission.
   An influencer stay is complimentary: it books nights but brings no income. */
function incGross(r){ return r.clientType === "influencer" ? 0 : (Number(r.grossAmount) || 0); }
function incNet(r){
  if(r.clientType === "influencer") return 0;
  const g = Number(r.grossAmount) || 0;
  return g * (1 - (Number(r.commissionRate) || 0));
}
function incGrossUSD(r){ return toUSD(incGross(r), r.currency); }
function incNetUSD(r){ return toUSD(incNet(r), r.currency); }
function expUSD(r){ return toUSD(r.amount, r.currency); }

/* the date a record counts under for year/month totals: a stay counts by its check-in
   (same as the Excel's "year" column); everything else by its own date */
function recDate(r){
  if("checkIn" in r && r.sector === "business" && r.checkIn) return r.checkIn;
  return r.date || "";
}
function recYear(r){ return recDate(r).slice(0,4); }
function recMonth(r){ return recDate(r).slice(0,7); }

/* channel buckets for the income charts: Direct · Airbnb · Agencies (every other platform / agent) */
function channelOf(platform){
  const p = String(platform || "").toLowerCase().trim();
  if(!p) return "Unspecified";
  if(p === "direct") return "Direct";
  if(p.indexOf("airbnb") !== -1) return "Airbnb";
  return "Agencies";
}
const CHANNELS = ["Direct","Airbnb","Agencies"];

function daysBetween(a, b){
  if(!a || !b) return null;
  const d1 = new Date(a + "T00:00:00Z"), d2 = new Date(b + "T00:00:00Z");
  if(isNaN(d1) || isNaN(d2)) return null;
  return Math.round((d2 - d1) / 86400000);
}
function fmtDay(iso){
  if(!iso) return "";
  const [y,m,d] = iso.split("-");
  return `${parseInt(d,10)} ${MONTHS_EN[parseInt(m,10)-1]}${y ? " " + y : ""}`;
}
function fmtStay(r){
  if(!r.checkIn && !r.checkOut) return "—";
  return `${fmtDay(r.checkIn) || "?"} → ${fmtDay(r.checkOut) || "?"}`;
}
function nextMonthKey(k){
  let [y,m] = k.split("-").map(Number);
  m++; if(m > 12){ m = 1; y++; }
  return y + "-" + String(m).padStart(2,"0");
}
function currentMonthKey(){ return new Date().toISOString().slice(0,7); }

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
          normalizeDB();
          LOADED_FROM_SHEET = true;
          setSaveStatus("ok", "Synced with Google Sheet");
          return;
        }
      }
    }catch(e){ /* offline or misconfigured — fall back to the embedded seed below */ }
  }
  DB = seed;
  ensureCategoryStore();
  migrateLegacyLabels();
  normalizeDB();
  setSaveStatus(scriptUrlConfigured() ? "err" : "", scriptUrlConfigured() ? "Couldn't reach the Sheet — showing last-known data" : "Loaded starting data (not connected to a Sheet yet)");
}

function setSaveStatus(state, text){
  const dot = document.getElementById("saveDot");
  const t = document.getElementById("saveText");
  dot.className = "save-dot" + (state ? " " + state : "");
  t.textContent = text;
}

/* Whole-database overwrite: every save sends the complete current dataset and the Apps Script
   backend rewrites the sheet tabs from it. No per-field diffing — last save wins. */
function persist(){
  clearTimeout(persistTimer);
  if(!scriptUrlConfigured()){
    setSaveStatus("err", "Not connected to a Google Sheet — see APPS_SCRIPT_URL in app.js");
    return;
  }
  if(!LOADED_FROM_SHEET){
    /* the Sheet could not be read on load, so what's on screen is only the embedded starting data —
       saving it would overwrite the real Sheet. Refuse and tell the user to reload. */
    setSaveStatus("err", "Not saved — the Sheet couldn't be loaded, so saving would overwrite it. Reload the page.");
    return;
  }
  setSaveStatus("busy", "Saving…");
  persistTimer = setTimeout(async () => {
    DB.updatedAt = new Date().toISOString();
    const body = JSON.stringify(DB);
    try{
      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: {"Content-Type": "text/plain;charset=utf-8"}, // avoids a CORS preflight against Apps Script
        body,
      });
      const out = await res.json().catch(()=>null);
      if(out && out.ok === false){
        setSaveStatus("err", "Save failed: " + (out.error || "unknown error"));
      } else {
        setSaveStatus("ok", "Saved");
      }
    }catch(err){
      /* the browser refused to hand back the response (usually a CORS / redirect quirk on the Apps
         Script side) even though the request itself may well have gone through. Re-send it as a
         "no-cors" request — we can't read the answer, so we say so instead of claiming success. */
      try{
        await fetch(APPS_SCRIPT_URL, { method:"POST", mode:"no-cors", headers:{"Content-Type":"text/plain;charset=utf-8"}, body });
        setSaveStatus("ok", "Sent to the Sheet (no confirmation received — reload to verify)");
      }catch(err2){
        setSaveStatus("err", "Save failed — " + (err2 && err2.message ? err2.message : "check your connection and try again"));
      }
    }
  }, 700);
}

/* ---------------- filters / derived data ---------------- */
function allYears(){
  const ys = new Set();
  DB.incomeRecords.forEach(r => { const y = recYear(r); if(y) ys.add(y); });
  DB.expenseRecords.forEach(r => { const y = recYear(r); if(y) ys.add(y); });
  return Array.from(ys).sort();
}
function inYear(r){ return filters.year === "all" || recYear(r) === filters.year; }
function inFilter(r){
  if(filters.sector !== "all" && recType(r) !== filters.sector) return false;
  return inYear(r);
}
function filteredIncome(){ return DB.incomeRecords.filter(inFilter); }
function filteredExpense(){ return DB.expenseRecords.filter(inFilter); }

function sumBy(arr, fn){ return arr.reduce((s,r)=>s + fn(r), 0); }

/* ================= recurring (fixed) expenses: auto-added every month ================= */
function recurringType(t){ return recType(t); }
function generateRecurring(){
  let added = 0;
  const cur = currentMonthKey();
  DB.recurringExpenses.forEach(t=>{
    if(!t.active || !t.startMonth || !(t.amount > 0) || !t.group || !t.category) return;
    const end = (t.endMonth && t.endMonth < cur) ? t.endMonth : cur;
    const skips = String(t.skipMonths || "").split(",").map(s=>s.trim()).filter(Boolean);
    const ty = recurringType(t);
    for(let m = t.startMonth; m <= end; m = nextMonthKey(m)){
      if(skips.indexOf(m) !== -1) continue;
      /* never double up with a row that's already there for that month (e.g. history that was imported) */
      const exists = DB.expenseRecords.some(r => (r.date||"").slice(0,7) === m && recType(r) === ty && r.group === t.group && r.category === t.category);
      if(exists) continue;
      DB.expenseRecords.push({
        id: uid("exp"), sector: t.sector, owner: t.owner, date: m + "-01",
        group: t.group, category: t.category, amount: t.amount, currency: t.currency,
        notes: "Fixed expense (auto)" + (t.notes ? " · " + t.notes : ""), recurringId: t.id,
      });
      added++;
    }
  });
  return added;
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

/* grouped vertical bars: categories=["2023","2024"], series=[{name,color,values:[..]}] */
function groupedBarChart(categories, series, opts){
  opts = opts || {};
  const w = opts.width || 520, h = opts.height || 250;
  const padL = 50, padB = 34, padT = 14, padR = 10;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const allVals = series.flatMap(s=>s.values);
  const max = niceMax(Math.max(...allVals, 1));
  const groupW = innerW / categories.length;
  const gap = 4;
  const barW = Math.min(44, (groupW * 0.72 - gap*(series.length-1)) / series.length);
  const clusterW = barW*series.length + gap*(series.length-1);
  let grid = "";
  for(let i=0;i<=4;i++){
    const y = padT + innerH - innerH*i/4;
    grid += `<line class="grid" x1="${padL}" x2="${w-padR}" y1="${y}" y2="${y}"/>`;
    grid += `<text x="${padL-8}" y="${y+4}" text-anchor="end" font-size="10.5">${fmtCompact(max*i/4)}</text>`;
  }
  let bars = "";
  categories.forEach((cat,ci)=>{
    const x0 = padL + groupW*ci + (groupW - clusterW)/2;
    series.forEach((s,si)=>{
      const v = s.values[ci] || 0;
      const bh = (v/max)*innerH;
      const x = x0 + si*(barW+gap), y = padT + innerH - bh;
      const color = resolveCssVar(s.color);
      bars += `<rect class="mark" data-label="${escAttr(cat + ' · ' + s.name)}" data-value="${v}" data-currency="${opts.currency||''}" x="${x}" y="${y}" width="${barW}" height="${Math.max(bh,1)}" rx="4" fill="${color}"/>`;
      if(categories.length * series.length <= 12){
        bars += `<text class="bar-label" x="${x+barW/2}" y="${y-5}" text-anchor="middle">${fmtCompact(v)}</text>`;
      }
    });
    bars += `<text class="cat-label" x="${padL + groupW*ci + groupW/2}" y="${h-padB+17}" text-anchor="middle">${escHtml(truncateLabel(cat,12))}</text>`;
  });
  return `<svg class="chart" dir="ltr" viewBox="0 0 ${w} ${h}" width="100%" height="${h}">${grid}${bars}</svg>` +
    legendHtml(series.map(s=>({label:s.name, color:s.color})));
}

/* ================= overview ================= */
function monthLabel(key){ const [y,m] = key.split("-"); return MONTHS_EN[parseInt(m,10)-1] + " " + y; }
function sumMap(recs, keyFn, valFn){
  const m = {};
  recs.forEach(r=>{ const k = keyFn(r); if(!k) return; m[k] = (m[k]||0) + valFn(r); });
  return m;
}
function sortedEntries(map){ return Object.entries(map).filter(([,v])=>Math.abs(v) > 0.5).sort((a,b)=>b[1]-a[1]); }

/* ---- profit & loss, all in USD:
   gross income → net income (after commissions) → minus business expenses → business profit
   → minus Moti's and Sivan's private expenses → total ---- */
function computePnl(){
  const inc = DB.incomeRecords.filter(inYear), exp = DB.expenseRecords.filter(inYear);
  const bizInc = inc.filter(r=>r.sector === "business");
  const gross = sumBy(bizInc, incGrossUSD), net = sumBy(bizInc, incNetUSD);
  const expBy = t => sumBy(exp.filter(r=>recType(r) === t), expUSD);
  const incBy = t => sumBy(inc.filter(r=>r.sector === "personal" && recType(r) === t), r=>toUSD(r.grossAmount, r.currency));
  const bizExp = expBy("business"), moti = expBy("moti"), sivan = expBy("sivan"), unassigned = expBy("private");
  const profit = net - bizExp;
  return {
    bizInc, gross, net, commission: gross - net, bizExp, profit, moti, sivan, unassigned,
    total: profit - moti - sivan - unassigned,
    privIncome: { moti: incBy("moti"), sivan: incBy("sivan"), private: incBy("private") },
  };
}

function pnlRowHtml(label, value, kind, maxAbs){
  const pct = Math.min(100, Math.abs(value) / maxAbs * 100);
  const color = kind === "total" ? (value < 0 ? "var(--crit)" : "var(--good)") : (kind === "sub" ? "var(--biz)" : (value < 0 ? "var(--per)" : "var(--c1)"));
  return `<tr class="pnl-${kind||"line"}">
    <td class="label-cell bar-wrap">${escHtml(label)}<span class="bar-fill" style="width:${pct}%; background:${color}"></span></td>
    <td class="num ${value<0 && kind==="total" ? "neg" : ""}">${fmtMoney(value,"USD")}</td>
  </tr>`;
}

function renderKPIs(){
  const p = computePnl();
  const lines = [
    ["Gross income (paying stays)", p.gross, "line"],
    ["− Commissions (platforms & agencies)", -p.commission, "line"],
    ["= Net income", p.net, "sub"],
    ["− Business expenses (villas)", -p.bizExp, "line"],
    ["= Business profit", p.profit, "sub"],
    ["− Private expenses · Moti", -p.moti, "line"],
    ["− Private expenses · Sivan", -p.sivan, "line"],
  ];
  if(p.unassigned > 0.5) lines.push(["− Private expenses · not assigned yet", -p.unassigned, "line"]);
  lines.push(["= Total after private expenses", p.total, "total"]);
  const maxAbs = Math.max(...lines.map(l=>Math.abs(l[1])), 1);
  const privInc = [["Moti", p.privIncome.moti], ["Sivan", p.privIncome.sivan], ["not assigned", p.privIncome.private]].filter(x=>x[1] > 0.5);
  const memo = privInc.length
    ? `<div class="panel-sub" style="margin:8px 0 0;">Private income, not included above: ${privInc.map(([n,v])=>`${n} ${fmtMoney(v,"USD")}`).join(" · ")}</div>` : "";

  document.getElementById("ovBusinessKpi").innerHTML = `
    <div class="kpi-heading"><span class="swatch" style="background:var(--biz)"></span>Profit &amp; loss · all in USD${filters.year!=="all" ? " · " + filters.year : ""}</div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Gross income</div><div class="kpi-value">${fmtMoney(p.gross,"USD")}</div></div>
      <div class="kpi-card"><div class="kpi-label">Net income</div><div class="kpi-value">${fmtMoney(p.net,"USD")}</div><div class="kpi-sub">after ${fmtMoney(p.commission,"USD")} commissions</div></div>
      <div class="kpi-card"><div class="kpi-label">Business expenses</div><div class="kpi-value">${fmtMoney(p.bizExp,"USD")}</div></div>
      <div class="kpi-card"><div class="kpi-label">Business profit</div><div class="kpi-value ${p.profit<0?'neg':''}">${fmtMoney(p.profit,"USD")}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total after private</div><div class="kpi-value ${p.total<0?'neg':''}">${fmtMoney(p.total,"USD")}</div><div class="kpi-sub">Moti ${fmtMoney(p.moti,"USD")} · Sivan ${fmtMoney(p.sivan,"USD")}</div></div>
    </div>
    <div class="panels" style="margin-top:14px;">
      <div class="panel">
        <div class="panel-title">How the total is built</div>
        <div class="panel-sub">Every amount converted to USD${filters.year!=="all" ? " · " + filters.year : " · all years"}</div>
        <table class="mini-table pnl"><tbody>${lines.map(l=>pnlRowHtml(l[0], l[1], l[2], maxAbs)).join("")}</tbody></table>
        ${memo}
        <div class="fx-row"><label for="fxInput">Exchange rate used for ILS amounts:</label>
          <span>1 USD =</span> <input type="number" id="fxInput" class="fx-input" min="0.1" step="0.01" value="${fxRate()}"> <span>₪</span></div>
      </div>
    </div>`;

  /* stays */
  const stays = DB.incomeRecords.filter(r=>r.sector === "business" && inYear(r));
  const paying = stays.filter(r=>r.clientType !== "influencer"), infl = stays.filter(r=>r.clientType === "influencer");
  const nightsPaying = sumBy(paying, r=>r.nights||0), nightsInfl = sumBy(infl, r=>r.nights||0);
  document.getElementById("ovPersonalKpi").innerHTML = `
    <div class="kpi-heading"><span class="swatch" style="background:var(--gold)"></span>Stays</div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Bookings</div><div class="kpi-value">${stays.length}</div><div class="kpi-sub">${paying.length} paying · ${infl.length} influencer</div></div>
      <div class="kpi-card"><div class="kpi-label">Paying nights</div><div class="kpi-value">${fmtNum(nightsPaying)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Influencer nights</div><div class="kpi-value">${fmtNum(nightsInfl)}</div><div class="kpi-sub">complimentary, no income</div></div>
      <div class="kpi-card"><div class="kpi-label">Avg net per paying night</div><div class="kpi-value">${nightsPaying ? fmtMoney(p.net/nightsPaying,"USD") : "—"}</div></div>
    </div>`;
}

/* a pie panel with fixed colors per label (the channel pie keeps Direct/Airbnb/Agencies colors stable) */
function colouredPiePanel(title, sub, entries, colorOf){
  if(!entries.length) return "";
  const data = entries.map(([label,value])=>({label, value, currency:"USD", color: colorOf(label)}));
  return `<div class="panel"><div class="panel-title">${title}</div>${sub?`<div class="panel-sub">${sub}</div>`:""}${pieChart(data,{size:280})}</div>`;
}

function platformTable(bizInc){
  const rows = {};
  bizInc.forEach(r=>{
    const k = r.platform ? r.platform.trim() : "(no platform)";
    rows[k] = rows[k] || {gross:0, net:0, n:0};
    rows[k].gross += incGrossUSD(r); rows[k].net += incNetUSD(r); rows[k].n++;
  });
  const entries = Object.entries(rows).sort((a,b)=>b[1].gross-a[1].gross);
  if(!entries.length) return "";
  const max = Math.max(...entries.map(e=>e[1].gross), 1);
  const body = entries.map(([label,v])=>`<tr>
      <td class="label-cell bar-wrap">${escHtml(label)}<span class="bar-fill" style="width:${Math.min(100,v.gross/max*100)}%; background:var(--biz)"></span></td>
      <td class="num">${v.n}</td><td class="num">${fmtMoney(v.gross,"USD")}</td><td class="num">${fmtMoney(v.net,"USD")}</td></tr>`).join("");
  return `<div class="panel"><div class="panel-title">Income by platform</div><div class="panel-sub">USD</div>
    <table class="mini-table"><thead><tr><th>Platform</th><th class="num">Stays</th><th class="num">Gross</th><th class="num">Net</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function monthlyTable(bizInc, bizExp){
  const months = Array.from(new Set([...bizInc.map(recMonth), ...bizExp.map(recMonth)].filter(Boolean))).sort();
  if(!months.length) return "";
  const g = sumMap(bizInc, recMonth, incGrossUSD), n = sumMap(bizInc, recMonth, incNetUSD), e = sumMap(bizExp, recMonth, expUSD);
  const rows = months.slice().reverse().map(m=>{
    const profit = (n[m]||0) - (e[m]||0);
    return `<tr><td>${monthLabel(m)}</td><td class="num">${fmtMoney(g[m]||0,"USD")}</td><td class="num">${fmtMoney(n[m]||0,"USD")}</td><td class="num">${fmtMoney(e[m]||0,"USD")}</td><td class="num" style="color:${profit<0?'var(--crit)':'var(--good)'}">${fmtMoney(profit,"USD")}</td></tr>`;
  }).join("");
  return `<div class="panel" style="grid-column:1 / -1;"><div class="panel-title">Monthly table · Business</div><div class="panel-sub">USD · stays counted in their check-in month</div>
    <div style="max-height:420px; overflow:auto;"><table class="mini-table"><thead><tr><th>Month</th><th class="num">Gross</th><th class="num">Net</th><th class="num">Expenses</th><th class="num">Net − expenses</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function renderOverviewCharts(){
  const inc = filteredIncome(), exp = filteredExpense();
  const bizInc = inc.filter(r=>r.sector === "business"), bizExp = exp.filter(r=>r.sector === "business");
  const showBiz = filters.sector === "all" || filters.sector === "business";
  const showPriv = filters.sector !== "business";
  let charts = "", out = "";

  if(showBiz){
    /* income by year — always every year, whatever the year filter says */
    const allBiz = DB.incomeRecords.filter(r=>r.sector === "business");
    const years = Array.from(new Set(allBiz.map(recYear).filter(Boolean))).sort();
    if(years.length){
      const gross = years.map(y=>sumBy(allBiz.filter(r=>recYear(r)===y), incGrossUSD));
      const net = years.map(y=>sumBy(allBiz.filter(r=>recYear(r)===y), incNetUSD));
      charts += `<div class="panel"><div class="panel-title">Income by year</div><div class="panel-sub">USD · gross vs net · by check-in year</div>${groupedBarChart(years, [{name:"Gross income", color:"var(--c1)", values:gross},{name:"Net income", color:"var(--c3)", values:net}], {currency:"USD"})}</div>`;
    }

    /* income by channel — amounts (grouped bars) and share (pie) */
    const chGross = sumMap(bizInc, r=>channelOf(r.platform), incGrossUSD);
    const chNet = sumMap(bizInc, r=>channelOf(r.platform), incNetUSD);
    const chans = CHANNELS.slice(); if((chGross["Unspecified"]||0) > 0.5) chans.push("Unspecified");
    if(bizInc.length){
      charts += `<div class="panel"><div class="panel-title">Income by channel · amounts</div><div class="panel-sub">USD · Direct · Airbnb · Agencies (every agent / travel agency)</div>${groupedBarChart(chans, [{name:"Gross income", color:"var(--c1)", values:chans.map(c=>chGross[c]||0)},{name:"Net income", color:"var(--c3)", values:chans.map(c=>chNet[c]||0)}], {currency:"USD"})}</div>`;
      const chColor = l => ({Direct:"var(--c1)", Airbnb:"var(--c2)", Agencies:"var(--c3)"}[l] || "var(--ink-muted)");
      charts += colouredPiePanel("Income by channel · share", "USD · gross", chans.map(c=>[c, chGross[c]||0]).filter(e=>e[1]>0.5), chColor);
    }

    const villaEntries = sortedEntries(sumMap(bizInc.filter(r=>r.villa), r=>r.villa, incGrossUSD));
    charts += pieSummaryPanel("Income by villa", "USD · gross", villaEntries, "USD", 8);
  }

  /* expenses by type: business vs Moti vs Sivan */
  if(filters.sector === "all"){
    const byType = {};
    exp.forEach(r=>{ const t = recType(r); byType[TYPE_SHORT[t]] = (byType[TYPE_SHORT[t]]||0) + expUSD(r); });
    const typeColor = l => ({Business:"var(--c1)", Moti:"var(--c2)", Sivan:"var(--c3)"}[l] || "var(--ink-muted)");
    charts += colouredPiePanel("Expenses by type", "USD · Business vs Moti vs Sivan", sortedEntries(byType), typeColor);
  }

  if(showBiz){
    const catEntries = sortedEntries(sumMap(bizExp, r=>r.category, expUSD));
    if(catEntries.length){
      const top = catEntries.slice(0,8).map(([label,value],i)=>({label,value,currency:"USD",color:CAT_COLORS[i%8]}));
      charts += `<div class="panel"><div class="panel-title">Top business expenses</div><div class="panel-sub">USD · top 8</div>${hBarChart(top,{labelW:120})}</div>`;
    }
  }

  if(showPriv){
    const types = filters.sector === "all" ? ["moti","sivan","private"] : [filters.sector];
    types.forEach(t=>{
      const entries = sortedEntries(sumMap(exp.filter(r=>recType(r)===t), r=>r.group, expUSD));
      charts += pieSummaryPanel("Private expenses by group · " + TYPE_SHORT[t], "USD", entries, "USD", 6);
    });
  }

  /* detailed tables */
  if(showBiz){
    out += platformTable(bizInc);
    const catEntries = sortedEntries(sumMap(bizExp, r=>r.category, expUSD));
    out += pieSummaryPanel("Business expenses by category", "USD", catEntries, "USD", 6);
    out += monthlyTable(bizInc, bizExp);
  }

  const chartsWrap = document.getElementById("ovManagerCharts");
  chartsWrap.innerHTML = charts ? `<div class="kpi-heading"><span class="swatch" style="background:var(--biz)"></span>Manager view</div><div class="panels">${charts}</div>` : "";
  wireChartTooltips(chartsWrap);
  const tablesWrap = document.getElementById("ovTables");
  tablesWrap.innerHTML = `<div class="panels">${out}</div>`;
  wireChartTooltips(tablesWrap);
}

/* ================= tables ================= */
function escHtml(s){ return String(s??"").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function incomeById(id){ return DB.incomeRecords.find(r=>r.id === id); }

/* ================= payment tracking maths ================= */
function bookingPaid(rec){
  return sumBy(DB.paymentRecords.filter(p=>p.incomeId === rec.id), p=>convertCur(p.amount, p.currency, rec.currency));
}
/* what the villa should actually collect for a stay is the NET price (after commission) */
function bookingStatus(rec){
  if(rec.clientType === "influencer") return { key:"free", label:"Complimentary", due:0, paid:0, balance:0 };
  const due = incNet(rec), paid = bookingPaid(rec), tol = Math.max(1, due * 0.002);
  const balance = due - paid;
  if(due <= 0 && paid <= 0) return { key:"none", label:"No amount", due, paid, balance };
  if(paid >= due - tol) return { key:"paid", label: paid > due + tol ? "Paid (over)" : "Paid", due, paid, balance };
  if(paid > 0) return { key:"partial", label:"Partial " + Math.round(paid/due*100) + "%", due, paid, balance };
  return { key:"unpaid", label:"No payments", due, paid, balance };
}
function statusPill(st){
  const cls = {paid:"ok", partial:"warn", unpaid:"crit", free:"muted", none:"muted"}[st.key] || "muted";
  return `<span class="pill st-${cls}">${escHtml(st.label)}</span>`;
}
function bookingLabel(b){
  return [b.client || "(no name)", b.villa, fmtStay(b)].filter(Boolean).join(" · ");
}

/* ================= column filters ================= */
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
  const ct = document.getElementById("incomeClientTypeFilter");
  if(ct){
    ct.innerHTML = `<option value="">All client types</option>` + CLIENT_TYPES.map(([v,l])=>`<option value="${v}" ${incomeColFilter.clientType===v?"selected":""}>${l}</option>`).join("");
  }
}
function populateExpenseFilters(){
  const base = filteredExpense();
  expenseColFilter.group = fillSelect(document.getElementById("expenseGroupFilter"), distinctValues(base,"group"), expenseColFilter.group, "All groups");
  const catBase = expenseColFilter.group ? base.filter(r=>r.group===expenseColFilter.group) : base;
  expenseColFilter.category = fillSelect(document.getElementById("expenseCategoryFilter"), distinctValues(catBase,"category"), expenseColFilter.category, "All categories");
  expenseColFilter.currency = fillSelect(document.getElementById("expenseCurrencyFilter"), distinctValues(base,"currency"), expenseColFilter.currency, "All currencies");
}
function clearIncomeFilters(){
  incomeColFilter = { villa:"", platform:"", currency:"", clientType:"" };
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

/* ================= income sheet ================= */
const INCOME_COLUMNS = [
  {field:"type", label:"Type"}, {field:"client", label:"Client / Category"}, {field:"clientType", label:"Client type"},
  {field:"villa", label:"Villa"}, {field:"checkIn", label:"Check-in"}, {field:"checkOut", label:"Check-out"},
  {field:"nights", label:"Nights"}, {field:"pricePerNight", label:"Price/night"}, {field:"platform", label:"Platform"},
  {field:"commissionRate", label:"Commission %"}, {field:"grossAmount", label:"Gross amount"}, {field:"netAmount", label:"Net price"},
  {field:"currency", label:"Currency"}, {field:"date", label:"Payment date"}, {field:"payStatus", label:"Payments"},
  {field:"notes", label:"Notes"},
];
const EXPENSE_COLUMNS = [
  {field:"date", label:"Month"}, {field:"type", label:"Type"}, {field:"group", label:"Group"},
  {field:"category", label:"Category"}, {field:"amount", label:"Amount"}, {field:"currency", label:"Currency"},
  {field:"usd", label:"≈ USD"}, {field:"notes", label:"Notes"},
];
let incomeSort = { field: null, dir: 1 };
let expenseSort = { field: null, dir: 1 };

function sortVal(r, f){
  switch(f){
    case "type": return TYPE_LABEL[recType(r)];
    case "netAmount": return incNet(r);
    case "usd": return expUSD(r);
    case "payStatus": { const s = bookingStatus(r); return s.key === "free" ? -1 : s.paid / (s.due || 1); }
    default: return r[f];
  }
}

function incomeRowHtml(r){
  const t = recType(r), isBiz = t === "business", infl = r.clientType === "influencer";
  const st = isBiz ? bookingStatus(r) : null;
  const typeCell = `<td class="cell w-type"><select class="cell-input" data-field="type">${typeOptionsHtml(t)}</select></td>`;
  const clientCell = isBiz
    ? `<td class="cell w-client"><div class="client-cell"><input class="cell-input" data-field="client" placeholder="Client name" value="${escHtml(r.client)}"><button type="button" class="link-btn" data-open-payments="${r.id}" title="Open this client's payments & receipts">↗</button></div></td>`
    : `<td class="cell w-client"><select class="cell-input" data-field="category">${categoryOptionsHtml(DB.categoryStore.personalIncomeCategories, r.category)}</select></td>`;
  const ctCell = isBiz
    ? `<td class="cell w-ctype"><select class="cell-input" data-field="clientType">${CLIENT_TYPES.map(([v,l])=>`<option value="${v}" ${r.clientType===v?"selected":""}>${l}</option>`).join("")}</select></td>`
    : `<td class="cell"></td>`;
  const villaCell = isBiz
    ? `<td class="cell w-villa"><select class="cell-input" data-field="villa"><option value=""></option>${VILLAS.map(v=>`<option ${r.villa===v?"selected":""}>${v}</option>`).join("")}</select></td>`
    : `<td class="cell w-villa"></td>`;
  const payCell = isBiz
    ? `<td class="cell w-pay"><button type="button" class="pill-btn" data-open-payments="${r.id}" title="Open this client's payments & receipts">${statusPill(st)}</button></td>`
    : `<td class="cell"></td>`;
  return `<tr data-id="${r.id}" class="${infl?"row-infl":""}">
    ${typeCell}
    ${clientCell}
    ${ctCell}
    ${villaCell}
    <td class="cell w-date">${isBiz ? `<input class="cell-input" type="date" data-field="checkIn" value="${r.checkIn}">` : ""}</td>
    <td class="cell w-date">${isBiz ? `<input class="cell-input" type="date" data-field="checkOut" value="${r.checkOut}">` : ""}</td>
    <td class="cell w-num">${isBiz ? `<input class="cell-input num" type="number" min="0" data-field="nights" value="${r.nights??''}">` : ""}</td>
    <td class="cell w-num">${isBiz ? `<input class="cell-input num" type="number" min="0" step="0.01" data-field="pricePerNight" value="${r.pricePerNight??''}">` : ""}</td>
    <td class="cell w-plat">${isBiz ? `<input class="cell-input" list="platformList" data-field="platform" value="${escHtml(r.platform)}">` : ""}</td>
    <td class="cell w-num">${isBiz ? `<input class="cell-input num" type="number" min="0" max="100" step="0.1" data-field="commissionRate" value="${r.commissionRate!=null?Math.round(r.commissionRate*1000)/10:''}">` : ""}</td>
    <td class="cell w-amt"><input class="cell-input num" type="number" step="0.01" data-field="grossAmount" value="${infl ? 0 : (r.grossAmount||0)}" ${infl?"disabled":""}></td>
    <td class="num net-cell w-amt">${isBiz ? fmtNum(incNet(r)) : ""}</td>
    <td class="cell w-cur"><select class="cell-input" data-field="currency"><option ${r.currency==='USD'?'selected':''}>USD</option><option ${r.currency==='ILS'?'selected':''}>ILS</option></select></td>
    <td class="cell w-date"><input class="cell-input" type="date" data-field="date" value="${r.date}"></td>
    ${payCell}
    <td class="cell w-notes"><input class="cell-input" data-field="notes" value="${escHtml(r.notes)}"></td>
    <td class="row-actions"><button class="icon-btn" title="Delete" onclick="deleteRecord('income','${r.id}')">🗑</button></td>
  </tr>`;
}

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
    let va = sortVal(a,f), vb = sortVal(b,f);
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
  const state = tableName === "income" ? incomeSort : (tableName === "expense" ? expenseSort : null);
  if(!state) return;
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
    && (!incomeColFilter.clientType || (r.sector==="business" && r.clientType===incomeColFilter.clientType))
  );
  rows = applySort(rows, incomeSort);
  const thead = sortableTheadHtml(INCOME_COLUMNS, incomeSort, "income");
  const tbody = rows.length ? rows.map(incomeRowHtml).join("") : `<tr class="empty-row"><td colspan="${INCOME_COLUMNS.length+1}">No matching records — click "New row" to get started</td></tr>`;
  document.getElementById("incomeTable").innerHTML = `<thead>${thead}</thead><tbody>${tbody}</tbody>`;
  /* totals under the filtered rows, in USD */
  const biz = rows.filter(r=>r.sector==="business");
  const tot = document.getElementById("incomeTotals");
  if(tot) tot.innerHTML = biz.length
    ? `<b>${biz.length}</b> stays shown · gross <b>${fmtMoney(sumBy(biz,incGrossUSD),"USD")}</b> · net <b>${fmtMoney(sumBy(biz,incNetUSD),"USD")}</b> · <b>${fmtNum(sumBy(biz,r=>r.nights||0))}</b> nights <span class="sheet-hint">(USD, influencer stays count nights but no income)</span>` : "";
}

/* ================= expenses sheet ================= */
function expenseRowHtml(r){
  const t = recType(r), isBiz = t === "business";
  const groups = isBiz ? DB.categoryStore.businessGroups : DB.categoryStore.personalGroups;
  const cats = groups[r.group] || ["Other"];
  return `<tr data-id="${r.id}" class="${r.recurringId?"row-auto":""}">
    <td class="cell w-date"><input class="cell-input" type="month" data-field="date" value="${r.date.slice(0,7)}"></td>
    <td class="cell w-type"><select class="cell-input" data-field="type">${typeOptionsHtml(t)}</select></td>
    <td class="cell w-group"><select class="cell-input" data-field="group">${Object.keys(groups).map(g=>`<option ${r.group===g?'selected':''}>${escHtml(g)}</option>`).join("")}</select></td>
    <td class="cell w-cat"><select class="cell-input" data-field="category">${categoryOptionsHtml(cats, r.category)}</select></td>
    <td class="cell w-amt"><input class="cell-input num" type="number" step="0.01" data-field="amount" value="${r.amount||0}"></td>
    <td class="cell w-cur"><select class="cell-input" data-field="currency"><option ${r.currency==='USD'?'selected':''}>USD</option><option ${r.currency==='ILS'?'selected':''}>ILS</option></select></td>
    <td class="num usd-cell w-amt">${r.currency==="ILS" ? fmtMoney(expUSD(r),"USD") : ""}</td>
    <td class="cell w-notes"><input class="cell-input" data-field="notes" value="${escHtml(r.notes)}"></td>
    <td class="row-actions"><button class="icon-btn" title="Delete" onclick="deleteRecord('expense','${r.id}')">🗑</button></td>
  </tr>`;
}

function renderExpenseTable(){
  populateExpenseFilters();
  renderAssignBar();
  const search = (document.getElementById("expenseSearch").value||"").toLowerCase();
  let rows = filteredExpense().filter(r =>
    (!search || (r.group+r.category+r.notes+TYPE_LABEL[recType(r)]).toLowerCase().includes(search))
    && (!expenseColFilter.group || r.group===expenseColFilter.group)
    && (!expenseColFilter.category || r.category===expenseColFilter.category)
    && (!expenseColFilter.currency || r.currency===expenseColFilter.currency)
  );
  rows = applySort(rows, expenseSort);
  const thead = sortableTheadHtml(EXPENSE_COLUMNS, expenseSort, "expense");
  const tbody = rows.length ? rows.map(expenseRowHtml).join("") : `<tr class="empty-row"><td colspan="${EXPENSE_COLUMNS.length+1}">No matching records — click "New row" to get started</td></tr>`;
  document.getElementById("expenseTable").innerHTML = `<thead>${thead}</thead><tbody>${tbody}</tbody>`;
  const tot = document.getElementById("expenseTotals");
  if(tot) tot.innerHTML = rows.length ? `<b>${rows.length}</b> rows shown · total <b>${fmtMoney(sumBy(rows,expUSD),"USD")}</b> <span class="sheet-hint">(ILS rows converted at ${fxRate()} ₪ per USD)</span>` : "";
}

/* legacy private rows that were never tagged with Moti / Sivan: one-click assignment */
function unassignedCounts(){
  return {
    exp: DB.expenseRecords.filter(r=>recType(r)==="private").length,
    inc: DB.incomeRecords.filter(r=>recType(r)==="private").length,
  };
}
function renderAssignBar(){
  const bar = document.getElementById("assignBar");
  if(!bar) return;
  const c = unassignedCounts();
  if(!c.exp && !c.inc){ bar.innerHTML = ""; bar.style.display = "none"; return; }
  bar.style.display = "flex";
  bar.innerHTML = `<div><b>${c.exp}</b> private expenses${c.inc?` and <b>${c.inc}</b> private income rows`:""} aren't assigned to Moti or Sivan yet. They are counted separately until you assign them (change the <i>Type</i> cell on a row, or assign all at once):</div>
    <div class="assign-actions"><select id="assignTo"><option value="moti">Moti</option><option value="sivan">Sivan</option></select><button class="btn btn-primary" id="assignAllBtn">Assign all</button></div>`;
}
function assignAllPrivate(){
  const to = document.getElementById("assignTo").value;
  const c = unassignedCounts();
  if(!confirm(`Assign ${c.exp + c.inc} unassigned private rows to ${TYPE_SHORT[to]}?`)) return;
  [...DB.expenseRecords, ...DB.incomeRecords].forEach(r=>{ if(recType(r)==="private") applyType(r, to); });
  renderAll(); persist(); showToast("Assigned to " + TYPE_SHORT[to]);
}

/* ================= fixed (recurring) expenses ================= */
function fixedRowHtml(t){
  const ty = recType(t);
  const groups = ty === "business" ? DB.categoryStore.businessGroups : DB.categoryStore.personalGroups;
  const cats = groups[t.group] || ["Other"];
  return `<tr data-id="${t.id}">
    <td class="cell w-check"><input class="cell-check" type="checkbox" data-field="active" ${t.active?"checked":""} title="Active"></td>
    <td class="cell w-type"><select class="cell-input" data-field="type">${typeOptionsHtml(ty==="private"?"moti":ty)}</select></td>
    <td class="cell w-group"><select class="cell-input" data-field="group">${Object.keys(groups).map(g=>`<option ${t.group===g?'selected':''}>${escHtml(g)}</option>`).join("")}</select></td>
    <td class="cell w-cat"><select class="cell-input" data-field="category">${categoryOptionsHtml(cats, t.category)}</select></td>
    <td class="cell w-amt"><input class="cell-input num" type="number" step="0.01" min="0" data-field="amount" value="${t.amount||0}"></td>
    <td class="cell w-cur"><select class="cell-input" data-field="currency"><option ${t.currency==='USD'?'selected':''}>USD</option><option ${t.currency==='ILS'?'selected':''}>ILS</option></select></td>
    <td class="cell w-date"><input class="cell-input" type="month" data-field="startMonth" value="${t.startMonth}"></td>
    <td class="cell w-date"><input class="cell-input" type="month" data-field="endMonth" value="${t.endMonth}" title="Optional — leave empty to keep adding every month"></td>
    <td class="cell w-notes"><input class="cell-input" data-field="notes" value="${escHtml(t.notes)}"></td>
    <td class="row-actions"><button class="icon-btn" title="Delete" onclick="deleteRecord('fixed','${t.id}')">🗑</button></td>
  </tr>`;
}
const FIXED_COLUMNS = ["On","Type","Group","Category","Amount / month","Currency","From month","Until (optional)","Notes"];
function renderFixedTable(){
  const el = document.getElementById("fixedTable");
  if(!el) return;
  const rows = DB.recurringExpenses.length ? DB.recurringExpenses.map(fixedRowHtml).join("")
    : `<tr class="empty-row"><td colspan="${FIXED_COLUMNS.length+1}">No fixed expenses yet — add the ones that repeat every month and they'll be entered for you automatically</td></tr>`;
  const fc = document.getElementById("fixedCount");
  if(fc){ const on = DB.recurringExpenses.filter(t=>t.active).length; fc.textContent = DB.recurringExpenses.length ? "(" + on + " active)" : "(none yet)"; }
  el.innerHTML = `<thead><tr>${FIXED_COLUMNS.map(c=>`<th>${c}</th>`).join("")}<th></th></tr></thead><tbody>${rows}</tbody>`;
}

/* ================= payments tracking ================= */
function clientBookings(name){
  const n = String(name||"").trim().toLowerCase();
  return DB.incomeRecords.filter(r=>r.sector==="business" && String(r.client||"").trim().toLowerCase() === n);
}
function payableBookings(){
  return DB.incomeRecords.filter(r=>r.sector==="business" && r.clientType !== "influencer");
}
function paymentClientNames(){
  return Array.from(new Set(payableBookings().map(r=>(r.client||"").trim()).filter(Boolean))).sort((a,b)=>a.localeCompare(b));
}
function openPaymentsFor(clientName){
  paymentFilter.client = clientName || "";
  paymentFilter.search = "";
  const s = document.getElementById("paySearch"); if(s) s.value = "";
  renderPaymentsView();
  const tab = document.querySelector('.tab[data-view="payments"]');
  if(tab) tab.click();
  window.scrollTo({top:0, behavior:"smooth"});
}

function renderPaymentSummary(){
  const wrap = document.getElementById("payClientSummary");
  let bookings = payableBookings();
  if(paymentFilter.client) bookings = bookings.filter(b=>(b.client||"").trim().toLowerCase() === paymentFilter.client.toLowerCase());
  bookings = bookings.filter(inYear).sort((a,b)=>(b.checkIn||b.date).localeCompare(a.checkIn||a.date));
  if(!bookings.length){ wrap.innerHTML = `<div class="panel empty">No paying bookings${paymentFilter.client?" for this client":""} in this selection</div>`; return; }
  const sts = bookings.map(b=>[b, bookingStatus(b)]);
  const dueU = sumBy(sts, ([b,s])=>toUSD(s.due, b.currency)), paidU = sumBy(sts, ([b,s])=>toUSD(s.paid, b.currency));
  const rows = sts.map(([b,s])=>`<tr>
      <td><button type="button" class="name-link" data-pay-client="${escAttr(b.client)}">${escHtml(b.client||"(no name)")}</button></td>
      <td>${escHtml(b.villa)}</td><td>${escHtml(fmtStay(b))}</td>
      <td class="num">${fmtMoney(s.due,b.currency)}</td><td class="num">${fmtMoney(s.paid,b.currency)}</td>
      <td class="num" style="color:${s.balance>0.5?'var(--crit)':'var(--good)'}">${fmtMoney(s.balance,b.currency)}</td>
      <td>${statusPill(s)}</td></tr>`).join("");
  wrap.innerHTML = `<div class="panel">
    <div class="panel-title">${paymentFilter.client ? "Bookings of " + escHtml(paymentFilter.client) : "Bookings & balances"}</div>
    <div class="panel-sub">To collect = net price after commission · totals in USD: to collect <b>${fmtMoney(dueU,"USD")}</b> · paid <b>${fmtMoney(paidU,"USD")}</b> · outstanding <b>${fmtMoney(dueU-paidU,"USD")}</b></div>
    <div style="max-height:340px; overflow:auto;"><table class="mini-table"><thead><tr><th>Client</th><th>Villa</th><th>Stay</th><th class="num">To collect</th><th class="num">Paid</th><th class="num">Balance</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
  </div>`;
}

function paymentRowHtml(p, bookings){
  const known = bookings.some(b=>b.id === p.incomeId);
  const opts = bookings.map(b=>`<option value="${b.id}" ${p.incomeId===b.id?"selected":""}>${escHtml(bookingLabel(b))}</option>`).join("");
  const receipt = p.receiptUrl
    ? `<a class="receipt-link" href="${escAttr(p.receiptUrl)}" target="_blank" rel="noopener" title="${escAttr(p.receiptName||"Receipt")}">📎 ${escHtml(truncateLabel(p.receiptName||"Receipt",22))}</a> <button type="button" class="icon-btn" data-receipt-remove="${p.id}" title="Remove receipt link">✕</button>`
    : `<button type="button" class="btn btn-ghost receipt-btn" data-receipt-upload="${p.id}">⬆ Upload receipt</button>`;
  return `<tr data-id="${p.id}">
    <td class="cell w-date"><input class="cell-input" type="date" data-field="date" value="${p.date}"></td>
    <td class="cell w-booking"><select class="cell-input" data-field="incomeId">${known ? "" : `<option value="" selected>(choose booking)</option>`}${opts}</select></td>
    <td class="cell w-amt"><input class="cell-input num" type="number" step="0.01" data-field="amount" value="${p.amount||0}"></td>
    <td class="cell w-cur"><select class="cell-input" data-field="currency"><option ${p.currency==='USD'?'selected':''}>USD</option><option ${p.currency==='ILS'?'selected':''}>ILS</option></select></td>
    <td class="cell w-method"><input class="cell-input" list="methodList" data-field="method" value="${escHtml(p.method)}"></td>
    <td class="cell w-receipt receipt-cell">${receipt}</td>
    <td class="cell w-notes"><input class="cell-input" data-field="notes" value="${escHtml(p.notes)}"></td>
    <td class="row-actions"><button class="icon-btn" title="Delete" onclick="deleteRecord('payment','${p.id}')">🗑</button></td>
  </tr>`;
}

function filteredPayments(){
  const q = (paymentFilter.search||"").toLowerCase();
  const ids = paymentFilter.client ? new Set(clientBookings(paymentFilter.client).map(b=>b.id)) : null;
  return DB.paymentRecords.filter(p=>{
    if(ids && !ids.has(p.incomeId)) return false;
    if(q){
      const b = incomeById(p.incomeId);
      if(!((b?b.client:"") + p.method + p.notes + p.receiptName).toLowerCase().includes(q)) return false;
    }
    return true;
  }).sort((a,b)=>b.date.localeCompare(a.date));
}

function renderPaymentsView(){
  const sel = document.getElementById("payClientFilter");
  if(!sel) return;
  const names = paymentClientNames();
  if(paymentFilter.client && !names.some(n=>n.toLowerCase()===paymentFilter.client.toLowerCase())) names.push(paymentFilter.client);
  sel.innerHTML = `<option value="">All clients</option>` + names.map(n=>`<option value="${escHtml(n)}" ${n.toLowerCase()===paymentFilter.client.toLowerCase()?"selected":""}>${escHtml(n)}</option>`).join("");
  renderPaymentSummary();
  const bookings = payableBookings().sort((a,b)=>(a.client||"").localeCompare(b.client||"") || (a.checkIn||"").localeCompare(b.checkIn||""));
  const rows = filteredPayments();
  const thead = `<thead><tr><th>Payment date</th><th>Booking</th><th>Amount</th><th>Currency</th><th>Method</th><th>Receipt</th><th>Notes</th><th></th></tr></thead>`;
  const body = rows.length ? rows.map(p=>paymentRowHtml(p, bookings)).join("") : `<tr class="empty-row"><td colspan="8">No payments recorded${paymentFilter.client?" for this client":""} yet — click "New payment"</td></tr>`;
  document.getElementById("paymentTable").innerHTML = thead + `<tbody>${body}</tbody>`;
  const tot = document.getElementById("paymentTotals");
  if(tot) tot.innerHTML = rows.length ? `<b>${rows.length}</b> payments · <b>${fmtMoney(sumBy(rows,p=>toUSD(p.amount,p.currency)),"USD")}</b> received` : "";
}

function addPaymentRow(){
  const list = paymentFilter.client ? clientBookings(paymentFilter.client).filter(b=>b.clientType!=="influencer") : [];
  list.sort((a,b)=>(b.checkIn||"").localeCompare(a.checkIn||""));
  const target = list.find(b=>bookingStatus(b).balance > 0.5) || list[0];
  const rec = {
    id: uid("pay"), incomeId: target ? target.id : "", date: new Date().toISOString().slice(0,10),
    amount: target ? Math.max(0, Math.round(bookingStatus(target).balance*100)/100) : 0,
    currency: target ? target.currency : "USD", method: "", notes: "", receiptUrl: "", receiptName: "",
  };
  DB.paymentRecords.push(rec);
  renderPaymentsView(); renderIncomeTable(); persist();
  focusNewRow(rec.id, "paymentTable");
}

function handlePaymentChange(e){
  const el = e.target.closest("[data-field]");
  const tr = el && el.closest("tr[data-id]");
  if(!tr) return;
  const rec = DB.paymentRecords.find(p=>p.id === tr.dataset.id);
  if(!rec) return;
  switch(el.dataset.field){
    case "date": rec.date = el.value; break;
    case "incomeId": rec.incomeId = el.value; { const b = incomeById(el.value); if(b && !rec.amount) rec.currency = b.currency; } break;
    case "amount": rec.amount = parseFloat(el.value)||0; break;
    case "currency": rec.currency = el.value; break;
    case "method": rec.method = el.value; break;
    case "notes": rec.notes = el.value; break;
  }
  persist();
  renderPaymentSummary();
  renderIncomeTable();
}

/* ---- receipts: the file goes to a Google Drive folder through the Apps Script, only its link is stored here ---- */
let pendingReceiptFor = null;
function fileToBase64(blob){
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}
async function downscaleImage(file, maxSide){
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise((res, rej)=>c.toBlob(b=>b?res(b):rej(new Error("resize failed")), "image/jpeg", 0.85));
}
async function uploadReceipt(file, paymentId){
  const p = DB.paymentRecords.find(x=>x.id === paymentId);
  if(!p || !file) return;
  if(!scriptUrlConfigured()){ showToast("Connect the Google Sheet first — receipts are stored in Google Drive"); return; }
  if(file.size > MAX_RECEIPT_BYTES){ showToast("File is too large (max 8 MB)"); return; }
  setSaveStatus("busy", "Uploading receipt…");
  try{
    let blob = file, mime = file.type || "application/octet-stream";
    if(mime.startsWith("image/") && file.size > 1.2*1024*1024){
      try{ blob = await downscaleImage(file, 2200); mime = "image/jpeg"; }catch(e){ blob = file; }
    }
    const b = incomeById(p.incomeId);
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST", headers: {"Content-Type": "text/plain;charset=utf-8"},
      body: JSON.stringify({
        action: "uploadReceipt", client: b ? b.client : "", paymentDate: p.date,
        filename: file.name, mimeType: mime, dataBase64: await fileToBase64(blob),
      }),
    });
    const out = await res.json();
    if(!out || out.ok === false) throw new Error((out && out.error) || "upload failed");
    p.receiptUrl = out.url; p.receiptName = file.name;
    renderPaymentsView(); persist();
    showToast("Receipt uploaded");
  }catch(err){
    setSaveStatus("err", "Receipt upload failed — " + (err && err.message ? err.message : "try again"));
  }
}

/* ================= edit handlers ================= */
function refreshAggregates(){
  renderKPIs(); renderOverviewCharts();
}
function refreshYearOptions(){
  const sel = document.getElementById("yearFilter");
  const years = allYears();
  const keep = filters.year === "all" || years.includes(filters.year) ? filters.year : "all";
  filters.year = keep;
  sel.innerHTML = `<option value="all">All years</option>` + years.map(y=>`<option value="${y}" ${y===keep?"selected":""}>${y}</option>`).join("");
}

function handleIncomeChange(e){
  const el = e.target.closest("[data-field]");
  const tr = el && el.closest("tr[data-id]");
  if(!tr) return;
  const rec = DB.incomeRecords.find(r=>r.id===tr.dataset.id);
  if(!rec) return;
  const field = el.dataset.field;
  let rerenderRow = false, recalcGross = false;
  switch(field){
    case "type":
      applyType(rec, el.value);
      if(rec.sector === "personal"){ rec.category = DB.categoryStore.personalIncomeCategories[0]; rec.currency = "ILS"; }
      else { rec.category = "Villa booking"; if(!rec.villa) rec.villa = "Elu"; }
      rerenderRow = true; break;
    case "clientType":
      rec.clientType = el.value === "influencer" ? "influencer" : "paying";
      if(rec.clientType === "influencer") rec.grossAmount = 0;
      rerenderRow = true; break;
    case "date": rec.date = el.value; break;
    case "checkIn":
    case "checkOut": {
      rec[field] = el.value;
      const d = daysBetween(rec.checkIn, rec.checkOut);
      if(d != null && d > 0) rec.nights = d;
      if(field === "checkIn" && !rec.date) rec.date = el.value;
      recalcGross = true; rerenderRow = true; break;
    }
    case "client": rec.client = el.value; break;
    case "category": {
      if(el.value === NEW_CATEGORY_VALUE){
        const name = (prompt("New category name:")||"").trim();
        if(name){
          if(!DB.categoryStore.personalIncomeCategories.includes(name)) DB.categoryStore.personalIncomeCategories.push(name);
          rec.category = name;
        }
        rerenderRow = true;
      } else { rec.category = el.value; }
      break;
    }
    case "villa": rec.villa = el.value; break;
    case "nights": rec.nights = el.value===""?null:parseFloat(el.value); recalcGross = true; break;
    case "pricePerNight": rec.pricePerNight = el.value===""?null:parseFloat(el.value); recalcGross = true; break;
    case "platform": rec.platform = el.value; break;
    case "commissionRate": rec.commissionRate = el.value===""?null:parseFloat(el.value)/100; break;
    case "grossAmount": rec.grossAmount = parseFloat(el.value)||0; break;
    case "currency": rec.currency = el.value; break;
    case "notes": rec.notes = el.value; break;
  }
  /* the gross is only recomputed when you actually touch nights / price per night / the stay dates —
     editing any other cell never rewrites an amount that was entered by hand */
  if(recalcGross && rec.clientType !== "influencer" && rec.nights && rec.pricePerNight){
    rec.grossAmount = rec.nights * rec.pricePerNight;
    rerenderRow = true;
  }
  rec.netAmount = incNet(rec);
  if(rerenderRow){
    const wrap = document.createElement("tbody");
    wrap.innerHTML = incomeRowHtml(rec);
    tr.replaceWith(wrap.firstElementChild);
  } else {
    const net = tr.querySelector(".net-cell"); if(net && rec.sector === "business") net.textContent = fmtNum(incNet(rec));
    const pay = tr.querySelector(".pill-btn"); if(pay) pay.innerHTML = statusPill(bookingStatus(rec));
  }
  refreshYearOptions();
  persist();
  refreshAggregates();
  renderPaymentsView();
  const tot = document.getElementById("incomeTotals"); if(tot) renderIncomeTable_totalsOnly();
}
function renderIncomeTable_totalsOnly(){
  /* cheap refresh of the totals line without rebuilding the (possibly being-edited) table */
  const search = (document.getElementById("incomeSearch").value||"").toLowerCase();
  const rows = filteredIncome().filter(r=>r.sector==="business" &&
    (!search || (r.client+r.villa+r.platform+r.category+r.notes).toLowerCase().includes(search))
    && (!incomeColFilter.villa || r.villa===incomeColFilter.villa)
    && (!incomeColFilter.platform || r.platform===incomeColFilter.platform)
    && (!incomeColFilter.currency || r.currency===incomeColFilter.currency)
    && (!incomeColFilter.clientType || r.clientType===incomeColFilter.clientType));
  const tot = document.getElementById("incomeTotals");
  tot.innerHTML = rows.length
    ? `<b>${rows.length}</b> stays shown · gross <b>${fmtMoney(sumBy(rows,incGrossUSD),"USD")}</b> · net <b>${fmtMoney(sumBy(rows,incNetUSD),"USD")}</b> · <b>${fmtNum(sumBy(rows,r=>r.nights||0))}</b> nights <span class="sheet-hint">(USD, influencer stays count nights but no income)</span>` : "";
}

function groupsFor(t){ return t === "business" ? DB.categoryStore.businessGroups : DB.categoryStore.personalGroups; }

function handleExpenseChange(e){
  const el = e.target.closest("[data-field]");
  const tr = el && el.closest("tr[data-id]");
  if(!tr) return;
  const rec = DB.expenseRecords.find(r=>r.id===tr.dataset.id);
  if(!rec) return;
  const field = el.dataset.field;
  let rerenderRow = false;
  switch(field){
    case "type": {
      const wasBiz = rec.sector === "business";
      applyType(rec, el.value);
      if(wasBiz !== (rec.sector === "business")){
        const groups = groupsFor(rec.sector === "business" ? "business" : "x");
        rec.group = Object.keys(groups)[0];
        rec.category = groups[rec.group][0];
      }
      rerenderRow = true; break;
    }
    case "group": {
      rec.group = el.value;
      rec.category = (groupsFor(rec.sector==="business"?"business":"x")[rec.group]||["Other"])[0];
      rerenderRow = true; break;
    }
    case "category": {
      if(el.value === NEW_CATEGORY_VALUE){
        const name = (prompt("New category name:")||"").trim();
        if(name){
          const groups = groupsFor(rec.sector==="business"?"business":"x");
          if(!groups[rec.group]) groups[rec.group] = [];
          if(!groups[rec.group].includes(name)) groups[rec.group].push(name);
          rec.category = name;
        }
        rerenderRow = true;
      } else { rec.category = el.value; }
      break;
    }
    case "amount": rec.amount = parseFloat(el.value)||0; rerenderRow = true; break;
    case "currency": rec.currency = el.value; rerenderRow = true; break;
    case "notes": rec.notes = el.value; break;
    case "date": rec.date = el.value + "-01"; break;
  }
  if(rerenderRow){
    const wrap = document.createElement("tbody");
    wrap.innerHTML = expenseRowHtml(rec);
    tr.replaceWith(wrap.firstElementChild);
  }
  refreshYearOptions();
  persist();
  refreshAggregates();
  renderAssignBar();
}

function handleFixedChange(e){
  const el = e.target.closest("[data-field]");
  const tr = el && el.closest("tr[data-id]");
  if(!tr) return;
  const t = DB.recurringExpenses.find(x=>x.id === tr.dataset.id);
  if(!t) return;
  let rerenderRow = false;
  switch(el.dataset.field){
    case "active": t.active = el.checked; break;
    case "type": {
      const wasBiz = t.sector === "business";
      applyType(t, el.value);
      if(wasBiz !== (t.sector === "business")){
        const groups = groupsFor(t.sector==="business"?"business":"x");
        t.group = Object.keys(groups)[0]; t.category = groups[t.group][0];
      }
      rerenderRow = true; break;
    }
    case "group": t.group = el.value; t.category = (groupsFor(t.sector==="business"?"business":"x")[t.group]||["Other"])[0]; rerenderRow = true; break;
    case "category": {
      if(el.value === NEW_CATEGORY_VALUE){
        const name = (prompt("New category name:")||"").trim();
        if(name){
          const groups = groupsFor(t.sector==="business"?"business":"x");
          if(!groups[t.group]) groups[t.group] = [];
          if(!groups[t.group].includes(name)) groups[t.group].push(name);
          t.category = name;
        }
        rerenderRow = true;
      } else { t.category = el.value; }
      break;
    }
    case "amount": t.amount = parseFloat(el.value)||0; break;
    case "currency": t.currency = el.value; break;
    case "startMonth": t.startMonth = el.value; break;
    case "endMonth": t.endMonth = el.value; break;
    case "notes": t.notes = el.value; break;
  }
  if(rerenderRow){
    const wrap = document.createElement("tbody");
    wrap.innerHTML = fixedRowHtml(t);
    tr.replaceWith(wrap.firstElementChild);
  }
  const added = generateRecurring();
  if(added){
    renderExpenseTable(); refreshYearOptions(); refreshAggregates();
    showToast(added + (added===1 ? " monthly expense added" : " monthly expenses added") + " to the Expenses sheet");
  }
  persist();
}

function addIncomeRow(){
  const t = (filters.sector === "moti" || filters.sector === "sivan") ? filters.sector : "business";
  const rec = {
    id: uid("inc"), sector: "business", owner: "", date: new Date().toISOString().slice(0,10), checkIn: "", checkOut: "", clientType: "paying",
    client: "", villa: "Elu", nights: null, pricePerNight: null, platform: "", commissionRate: null, category: "Villa booking",
    grossAmount: 0, netAmount: 0, currency: "USD", notes: "",
  };
  if(t !== "business"){
    applyType(rec, t); rec.villa = ""; rec.category = DB.categoryStore.personalIncomeCategories[0]; rec.currency = "ILS";
  }
  DB.incomeRecords.push(rec);
  refreshYearOptions(); renderIncomeTable(); refreshAggregates(); persist();
  focusNewRow(rec.id, "incomeTable");
}
function addExpenseRow(){
  const t = (filters.sector === "moti" || filters.sector === "sivan") ? filters.sector : "business";
  const groups = groupsFor(t);
  const group = Object.keys(groups)[0];
  const rec = { id: uid("exp"), sector: "business", owner: "", date: new Date().toISOString().slice(0,7)+"-01", group, category: groups[group][0], amount: 0, currency: t==="business" ? "USD" : "ILS", notes: "", recurringId: "" };
  applyType(rec, t);
  DB.expenseRecords.push(rec);
  refreshYearOptions(); renderExpenseTable(); refreshAggregates(); persist();
  focusNewRow(rec.id, "expenseTable");
}
function addFixedRow(){
  const t = (filters.sector === "moti" || filters.sector === "sivan") ? filters.sector : "business";
  const groups = groupsFor(t);
  const group = Object.keys(groups)[0];
  const rec = { id: uid("fix"), sector: "business", owner: "", group, category: groups[group][0], amount: 0, currency: t==="business" ? "USD" : "ILS", startMonth: currentMonthKey(), endMonth: "", active: true, skipMonths: "", notes: "" };
  applyType(rec, t);
  DB.recurringExpenses.push(rec);
  document.getElementById("fixedBox").open = true;
  renderFixedTable(); persist();
  focusNewRow(rec.id, "fixedTable");
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
  if(type === "income"){
    const linked = DB.paymentRecords.filter(p=>p.incomeId === id).length;
    if(!confirm(linked ? `Delete this record and its ${linked} recorded payment${linked>1?"s":""}?` : "Delete this record?")) return;
    DB.incomeRecords = DB.incomeRecords.filter(r=>r.id!==id);
    DB.paymentRecords = DB.paymentRecords.filter(p=>p.incomeId!==id);
  } else if(type === "expense"){
    if(!confirm("Delete this record?")) return;
    const rec = DB.expenseRecords.find(r=>r.id===id);
    if(rec && rec.recurringId){
      /* remember the month so the fixed expense doesn't re-add it on the next load */
      const t = DB.recurringExpenses.find(x=>x.id===rec.recurringId);
      const m = rec.date.slice(0,7);
      if(t && String(t.skipMonths).split(",").indexOf(m) === -1) t.skipMonths = (t.skipMonths ? t.skipMonths + "," : "") + m;
    }
    DB.expenseRecords = DB.expenseRecords.filter(r=>r.id!==id);
  } else if(type === "payment"){
    if(!confirm("Delete this payment? (A receipt file already in Google Drive is not deleted.)")) return;
    DB.paymentRecords = DB.paymentRecords.filter(p=>p.id!==id);
  } else if(type === "fixed"){
    if(!confirm("Delete this fixed expense? Rows it already added stay in the Expenses sheet.")) return;
    DB.recurringExpenses = DB.recurringExpenses.filter(t=>t.id!==id);
  }
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
  setTimeout(()=>{ el.classList.remove("show"); setTimeout(()=>el.remove(), 300); }, 2600);
}

/* ================= wiring ================= */
function renderAll(){
  refreshYearOptions();
  renderKPIs();
  renderOverviewCharts();
  renderIncomeTable();
  renderExpenseTable();
  renderFixedTable();
  renderPaymentsView();
  const upd = DB.updatedAt ? new Date(DB.updatedAt).toLocaleString("en-US") : "";
  document.getElementById("updatedAt").textContent = upd ? "Last updated: " + upd : "";
}

function setupYearFilter(){
  const sel = document.getElementById("yearFilter");
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
   double-click exactly like a workbook. */
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
  const st = isBiz ? bookingStatus(r) : null;
  return [
    TYPE_LABEL[recType(r)],
    isBiz ? (r.client||"") : (r.category||""),
    isBiz ? (r.clientType === "influencer" ? "Influencer (complimentary)" : "Paying guest") : "",
    isBiz ? (r.villa||"") : "",
    isBiz ? (r.checkIn||"") : "",
    isBiz ? (r.checkOut||"") : "",
    isBiz ? (r.nights ?? "") : "",
    isBiz ? (r.pricePerNight ?? "") : "",
    isBiz ? (r.platform||"") : "",
    (isBiz && r.commissionRate!=null) ? round2(r.commissionRate*100) : "",
    round2(incGross(r)),
    isBiz ? round2(incNet(r)) : "",
    r.currency || "USD",
    r.date || "",
    isBiz ? st.label : "",
    r.notes || "",
  ];
}
function expenseRecordToRow(r){
  return [
    (r.date||"").slice(0,7),
    TYPE_LABEL[recType(r)],
    r.group || "",
    r.category || "",
    round2(r.amount||0),
    r.currency || "USD",
    round2(expUSD(r)),
    r.notes || "",
  ];
}
function paymentRecordToRow(p){
  const b = incomeById(p.incomeId);
  return [p.date||"", b ? b.client : "", b ? [b.villa, fmtStay(b)].filter(Boolean).join(" · ") : "", round2(p.amount), p.currency, p.method||"", p.receiptUrl||"", p.notes||""];
}
function incomeSheetRows(){
  return [INCOME_COLUMNS.map(c=>c.label), ...applySort(filteredIncome(), incomeSort).map(incomeRecordToRow)];
}
function expenseSheetRows(){
  return [EXPENSE_COLUMNS.map(c=>c.label), ...applySort(filteredExpense(), expenseSort).map(expenseRecordToRow)];
}
function paymentSheetRows(){
  return [["Payment date","Client","Booking","Amount","Currency","Method","Receipt link","Notes"], ...filteredPayments().map(paymentRecordToRow)];
}

function summarySheetRows(){
  const rows = [];
  const title = t => rows.push([t]);
  const blank = () => rows.push([]);
  const block = (heading, head, entries) => { rows.push([heading]); rows.push(head); entries.forEach(e=>rows.push(e)); blank(); };
  const p = computePnl();
  const inc = filteredIncome(), exp = filteredExpense();
  const bizInc = inc.filter(r=>r.sector==="business"), bizExp = exp.filter(r=>r.sector==="business");

  title("Summary — Magna Pacific (all amounts in USD, ILS converted at " + fxRate() + " ₪ per USD)"); blank();
  block("Profit & loss" + (filters.year!=="all" ? " · " + filters.year : ""), ["Line","USD"], [
    ["Gross income (paying stays)", round2(p.gross)],
    ["Commissions", round2(-p.commission)],
    ["Net income", round2(p.net)],
    ["Business expenses (villas)", round2(-p.bizExp)],
    ["Business profit", round2(p.profit)],
    ["Private expenses · Moti", round2(-p.moti)],
    ["Private expenses · Sivan", round2(-p.sivan)],
    ["Private expenses · not assigned", round2(-p.unassigned)],
    ["Total after private expenses", round2(p.total)],
  ]);
  const allBiz = DB.incomeRecords.filter(r=>r.sector==="business");
  const years = Array.from(new Set(allBiz.map(recYear).filter(Boolean))).sort();
  block("Income by year", ["Year","Gross USD","Net USD"], years.map(y=>[y, round2(sumBy(allBiz.filter(r=>recYear(r)===y), incGrossUSD)), round2(sumBy(allBiz.filter(r=>recYear(r)===y), incNetUSD))]));
  const chG = sumMap(bizInc, r=>channelOf(r.platform), incGrossUSD), chN = sumMap(bizInc, r=>channelOf(r.platform), incNetUSD);
  block("Income by channel", ["Channel","Gross USD","Net USD"], Object.keys(chG).sort().map(c=>[c, round2(chG[c]), round2(chN[c]||0)]));
  block("Income by villa", ["Villa","Gross USD"], sortedEntries(sumMap(bizInc.filter(r=>r.villa), r=>r.villa, incGrossUSD)).map(([k,v])=>[k, round2(v)]));
  block("Expenses by type", ["Type","USD"], sortedEntries((()=>{ const m={}; exp.forEach(r=>{ const t=TYPE_LABEL[recType(r)]; m[t]=(m[t]||0)+expUSD(r); }); return m; })()).map(([k,v])=>[k, round2(v)]));
  block("Business expenses by category", ["Category","USD"], sortedEntries(sumMap(bizExp, r=>r.category, expUSD)).map(([k,v])=>[k, round2(v)]));
  const months = Array.from(new Set([...bizInc.map(recMonth), ...bizExp.map(recMonth)].filter(Boolean))).sort();
  const g = sumMap(bizInc, recMonth, incGrossUSD), n = sumMap(bizInc, recMonth, incNetUSD), e = sumMap(bizExp, recMonth, expUSD);
  block("Monthly · Business", ["Month","Gross","Net","Expenses","Net − expenses"], months.map(m=>[monthLabel(m), round2(g[m]||0), round2(n[m]||0), round2(e[m]||0), round2((n[m]||0)-(e[m]||0))]));
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
function exportPaymentsCsv(){ saveCsv("magna-pacific-payments.csv", paymentSheetRows()); }
function exportAllCsv(){
  const rows = [];
  rows.push(["Summary sheet"], []);
  rows.push(...summarySheetRows());
  rows.push([], ["Income sheet"], []);
  rows.push(...incomeSheetRows());
  rows.push([], ["Expenses sheet"], []);
  rows.push(...expenseSheetRows());
  rows.push([], ["Payments sheet"], []);
  rows.push(...paymentSheetRows());
  saveCsv("magna-pacific-all.csv", rows);
}

function wireColFilter(id, state, key, renderFn){
  const el = document.getElementById(id);
  if(!el) return;
  el.addEventListener("change", ()=>{ state[key] = el.value; renderFn(); });
}

function handleIncomeClick(e){
  const open = e.target.closest("[data-open-payments]");
  if(open){
    const rec = incomeById(open.dataset.openPayments);
    if(rec) openPaymentsFor((rec.client || "").trim());
    return;
  }
  handleSortClick(e);
}
function handlePaymentClick(e){
  const up = e.target.closest("[data-receipt-upload]");
  if(up){
    pendingReceiptFor = up.dataset.receiptUpload;
    const fi = document.getElementById("receiptFile");
    fi.value = ""; fi.click();
    return;
  }
  const rm = e.target.closest("[data-receipt-remove]");
  if(rm){
    const p = DB.paymentRecords.find(x=>x.id === rm.dataset.receiptRemove);
    if(p && confirm("Remove the receipt link from this payment? (The file stays in Google Drive.)")){
      p.receiptUrl = ""; p.receiptName = "";
      renderPaymentsView(); persist();
    }
  }
}

function setupButtons(){
  document.getElementById("addIncomeBtn").addEventListener("click", addIncomeRow);
  document.getElementById("addExpenseBtn").addEventListener("click", addExpenseRow);
  document.getElementById("addFixedBtn").addEventListener("click", addFixedRow);
  document.getElementById("addPaymentBtn").addEventListener("click", addPaymentRow);
  document.getElementById("incomeSearch").addEventListener("input", renderIncomeTable);
  document.getElementById("expenseSearch").addEventListener("input", renderExpenseTable);
  document.getElementById("exportIncomeBtn").addEventListener("click", exportIncomeCsv);
  document.getElementById("exportExpenseBtn").addEventListener("click", exportExpenseCsv);
  document.getElementById("exportPaymentsBtn").addEventListener("click", exportPaymentsCsv);
  document.getElementById("exportAllBtn").addEventListener("click", exportAllCsv);

  wireColFilter("incomeVillaFilter", incomeColFilter, "villa", renderIncomeTable);
  wireColFilter("incomePlatformFilter", incomeColFilter, "platform", renderIncomeTable);
  wireColFilter("incomeCurrencyFilter", incomeColFilter, "currency", renderIncomeTable);
  wireColFilter("incomeClientTypeFilter", incomeColFilter, "clientType", renderIncomeTable);
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
  incomeTableEl.addEventListener("click", handleIncomeClick);

  const expenseTableEl = document.getElementById("expenseTable");
  expenseTableEl.addEventListener("change", handleExpenseChange);
  expenseTableEl.addEventListener("keydown", handleSheetKeydown);
  expenseTableEl.addEventListener("click", handleSortClick);

  const fixedEl = document.getElementById("fixedTable");
  fixedEl.addEventListener("change", handleFixedChange);
  fixedEl.addEventListener("keydown", handleSheetKeydown);

  const payEl = document.getElementById("paymentTable");
  payEl.addEventListener("change", handlePaymentChange);
  payEl.addEventListener("keydown", handleSheetKeydown);
  payEl.addEventListener("click", handlePaymentClick);
  document.getElementById("receiptFile").addEventListener("change", (e)=>{
    const f = e.target.files && e.target.files[0];
    if(f && pendingReceiptFor) uploadReceipt(f, pendingReceiptFor);
  });
  document.getElementById("payClientFilter").addEventListener("change", (e)=>{ paymentFilter.client = e.target.value; renderPaymentsView(); });
  document.getElementById("paySearch").addEventListener("input", (e)=>{ paymentFilter.search = e.target.value; renderPaymentsView(); });
  document.getElementById("payClearBtn").addEventListener("click", ()=>{ paymentFilter = {client:"", search:""}; document.getElementById("paySearch").value = ""; renderPaymentsView(); });
  document.getElementById("payClientSummary").addEventListener("click", (e)=>{
    const b = e.target.closest("[data-pay-client]");
    if(b){ paymentFilter.client = b.dataset.payClient; renderPaymentsView(); }
  });

  document.getElementById("assignBar").addEventListener("click", (e)=>{ if(e.target.id === "assignAllBtn") assignAllPrivate(); });
  document.getElementById("ovBusinessKpi").addEventListener("change", (e)=>{
    if(e.target.id !== "fxInput") return;
    const v = parseFloat(e.target.value);
    if(!(v > 0)){ e.target.value = fxRate(); return; }
    DB.settings.ilsPerUsd = v;
    persist(); renderAll();
  });
}

(async function init(){
  document.getElementById("platformList").innerHTML = PLATFORMS.map(p=>`<option value="${p}">`).join("");
  document.getElementById("methodList").innerHTML = PAYMENT_METHODS.map(m=>`<option value="${m}">`).join("");
  setupTabs(); setupSectorSeg(); setupButtons(); setupYearFilter();
  await loadData();
  const added = generateRecurring();
  renderAll();
  if(added){
    showToast(added + (added===1 ? " fixed expense added" : " fixed expenses added") + " for the months since they started");
    if(LOADED_FROM_SHEET) persist();
  }
})();
