/*****************************************************************
 * PatchinPennies — Google Apps Script backend  (v2: Money update)
 * Paste this over your existing Code.gs (Extensions → Apps Script),
 * then run setup() ONCE from the editor, then run installTriggers() ONCE.
 *
 * Your existing Transactions / Income / Goals / Recurring data is
 * preserved. setup() only adds sheets & columns that don't exist,
 * migrates old debt-type goals into the new Debts sheet, and seeds
 * your real debts + starter accounts if those sheets are empty.
 *****************************************************************/

const SPREADSHEET_ID = "1EfHBQsdm9b9Qh-k18kqjWiwN2aUsJO_hI3_qJyTvCLM";
const TX_SHEET      = "Transactions";
const INCOME_SHEET  = "Income";
const GOALS_SHEET   = "Goals";
const RECUR_SHEET   = "Recurring";      // recurring EXPENSES that auto-log on the 1st
const ACCT_SHEET    = "Accounts";       // real accounts (checking, HYSA, 401k…)
const RECON_SHEET   = "Reconciles";     // balance check-in history
const DEBT_SHEET    = "Debts";          // debts with live balances
const DEBTPAY_SHEET = "DebtPayments";   // payment history per debt
const FLOWS_SHEET   = "RecurringFlows"; // recurring investments / divestments
const CARDCHG_SHEET = "CardCharges";    // queued credit-card charges (holding tank)
const CONTRIB_SHEET = "Contributions";  // money moved into accounts/goals (or out)
const CAT_SHEET     = "Categories";     // spending categories + monthly budgets (shared across devices)
const DRIVE_FOLDER  = "PatchinPennies Receipts";

// People to email the monthly recap to:
const RECAP_EMAILS = ["ateeq8474@gmail.com"]; // add Celeste's email here

let _ssCache=null;
function ss(){ if(!_ssCache) _ssCache=SpreadsheetApp.openById(SPREADSHEET_ID); return _ssCache; }
function sheet(name){ const s=ss().getSheetByName(name); return s; }

// One round trip for everything the app needs on load (Apps Script is slow per-request)
function getAll(month,year){
  const d=getDebts();
  return {
    transactions: getTransactions(month,year).transactions,
    goals: getGoals().goals,
    income: getIncome(month,year).income,
    accounts: getAccounts().accounts,
    debts: d.debts,
    payments: d.payments,
    flows: getFlows().flows,
    contributions: getContributions(month,year).contributions,
    cardCharges: getCardCharges().charges,
    recurringBills: getRecurringBills().bills,
    categories: getCategories().categories,
    insights: computeInsights_(month,year)
  };
}

// Every transaction and income row, all months. The client normally holds one
// month; the per-person spending view needs "last 3 months" and "this year", so
// it pulls this once and caches it. Trimmed to the fields those views read.
function getLedger(){
  const tx=rowsAsObjects(sheet(TX_SHEET)).map(function(t){
    return {ID:t.ID,Date:fmtDate(t.Date),Description:t.Description,Category:t.Category,
            PaidBy:t.PaidBy,Amount:num(t.Amount),TxType:t.TxType,Need:t.Need||"",Sub:t.Sub||""};
  }).filter(function(t){ return t.Date; });
  const inc=rowsAsObjects(sheet(INCOME_SHEET)).map(function(i){
    return {ID:i.ID,Date:fmtDate(i.Date),Description:i.Description,Source:i.Source,Amount:num(i.Amount)};
  }).filter(function(i){ return i.Date; });
  return {transactions:tx, income:inc};
}

// Cross-month context the client can't compute from a single month's rows:
// last-6-months income/expense series and the previous month's per-category
// totals (for "vs last month" deltas). One read of each sheet.
function computeInsights_(month,year){
  const m0=+month||(new Date().getMonth()+1), y0=+year||(new Date().getFullYear());
  let pm=m0-1, py=y0; if(pm<1){pm=12;py--;}
  const buckets={}; const prevCat={};
  const key=(y,m)=>y+"-"+m;
  rowsAsObjects(sheet(TX_SHEET)).forEach(t=>{
    const d=(t.Date instanceof Date)?t.Date:new Date(t.Date); if(isNaN(d)) return;
    const y=d.getFullYear(), m=d.getMonth()+1;
    (buckets[key(y,m)]=buckets[key(y,m)]||{exp:0,inc:0}).exp+=num(t.Amount);
    if(y===py&&m===pm){ const c=t.Category||"Personal/Misc"; prevCat[c]=(prevCat[c]||0)+num(t.Amount); }
  });
  rowsAsObjects(sheet(INCOME_SHEET)).forEach(i=>{
    const d=(i.Date instanceof Date)?i.Date:new Date(i.Date); if(isNaN(d)) return;
    const k=key(d.getFullYear(),d.getMonth()+1);
    (buckets[k]=buckets[k]||{exp:0,inc:0}).inc+=num(i.Amount);
  });
  const monthly=[];
  for(let i=5;i>=0;i--){
    let m=m0-i, y=y0; while(m<1){m+=12;y--;}
    const b=buckets[key(y,m)]||{exp:0,inc:0};
    monthly.push({month:m,year:y,expenses:Math.round(b.exp*100)/100,income:Math.round(b.inc*100)/100});
  }
  return {prevCategoryTotals:prevCat, monthly:monthly};
}

// ─── Router ─────────────────────────────────────────────────────────────────
function doGet(e){
  const a=(e.parameter.action)||"getTransactions";
  let r;
  try{
    maybeMigrate_();
    switch(a){
      case "getAll":             r=getAll(e.parameter.month,e.parameter.year); break;
      case "getTransactions":    r=getTransactions(e.parameter.month,e.parameter.year); break;
      case "getLedger":          r=getLedger(); break;
      case "addTransaction":     r=addTransaction(e.parameter); break;
      case "updateTransaction":  r=updateTransaction(e.parameter); break;
      case "deleteTransaction":  r=deleteTransaction(e.parameter.id); break;
      case "seedFixed":          r=seedFixed(e.parameter.month,e.parameter.year); break;
      case "getIncome":          r=getIncome(e.parameter.month,e.parameter.year); break;
      case "addIncome":          r=addIncome(e.parameter); break;
      case "deleteIncome":       r=deleteIncome(e.parameter.id); break;
      case "getGoals":           r=getGoals(); break;
      case "addGoal":            r=addGoal(e.parameter); break;
      case "updateGoalProgress": r=updateGoalProgress(e.parameter); break;
      case "deleteGoal":         r=deleteGoal(e.parameter.goalId); break;
      // Accounts
      case "getAccounts":        r=getAccounts(); break;
      case "addAccount":         r=addAccount(e.parameter); break;
      case "updateAccount":      r=updateAccount(e.parameter); break;
      case "deleteAccount":      r=deleteAccount(e.parameter.id); break;
      case "reconcileAccount":   r=reconcileAccount(e.parameter); break;
      // Debts
      case "getDebts":           r=getDebts(); break;
      case "addDebt":            r=addDebt(e.parameter); break;
      case "updateDebt":         r=updateDebt(e.parameter); break;
      case "deleteDebt":         r=deleteDebt(e.parameter.id); break;
      case "logDebtPayment":     r=logDebtPayment(e.parameter); break;
      // Recurring flows (investments / divestments)
      case "getFlows":           r=getFlows(); break;
      case "addFlow":            r=addFlow(e.parameter); break;
      case "updateFlow":         r=updateFlow(e.parameter); break;
      case "deleteFlow":         r=deleteFlow(e.parameter.id); break;
      case "runFlowsNow":        r=runFlows(new Date()); break;
      // Recurring bills (rent, subscriptions, etc.)
      case "getRecurringBills":    r=getRecurringBills(); break;
      case "addRecurringBill":     r=addRecurringBill(e.parameter); break;
      case "updateRecurringBill":  r=updateRecurringBill(e.parameter); break;
      case "deleteRecurringBill":  r=deleteRecurringBill(e.parameter.id); break;
      case "runRecurringBillsNow": r=runRecurringBills(new Date()); break;
      // Categories & budgets (shared across devices)
      case "getCategories":      r=getCategories(); break;
      case "addCategory":        r=addCategory(e.parameter); break;
      case "updateCategory":     r=updateCategory(e.parameter); break;
      case "deleteCategory":     r=deleteCategory(e.parameter.id); break;
      // Contributions
      case "getContributions":   r=getContributions(e.parameter.month,e.parameter.year); break;
      case "addContribution":    r=addContribution(e.parameter); break;
      // Credit card
      case "getCardCharges":     r=getCardCharges(); break;
      case "chargeCard":         r=chargeCard(e.parameter); break;
      case "payCard":            r=payCard(e.parameter); break;
      case "ping":               r={ok:true,version:4}; break;
      case "runSetup":           r={result:setup()}; break; // safe to re-run; only adds missing sheets/columns
      default:                   r={error:"Unknown action: "+a};
    }
  }catch(err){ r={error:String(err)}; }
  return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e){
  let r;
  try{
    const b=JSON.parse(e.postData.contents);
    if(b.action==="saveReceipt") r=saveReceiptToDrive(b.base64,b.filename,b.mediaType);
    else r={error:"Unknown POST action"};
  }catch(err){ r={error:String(err)}; }
  return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON);
}

// ─── Setup (safe to re-run) ─────────────────────────────────────────────────
function setup(){
  const book=ss();
  // Transactions (+ new Need / Sub columns)
  let tx=book.getSheetByName(TX_SHEET);
  if(!tx){ tx=book.insertSheet(TX_SHEET); }
  if(tx.getLastRow()===0){
    tx.appendRow(["ID","Date","Description","Category","PaidBy","Amount","TxType","Notes","ReceiptURL","Need","Sub"]);
    tx.getRange(1,1,1,11).setFontWeight("bold");
  } else ensureCols(tx,["ID","Date","Description","Category","PaidBy","Amount","TxType","Notes","ReceiptURL","Need","Sub"]);
  // Income
  let inc=book.getSheetByName(INCOME_SHEET);
  if(!inc){ inc=book.insertSheet(INCOME_SHEET); inc.appendRow(["ID","Date","Description","Source","Amount","Notes"]); inc.getRange(1,1,1,6).setFontWeight("bold"); }
  // Goals
  let gl=book.getSheetByName(GOALS_SHEET);
  if(!gl){ gl=book.insertSheet(GOALS_SHEET); gl.appendRow(["ID","Name","Target","Saved","Type","TargetDate","Notes","Created"]); gl.getRange(1,1,1,8).setFontWeight("bold"); }
  else ensureCols(gl,["ID","Name","Target","Saved","Type","TargetDate","Notes","Created"]);
  // Recurring expense template
  let rc=book.getSheetByName(RECUR_SHEET);
  if(!rc){
    rc=book.insertSheet(RECUR_SHEET);
    rc.appendRow(["ID","Description","Category","PaidBy","Amount","Active","Frequency","DayOfMonth","LastRun"]);
    rc.getRange(1,1,1,9).setFontWeight("bold");
    [["Rent","Fixed","Both",1800,"yes"],
     ["Internet","Utilities","Ateeq",95,"yes"],
     ["Spotify – Ateeq","Subscriptions","Ateeq",20,"yes"],
     ["Spotify – Celeste","Subscriptions","Celeste",20,"yes"],
     ["Planned Parenthood","Donation","Celeste",10,"yes"],
     ["Patches Food Chewy","Patches' Expenses","Celeste",98.59,"yes"],
     ["Gym Membership","Health","Ateeq",20,"yes"],
     ["CCC School Tuition","Personal/Misc","Celeste",111.87,"yes"]].forEach(r=>rc.appendRow([uuid(),r[0],r[1],r[2],r[3],r[4],"monthly",1,""]));
  } else {
    ensureCols(rc,["ID","Description","Category","PaidBy","Amount","Active","Frequency","DayOfMonth","LastRun"]);
    backfillIds(rc);
  }
  // Categories & budgets (shared so both people see the same picker).
  // Kind: 'bill' = fixed/recurring commitments, 'flex' = everyday spending choices.
  let cat=book.getSheetByName(CAT_SHEET);
  if(!cat){
    cat=book.insertSheet(CAT_SHEET);
    cat.appendRow(["ID","Name","Icon","Color","Budget","Kind"]);
    cat.getRange(1,1,1,6).setFontWeight("bold");
    [["Groceries","🛒","#93c5fd",600,"flex"],["Dining Out","🍽️","#fdba74",200,"flex"],["Entertainment","🎮","#c4b5fd",150,"flex"],
     ["Transportation","🚗","#6ee7b7",100,"flex"],["Utilities","💡","#fde68a",150,"bill"],["Health","🏥","#fda4b8",100,"flex"],
     ["Shopping","🛍️","#f0abfc",150,"flex"],["Personal/Misc","📦","#f9a8d4",100,"flex"],["Patches' Expenses","🐱","#fbcfe8",75,"flex"],
     ["Rent","🏠","#a5b4fc",1800,"bill"],["Subscriptions","📱","#e879f9",0,"bill"],["Donation","❤️","#fca5a5",0,"bill"]
    ].forEach(r=>cat.appendRow([uuid(),r[0],r[1],r[2],r[3],r[4]]));
  } else ensureCols(cat,["ID","Name","Icon","Color","Budget","Kind"]);
  // Accounts
  let ac=book.getSheetByName(ACCT_SHEET);
  const acNew=!ac;
  if(!ac){ ac=book.insertSheet(ACCT_SHEET); ac.appendRow(["ID","Name","Owner","Type","Balance","APY","LastReconciled","Created","Limit"]); ac.getRange(1,1,1,9).setFontWeight("bold"); }
  else ensureCols(ac,["ID","Name","Owner","Type","Balance","APY","LastReconciled","Created","Limit"]);
  if(acNew || ac.getLastRow()<2){
    [["Celeste's HYSA","Celeste","hysa",0,4.2,0],
     ["Checking","Both","checking",0,0,0],
     ["Roth IRA — Ateeq","Ateeq","investment",0,0,0],
     ["401k — Celeste","Celeste","retirement",0,0,0],
     ["401k — Ateeq","Ateeq","retirement",0,0,0],
     ["Credit Card - Ateeq","Ateeq","credit",0,0,1000]].forEach(r=>{
      ac.appendRow([Utilities.getUuid(),r[0],r[1],r[2],r[3],r[4],"",todayStr(),r[5]]);
    });
  }
  // Reconciles
  let re=book.getSheetByName(RECON_SHEET);
  if(!re){ re=book.insertSheet(RECON_SHEET); re.appendRow(["ID","AccountID","Date","StatedBalance","PriorBalance","Drift"]); re.getRange(1,1,1,6).setFontWeight("bold"); }
  // Debts + payments
  let db=book.getSheetByName(DEBT_SHEET);
  const dbNew=!db;
  if(!db){ db=book.insertSheet(DEBT_SHEET); db.appendRow(["ID","Name","Owner","StartBalance","Balance","APR","MinPayment","HighPriority","Created"]); db.getRange(1,1,1,9).setFontWeight("bold"); }
  let dp=book.getSheetByName(DEBTPAY_SHEET);
  if(!dp){ dp=book.insertSheet(DEBTPAY_SHEET); dp.appendRow(["ID","DebtID","Date","Amount","PaidBy","Notes"]); dp.getRange(1,1,1,6).setFontWeight("bold"); }
  // migrate old debt-type goals → Debts
  migrateDebtGoals(gl,db);
  // seed real debts if Debts still empty
  if(db.getLastRow()<2){
    [["1-01 Direct Loan","Celeste",3626.77,200],
     ["1-02 Direct Loan","Celeste",2050.97,200],
     ["1-04 Direct Loan","Celeste",5697.60,200],
     ["1-05 Direct Loan","Celeste",2797.01,50],
     ["1-06 Direct Loan","Celeste",1639.86,50],
     ["Team Health","Celeste",400,400],
     ["Sentara","Celeste",380,0],
     ["Patient First","Celeste",370,0]].forEach(r=>{
      db.appendRow([Utilities.getUuid(),r[0],r[1],r[2],r[2],0,r[3],r[0]==="Team Health"?"yes":"no",todayStr()]);
    });
  }
  // Recurring flows + contributions
  let fl=book.getSheetByName(FLOWS_SHEET);
  if(!fl){ fl=book.insertSheet(FLOWS_SHEET); fl.appendRow(["ID","Name","FlowType","Amount","Owner","AccountID","GoalID","DayOfMonth","Active","Created","Frequency","LastRun"]); fl.getRange(1,1,1,12).setFontWeight("bold"); }
  else ensureCols(fl,["ID","Name","FlowType","Amount","Owner","AccountID","GoalID","DayOfMonth","Active","Created","Frequency","LastRun"]);
  // Credit-card charge queue (holding tank)
  let cc=book.getSheetByName(CARDCHG_SHEET);
  if(!cc){ cc=book.insertSheet(CARDCHG_SHEET); cc.appendRow(["ID","AccountID","Date","Description","Category","PaidBy","Amount","Settled","Notes"]); cc.getRange(1,1,1,9).setFontWeight("bold"); }
  let co=book.getSheetByName(CONTRIB_SHEET);
  if(!co){ co=book.insertSheet(CONTRIB_SHEET); co.appendRow(["ID","Date","FlowType","Amount","AccountID","GoalID","Owner","Notes","Source"]); co.getRange(1,1,1,9).setFontWeight("bold"); }
  return "Setup complete. Now run installTriggers() once (safe to re-run too).";
}

// ─── One-time data migrations (guarded; run lazily on first request) ─────────
// Each migration runs exactly once per deployment of its key, protected by a
// script lock so two devices hitting the API simultaneously can't double-run it.
function maybeMigrate_(){
  const props=PropertiesService.getScriptProperties();
  const pending=MIGRATIONS_.filter(m=>!props.getProperty(m.key));
  if(!pending.length) return;
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(20000)) return; // someone else is running them; they'll finish
  try{
    MIGRATIONS_.forEach(m=>{
      if(props.getProperty(m.key)) return;
      m.run();
      props.setProperty(m.key, todayStr());
    });
  } finally { lock.releaseLock(); }
}
var MIGRATIONS_=[
  {key:"mig_2026_08_cleanup", run:function(){ mig_2026_08_cleanup_(); }},
  // Statement-scan rows imported before the client defaulted to the cardholder
  // are still sitting on "Both". Re-run the reattribution so anything scanned
  // between the first migration and this deploy gets corrected too.
  {key:"mig_2026_08_rescan_owner", run:function(){
    reattributeByNote_(sheet(TX_SHEET),"Imported from statement scan","PaidBy","Ateeq");
    reattributeByNote_(sheet(INCOME_SHEET),"Imported from statement scan","Source","Ateeq");
  }},
  // Ateeq's second card ($5,000 limit), requested 2026-08-27. Fixed ID so a
  // re-run can never create a duplicate; skipped entirely if it already exists.
  // Ateeq's paycheck was in the Income sheet twice: once typed in by hand
  // ("WISE"), once picked up by the statement scanner ("Gusto Payroll", the
  // payroll processor behind it). Same dates, amounts within a dollar or ten.
  // August income read $5,798 when it was really $3,833, which made a $706
  // deficit look like a $1,259 surplus. Keep the scanned rows - the bank
  // statement is ground truth and the manual figures were rounded - but move
  // them off "Both", since this is Ateeq's salary and not shared income.
  {key:"mig_2026_08_dedupe_income", run:function(){
    ["aa9f5cbe-9d4d-4d7e-99f6-feccc3c12f71",   // WISE 7/31 $3,089.00 -> Gusto $3,089.95
     "8d974705-24fa-4b67-a458-25ae5bb358aa"]   // WISE 8/14 $1,955.00 -> Gusto $1,965.18
      .forEach(function(id){ deleteRowById(sheet(INCOME_SHEET),id); });
    ["e106a788-0f3a-406c-988e-95001d3ceb98",
     "9b10f95c-f65e-46b5-a75c-1474a294541d"]
      .forEach(function(id){ updateRowById(sheet(INCOME_SHEET),id,{Source:"Ateeq"}); });
    // Three rows shared one ID (a scan import that ran twice). Identical IDs are
    // always a bug - no legitimate row can collide - so collapse to the first.
    dedupeById_(sheet(TX_SHEET));
  }},
  {key:"mig_2026_08_add_5k_card", run:function(){
    const ID="c5000a7e-0000-4000-8000-a7e59c5000ca";
    if(getCell(sheet(ACCT_SHEET),ID,"ID")!==null) return;
    addAccount({id:ID,name:"Ateeq's $5K Card",owner:"Ateeq",type:"credit",balance:0,apy:0,limit:5000});
  }}
];

// Cleanup agreed with Ateeq on 2026-08-27:
//  - $900 Zelle to Celeste was his half of rent -> already covered by the $1800
//    "Both" rent rows, so it double-counted rent; delete it.
//  - Two of the three duplicate Internet $88.73 rows on 8/14; keep one.
//  - July card payoffs should total exactly $1000: delete the $874.04 partial
//    duplicate and the $870 "Credit card" expense (payments aren't spending in
//    this model - spend is counted when queued charges settle).
//  - CardCharges: remove the $125.96 phantom remnant of the bad partial settle
//    and the $500 "Credit card" payment mislogged as a charge; recompute the
//    card balance from what's actually still queued.
//  - Statement-scan imports were from Ateeq's debit card but got logged as
//    "Both": reattribute to Ateeq (income row included).
//  - Category hygiene: "Fixed" rows -> Rent/Utilities, Gym's "Recurring" ->
//    Health, retire the Fixed category, and tag every category as bill/flex.
function mig_2026_08_cleanup_(){
  const tx=sheet(TX_SHEET);
  ["1c0c9442-627f-4f92-8973-39839086b4e3",  // $900 Zelle (rent settlement, double-count)
   "799b6aee-7d99-4bf3-9f96-6bcf8e1d3003",  // Internet dupe 2
   "24d4057b-97d3-46dc-90bb-3767656b9471",  // Internet dupe 3
   "04b30ca8-4257-4187-8059-96e66857a08a",  // $874.04 July payoff duplicate
   "b70a702f-0604-4a94-a673-a3372e579fde"   // $870 card payment logged as expense
  ].forEach(id=>deleteRowById(tx,id));

  const cc=sheet(CARDCHG_SHEET);
  ["545e7dbd-b6ce-4c83-bc75-345a235bee56",  // $125.96 phantom remnant of bad partial settle
   "277d18cc-39ba-4749-a8a8-c37b74c84f4c"   // $500 payment mislogged as a charge
  ].forEach(id=>deleteRowById(cc,id));

  // Card balance = sum of charges still queued (source of truth for the bar)
  const CARD_ID="7a46e298-f0ed-4746-966d-2413dc6cf460";
  const owed=getCardCharges().charges.filter(c=>c.AccountID===CARD_ID && !c.Settled).reduce((s,c)=>s+c.Amount,0);
  updateRowById(sheet(ACCT_SHEET),CARD_ID,{Balance:Math.round(owed*100)/100});

  // Statement-scan rows are Ateeq's debit card, not "Both"
  reattributeByNote_(tx,"Imported from statement scan","PaidBy","Ateeq");
  reattributeByNote_(sheet(INCOME_SHEET),"Imported from statement scan","Source","Ateeq");

  // Normalize the one slash-format date so month filters catch it everywhere
  updateRowById(tx,"2cc7df7c-5158-4c9a-bc8b-a451f0df9f00",{Date:"2026-07-31"});

  // Category hygiene on old rows
  [["ca8d63fe-7cb4-43fa-9586-0f5b0e89ca33","Rent"],["89640a44-29d0-4e43-ba18-94017b53fd95","Rent"],
   ["206161b7-7380-4173-9b90-5e3f3c6650fa","Rent"],["08acec1e-aaa4-4667-ab4e-fa8b38563a8b","Rent"],
   ["b13a114a-7a97-4a53-ae1a-753b1a387150","Utilities"],["1fc9d722-79c5-422f-8542-47f971032a0d","Utilities"],
   ["b9af9b66-b932-4655-9da5-eb724ecb0329","Health"]
  ].forEach(p=>updateRowById(tx,p[0],{Category:p[1]}));
  // Rent recurring bill seeds under the Rent category from now on
  updateRowById(sheet(RECUR_SHEET),"b8f08e8c-9ad1-4296-b7d9-5e6ff35318f2",{Category:"Rent"});

  // Retire "Fixed" (empty after the recats) and tag every category bill/flex
  const cat=sheet(CAT_SHEET);
  ensureCols(cat,["ID","Name","Icon","Color","Budget","Kind"]);
  deleteRowById(cat,"f5d45bf5-df4c-455d-978d-f81e3de49fd3"); // Fixed
  const BILLS={"Rent":1,"Utilities":1,"Subscriptions":1,"Donation":1};
  const data=cat.getDataRange().getValues(); const hdr=data[0].map(String);
  const iName=hdr.indexOf("Name"), iKind=hdr.indexOf("Kind");
  for(let i=1;i<data.length;i++){
    const want=BILLS[String(data[i][iName])]?"bill":"flex";
    if(String(data[i][iKind]||"")!==want) cat.getRange(i+1,iKind+1).setValue(want);
  }
}
// Removes rows whose ID has already been seen. Walks bottom-up so deleting a
// row cannot shift the index of one still to be checked.
function dedupeById_(sh){
  const data=sh.getDataRange().getValues(); const idCol=data[0].map(String).indexOf("ID");
  if(idCol<0) return 0;
  const seen={}; const kill=[];
  for(let i=1;i<data.length;i++){
    const id=String(data[i][idCol]); if(!id) continue;
    if(seen[id]) kill.push(i+1); else seen[id]=true;
  }
  for(let j=kill.length-1;j>=0;j--) sh.deleteRow(kill[j]);
  return kill.length;
}
function reattributeByNote_(sh,noteMarker,col,value){
  if(!sh||sh.getLastRow()<2) return;
  const data=sh.getDataRange().getValues(); const hdr=data[0].map(String);
  const iNotes=hdr.indexOf("Notes"), iCol=hdr.indexOf(col);
  if(iNotes===-1||iCol===-1) return;
  for(let i=1;i<data.length;i++){
    if(String(data[i][iNotes]||"").indexOf(noteMarker)>-1 && String(data[i][iCol])!==value){
      sh.getRange(i+1,iCol+1).setValue(value);
    }
  }
}

function ensureCols(sh,need){
  const hdr=sh.getRange(1,1,1,Math.max(sh.getLastColumn(),1)).getValues()[0].map(String);
  need.forEach(h=>{ if(hdr.indexOf(h)===-1){ sh.getRange(1,sh.getLastColumn()+1).setValue(h); hdr.push(h); } });
}
function ensureGoalCols(gl){ ensureCols(gl,["ID","Name","Target","Saved","Type","TargetDate","Notes","Created"]); }
// Assigns a UUID to any existing row whose ID cell is blank (safe/idempotent to re-run)
function backfillIds(sh){
  const data=sh.getDataRange().getValues(); if(data.length<2) return;
  const idCol=data[0].map(String).indexOf("ID"); if(idCol===-1) return;
  for(let i=1;i<data.length;i++){
    if(!data[i][idCol]) sh.getRange(i+1,idCol+1).setValue(Utilities.getUuid());
  }
}

function migrateDebtGoals(gl,db){
  const data=gl.getDataRange().getValues(); if(data.length<2) return;
  const hdr=data[0].map(String);
  const iType=hdr.indexOf("Type"), iName=hdr.indexOf("Name"), iTarget=hdr.indexOf("Target"), iSaved=hdr.indexOf("Saved");
  if(iType===-1) return;
  for(let i=data.length-1;i>=1;i--){
    if(String(data[i][iType]).toLowerCase()==="debt"){
      const target=num(data[i][iTarget]), saved=num(data[i][iSaved]);
      db.appendRow([Utilities.getUuid(),data[i][iName]||"Debt","Both",target,Math.max(target-saved,0),0,0,"no",todayStr()]);
      gl.deleteRow(i+1);
    }
  }
}

// ─── Triggers (run once) ────────────────────────────────────────────────────
function installTriggers(){
  ScriptApp.getProjectTriggers().forEach(t=>ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("autoLogRecurring").timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger("autoLogFlows").timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger("sendMonthlyRecap").timeBased().onMonthDay(1).atHour(7).create();
  return "Triggers installed: daily recurring-bill check (weekly/biweekly/twice-monthly/monthly), daily flow check, recap email (1st).";
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function uuid(){ return Utilities.getUuid(); }
function tz(){ return ss().getSpreadsheetTimeZone(); }
function todayStr(){ return Utilities.formatDate(new Date(),tz(),"yyyy-MM-dd"); }
function num(v){ if(typeof v==="number")return v; return parseFloat(String(v).replace(/[$,]/g,""))||0; }
function rowsAsObjects(sh){
  if(!sh||sh.getLastRow()<2) return [];
  const data=sh.getDataRange().getValues();
  const hdr=data[0].map(String);
  return data.slice(1).map(r=>{ const o={}; hdr.forEach((h,i)=>o[h]=r[i]); return o; });
}
function monthMatch(dateVal,month,year){
  if(!month||!year) return true;
  let d = (dateVal instanceof Date)?dateVal:new Date(dateVal);
  if(isNaN(d)) { const p=String(dateVal).split("-"); return (+p[1]===+month)&&(+p[0]===+year); }
  return (d.getMonth()+1===+month)&&(d.getFullYear()===+year);
}
function fmtDate(d){ return (d instanceof Date)?Utilities.formatDate(d,tz(),"yyyy-MM-dd"):String(d).slice(0,10); }
function updateRowById(sh,id,setters){ // setters: {ColName: value}
  const data=sh.getDataRange().getValues(); const hdr=data[0].map(String); const idCol=hdr.indexOf("ID");
  for(let i=1;i<data.length;i++){
    if(String(data[i][idCol])===String(id)){
      Object.keys(setters).forEach(k=>{ const c=hdr.indexOf(k); if(c>-1) sh.getRange(i+1,c+1).setValue(setters[k]); });
      return data[i];
    }
  }
  return null;
}
function deleteRowById(sh,id){
  const data=sh.getDataRange().getValues(); const idCol=data[0].map(String).indexOf("ID");
  for(let i=1;i<data.length;i++){ if(String(data[i][idCol])===String(id)){ sh.deleteRow(i+1); return true; } }
  return false;
}
function getCell(sh,id,col){
  const data=sh.getDataRange().getValues(); const hdr=data[0].map(String);
  const idCol=hdr.indexOf("ID"), c=hdr.indexOf(col);
  for(let i=1;i<data.length;i++){ if(String(data[i][idCol])===String(id)) return data[i][c]; }
  return null;
}

// ─── Transactions ───────────────────────────────────────────────────────────
function getTransactions(month,year){
  const sh=sheet(TX_SHEET); const all=rowsAsObjects(sh);
  const out=all.filter(t=>monthMatch(t.Date,month,year)).map(t=>({
    ID:t.ID, Date:fmtDate(t.Date), Description:t.Description, Category:t.Category,
    PaidBy:t.PaidBy, Amount:num(t.Amount), TxType:t.TxType, Notes:t.Notes, ReceiptURL:t.ReceiptURL,
    Need:t.Need||"", Sub:t.Sub||""
  }));
  return {transactions:out};
}
function addTransaction(p){
  const sh=sheet(TX_SHEET); ensureCols(sh,["ID","Date","Description","Category","PaidBy","Amount","TxType","Notes","ReceiptURL","Need","Sub"]);
  const id=p.id||uuid();
  const hdr=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  const row=hdr.map(h=>({ID:id,Date:p.date||todayStr(),Description:p.description||"",Category:p.category||"Personal/Misc",
    PaidBy:p.paidBy||"Ateeq",Amount:num(p.amount),TxType:p.txType||"One-time",Notes:p.notes||"",ReceiptURL:p.receiptUrl||"",
    Need:p.need||"",Sub:p.sub||""}[h] ?? ""));
  sh.appendRow(row);
  return {success:true, id};
}
function updateTransaction(p){
  const sh=sheet(TX_SHEET);
  const found=updateRowById(sh,p.id,Object.assign({},
    p.date?{Date:p.date}:{}, p.description!=null?{Description:p.description}:{},
    p.category?{Category:p.category}:{}, p.paidBy?{PaidBy:p.paidBy}:{},
    p.amount!=null?{Amount:num(p.amount)}:{}, p.txType?{TxType:p.txType}:{},
    p.need!=null?{Need:p.need}:{}, p.sub!=null?{Sub:p.sub}:{}));
  return found?{success:true}:{error:"Not found"};
}
function deleteTransaction(id){ return deleteRowById(sheet(TX_SHEET),id)?{success:true}:{error:"Not found"}; }

// ─── Recurring bills (rent, subscriptions, etc. — auto-logged as expenses) ───
function getRecurringBills(){
  const out=rowsAsObjects(sheet(RECUR_SHEET)).map(r=>({
    ID:r.ID, Description:r.Description, Category:r.Category, PaidBy:r.PaidBy||"Ateeq", Amount:num(r.Amount),
    Active:String(r.Active||"yes").toLowerCase()!=="no",
    Frequency:(r.Frequency||"monthly"), DayOfMonth:Math.min(Math.max(parseInt(r.DayOfMonth)||1,1),28),
    LastRun:r.LastRun?fmtDate(r.LastRun):""
  }));
  return {bills:out};
}
function addRecurringBill(p){
  const sh=sheet(RECUR_SHEET); const id=p.id||uuid();
  const freq=["weekly","biweekly","semimonthly","monthly"].indexOf(p.frequency)>-1?p.frequency:"monthly";
  sh.appendRow([id,p.description||"Bill",p.category||"Personal/Misc",p.paidBy||"Ateeq",num(p.amount),"yes",freq,Math.min(Math.max(parseInt(p.day)||1,1),28),""]);
  return {success:true,id};
}
function updateRecurringBill(p){
  const found=updateRowById(sheet(RECUR_SHEET),p.id,Object.assign({},
    p.description?{Description:p.description}:{}, p.category?{Category:p.category}:{}, p.paidBy?{PaidBy:p.paidBy}:{},
    p.amount!=null?{Amount:num(p.amount)}:{}, p.frequency?{Frequency:p.frequency}:{},
    p.day!=null?{DayOfMonth:Math.min(Math.max(parseInt(p.day)||1,1),28)}:{},
    p.active!=null?{Active:p.active==="no"?"no":"yes"}:{}));
  return found?{success:true}:{error:"Not found"};
}
function deleteRecurringBill(id){ return deleteRowById(sheet(RECUR_SHEET),id)?{success:true}:{error:"Not found"}; }
// Runs any active bill that's due since its LastRun, given its own frequency (mirrors runFlows()).
function runRecurringBills(now){
  const sh=sheet(RECUR_SHEET);
  const bills=getRecurringBills().bills.filter(b=>b.Active);
  let ran=0;
  bills.forEach(b=>{
    const last=b.LastRun?new Date(b.LastRun):null;
    let due=false;
    if(b.Frequency==="weekly")        due=!last||daysBetween(last,now)>=7;
    else if(b.Frequency==="biweekly") due=!last||daysBetween(last,now)>=14;
    else if(b.Frequency==="semimonthly"){ const d=now.getDate(); const key=now.getFullYear()+"-"+(now.getMonth()+1); const lastKey=last?last.getFullYear()+"-"+(last.getMonth()+1):""; const half=d>=1&&d<15?"a":"b"; const lastHalf=last?(last.getDate()<15?"a":"b"):""; due=!last||(key+half)!==(lastKey+lastHalf); }
    else { due=!last||now.getMonth()!==last.getMonth()||now.getFullYear()!==last.getFullYear(); if(due&&now.getDate()<b.DayOfMonth&&(!last||now.getMonth()===last.getMonth())) due=false; }
    if(!due) return;
    addTransaction({date:todayStr(),description:b.Description,category:b.Category,paidBy:b.PaidBy,amount:b.Amount,txType:"Recurring",notes:"AUTO_SEED",
      sub:String(b.Category||"").toLowerCase()==="subscriptions"?"yes":"",need:""});
    updateRowById(sh,b.ID,{LastRun:todayStr()});
    ran++;
  });
  return {success:true, ran:ran};
}
function autoLogRecurring(){ runRecurringBills(new Date()); }

// ─── Categories & budgets (shared across devices) ────────────────────────────
function getCategories(){
  const out=rowsAsObjects(sheet(CAT_SHEET)).map(c=>({
    ID:c.ID, Name:c.Name, Icon:c.Icon||"📦", Color:c.Color||"#f9a8d4", Budget:num(c.Budget),
    Kind:String(c.Kind||"flex")==="bill"?"bill":"flex"
  }));
  return {categories:out};
}
function addCategory(p){
  const sh=sheet(CAT_SHEET); ensureCols(sh,["ID","Name","Icon","Color","Budget","Kind"]);
  const id=p.id||uuid();
  sh.appendRow([id,p.name||"Category",p.icon||"📦",p.color||"#f9a8d4",num(p.budget||0),p.kind==="bill"?"bill":"flex"]);
  return {success:true,id};
}
function updateCategory(p){
  const found=updateRowById(sheet(CAT_SHEET),p.id,Object.assign({},
    p.icon?{Icon:p.icon}:{}, p.budget!=null?{Budget:num(p.budget)}:{},
    p.kind?{Kind:p.kind==="bill"?"bill":"flex"}:{}));
  return found?{success:true}:{error:"Not found"};
}
function deleteCategory(id){ return deleteRowById(sheet(CAT_SHEET),id)?{success:true}:{error:"Not found"}; }

// ─── Income ─────────────────────────────────────────────────────────────────
function getIncome(month,year){
  const sh=sheet(INCOME_SHEET); const all=rowsAsObjects(sh);
  const out=all.filter(i=>monthMatch(i.Date,month,year)).map(i=>({
    ID:i.ID, Date:fmtDate(i.Date), Description:i.Description, Source:i.Source, Amount:num(i.Amount), Notes:i.Notes
  }));
  return {income:out};
}
function addIncome(p){
  const sh=sheet(INCOME_SHEET); const id=p.id||uuid();
  sh.appendRow([id,p.date||todayStr(),p.description||"Income",p.source||"Ateeq",num(p.amount),p.notes||""]);
  return {success:true,id};
}
function deleteIncome(id){ return deleteRowById(sheet(INCOME_SHEET),id)?{success:true}:{error:"Not found"}; }

// ─── Goals (savings) ────────────────────────────────────────────────────────
function getGoals(){
  const sh=sheet(GOALS_SHEET); const all=rowsAsObjects(sh);
  const out=all.map(g=>({
    ID:g.ID, Name:g.Name, Target:num(g.Target), Saved:num(g.Saved),
    Type:g.Type||"savings", TargetDate:g.TargetDate?fmtDate(g.TargetDate):"", Notes:g.Notes
  }));
  return {goals:out};
}
function addGoal(p){
  const sh=sheet(GOALS_SHEET); const id=p.id||uuid();
  sh.appendRow([id,p.name||"Goal",num(p.target),num(p.saved||0),p.type||"savings",p.targetDate||"",p.notes||"",todayStr()]);
  return {success:true,id};
}
function updateGoalProgress(p){
  const sh=sheet(GOALS_SHEET);
  const cur=num(getCell(sh,p.goalId,"Saved"));
  const found=updateRowById(sh,p.goalId,{Saved:cur+num(p.amount)});
  return found?{success:true}:{error:"Not found"};
}
function deleteGoal(id){ return deleteRowById(sheet(GOALS_SHEET),id)?{success:true}:{error:"Not found"}; }

// ─── Accounts ───────────────────────────────────────────────────────────────
function getAccounts(){
  const out=rowsAsObjects(sheet(ACCT_SHEET)).map(a=>({
    ID:a.ID, Name:a.Name, Owner:a.Owner||"Both", Type:a.Type||"checking",
    Balance:num(a.Balance), APY:num(a.APY), LastReconciled:a.LastReconciled?fmtDate(a.LastReconciled):"", Limit:num(a.Limit)
  }));
  return {accounts:out};
}
function addAccount(p){
  const sh=sheet(ACCT_SHEET); const id=p.id||uuid();
  sh.appendRow([id,p.name||"Account",p.owner||"Both",p.type||"checking",num(p.balance||0),num(p.apy||0),p.balance?todayStr():"",todayStr(),num(p.limit||0)]);
  return {success:true,id};
}
function updateAccount(p){
  const found=updateRowById(sheet(ACCT_SHEET),p.id,Object.assign({},
    p.name?{Name:p.name}:{}, p.owner?{Owner:p.owner}:{}, p.type?{Type:p.type}:{},
    p.apy!=null?{APY:num(p.apy)}:{}, p.balance!=null?{Balance:num(p.balance)}:{}, p.limit!=null?{Limit:num(p.limit)}:{}));
  return found?{success:true}:{error:"Not found"};
}
function deleteAccount(id){ return deleteRowById(sheet(ACCT_SHEET),id)?{success:true}:{error:"Not found"}; }
function reconcileAccount(p){
  const sh=sheet(ACCT_SHEET);
  const prior=num(getCell(sh,p.id,"Balance"));
  const stated=num(p.balance);
  const found=updateRowById(sh,p.id,{Balance:stated,LastReconciled:todayStr()});
  if(!found) return {error:"Not found"};
  sheet(RECON_SHEET).appendRow([uuid(),p.id,todayStr(),stated,prior,stated-prior]);
  return {success:true, drift:stated-prior};
}

// ─── Debts ──────────────────────────────────────────────────────────────────
function getDebts(){
  const debts=rowsAsObjects(sheet(DEBT_SHEET)).map(d=>({
    ID:d.ID, Name:d.Name, Owner:d.Owner||"Both",
    StartBalance:num(d.StartBalance), Balance:num(d.Balance),
    APR:num(d.APR), MinPayment:num(d.MinPayment),
    HighPriority:String(d.HighPriority||"no").toLowerCase()==="yes",
    // When the debt was first tracked. Needed to say how long a balance has sat
    // untouched when there is no payment history to measure from.
    Created:d.Created?fmtDate(d.Created):""
  }));
  const payments=rowsAsObjects(sheet(DEBTPAY_SHEET)).map(pm=>({
    ID:pm.ID, DebtID:pm.DebtID, Date:fmtDate(pm.Date), Amount:num(pm.Amount), PaidBy:pm.PaidBy
  }));
  return {debts:debts, payments:payments};
}
function addDebt(p){
  const sh=sheet(DEBT_SHEET); const id=p.id||uuid();
  const bal=num(p.balance);
  sh.appendRow([id,p.name||"Debt",p.owner||"Both",bal,bal,num(p.apr||0),num(p.minPayment||0),p.highPriority==="yes"?"yes":"no",todayStr()]);
  return {success:true,id};
}
function updateDebt(p){
  const found=updateRowById(sheet(DEBT_SHEET),p.id,Object.assign({},
    p.name?{Name:p.name}:{}, p.owner?{Owner:p.owner}:{},
    p.apr!=null?{APR:num(p.apr)}:{}, p.minPayment!=null?{MinPayment:num(p.minPayment)}:{},
    p.balance!=null?{Balance:num(p.balance)}:{}, p.highPriority!=null?{HighPriority:p.highPriority==="yes"?"yes":"no"}:{}));
  return found?{success:true}:{error:"Not found"};
}
function deleteDebt(id){
  // remove payments too
  const dp=sheet(DEBTPAY_SHEET); const data=dp.getDataRange().getValues();
  const iDebt=data[0].map(String).indexOf("DebtID");
  for(let i=data.length-1;i>=1;i--){ if(String(data[i][iDebt])===String(id)) dp.deleteRow(i+1); }
  return deleteRowById(sheet(DEBT_SHEET),id)?{success:true}:{error:"Not found"};
}
function logDebtPayment(p){
  const sh=sheet(DEBT_SHEET);
  const cur=num(getCell(sh,p.debtId,"Balance"));
  if(getCell(sh,p.debtId,"ID")===null) return {error:"Not found"};
  const amt=num(p.amount);
  const newBal=Math.max(cur-amt,0);
  updateRowById(sh,p.debtId,{Balance:newBal});
  sheet(DEBTPAY_SHEET).appendRow([p.id||uuid(),p.debtId,p.date||todayStr(),amt,p.paidBy||"Both",p.notes||""]);
  return {success:true, balance:newBal, paidOff:newBal===0};
}

// ─── Recurring flows (investments / divestments) ────────────────────────────
function getFlows(){
  const out=rowsAsObjects(sheet(FLOWS_SHEET)).map(f=>({
    ID:f.ID, Name:f.Name, FlowType:f.FlowType||"invest", Amount:num(f.Amount),
    Owner:f.Owner||"Both", AccountID:f.AccountID||"", GoalID:f.GoalID||"",
    DayOfMonth:Math.min(Math.max(parseInt(f.DayOfMonth)||1,1),28),
    Frequency:(f.Frequency||"monthly"), LastRun:f.LastRun?fmtDate(f.LastRun):"",
    Active:String(f.Active||"yes").toLowerCase()!=="no"
  }));
  return {flows:out};
}
function addFlow(p){
  const sh=sheet(FLOWS_SHEET); const id=p.id||uuid();
  const freq=["weekly","biweekly","semimonthly","monthly"].indexOf(p.frequency)>-1?p.frequency:"monthly";
  sh.appendRow([id,p.name||"Flow",p.flowType==="divest"?"divest":"invest",num(p.amount),
    p.owner||"Both",p.accountId||"",p.goalId||"",Math.min(Math.max(parseInt(p.day)||1,1),28),"yes",todayStr(),freq,""]);
  return {success:true,id};
}
function updateFlow(p){
  const found=updateRowById(sheet(FLOWS_SHEET),p.id,Object.assign({},
    p.name?{Name:p.name}:{}, p.flowType?{FlowType:p.flowType==="divest"?"divest":"invest"}:{},
    p.amount!=null?{Amount:num(p.amount)}:{}, p.owner?{Owner:p.owner}:{},
    p.accountId!=null?{AccountID:p.accountId}:{}, p.goalId!=null?{GoalID:p.goalId}:{},
    p.day!=null?{DayOfMonth:Math.min(Math.max(parseInt(p.day)||1,1),28)}:{},
    p.frequency?{Frequency:p.frequency}:{},
    p.active!=null?{Active:p.active==="no"?"no":"yes"}:{}));
  return found?{success:true}:{error:"Not found"};
}
function deleteFlow(id){ return deleteRowById(sheet(FLOWS_SHEET),id)?{success:true}:{error:"Not found"}; }

// Approx monthly equivalent of a flow (for planning math on the client too)
function flowMonthly(f){
  switch(f.Frequency){
    case "weekly": return f.Amount*52/12;
    case "biweekly": return f.Amount*26/12;
    case "semimonthly": return f.Amount*2;
    default: return f.Amount;
  }
}
// Runs daily; fires any active flow that's due since its LastRun given its frequency.
function autoLogFlows(){ runFlows(new Date()); }
function daysBetween(a,b){ return Math.floor((b-a)/86400000); }
function runFlows(now){
  const sh=sheet(FLOWS_SHEET);
  const flows=getFlows().flows.filter(f=>f.Active);
  let ran=0;
  flows.forEach(f=>{
    const last=f.LastRun?new Date(f.LastRun):null;
    let due=false;
    if(f.Frequency==="weekly")      due=!last||daysBetween(last,now)>=7;
    else if(f.Frequency==="biweekly")due=!last||daysBetween(last,now)>=14;
    else if(f.Frequency==="semimonthly"){ const d=now.getDate(); const key=now.getFullYear()+"-"+(now.getMonth()+1); const lastKey=last?last.getFullYear()+"-"+(last.getMonth()+1):""; const half=d>=1&&d<15?"a":"b"; const lastHalf=last?(last.getDate()<15?"a":"b"):""; due=!last||(key+half)!==(lastKey+lastHalf); }
    else { due=!last||now.getMonth()!==last.getMonth()||now.getFullYear()!==last.getFullYear(); if(due&&now.getDate()<f.DayOfMonth&&(!last||now.getMonth()===last.getMonth())) due=false; }
    if(!due) return;
    addContribution({flowType:f.FlowType,amount:f.Amount,accountId:f.AccountID,goalId:f.GoalID,owner:f.Owner,
      notes:"FLOW:"+f.ID+" "+f.Name,source:"auto"});
    updateRowById(sh,f.ID,{LastRun:todayStr()});
    ran++;
  });
  return {success:true, ran:ran};
}

// ─── Credit-card holding tank ───────────────────────────────────────────────
// A charge raises the card's Balance and queues a row (unsettled). It does NOT
// count as spending yet. Paying the card settles oldest charges first; settled
// charges become real Transactions "as charged", preserving category.
function getCardCharges(){
  const out=rowsAsObjects(sheet(CARDCHG_SHEET)).map(c=>({
    ID:c.ID, AccountID:c.AccountID, Date:fmtDate(c.Date), Description:c.Description,
    Category:c.Category, PaidBy:c.PaidBy||"Ateeq", Amount:num(c.Amount),
    Settled:String(c.Settled||"no").toLowerCase()==="yes"
  }));
  return {charges:out};
}
function chargeCard(p){
  const sh=sheet(ACCT_SHEET);
  const cardId=p.accountId;
  if(getCell(sh,cardId,"ID")===null) return {error:"Card not found"};
  const amt=num(p.amount);
  const cur=num(getCell(sh,cardId,"Balance"));
  updateRowById(sh,cardId,{Balance:cur+amt});
  sheet(CARDCHG_SHEET).appendRow([p.id||uuid(),cardId,p.date||todayStr(),p.description||"",p.category||"Personal/Misc",p.paidBy||"Ateeq",amt,"no",p.notes||""]);
  const lim=num(getCell(sh,cardId,"Limit"));
  return {success:true, balance:cur+amt, limit:lim};
}
// Pay down the card. Lowers Balance, settles oldest unsettled charges up to the
// paid amount, and turns each fully-settled charge into a real Transaction.
function payCard(p){
  const acc=sheet(ACCT_SHEET); const cardId=p.accountId;
  if(getCell(acc,cardId,"ID")===null) return {error:"Card not found"};
  let pay=num(p.amount);
  const bal=num(getCell(acc,cardId,"Balance"));
  const applied=Math.min(pay,bal);
  updateRowById(acc,cardId,{Balance:bal-applied});
  // pull checking down if specified
  if(p.fromAccountId){ const fc=num(getCell(acc,p.fromAccountId,"Balance")); if(getCell(acc,p.fromAccountId,"ID")!==null) updateRowById(acc,p.fromAccountId,{Balance:fc-applied}); }
  // settle oldest first
  const cs=sheet(CARDCHG_SHEET); const data=cs.getDataRange().getValues(); const hdr=data[0].map(String);
  const iId=hdr.indexOf("ID"),iAcc=hdr.indexOf("AccountID"),iSettled=hdr.indexOf("Settled"),iAmt=hdr.indexOf("Amount"),
        iDate=hdr.indexOf("Date"),iDesc=hdr.indexOf("Description"),iCat=hdr.indexOf("Category"),iPaidBy=hdr.indexOf("PaidBy");
  let remaining=applied, settledCount=0;
  for(let i=1;i<data.length && remaining>0.001;i++){
    if(String(data[i][iAcc])!==String(cardId)) continue;
    if(String(data[i][iSettled]).toLowerCase()==="yes") continue;
    const amt=num(data[i][iAmt]);
    if(amt<=remaining+0.001){
      // fully settle → becomes a real transaction "as charged"
      cs.getRange(i+1,iSettled+1).setValue("yes");
      addTransaction({date:data[i][iDate],description:data[i][iDesc]||"Card charge",category:data[i][iCat]||"Personal/Misc",
        paidBy:data[i][iPaidBy]||"Ateeq",amount:amt,txType:"One-time",notes:"CARD_SETTLED",need:"",sub:""});
      remaining-=amt; settledCount++;
    } else {
      // partial: split the charge — settle `remaining`, leave the rest queued
      cs.getRange(i+1,iAmt+1).setValue(amt-remaining);
      addTransaction({date:data[i][iDate],description:(data[i][iDesc]||"Card charge")+" (partial)",category:data[i][iCat]||"Personal/Misc",
        paidBy:data[i][iPaidBy]||"Ateeq",amount:remaining,txType:"One-time",notes:"CARD_SETTLED",need:"",sub:""});
      remaining=0; settledCount++;
    }
  }
  return {success:true, paid:applied, newBalance:bal-applied, settled:settledCount};
}

// ─── Contributions ──────────────────────────────────────────────────────────
function getContributions(month,year){
  const out=rowsAsObjects(sheet(CONTRIB_SHEET)).filter(c=>monthMatch(c.Date,month,year)).map(c=>({
    ID:c.ID, Date:fmtDate(c.Date), FlowType:c.FlowType||"invest", Amount:num(c.Amount),
    AccountID:c.AccountID||"", GoalID:c.GoalID||"", Owner:c.Owner||"Both", Notes:c.Notes||"", Source:c.Source||"manual"
  }));
  return {contributions:out};
}
// invest: money INTO an account and/or goal. divest: money OUT of an account.
function addContribution(p){
  const type=p.flowType==="divest"?"divest":"invest";
  const amt=num(p.amount);
  const sign=type==="divest"?-1:1;
  if(p.accountId){
    const sh=sheet(ACCT_SHEET);
    const cur=num(getCell(sh,p.accountId,"Balance"));
    if(getCell(sh,p.accountId,"ID")!==null) updateRowById(sh,p.accountId,{Balance:cur+sign*amt});
  }
  if(p.goalId && type==="invest"){
    const gs=sheet(GOALS_SHEET);
    const cur=num(getCell(gs,p.goalId,"Saved"));
    if(getCell(gs,p.goalId,"ID")!==null) updateRowById(gs,p.goalId,{Saved:cur+amt});
  }
  if(p.goalId && type==="divest"){
    const gs=sheet(GOALS_SHEET);
    const cur=num(getCell(gs,p.goalId,"Saved"));
    if(getCell(gs,p.goalId,"ID")!==null) updateRowById(gs,p.goalId,{Saved:Math.max(cur-amt,0)});
  }
  sheet(CONTRIB_SHEET).appendRow([p.id||uuid(),p.date||todayStr(),type,amt,p.accountId||"",p.goalId||"",p.owner||"Both",p.notes||"",p.source||"manual"]);
  return {success:true};
}

// ─── Receipts ───────────────────────────────────────────────────────────────
function saveReceiptToDrive(base64,filename,mediaType){
  let folder; const it=DriveApp.getFoldersByName(DRIVE_FOLDER);
  folder = it.hasNext()?it.next():DriveApp.createFolder(DRIVE_FOLDER);
  const blob=Utilities.newBlob(Utilities.base64Decode(base64),mediaType||"image/jpeg",filename||"receipt.jpg");
  const file=folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);
  return {success:true,url:file.getUrl()};
}

// ─── Monthly recap email ────────────────────────────────────────────────────
function sendMonthlyRecap(){
  const now=new Date();
  const d=new Date(now.getFullYear(),now.getMonth()-1,1); // previous month
  const m=d.getMonth()+1, y=d.getFullYear();
  const monthName=Utilities.formatDate(d,tz(),"MMMM yyyy");

  const txns=getTransactions(m,y).transactions;
  const income=getIncome(m,y).income;
  const contribs=getContributions(m,y).contributions;
  const dinfo=getDebts();
  const expTotal=txns.reduce((s,t)=>s+t.Amount,0);
  const incTotal=income.reduce((s,i)=>s+i.Amount,0);
  const net=incTotal-expTotal;
  const wants=txns.filter(t=>String(t.Need).toLowerCase()==="want").reduce((s,t)=>s+t.Amount,0);
  const subs=txns.filter(t=>String(t.Sub).toLowerCase()==="yes").reduce((s,t)=>s+t.Amount,0);
  const invested=contribs.filter(c=>c.FlowType==="invest").reduce((s,c)=>s+c.Amount,0);
  const debtPaid=dinfo.payments.filter(pm=>monthMatch(pm.Date,m,y)).reduce((s,pm)=>s+pm.Amount,0);
  const debtLeft=dinfo.debts.reduce((s,x)=>s+x.Balance,0);

  const catTotals={};
  txns.forEach(t=>{ catTotals[t.Category]=(catTotals[t.Category]||0)+t.Amount; });
  const top=Object.entries(catTotals).sort((a,b)=>b[1]-a[1]).slice(0,5);

  let ateeq=0,celeste=0;
  txns.forEach(t=>{ if(t.PaidBy==="Both"){ateeq+=t.Amount/2;celeste+=t.Amount/2;} else if(t.PaidBy==="Celeste")celeste+=t.Amount; else ateeq+=t.Amount; });

  const $=n=>"$"+(Math.round(n*100)/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
  const row=(l,v,c)=>'<tr><td style="padding:6px 0;color:#8a6880;font-weight:700">'+l+'</td><td style="text-align:right;font-weight:800;color:'+(c||'#4a3048')+'">'+v+'</td></tr>';
  const html=`
  <div style="font-family:Nunito,Arial,sans-serif;max-width:480px;margin:0 auto;background:#fdf6f9;padding:20px;border-radius:16px;color:#4a3048">
    <h1 style="font-size:22px;margin:0 0 4px">🐱 PatchinPennies</h1>
    <p style="color:#8a6880;font-weight:700;margin:0 0 18px">Your ${monthName} recap — money date time 💞</p>
    <div style="background:#fff;border:1.5px solid #f0d6e8;border-radius:14px;padding:16px;margin-bottom:12px">
      <table style="width:100%;font-size:15px">
        ${row("💰 Income",$(incTotal),"#34d399")}
        ${row("💸 Spent",$(expTotal),"#f472b6")}
        ${row("🛍️ …of which wants",$(wants),"#fb923c")}
        ${row("📱 …of which subscriptions",$(subs)+" ("+$(subs*12)+"/yr pace)","#a78bfa")}
        ${row("🌱 Invested / saved",$(invested),"#34d399")}
        ${row("💳 Debt paid",$(debtPaid),"#60a5fa")}
        ${row("🏔️ Debt remaining",$(debtLeft),"#fb7185")}
        ${row(net>=0?"🎉 Net":"⚠️ Net",(net>=0?"+":"-")+$(Math.abs(net)),net>=0?"#34d399":"#fb7185")}
      </table>
    </div>
    <div style="background:#fff;border:1.5px solid #f0d6e8;border-radius:14px;padding:16px;margin-bottom:12px">
      <p style="font-weight:800;margin:0 0 10px">🏆 Top categories</p>
      ${top.map(([c,v])=>'<div style="display:flex;justify-content:space-between;padding:5px 0;font-size:14px"><span style="color:#8a6880;font-weight:700">'+c+'</span><span style="font-weight:800">'+$(v)+'</span></div>').join("")}
    </div>
    <div style="background:#fff;border:1.5px solid #f0d6e8;border-radius:14px;padding:16px">
      <p style="font-weight:800;margin:0 0 10px">👫 Who spent what</p>
      <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:14px"><span style="color:#8a6880;font-weight:700">🧔 Ateeq</span><span style="font-weight:800">${$(ateeq)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:14px"><span style="color:#8a6880;font-weight:700">👩 Celeste</span><span style="font-weight:800">${$(celeste)}</span></div>
    </div>
    <p style="text-align:center;color:#b89aad;font-size:12px;font-weight:700;margin-top:16px">Open the app → Recap → Money Date to close out the month 🐾</p>
  </div>`;

  RECAP_EMAILS.forEach(addr=>{
    MailApp.sendEmail({to:addr,subject:"🐱 PatchinPennies — "+monthName+" recap",htmlBody:html});
  });
  return {success:true};
}
function testRecapNow(){ sendMonthlyRecap(); }
