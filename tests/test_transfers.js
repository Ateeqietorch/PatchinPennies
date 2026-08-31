const fs=require('fs');const {JSDOM}=require('jsdom');const ready=require('./boot');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const N=new Date(),Y=N.getFullYear(),M=N.getMonth()+1,p2=n=>String(n).padStart(2,'0');
const d=day=>`${Y}-${p2(M)}-${p2(day)}`;
const CATS=[{ID:'c1',Name:'Dining Out',Icon:'🍜',Color:'#fca5a5',Budget:200,Kind:'flex'},
            {ID:'c2',Name:'Rent',Icon:'🏠',Color:'#fde68a',Budget:1800,Kind:'bill'},
            {ID:'c3',Name:'Personal/Misc',Icon:'📦',Color:'#f9a8d4',Budget:100,Kind:'flex'}];
// Ateeq's August as it will look after the import: real spending, the $1,800
// shared rent, and the four money-moves that are not consumption.
const TX=[
 {ID:'t1',Date:d(21),Description:'Happy Lamb Hot Pot',Category:'Dining Out',PaidBy:'Ateeq',Amount:58.13,TxType:'One-time',Notes:''},
 {ID:'t2',Date:d(24),Description:'Venmo to Celeste - lunch',Category:'Dining Out',PaidBy:'Ateeq',Amount:55,TxType:'One-time',Notes:''},
 {ID:'t3',Date:d(1),Description:'Rent',Category:'Rent',PaidBy:'Both',Amount:1800,TxType:'Recurring',Notes:'AUTO_SEED'},
 {ID:'m1',Date:d(28),Description:'Zelle to Celeste - my half of rent',Category:'Personal/Misc',PaidBy:'Ateeq',Amount:900,TxType:'One-time',Notes:'TRANSFER:settle'},
 {ID:'m2',Date:d(28),Description:'Fidelity - investing',Category:'Personal/Misc',PaidBy:'Ateeq',Amount:50,TxType:'One-time',Notes:'TRANSFER:savings'},
 {ID:'m3',Date:d(28),Description:'5/3 Online Transfer',Category:'Personal/Misc',PaidBy:'Ateeq',Amount:990,TxType:'One-time',Notes:'TRANSFER:unknown'},
 {ID:'m4',Date:d(21),Description:'Transfer to Zelle',Category:'Personal/Misc',PaidBy:'Ateeq',Amount:850,TxType:'One-time',Notes:'TRANSFER:unknown'},
];
function payload(){return{transactions:TX,goals:[],income:[{ID:'i1',Date:d(14),Description:'Gusto Payroll',Source:'Ateeq',Amount:1965.18}],
 payments:[],flows:[],contributions:[],recurringBills:[],insights:{prevCategoryTotals:{},monthly:[]},cardCharges:[],
 accounts:[],debts:[],categories:CATS};}
(async()=>{
const dom=new JSDOM(html,{runScripts:'dangerously',resources:'usable',url:'http://localhost/'});
const w=dom.window; await ready(dom.window);
const errors=[]; w.addEventListener('error',e=>errors.push(e.error?(e.error.stack||String(e.error)):e.message));
const log=(l,fn)=>{try{fn();console.log('OK   ',l)}catch(e){console.log('FAIL ',l,'->',e.message);errors.push(l+': '+e.stack)}};
const R=n=>Math.round(n*100)/100;
w.eval("localStorage.removeItem(QUEUE_LS);localStorage.removeItem(DIDSETUP_LS);localStorage.removeItem('pp:ledger');");
w.fetch=async(u)=>{const a=new URL(u).searchParams.get('action');
 if(a==='getAll')return{ok:true,json:async()=>payload()};
 if(a==='getLedger')return{ok:true,json:async()=>({transactions:TX,income:[{ID:'i1',Date:d(14),Description:'Gusto Payroll',Source:'Ateeq',Amount:1965.18}]})};
 return{ok:true,json:async()=>({success:true})};};
await w.loadForMonth();

log('a TRANSFER note makes the row a transfer, not an expense',()=>{
  const m=w.eval("D.transactions.find(t=>t.id==='m1')");
  if(m.kind!=='transfer') throw new Error('kind = '+m.kind);
  if(m.transferKind!=='settle') throw new Error('sub-kind = '+m.transferKind);
  if(w.eval("D.transactions.find(t=>t.id==='t1').kind")!=='expense') throw new Error('normal row misread as transfer');
});
log('the three sub-kinds are parsed',()=>{
  const k=id=>w.eval(`D.transactions.find(t=>t.id==='${id}').transferKind`);
  if(k('m2')!=='savings'||k('m3')!=='unknown'||k('m4')!=='unknown') throw new Error('sub-kinds wrong');
});
log('moving money does NOT inflate spending',()=>{
  // 58.13 + 55 + 1800 shared = 1913.13. The 2,790 of transfers must not appear.
  const t=w.eval('totalExpenses()');
  if(R(t)!==1913.13) throw new Error('totalExpenses = '+t+' (transfers leaked in)');
});
log('moving money does not land in any category budget',()=>{
  const c=w.eval('catTotals()');
  if(R(c['Personal/Misc']||0)!==0) throw new Error("Personal/Misc = "+c['Personal/Misc']+" - transfers were bucketed");
  if(R(c['Dining Out'])!==113.13) throw new Error('Dining Out = '+c['Dining Out']);
});
log('the rent settlement is not double-counted against Ateeq',()=>{
  const pt=w.eval('personTotals()');
  // 58.13 + 55 + half of the 1,800 shared rent = 1,013.13. Adding the 900 Zelle
  // on top would charge him rent twice.
  if(R(pt.ateeq)!==1013.13) throw new Error('Ateeq = '+pt.ateeq);
});
log('settle-up is unchanged by the transfer rows',()=>{
  // KNOWN BUG, reported separately: settleUp() adds the same amount to aPaid and
  // aOwes on every branch, so it returns 0 for all input and the Home settle card
  // (gated on abs(net)>=1) can never appear. What this test can still prove is
  // that adding transfer rows does not change the answer either way.
  const withMoves=w.eval('settleUp().net');
  const keep=w.eval('JSON.stringify(D.transactions)');
  w.eval("D.transactions=D.transactions.filter(t=>t.kind!=='transfer')");
  const without=w.eval('settleUp().net');
  w.eval("D.transactions="+keep+";");
  if(R(withMoves)!==R(without)) throw new Error(`transfers moved settle-up: ${withMoves} vs ${without}`);
});
log('"What left the account" adds up to every dollar that moved',()=>{
  w.openPerson('ateeq'); w.setPV('period','month');
  const c=w.eval("cashOut('ateeq','month')");
  if(R(c.spent)!==1013.13) throw new Error('spent = '+c.spent);
  if(R(c.saved)!==50) throw new Error('saved = '+c.saved);
  if(R(c.settled)!==900) throw new Error('settled = '+c.settled);
  if(R(c.unknown)!==1840) throw new Error('unknown = '+c.unknown);
  if(R(c.total)!==3803.13) throw new Error('total = '+c.total);
});
log('the card shows the split and names what is actually spending',()=>{
  const h=w.eval('cashOutHTML()');
  if(!h.includes('What left the account')) throw new Error('card missing');
  ['Moved to savings','Settled with Celeste','Destination unconfirmed'].forEach(l=>{
    if(!h.includes(l)) throw new Error('missing row: '+l); });
  if(!h.includes('is spending')) throw new Error('does not say how much of it is spending');
});
log('the person view still reports spending only, not the moves',()=>{
  const s=w.eval("personRows().reduce((s,t)=>s+t.amount*pvShare(t),0)");
  if(R(s)!==1013.13) throw new Error('person spend = '+s);
});
log('transfers are findable in Activity under their own filter',()=>{
  w.eval("S.moneyTab='activity';S.person='All';clearAct();S.act.kind='transfer';"); w.go('money');
  if(w.eval('filteredActivity().length')!==4) throw new Error('expected 4 moves, got '+w.eval('filteredActivity().length'));
  w.eval("clearAct();S.act.kind='expense'");
  if(w.eval('filteredActivity().length')!==3) throw new Error('expense filter wrong');
  w.clearAct();
});
log('a transfer row is labelled as a transfer in the list',()=>{
  w.eval("S.act.kind='transfer'"); w.render();
  const h=w.document.getElementById('app').innerHTML;
  if(!h.includes('Transfer')) throw new Error('not labelled');
  w.clearAct();
});
log('no cash-out card when nothing moved',()=>{
  const keepL=w.eval('JSON.stringify(D.ledger)'), keepT=w.eval('JSON.stringify(D.transactions)');
  w.eval("D.ledger=[];D.transactions=[];");
  if(w.eval("cashOut('ateeq','month').total")!==0) throw new Error('should be zero');
  if(w.eval('cashOutHTML()')!=='') throw new Error('should render nothing');
  w.eval("D.ledger="+keepL+";D.transactions="+keepT+";");   // restore BOTH, or later cases see an empty ledger
});
log('a PC bought from savings is spending, not a transfer',()=>{
  // Funding source does not decide the category. Money left and a thing came
  // back, so it counts - unlike moving money INTO savings, which does not.
  w.eval(`D.transactions.push(fromServerTx({ID:'pc',Date:'${d(21)}',Description:'Gaming PC (funded from savings)',Category:'Dining Out',PaidBy:'Ateeq',Amount:850,TxType:'One-time',Notes:''}))`);
  const t=w.eval("D.transactions.find(t=>t.id==='pc')");
  if(t.kind!=='expense') throw new Error('kind = '+t.kind);
  if(!w.eval("catTotals()['Dining Out']")) throw new Error('did not reach a category');
  w.eval("D.transactions=D.transactions.filter(t=>t.id!=='pc')");
});
log('a card payment is a transfer, and shows in its own row',()=>{
  w.eval(`D.transactions.push(fromServerTx({ID:'cp',Date:'${d(28)}',Description:'Credit card payment',Category:'Personal/Misc',PaidBy:'Ateeq',Amount:990,TxType:'One-time',Notes:'TRANSFER:cardpay'}));D.ledger=D.transactions.slice();`);
  const t=w.eval("D.transactions.find(t=>t.id==='cp')");
  if(t.kind!=='transfer'||t.transferKind!=='cardpay') throw new Error('kind='+t.kind+' sub='+t.transferKind);
  if(R(w.eval("cashOut('ateeq','month').cardpay"))!==990) throw new Error('cardpay bucket wrong');
  w.openPerson('ateeq'); w.setPV('period','month');
  if(!w.eval('cashOutHTML()').includes('Paid off the card')) throw new Error('no card row on the card');
  if(R(w.eval('totalExpenses()'))!==1913.13) throw new Error('card payment leaked into spending: '+w.eval('totalExpenses()'));
});
log('overpaying a card reports the untracked difference instead of eating it',()=>{
  w.eval(`D.accounts=[{id:'card1',name:'Credit Card',owner:'ateeq',type:'credit',balance:374.04,apy:0,limit:1000,lastReconciled:''}];
          D.cardCharges=[{id:'c1',accountId:'card1',date:'${d(13)}',desc:'Coffee',category:'Dining Out',payer:'ateeq',amount:374.04,settled:false,notes:''}];`);
  const res=w.eval("payCard('card1',990,'')");
  if(R(res.paid)!==374.04) throw new Error('paid = '+res.paid);
  if(R(res.excess)!==615.96) throw new Error('excess should be 615.96, got '+res.excess);
  if(R(w.eval("acctById('card1').balance"))!==0) throw new Error('card not cleared');
  if(!w.eval("D.transactions.some(t=>t.desc==='Coffee'&&t.cardSettled)")) throw new Error('charge did not become spending');
});
log('paying exactly what is owed reports no excess',()=>{
  w.eval(`D.accounts=[{id:'c2',name:'Card2',owner:'ateeq',type:'credit',balance:100,apy:0,limit:500,lastReconciled:''}];
          D.cardCharges=[{id:'x1',accountId:'c2',date:'${d(13)}',desc:'Thing',category:'Dining Out',payer:'ateeq',amount:100,settled:false,notes:''}];`);
  if(w.eval("payCard('c2',100,'').excess")!==0) throw new Error('false positive on an exact payment');
});

['home','money','goals','recap','settings','person'].forEach(v=>log('regression go('+v+')',()=>w.go(v)));
console.log('\n--- window errors ---'); errors.forEach(e=>console.log(e));
console.log('TOTAL ERRORS:',errors.length);
process.exit(errors.length?1:0);
})();
