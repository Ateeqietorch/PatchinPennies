const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const N=new Date(), M=N.getMonth()+1, Y=N.getFullYear();
const p2=n=>String(n).padStart(2,'0');
const d=(mOff,day)=>{const x=new Date(Y,N.getMonth()-mOff,day);return `${x.getFullYear()}-${p2(x.getMonth()+1)}-${p2(x.getDate())}`;};
const CATS=[{ID:'c1',Name:'Groceries',Icon:'🛒',Color:'#93c5fd',Budget:600,Kind:'flex'},
            {ID:'c2',Name:'Dining Out',Icon:'🍜',Color:'#fca5a5',Budget:200,Kind:'flex'}];
// Mirrors the real sheet: every debt Celeste's, DebtPayments empty, APR unset.
const DEBTS=[{ID:'d1',Name:'1-01 Direct Loan',Owner:'Celeste',StartBalance:3626.77,Balance:3626.77,APR:0,MinPayment:200,HighPriority:false,Created:d(6,1)},
             {ID:'d2',Name:'Team Health',Owner:'Celeste',StartBalance:400,Balance:400,APR:0,MinPayment:400,HighPriority:true,Created:d(6,1)}];
const THIS=[{ID:'t1',Date:d(0,3),Description:'Ramen',Category:'Dining Out',PaidBy:'Celeste',Amount:120,TxType:'One-time'},
            {ID:'t2',Date:d(0,4),Description:'Aldi',Category:'Groceries',PaidBy:'Ateeq',Amount:60,TxType:'One-time'},
            {ID:'t3',Date:d(0,5),Description:'Shared dinner',Category:'Dining Out',PaidBy:'Both',Amount:100,TxType:'One-time'}];
const OLD =[{ID:'t4',Date:d(2,7),Description:'Old sushi',Category:'Dining Out',PaidBy:'Celeste',Amount:400,TxType:'One-time'},
            {ID:'t5',Date:d(5,7),Description:'Ancient',Category:'Groceries',PaidBy:'Celeste',Amount:900,TxType:'One-time'}];
function payload(){return{transactions:THIS,goals:[],income:[{ID:'i1',Date:d(0,1),Description:'LPP',Source:'Celeste',Amount:1848}],
 payments:[],flows:[],contributions:[],recurringBills:[{ID:'r1',Name:'Rent',Kind:'bill',Category:'Rent',Amount:1800,Frequency:'monthly',Active:true}],
 insights:{prevCategoryTotals:{},monthly:[]},cardCharges:[],
 accounts:[{ID:'a1',Name:"Ateeq's HYSA",Owner:'Ateeq',Type:'hysa',Balance:410,APY:2.8,LastReconciled:'',Limit:0}],
 debts:DEBTS,categories:CATS};}
const LEDGER={transactions:THIS.concat(OLD),income:[{ID:'i1',Date:d(0,1),Description:'LPP',Source:'Celeste',Amount:1848},
                                                    {ID:'i2',Date:d(2,1),Description:'LPP',Source:'Celeste',Amount:1848}]};
(async()=>{
const dom=new JSDOM(html,{runScripts:'dangerously',resources:'usable',url:'http://localhost/'});
const w=dom.window; await new Promise(r=>setTimeout(r,400));
const errors=[]; w.addEventListener('error',e=>errors.push(e.error?(e.error.stack||String(e.error)):e.message));
const log=(l,fn)=>{try{fn();console.log('OK   ',l)}catch(e){console.log('FAIL ',l,'->',e.message);errors.push(l+': '+e.stack)}};
const aLog=async(l,fn)=>{try{await fn();console.log('OK   ',l)}catch(e){console.log('FAIL ',l,'->',e.message);errors.push(l+': '+e.stack)}};
w.eval("localStorage.removeItem(QUEUE_LS);localStorage.removeItem(DIDSETUP_LS);localStorage.removeItem('pp:ledger');");
w.fetch=async(u)=>{const a=new URL(u).searchParams.get('action');
 if(a==='getAll')return{ok:true,json:async()=>payload()};
 if(a==='getLedger')return{ok:true,json:async()=>LEDGER};
 return{ok:true,json:async()=>({success:true})};};
await w.loadForMonth();
const H=()=>w.document.getElementById('app').innerHTML;

console.log('\n── Debt tells the truth ──');
log('no fabricated payoff date when nothing has ever been paid',()=>{
  const h=w.eval("debtProjHTML(D.debts[0])");
  if(/debt-free/.test(h)) throw new Error('still projecting a payoff date: '+h);
  if(!h.includes('No payment logged yet')) throw new Error('does not say what is true: '+h);
});
log('it says how long the debt has gone untouched',()=>{
  const m=w.eval("monthsUntouched(D.debts[0])");
  if(m!==6) throw new Error('expected 6 months since Created, got '+m);
  if(!w.eval("debtProjHTML(D.debts[0])").includes('6 months')) throw new Error('duration not shown');
});
log('the minimum is still stated, just not treated as paid',()=>{
  if(!w.eval("debtProjHTML(D.debts[0])").includes('200')) throw new Error('minimum missing');
});
log('a real payment brings the forecast back, based on actual pace',()=>{
  w.eval(`D.debtPayments=[{id:'p1',debtId:'d1',date:'${d(0,2)}',amount:300,payer:'celeste'}]`);
  const h=w.eval("debtProjHTML(D.debts[0])");
  if(!h.includes('debt-free')) throw new Error('should forecast once there is history: '+h);
  if(!h.includes('your actual')) throw new Error('should be labelled as actual pace');
  if(!h.includes('no interest rate set')) throw new Error('should caveat the missing APR');
  w.eval("D.debtPayments=[]");
});
log('Goals says nothing was paid down instead of "0 crushed"',()=>{
  w.go('goals'); const h=H();
  if(!h.includes('Nothing paid down yet')) throw new Error('melt bar still implies progress');
  if(!h.includes('No payment has ever been logged')) throw new Error('no explicit note');
  if(!h.includes('no interest rate set')) throw new Error('no APR warning');
});

console.log('\n── Attention reflects reality ──');
log('the item says never paid, not "not this month"',()=>{
  const i=w.eval("attentionItems().find(x=>x.id==='debt-never-paid')");
  if(!i) throw new Error('never-paid item missing');
  if(!i.title.includes('4,027')) throw new Error('should name total owed: '+i.title);
  if(!i.sub.includes('Celeste')) throw new Error('should name whose');
  if(!i.sub.includes('6 months')) throw new Error('should say how long: '+i.sub);
  if(w.eval("attentionItems().some(x=>x.id==='debt-mins')")) throw new Error('both debt items fired at once');
});
log('once a payment exists it switches to the this-month item',()=>{
  w.eval(`D.debtPayments=[{id:'p1',debtId:'d1',date:'${d(3,2)}',amount:50,payer:'celeste'}]`);
  const ids=w.eval('attentionItems().map(i=>i.id)');
  if(ids.includes('debt-never-paid')) throw new Error('still claiming never paid');
  if(new Date().getDate()>=5 && !ids.includes('debt-mins')) throw new Error('should flag the unpaid month');
  w.eval("D.debtPayments=[]");
});
log('missing interest rates are flagged separately',()=>{
  const i=w.eval("attentionItems().find(x=>x.id==='no-apr')");
  if(!i) throw new Error('no-apr item missing');
  if(!i.title.includes('2 debts')) throw new Error('count wrong: '+i.title);
  w.eval("D.debts=D.debts.map(x=>Object.assign({},x,{apr:5.5}))");
  if(w.eval("attentionItems().some(x=>x.id==='no-apr')")) throw new Error('still flagging once rates are set');
  w.eval("D.debts=D.debts.map(x=>Object.assign({},x,{apr:0}))");
});

console.log('\n── Person view ──');
await aLog('tapping a person opens their own view and pulls full history',async()=>{
  w.openPerson('celeste');
  if(w.eval('S.view')!=='person') throw new Error('did not navigate');
  await new Promise(r=>setTimeout(r,60));
  if(w.eval('D.ledger.length')!==7) throw new Error('ledger not loaded: '+w.eval('D.ledger.length'));
});
log('the header names the person',()=>{ if(!H().includes('Celeste')) throw new Error('name missing'); });
log('all three dropdowns render with the documented options',()=>{
  const h=H();
  ['This month','Last 3 months','This year','All time'].forEach(o=>{ if(!h.includes(o)) throw new Error('period option missing: '+o); });
  ['Biggest first','Smallest first','Newest first','By category'].forEach(o=>{ if(!h.includes(o)) throw new Error('sort option missing: '+o); });
  if(!h.includes('All categories')) throw new Error('category dropdown missing');
});
log('the period dropdown actually changes the range',()=>{
  const n=p=>{w.setPV('period',p);return w.eval('personRows().length')};
  if(n('month')!==2) throw new Error('this month should be Ramen + shared, got '+n('month'));
  if(n('3mo')!==3) throw new Error('3 months should add the old sushi, got '+n('3mo'));
  if(n('all')!==4) throw new Error('all time should include everything, got '+n('all'));
});
log('shared costs are halved so the two people still sum to the household',()=>{
  w.setPV('period','month');
  const c=w.eval("personRows().reduce((s,t)=>s+t.amount*pvShare(t),0)");
  if(Math.round(c*100)/100!==170) throw new Error('Celeste should be 120 + half of 100 = 170, got '+c);
  w.eval("S.pv.id='ateeq'"); w.render();
  const a=w.eval("personRows().reduce((s,t)=>s+t.amount*pvShare(t),0)");
  if(Math.round(a*100)/100!==110) throw new Error('Ateeq should be 60 + 50 = 110, got '+a);
  if(Math.round((a+c)*100)/100!==280) throw new Error('the two should sum to the 280 household total');
  w.eval("S.pv.id='celeste'"); w.render();
});
log('sort by amount orders biggest to smallest and back',()=>{
  w.setPV('period','all'); w.setPV('sort','amount-desc');
  let amts=[...H().matchAll(/tx-amt[^>]*>\$([\d,]+)/g)].map(m=>+m[1].replace(/,/g,''));
  if(amts.join()!==[...amts].sort((a,b)=>b-a).join()) throw new Error('not descending: '+amts);
  w.setPV('sort','amount-asc');
  amts=[...H().matchAll(/tx-amt[^>]*>\$([\d,]+)/g)].map(m=>+m[1].replace(/,/g,''));
  if(amts.join()!==[...amts].sort((a,b)=>a-b).join()) throw new Error('not ascending: '+amts);
});
log('sort by date works in both directions',()=>{
  w.setPV('sort','date-desc');
  const first=H().indexOf('Ramen'), old=H().indexOf('Ancient');
  if(first<0||old<0||first>old) throw new Error('newest should lead');
  w.setPV('sort','date-asc');
  if(H().indexOf('Ancient')>H().indexOf('Ramen')) throw new Error('oldest should lead');
});
log('the category dropdown filters, and the breakdown adds to the total',()=>{
  w.setPV('sort','amount-desc'); w.setPV('cat','Dining Out');
  if(!w.eval("personRows().every(t=>t.category==='Dining Out')")) throw new Error('filter leaked');
  w.setPV('cat','');
  const total=w.eval("personRows().reduce((s,t)=>s+t.amount*pvShare(t),0)");
  const bars=w.eval("(()=>{const b={};personRows().forEach(t=>{const c=t.category||'x';b[c]=(b[c]||0)+t.amount*pvShare(t)});return Object.values(b).reduce((s,v)=>s+v,0)})()");
  if(Math.round(total*100)!==Math.round(bars*100)) throw new Error('category breakdown does not reconcile');
});
log('a per-month average is shown, not just a raw total',()=>{
  w.setPV('period','3mo');
  if(w.eval("periodMonths('3mo')")!==3) throw new Error('month count wrong');
  if(!H().includes('per month')) throw new Error('no per-month stat');
});
log('income for the period is shown alongside spending',()=>{
  const inc=w.eval('personIncomeTotal()');
  if(inc!==3696) throw new Error("Celeste's two paycheques in 3 months = 3696, got "+inc);
});
log('an empty period says so instead of rendering blank',()=>{
  w.eval("S.pv.cat='Groceries';S.pv.period='last';"); w.render();
  if(!H().includes('Nothing in this period')) throw new Error('no empty state');
  w.eval("S.pv.cat='';S.pv.period='3mo';"); w.render();
});
log('offline with no cached ledger it still shows the current month',()=>{
  const keep=w.eval('JSON.stringify(D.ledger)');
  w.eval("D.ledger=[]");
  if(w.eval('ledgerRows().length')!==w.eval('D.transactions.length')) throw new Error('did not fall back to the loaded month');
  w.eval("D.ledger="+keep+";");
});
console.log('\n── Regression ──');
['home','money','goals','recap','settings','person'].forEach(v=>log('go('+v+')',()=>w.go(v)));
console.log('\n--- window errors ---'); errors.forEach(e=>console.log(e));
console.log('TOTAL ERRORS:',errors.length);
process.exit(errors.length?1:0);
})();
