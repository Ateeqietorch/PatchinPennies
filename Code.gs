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
const CONTRIB_SHEET = "Contributions";  // money moved into accounts/goals (or out)
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
    contributions: getContributions(month,year).contributions
  };
}

// ─── Router ─────────────────────────────────────────────────────────────────
function doGet(e){
  const a=(e.parameter.action)||"getTransactions";
  let r;
  try{
    switch(a){
      case "getAll":             r=getAll(e.parameter.month,e.parameter.year); break;
      case "getTransactions":    r=getTransactions(e.parameter.month,e.parameter.year); break;
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
      // Contributions
      case "getContributions":   r=getContributions(e.parameter.month,e.parameter.year); break;
      case "addContribution":    r=addContribution(e.parameter); break;
      case "ping":               r={ok:true,version:3}; break;
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
    rc.appendRow(["Description","Category","PaidBy","Amount","Active"]);
    rc.getRange(1,1,1,5).setFontWeight("bold");
    [["Rent","Fixed","Both",1800,"yes"],
     ["Internet","Utilities","Ateeq",95,"yes"],
     ["Spotify – Ateeq","Subscriptions","Ateeq",20,"yes"],
     ["Spotify – Celeste","Subscriptions","Celeste",20,"yes"],
     ["Planned Parenthood","Donation","Celeste",10,"yes"],
     ["Patches Food Chewy","Patches' Expenses","Celeste",98.59,"yes"],
     ["Gym Membership","Health","Ateeq",20,"yes"],
     ["CCC School Tuition","Personal/Misc","Celeste",111.87,"yes"]].forEach(r=>rc.appendRow(r));
  }
  // Accounts
  let ac=book.getSheetByName(ACCT_SHEET);
  const acNew=!ac;
  if(!ac){ ac=book.insertSheet(ACCT_SHEET); ac.appendRow(["ID","Name","Owner","Type","Balance","APY","LastReconciled","Created"]); ac.getRange(1,1,1,8).setFontWeight("bold"); }
  if(acNew || ac.getLastRow()<2){
    [["Celeste's HYSA","Celeste","hysa",0,4.2],
     ["Checking","Both","checking",0,0],
     ["401k — Celeste","Celeste","retirement",0,0],
     ["401k — Ateeq","Ateeq","retirement",0,0]].forEach(r=>{
      ac.appendRow([Utilities.getUuid(),r[0],r[1],r[2],r[3],r[4],"",todayStr()]);
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
  if(!fl){ fl=book.insertSheet(FLOWS_SHEET); fl.appendRow(["ID","Name","FlowType","Amount","Owner","AccountID","GoalID","DayOfMonth","Active","Created"]); fl.getRange(1,1,1,10).setFontWeight("bold"); }
  let co=book.getSheetByName(CONTRIB_SHEET);
  if(!co){ co=book.insertSheet(CONTRIB_SHEET); co.appendRow(["ID","Date","FlowType","Amount","AccountID","GoalID","Owner","Notes","Source"]); co.getRange(1,1,1,9).setFontWeight("bold"); }
  return "Setup complete. Now run installTriggers() once (safe to re-run too).";
}

function ensureCols(sh,need){
  const hdr=sh.getRange(1,1,1,Math.max(sh.getLastColumn(),1)).getValues()[0].map(String);
  need.forEach(h=>{ if(hdr.indexOf(h)===-1){ sh.getRange(1,sh.getLastColumn()+1).setValue(h); hdr.push(h); } });
}
function ensureGoalCols(gl){ ensureCols(gl,["ID","Name","Target","Saved","Type","TargetDate","Notes","Created"]); }

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
  ScriptApp.newTrigger("autoLogRecurring").timeBased().onMonthDay(1).atHour(6).create();
  ScriptApp.newTrigger("autoLogFlows").timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger("sendMonthlyRecap").timeBased().onMonthDay(1).atHour(7).create();
  return "Triggers installed: recurring expenses (1st), daily flow check, recap email (1st).";
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
  const id=uuid();
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

// ─── Recurring expenses ─────────────────────────────────────────────────────
function seedFixed(month,year){
  const rc=sheet(RECUR_SHEET); const tx=sheet(TX_SHEET);
  const m=+month||(new Date().getMonth()+1), y=+year||(new Date().getFullYear());
  const dateStr=Utilities.formatDate(new Date(y,m-1,1),tz(),"yyyy-MM-dd");
  const existing=rowsAsObjects(tx).some(t=>monthMatch(t.Date,m,y)&&String(t.Notes||"").indexOf("AUTO_SEED")>-1);
  if(existing) return {success:true, note:"already seeded"};
  const items=rowsAsObjects(rc).filter(r=>String(r.Active||"yes").toLowerCase()!=="no");
  items.forEach(r=>{
    addTransaction({date:dateStr,description:r.Description,category:r.Category,paidBy:r.PaidBy,amount:r.Amount,txType:"Recurring",notes:"AUTO_SEED",
      sub:String(r.Category||"").toLowerCase()==="subscriptions"?"yes":"",need:""});
  });
  return {success:true, count:items.length};
}
function autoLogRecurring(){ const now=new Date(); seedFixed(now.getMonth()+1, now.getFullYear()); }

// ─── Income ─────────────────────────────────────────────────────────────────
function getIncome(month,year){
  const sh=sheet(INCOME_SHEET); const all=rowsAsObjects(sh);
  const out=all.filter(i=>monthMatch(i.Date,month,year)).map(i=>({
    ID:i.ID, Date:fmtDate(i.Date), Description:i.Description, Source:i.Source, Amount:num(i.Amount), Notes:i.Notes
  }));
  return {income:out};
}
function addIncome(p){
  const sh=sheet(INCOME_SHEET); const id=uuid();
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
  const sh=sheet(GOALS_SHEET); const id=uuid();
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
    Balance:num(a.Balance), APY:num(a.APY), LastReconciled:a.LastReconciled?fmtDate(a.LastReconciled):""
  }));
  return {accounts:out};
}
function addAccount(p){
  const sh=sheet(ACCT_SHEET); const id=uuid();
  sh.appendRow([id,p.name||"Account",p.owner||"Both",p.type||"checking",num(p.balance||0),num(p.apy||0),p.balance?todayStr():"",todayStr()]);
  return {success:true,id};
}
function updateAccount(p){
  const found=updateRowById(sheet(ACCT_SHEET),p.id,Object.assign({},
    p.name?{Name:p.name}:{}, p.owner?{Owner:p.owner}:{}, p.type?{Type:p.type}:{},
    p.apy!=null?{APY:num(p.apy)}:{}, p.balance!=null?{Balance:num(p.balance)}:{}));
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
    HighPriority:String(d.HighPriority||"no").toLowerCase()==="yes"
  }));
  const payments=rowsAsObjects(sheet(DEBTPAY_SHEET)).map(pm=>({
    ID:pm.ID, DebtID:pm.DebtID, Date:fmtDate(pm.Date), Amount:num(pm.Amount), PaidBy:pm.PaidBy
  }));
  return {debts:debts, payments:payments};
}
function addDebt(p){
  const sh=sheet(DEBT_SHEET); const id=uuid();
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
  sheet(DEBTPAY_SHEET).appendRow([uuid(),p.debtId,p.date||todayStr(),amt,p.paidBy||"Both",p.notes||""]);
  return {success:true, balance:newBal, paidOff:newBal===0};
}

// ─── Recurring flows (investments / divestments) ────────────────────────────
function getFlows(){
  const out=rowsAsObjects(sheet(FLOWS_SHEET)).map(f=>({
    ID:f.ID, Name:f.Name, FlowType:f.FlowType||"invest", Amount:num(f.Amount),
    Owner:f.Owner||"Both", AccountID:f.AccountID||"", GoalID:f.GoalID||"",
    DayOfMonth:Math.min(Math.max(parseInt(f.DayOfMonth)||1,1),28),
    Active:String(f.Active||"yes").toLowerCase()!=="no"
  }));
  return {flows:out};
}
function addFlow(p){
  const sh=sheet(FLOWS_SHEET); const id=uuid();
  sh.appendRow([id,p.name||"Flow",p.flowType==="divest"?"divest":"invest",num(p.amount),
    p.owner||"Both",p.accountId||"",p.goalId||"",Math.min(Math.max(parseInt(p.day)||1,1),28),"yes",todayStr()]);
  return {success:true,id};
}
function updateFlow(p){
  const found=updateRowById(sheet(FLOWS_SHEET),p.id,Object.assign({},
    p.name?{Name:p.name}:{}, p.flowType?{FlowType:p.flowType==="divest"?"divest":"invest"}:{},
    p.amount!=null?{Amount:num(p.amount)}:{}, p.owner?{Owner:p.owner}:{},
    p.accountId!=null?{AccountID:p.accountId}:{}, p.goalId!=null?{GoalID:p.goalId}:{},
    p.day!=null?{DayOfMonth:Math.min(Math.max(parseInt(p.day)||1,1),28)}:{},
    p.active!=null?{Active:p.active==="no"?"no":"yes"}:{}));
  return found?{success:true}:{error:"Not found"};
}
function deleteFlow(id){ return deleteRowById(sheet(FLOWS_SHEET),id)?{success:true}:{error:"Not found"}; }

// Runs daily; executes any active flow whose DayOfMonth is today and hasn't run this month.
function autoLogFlows(){ runFlows(new Date()); }
function runFlows(now){
  const flows=getFlows().flows.filter(f=>f.Active);
  const m=now.getMonth()+1, y=now.getFullYear(), day=now.getDate();
  const contribs=rowsAsObjects(sheet(CONTRIB_SHEET));
  let ran=0;
  flows.forEach(f=>{
    if(day<f.DayOfMonth) return; // not due yet this month
    const already=contribs.some(c=>String(c.Notes||"").indexOf("FLOW:"+f.ID)>-1 && monthMatch(c.Date,m,y));
    if(already) return;
    addContribution({flowType:f.FlowType,amount:f.Amount,accountId:f.AccountID,goalId:f.GoalID,owner:f.Owner,
      notes:"FLOW:"+f.ID+" "+f.Name,source:"auto"});
    ran++;
  });
  return {success:true, ran:ran};
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
  sheet(CONTRIB_SHEET).appendRow([uuid(),p.date||todayStr(),type,amt,p.accountId||"",p.goalId||"",p.owner||"Both",p.notes||"",p.source||"manual"]);
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
