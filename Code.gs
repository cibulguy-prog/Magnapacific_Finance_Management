/**
 * Magna Pacific — Google Sheets backend (Apps Script Web App)
 *
 * This turns a Google Sheet into a tiny JSON API the web app talks to:
 *   GET  <web app url>            -> returns the whole dataset as JSON
 *   POST <web app url>  (JSON body with incomeRecords / expenseRecords / categoryStore)
 *                                 -> overwrites the sheet with that dataset
 *
 * SETUP (one time):
 *   1. Create a new Google Sheet (or open the one you want to use).
 *   2. Extensions > Apps Script.
 *   3. Delete the default empty Code.gs content and paste THIS file's content in.
 *   4. Add a second file (+ icon > Script) named "SeedData.gs" and paste the content
 *      of the SeedData.gs file you were given.
 *   5. In the Apps Script editor, select the "importSeed" function from the function
 *      dropdown (top toolbar) and click Run once. This loads the historical data into
 *      three tabs: Income, Expenses, Categories. Approve the permission prompt when asked.
 *   6. Deploy > New deployment > type: Web app.
 *        Execute as: Me
 *        Who has access: Anyone with the link
 *      Click Deploy, authorize again if asked, then copy the "Web app URL".
 *   7. Paste that URL into APPS_SCRIPT_URL near the top of app.js.
 *
 * Re-running "Deploy > Manage deployments > Edit > New version" is needed any time you
 * change this code after the first deployment (the URL stays the same).
 */

const SHEET_INCOME = "Income";
const SHEET_EXPENSES = "Expenses";
const SHEET_CATEGORIES = "Categories";

const INCOME_HEADERS = ["id","sector","date","client","villa","nights","pricePerNight","platform","commissionRate","category","grossAmount","netAmount","currency","notes"];
const EXPENSE_HEADERS = ["id","sector","date","group","category","amount","currency","notes"];
const CATEGORY_HEADERS = ["sector","group","category"];

function getSheet_(name, headers){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if(!sh){
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

function sheetToObjects_(sh, headers){
  const values = sh.getDataRange().getValues();
  if(values.length < 2) return [];
  return values.slice(1)
    .filter(r => r.some(v => v !== "" && v !== null))
    .map(r => {
      const obj = {};
      headers.forEach((h,i) => { obj[h] = r[i]; });
      return obj;
    });
}

function objectsToSheet_(sh, headers, objects){
  sh.clearContents();
  sh.appendRow(headers);
  if(objects.length){
    const rows = objects.map(o => headers.map(h => (o[h] === undefined || o[h] === null) ? "" : o[h]));
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sh.setFrozenRows(1);
}

function normalizeDate_(v){
  if(Object.prototype.toString.call(v) === "[object Date]"){
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(v || "");
}
function numOrNull_(v){
  if(v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function normalizeIncomeRecord_(r){
  const gross = Number(r.grossAmount) || 0;
  return {
    id: String(r.id || Utilities.getUuid()),
    sector: (r.sector === "personal") ? "personal" : "business",
    date: normalizeDate_(r.date),
    client: r.client || "",
    villa: r.villa || "",
    nights: numOrNull_(r.nights),
    pricePerNight: numOrNull_(r.pricePerNight),
    platform: r.platform || "",
    commissionRate: numOrNull_(r.commissionRate),
    category: r.category || "",
    grossAmount: gross,
    netAmount: Number(r.netAmount) || gross,
    currency: r.currency || "USD",
    notes: r.notes || "",
  };
}
function normalizeExpenseRecord_(r){
  return {
    id: String(r.id || Utilities.getUuid()),
    sector: (r.sector === "personal") ? "personal" : "business",
    date: normalizeDate_(r.date),
    group: r.group || "",
    category: r.category || "",
    amount: Number(r.amount) || 0,
    currency: r.currency || "USD",
    notes: r.notes || "",
  };
}

/* the app's categoryStore is a nested object; on the sheet it's flattened into
   (sector, group, category) rows so it's just as editable as everything else —
   personal income categories use the marker group "Income" */
function buildCategoryStore_(catRows){
  const businessGroups = {}, personalGroups = {};
  const personalIncomeCategories = [];
  catRows.forEach(r=>{
    const sector = String(r.sector || "").toLowerCase();
    const group = String(r.group || "");
    const category = String(r.category || "");
    if(!category) return;
    if(sector === "personal" && group === "Income"){
      if(personalIncomeCategories.indexOf(category) === -1) personalIncomeCategories.push(category);
      return;
    }
    const target = sector === "personal" ? personalGroups : businessGroups;
    if(!target[group]) target[group] = [];
    if(target[group].indexOf(category) === -1) target[group].push(category);
  });
  return { businessGroups: businessGroups, personalGroups: personalGroups, personalIncomeCategories: personalIncomeCategories };
}
function categoryStoreToRows_(store){
  const rows = [];
  Object.keys(store.businessGroups || {}).forEach(g=>{
    (store.businessGroups[g] || []).forEach(c=> rows.push({sector:"business", group:g, category:c}));
  });
  Object.keys(store.personalGroups || {}).forEach(g=>{
    (store.personalGroups[g] || []).forEach(c=> rows.push({sector:"personal", group:g, category:c}));
  });
  (store.personalIncomeCategories || []).forEach(c=> rows.push({sector:"personal", group:"Income", category:c}));
  return rows;
}

function jsonOut_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e){
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try{
    const incomeSh = getSheet_(SHEET_INCOME, INCOME_HEADERS);
    const expenseSh = getSheet_(SHEET_EXPENSES, EXPENSE_HEADERS);
    const catSh = getSheet_(SHEET_CATEGORIES, CATEGORY_HEADERS);

    const incomeRecords = sheetToObjects_(incomeSh, INCOME_HEADERS).map(normalizeIncomeRecord_);
    const expenseRecords = sheetToObjects_(expenseSh, EXPENSE_HEADERS).map(normalizeExpenseRecord_);
    const categoryStore = buildCategoryStore_(sheetToObjects_(catSh, CATEGORY_HEADERS));

    return jsonOut_({
      version: 1,
      updatedAt: new Date().toISOString(),
      incomeRecords: incomeRecords,
      expenseRecords: expenseRecords,
      categoryStore: categoryStore,
    });
  } catch(err){
    return jsonOut_({ ok:false, error:String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doPost(e){
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try{
    const body = JSON.parse(e.postData.contents);
    if(!body || !Array.isArray(body.incomeRecords) || !Array.isArray(body.expenseRecords)){
      return jsonOut_({ ok:false, error:"bad_request: expected incomeRecords[] and expenseRecords[]" });
    }
    const incomeSh = getSheet_(SHEET_INCOME, INCOME_HEADERS);
    const expenseSh = getSheet_(SHEET_EXPENSES, EXPENSE_HEADERS);
    const catSh = getSheet_(SHEET_CATEGORIES, CATEGORY_HEADERS);

    objectsToSheet_(incomeSh, INCOME_HEADERS, body.incomeRecords.map(normalizeIncomeRecord_));
    objectsToSheet_(expenseSh, EXPENSE_HEADERS, body.expenseRecords.map(normalizeExpenseRecord_));
    if(body.categoryStore){
      objectsToSheet_(catSh, CATEGORY_HEADERS, categoryStoreToRows_(body.categoryStore));
    }
    return jsonOut_({ ok:true, updatedAt: new Date().toISOString() });
  } catch(err){
    return jsonOut_({ ok:false, error:String(err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Run this ONCE (from the Apps Script editor's function dropdown) against a brand-new,
 * empty spreadsheet to load the historical starting data from SeedData.gs.
 * Safe to re-run — it always overwrites the three tabs from the seed, so don't run it
 * again after you've started editing live data unless you mean to reset back to the seed.
 */
function importSeed(){
  const incomeSh = getSheet_(SHEET_INCOME, INCOME_HEADERS);
  const expenseSh = getSheet_(SHEET_EXPENSES, EXPENSE_HEADERS);
  const catSh = getSheet_(SHEET_CATEGORIES, CATEGORY_HEADERS);

  objectsToSheet_(incomeSh, INCOME_HEADERS, SEED_DATA.incomeRecords.map(normalizeIncomeRecord_));
  objectsToSheet_(expenseSh, EXPENSE_HEADERS, SEED_DATA.expenseRecords.map(normalizeExpenseRecord_));
  objectsToSheet_(catSh, CATEGORY_HEADERS, categoryStoreToRows_(SEED_DATA.categoryStore));

  Logger.log("Imported %s income rows, %s expense rows, %s category rows",
    SEED_DATA.incomeRecords.length, SEED_DATA.expenseRecords.length,
    categoryStoreToRows_(SEED_DATA.categoryStore).length);
}
