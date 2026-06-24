/*****************************************************************
 * PatchinPennies — Google Apps Script backend
 * Paste this over your existing Code.gs (Extensions → Apps Script),
 * then run setup() ONCE from the editor, then run installTriggers() ONCE.
 *
 * Your existing Transactions & Income data is preserved.
 * This only adds columns/sheets that don't exist yet.
 *****************************************************************/

const SPREADSHEET_ID = "1EfHBQsdm9b9Qh-k18kqjWiwN2aUsJO_hI3_qJyTvCLM";
const TX_SHEET     = "Transactions";
const INCOME_SHEET = "Income";
const GOALS_SHEET  = "Goals";
const RECUR_SHEET  = "Recurring";   // template rows that auto-log on the 1st
const DRIVE_FOLDER = "PatchinPennies Receipts";

// People to email the monthly recap to:
const RECAP_EMAILS = ["ateeq8474@gmail.com"]; // add Celeste's email here

function ss(){ return SpreadsheetApp.openById(SPREADSHEET_ID); }
function sheet(name){ const s=ss().getSheetByName(name); return s; }

// ─── Router ─────────────────────────────────────────────────────────────────
function doGet(e){
  const a=(e.parameter.action)||"getTransactions";
  let r;
  try{
    switch(a){
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
      case "ping":               r={ok:true}; break;
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
  // Transactions
  let tx=book.getSheetByName(TX_SHEET);
  if(!tx){ tx=book.insertSheet(TX_SHEET); }
  if(tx.getLastRow()===0){
    tx.appendRow(["ID","Date","Description","Category","PaidBy","Amount","TxType","Notes","ReceiptURL"]);
    tx.getRange(1,1,1,9).setFontWeight("bold");
  }
  // Income
  let inc=book.getSheetByName(INCOME_SHEET);
  if(!inc){ inc=book.insertSheet(INCOME_SHEET); inc.appendRow(["ID","Date","Description","Source","Amount","Notes"]); inc.getRange(1,1,1,6).setFontWeight("bold"); }
  // Goals (now with Type + Saved)
  let gl=book.getSheetByName(GOALS_SHEET);
  if(!gl){ gl=book.insertSheet(GOALS_SHEET); gl.appendRow(["ID","Name","Target","Saved","Type","TargetDate","Notes","Created"]); gl.getRange(1,1,1,8).setFontWeight("bold"); }
  else { ensureGoalCols(gl); }
  // Recurring template
  let rc=book.getSheetByName(RECUR_SHEET);
  if(!rc){
    rc=book.insertSheet(RECUR_SHEET);
    rc.appendRow(["Description","Category","PaidBy","Amount","Active"]);
    rc.getRange(1,1,1,5).setFontWeight("bold");
    // Seed with the recurring items from your data:
    [["Rent","Fixed","Both",1800,"yes"],
     ["Internet","Utilities","Ateeq",95,"yes"],
     ["Spotify – Ateeq","Subscriptions","Ateeq",20,"yes"],
     ["Spotify – Celeste","Subscriptions","Celeste",20,"yes"],
     ["Planned Parenthood","Donation","Celeste",10,"yes"],
     ["Patches Food Chewy","Patches' Expenses","Celeste",98.59,"yes"],
     ["Gym Membership","Health","Ateeq",20,"yes"],
     ["CCC School Tuition","Personal/Misc","Celeste",111.87,"yes"]].forEach(r=>rc.appendRow(r));
  }
  return "Setup complete. Now run installTriggers() once.";
}

function ensureGoalCols(gl){
  const hdr=gl.getRange(1,1,1,Math.max(gl.getLastColumn(),1)).getValues()[0].map(String);
  const need=["ID","Name","Target","Saved","Type","TargetDate","Notes","Created"];
  // If old goals sheet lacks Type/Saved, append missing headers at end
  need.forEach(h=>{ if(hdr.indexOf(h)===-1){ gl.getRange(1,gl.getLastColumn()+1).setValue(h); } });
}

// ─── Triggers (run once) ────────────────────────────────────────────────────
function installTriggers(){
  // clear old
  ScriptApp.getProjectTriggers().forEach(t=>ScriptApp.deleteTrigger(t));
  // auto-log recurring on the 1st, ~6am
  ScriptApp.newTrigger("autoLogRecurring").timeBased().onMonthDay(1).atHour(6).create();
  // monthly recap email on the 1st, ~7am
  ScriptApp.newTrigger("sendMonthlyRecap").timeBased().onMonthDay(1).atHour(7).create();
  return "Triggers installed: auto-recurring + recap email on the 1st.";
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
  if(isNaN(d)) { // string yyyy-mm-dd
    const p=String(dateVal).split("-"); return (+p[1]===+month)&&(+p[0]===+year);
  }
  return (d.getMonth()+1===+month)&&(d.getFullYear()===+year);
}
function fmtDate(d){ return (d instanceof Date)?Utilities.formatDate(d,tz(),"yyyy-MM-dd"):String(d).slice(0,10); }

// ─── Transactions ───────────────────────────────────────────────────────────
function getTransactions(month,year){
  const sh=sheet(TX_SHEET); const all=rowsAsObjects(sh);
  const out=all.filter(t=>monthMatch(t.Date,month,year)).map(t=>({
    ID:t.ID, Date:fmtDate(t.Date), Description:t.Description, Category:t.Category,
    PaidBy:t.PaidBy, Amount:num(t.Amount), TxType:t.TxType, Notes:t.Notes, ReceiptURL:t.ReceiptURL
  }));
  return {transactions:out};
}
function addTransaction(p){
  const sh=sheet(TX_SHEET);
  const id=uuid();
  sh.appendRow([id, p.date||todayStr(), p.description||"", p.category||"Personal/Misc",
    p.paidBy||"Ateeq", num(p.amount), p.txType||"One-time", p.notes||"", p.receiptUrl||""]);
  return {success:true, id};
}
function updateTransaction(p){
  const sh=sheet(TX_SHEET); const data=sh.getDataRange().getValues();
  for(let i=1;i<data.length;i++){
    if(String(data[i][0])===String(p.id)){
      if(p.date)sh.getRange(i+1,2).setValue(p.date);
      if(p.description!=null)sh.getRange(i+1,3).setValue(p.description);
      if(p.category)sh.getRange(i+1,4).setValue(p.category);
      if(p.paidBy)sh.getRange(i+1,5).setValue(p.paidBy);
      if(p.amount!=null)sh.getRange(i+1,6).setValue(num(p.amount));
      if(p.txType)sh.getRange(i+1,7).setValue(p.txType);
      return {success:true};
    }
  }
  return {error:"Not found"};
}
function deleteTransaction(id){
  const sh=sheet(TX_SHEET); const data=sh.getDataRange().getValues();
  for(let i=1;i<data.length;i++){ if(String(data[i][0])===String(id)){ sh.deleteRow(i+1); return {success:true}; } }
  return {error:"Not found"};
}

// ─── Recurring ──────────────────────────────────────────────────────────────
function seedFixed(month,year){
  const rc=sheet(RECUR_SHEET); const tx=sheet(TX_SHEET);
  const m=+month||(new Date().getMonth()+1), y=+year||(new Date().getFullYear());
  const dateStr=Utilities.formatDate(new Date(y,m-1,1),tz(),"yyyy-MM-dd");
  // avoid double-seed: check if any AUTO_SEED already exists this month
  const existing=rowsAsObjects(tx).some(t=>monthMatch(t.Date,m,y)&&String(t.Notes||"").indexOf("AUTO_SEED")>-1);
  if(existing) return {success:true, note:"already seeded"};
  const items=rowsAsObjects(rc).filter(r=>String(r.Active||"yes").toLowerCase()!=="no");
  items.forEach(r=>{
    tx.appendRow([uuid(),dateStr,r.Description,r.Category,r.PaidBy,num(r.Amount),"Recurring","AUTO_SEED",""]);
  });
  return {success:true, count:items.length};
}
// Trigger target — logs current month's recurring
function autoLogRecurring(){
  const now=new Date();
  seedFixed(now.getMonth()+1, now.getFullYear());
}

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
function deleteIncome(id){
  const sh=sheet(INCOME_SHEET); const data=sh.getDataRange().getValues();
  for(let i=1;i<data.length;i++){ if(String(data[i][0])===String(id)){ sh.deleteRow(i+1); return {success:true}; } }
  return {error:"Not found"};
}

// ─── Goals (savings + debt) ─────────────────────────────────────────────────
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
  const sh=sheet(GOALS_SHEET); const data=sh.getDataRange().getValues();
  const hdr=data[0].map(String); const idCol=hdr.indexOf("ID"), savedCol=hdr.indexOf("Saved");
  for(let i=1;i<data.length;i++){
    if(String(data[i][idCol])===String(p.goalId)){
      const cur=num(data[i][savedCol]);
      sh.getRange(i+1,savedCol+1).setValue(cur+num(p.amount));
      return {success:true};
    }
  }
  return {error:"Not found"};
}
function deleteGoal(id){
  const sh=sheet(GOALS_SHEET); const data=sh.getDataRange().getValues();
  const idCol=data[0].map(String).indexOf("ID");
  for(let i=1;i<data.length;i++){ if(String(data[i][idCol])===String(id)){ sh.deleteRow(i+1); return {success:true}; } }
  return {error:"Not found"};
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
  // recap is for the month that just ended
  const now=new Date();
  const d=new Date(now.getFullYear(),now.getMonth()-1,1); // previous month
  const m=d.getMonth()+1, y=d.getFullYear();
  const monthName=Utilities.formatDate(d,tz(),"MMMM yyyy");

  const txns=getTransactions(m,y).transactions;
  const income=getIncome(m,y).income;
  const expTotal=txns.reduce((s,t)=>s+t.Amount,0);
  const incTotal=income.reduce((s,i)=>s+i.Amount,0);
  const net=incTotal-expTotal;

  const catTotals={};
  txns.forEach(t=>{ catTotals[t.Category]=(catTotals[t.Category]||0)+t.Amount; });
  const top=Object.entries(catTotals).sort((a,b)=>b[1]-a[1]).slice(0,5);

  let ateeq=0,celeste=0;
  txns.forEach(t=>{ if(t.PaidBy==="Both"){ateeq+=t.Amount/2;celeste+=t.Amount/2;} else if(t.PaidBy==="Celeste")celeste+=t.Amount; else ateeq+=t.Amount; });

  const $=n=>"$"+(Math.round(n*100)/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
  const html=`
  <div style="font-family:Nunito,Arial,sans-serif;max-width:480px;margin:0 auto;background:#fdf6f9;padding:20px;border-radius:16px;color:#4a3048">
    <h1 style="font-size:22px;margin:0 0 4px">🐱 PatchinPennies</h1>
    <p style="color:#8a6880;font-weight:700;margin:0 0 18px">Your ${monthName} recap</p>
    <div style="background:#fff;border:1.5px solid #f0d6e8;border-radius:14px;padding:16px;margin-bottom:12px">
      <table style="width:100%;font-size:15px">
        <tr><td style="padding:6px 0;color:#8a6880;font-weight:700">💰 Income</td><td style="text-align:right;font-weight:800;color:#34d399">${$(incTotal)}</td></tr>
        <tr><td style="padding:6px 0;color:#8a6880;font-weight:700">💸 Spent</td><td style="text-align:right;font-weight:800;color:#f472b6">${$(expTotal)}</td></tr>
        <tr><td style="padding:6px 0;color:#8a6880;font-weight:700">${net>=0?"🎉 Saved":"⚠️ Overspent"}</td><td style="text-align:right;font-weight:900;color:${net>=0?"#34d399":"#fb7185"}">${net>=0?"+":"-"}${$(Math.abs(net))}</td></tr>
      </table>
    </div>
    <div style="background:#fff;border:1.5px solid #f0d6e8;border-radius:14px;padding:16px;margin-bottom:12px">
      <p style="font-weight:800;margin:0 0 10px">🏆 Top categories</p>
      ${top.map(([c,v])=>`<div style="display:flex;justify-content:space-between;padding:5px 0;font-size:14px"><span style="color:#8a6880;font-weight:700">${c}</span><span style="font-weight:800">${$(v)}</span></div>`).join("")}
    </div>
    <div style="background:#fff;border:1.5px solid #f0d6e8;border-radius:14px;padding:16px">
      <p style="font-weight:800;margin:0 0 10px">👫 Who spent what</p>
      <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:14px"><span style="color:#8a6880;font-weight:700">🧔 Ateeq</span><span style="font-weight:800">${$(ateeq)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:14px"><span style="color:#8a6880;font-weight:700">👩 Celeste</span><span style="font-weight:800">${$(celeste)}</span></div>
    </div>
    <p style="text-align:center;color:#b89aad;font-size:12px;font-weight:700;margin-top:16px">Keep it up, you two 🐾</p>
  </div>`;

  RECAP_EMAILS.forEach(addr=>{
    MailApp.sendEmail({to:addr,subject:`🐱 PatchinPennies — ${monthName} recap`,htmlBody:html});
  });
  return {success:true};
}

// Manual test: run this to email yourself the current recap right now
function testRecapNow(){ sendMonthlyRecap(); }
