const fs=require('fs');const {JSDOM}=require('jsdom');const ready=require('./boot');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const N=new Date(),Y=N.getFullYear(),M=N.getMonth()+1,p2=n=>String(n).padStart(2,'0');
const d=day=>`${Y}-${p2(M)}-${p2(day)}`;
// The account shape after the reconcile migration: a real checking account,
// corrected savings, and a card whose queued charges match its balance.
const ACC=[
 {ID:'chk',Name:"Ateeq's Checking",Owner:'Ateeq',Type:'checking',Balance:16.64,APY:0,LastReconciled:d(31>28?28:31),Limit:0},
 {ID:'hysa',Name:"Ateeq's HYSA",Owner:'Ateeq',Type:'hysa',Balance:350,APY:2.8,LastReconciled:'',Limit:0},
 {ID:'k1',Name:'Credit Card',Owner:'Ateeq',Type:'credit',Balance:0,APY:0,LastReconciled:'',Limit:1000},
 {ID:'k5',Name:"Ateeq's $5K Card",Owner:'Ateeq',Type:'credit',Balance:319,APY:0,LastReconciled:'',Limit:5000}];
const CHG=[
 {ID:'c1',AccountID:'k5',Date:d(28),Description:'Groceries',Category:'Groceries',PaidBy:'Ateeq',Amount:139.77,Settled:false,Notes:''},
 {ID:'c2',AccountID:'k5',Date:d(28),Description:'Unidentified charges - scan the card statement to itemise',Category:'Personal/Misc',PaidBy:'Ateeq',Amount:179.23,Settled:false,Notes:''}];
function payload(){return{transactions:[],goals:[],income:[],payments:[],flows:[],contributions:[],
 recurringBills:[],insights:{prevCategoryTotals:{},monthly:[]},cardCharges:CHG,accounts:ACC,debts:[],
 categories:[{ID:'c',Name:'Groceries',Icon:'🛒',Color:'#93c5fd',Budget:600,Kind:'flex'},
             {ID:'p',Name:'Personal/Misc',Icon:'📦',Color:'#f9a8d4',Budget:100,Kind:'flex'}]};}
(async()=>{
const dom=new JSDOM(html,{runScripts:'dangerously',resources:'usable',url:'http://localhost/'});
const w=dom.window; await ready(dom.window);
const errors=[]; w.addEventListener('error',e=>errors.push(e.error?(e.error.stack||String(e.error)):e.message));
const log=(l,fn)=>{try{fn();console.log('OK   ',l)}catch(e){console.log('FAIL ',l,'->',e.message);errors.push(l+': '+e.stack)}};
const R=n=>Math.round(n*100)/100;
w.eval("localStorage.removeItem(QUEUE_LS);localStorage.removeItem(DIDSETUP_LS);localStorage.removeItem('pp:ledger');");
w.fetch=async(u)=>{const a=new URL(u).searchParams.get('action');
 if(a==='getAll')return{ok:true,json:async()=>payload()};
 if(a==='getLedger')return{ok:true,json:async()=>({transactions:[],income:[]})};
 return{ok:true,json:async()=>({success:true})};};
await w.loadForMonth();
const H=()=>w.document.getElementById('app').innerHTML;

log('checking is a spendable account, not a card',()=>{
  const c=w.eval("acctById('chk')");
  if(!c) throw new Error('no checking account');
  if(c.type!=='checking') throw new Error('type = '+c.type);
  if(!w.eval("spendAccounts().some(a=>a.id==='chk')")) throw new Error('excluded from spendable accounts');
  if(w.eval("cards().some(a=>a.id==='chk')")) throw new Error('treated as a card');
});
log('checking counts toward net worth as an asset',()=>{
  const nw=w.eval("netWorth('ateeq')");
  // assets 16.64 + 350 = 366.64 ; owed = the 319 card
  if(R(nw.assets)!==366.64) throw new Error('assets = '+nw.assets);
  if(R(nw.owed)!==319) throw new Error('owed = '+nw.owed);
  if(R(nw.net)!==47.64) throw new Error('net = '+nw.net);
});
log('it shows in the Money tab so cash is finally visible',()=>{
  w.eval("S.person='ateeq';S.moneyTab='overview';"); w.go('money');
  const h=H();
  if(!h.includes("Ateeq's Checking")) throw new Error('checking missing from accounts list');
  if(!h.includes('🏦')) throw new Error('no checking icon');
});
log('savings reads the corrected 350, not the stale 410',()=>{
  if(R(w.eval("acctById('hysa').balance"))!==350) throw new Error('savings = '+w.eval("acctById('hysa').balance"));
});
log('a "no" from the raw sheet is not mistaken for a settled charge',()=>{
  // !!"no" === true, so this used to flip every outstanding charge to paid.
  if(w.eval("chargeSettled('no')")) throw new Error('"no" read as settled');
  if(w.eval("chargeSettled('')")) throw new Error('blank read as settled');
  if(!w.eval("chargeSettled('yes')")) throw new Error('"yes" not read as settled');
  if(!w.eval("chargeSettled(true)")) throw new Error('boolean true not honoured');
});
log("the 5K card's queued charges now reconcile to its balance",()=>{
  const bal=w.eval("acctById('k5').balance");
  const queued=w.eval("D.cardCharges.filter(c=>c.accountId==='k5'&&!c.settled).reduce((s,c)=>s+c.amount,0)");
  if(R(bal)!==319) throw new Error('balance = '+bal);
  if(R(queued)!==R(bal)) throw new Error(`queued ${queued} != balance ${bal}`);
});
log('the unidentified charge is labelled as such, not disguised',()=>{
  const c=w.eval("D.cardCharges.find(c=>c.amount===179.23)");
  if(!c) throw new Error('gap charge missing');
  if(!/Unidentified/i.test(c.desc)) throw new Error('not labelled: '+c.desc);
});
log('paying the 5K card off settles the full balance with no excess',()=>{
  const res=w.eval("payCard('k5',319,'chk')");
  if(R(res.paid)!==319) throw new Error('paid = '+res.paid);
  if(res.excess) throw new Error('should be no excess, got '+res.excess);
  if(R(w.eval("acctById('k5').balance"))!==0) throw new Error('card not cleared');
  if(R(w.eval("acctById('chk').balance"))!==R(16.64-319)) throw new Error('checking not drawn down: '+w.eval("acctById('chk').balance"));
});
log('a card can be paid from checking in the pay-off picker',()=>{
  w.eval("D.accounts.find(a=>a.id==='k5').balance=319;");
  w.openPayCardModal('k5');
  if(!w.eval('modalHTML()').includes("Ateeq's Checking")) throw new Error('checking not offered as a source');
  w.closeModal();
});
['home','money','goals','recap','settings'].forEach(v=>log('regression go('+v+')',()=>w.go(v)));
console.log('\n--- window errors ---'); errors.forEach(e=>console.log(e));
console.log('TOTAL ERRORS:',errors.length);
process.exit(errors.length?1:0);
})();
