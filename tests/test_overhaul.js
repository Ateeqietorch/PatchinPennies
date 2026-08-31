const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const N=new Date(), M=N.getMonth()+1, Y=N.getFullYear();
const d=n=>`${Y}-${String(M).padStart(2,'0')}-${String(n).padStart(2,'0')}`;
// Mirrors their real shape: all debt Celeste's with minimums and nothing logged,
// Dining Out blown past its budget, Ateeq's card over 30% utilisation.
const CATS=[{ID:'c1',Name:'Groceries',Icon:'🛒',Color:'#93c5fd',Budget:600,Kind:'flex'},
 {ID:'c2',Name:'Dining Out',Icon:'🍜',Color:'#fca5a5',Budget:200,Kind:'flex'},
 {ID:'c3',Name:'Shopping',Icon:'🛍',Color:'#fcd34d',Budget:150,Kind:'flex'},
 {ID:'c4',Name:'Rent',Icon:'🏠',Color:'#a7f3d0',Budget:1800,Kind:'bill'},
 {ID:'c5',Name:'Utilities',Icon:'💡',Color:'#bfdbfe',Budget:200,Kind:'bill'},
 {ID:'c6',Name:'Health',Icon:'💊',Color:'#ddd6fe',Budget:80,Kind:'flex'},
 {ID:'c7',Name:'Transport',Icon:'🚗',Color:'#fbcfe8',Budget:120,Kind:'flex'},
 {ID:'c8',Name:'Donation',Icon:'🤲',Color:'#fde68a',Budget:50,Kind:'bill'},
 {ID:'c9',Name:"Patches' Expenses",Icon:'🐱',Color:'#f9a8d4',Budget:60,Kind:'flex'}];
const TX=[
 {ID:'t1',Date:d(2),Description:'Aldi run',Category:'Groceries',PaidBy:'Ateeq',Amount:52,TxType:'one-time',Notes:'',Need:'need',Sub:''},
 {ID:'t2',Date:d(9),Description:'Aldi run',Category:'Groceries',PaidBy:'Ateeq',Amount:48,TxType:'one-time',Notes:'',Need:'need',Sub:''},
 {ID:'t3',Date:d(11),Description:'Ramen night',Category:'Dining Out',PaidBy:'Celeste',Amount:420,TxType:'one-time',Notes:'',Need:'want',Sub:''},
 {ID:'t4',Date:d(12),Description:'Sushi',Category:'Dining Out',PaidBy:'Ateeq',Amount:120,TxType:'one-time',Notes:'',Need:'want',Sub:''},
 {ID:'t5',Date:d(13),Description:'Litter',Category:"Patches' Expenses",PaidBy:'Both',Amount:24,TxType:'one-time',Notes:'',Need:'need',Sub:''},
 {ID:'t6',Date:d(14),Description:'Paycheck',Category:'',PaidBy:'Ateeq',Amount:2400,TxType:'one-time',Notes:'',Need:'',Sub:''},
];
function base(o){return Object.assign({transactions:TX.slice(0,5),goals:[],income:[TX[5]],payments:[],flows:[],contributions:[],
 recurringBills:[{ID:'r1',Name:'Rent',Kind:'bill',Category:'Rent',Amount:1800,PaidBy:'Both',Frequency:'monthly',DayOfMonth:1,Active:true}],
 insights:{prevCategoryTotals:{'Dining Out':300},monthly:[]},
 cardCharges:[{ID:'cc1',AccountID:'card1',Date:d(15),Description:'Gas',Category:'Transport',PaidBy:'Ateeq',Amount:60,Settled:false,Notes:''}],
 accounts:[{ID:'a1',Name:"Ateeq's HYSA",Owner:'Ateeq',Type:'hysa',Balance:410,APY:2.8,LastReconciled:'',Limit:0},
           {ID:'card1',Name:'Credit Card',Owner:'Ateeq',Type:'credit',Balance:374.04,APY:0,LastReconciled:'',Limit:1000}],
 debts:[{ID:'d1',Name:'1-01 Direct Loan',Owner:'Celeste',StartBalance:3626.77,Balance:3626.77,APR:0,MinPayment:200,HighPriority:false},
        {ID:'d2',Name:'Team Health',Owner:'Celeste',StartBalance:400,Balance:400,APR:0,MinPayment:400,HighPriority:true}],
 categories:CATS},o||{});}

(async()=>{
const dom=new JSDOM(html,{runScripts:'dangerously',resources:'usable',url:'http://localhost/'});
const w=dom.window; await new Promise(r=>setTimeout(r,400));
const errors=[];
w.addEventListener('error',e=>errors.push(e.error?(e.error.stack||String(e.error)):e.message));
const log=(l,fn)=>{try{fn();console.log('OK   ',l)}catch(e){console.log('FAIL ',l,'->',e.message);errors.push(l+': '+e.stack)}};
w.eval("localStorage.removeItem(QUEUE_LS);localStorage.removeItem(DIDSETUP_LS);");
let PAYLOAD=base();
w.fetch=async(u)=>{const a=new URL(u).searchParams.get('action');
 if(a==='getAll')return{ok:true,json:async()=>PAYLOAD};return{ok:true,json:async()=>({success:true})};};
await w.loadForMonth();
const H=()=>w.document.getElementById('app').innerHTML;
const ids=()=>w.eval('attentionItems().map(i=>i.id)');
const dayNow=new Date().getDate();

console.log('\n── Category picker ──');
log('categories rank by real usage, not creation order',()=>{
  const r=w.eval('categoriesByUse().map(c=>c.name)');
  if(r[0]!=='Groceries') throw new Error('most-used should lead, got '+r[0]);
  if(r.indexOf('Dining Out')>r.indexOf('Rent')) throw new Error('used category ranked below unused one');
  if(r.length!==9) throw new Error('lost categories: '+r.length);
});
log('ties keep their original order so the list does not reshuffle',()=>{
  const r=w.eval('categoriesByUse().map(c=>c.name)');
  const unused=r.filter(n=>['Rent','Utilities','Health','Shopping','Donation'].includes(n));
  if(unused.join()!=='Shopping,Rent,Utilities,Health,Donation') throw new Error('unstable tie order: '+unused.join());
});
log('a filter box appears only once the list is long enough to need one',()=>{
  w.openAdd();
  if(!H().includes('catfind')) throw new Error('9 categories should get a filter box');
  const keep=w.eval('JSON.stringify(D.categories)');
  w.eval("D.categories=D.categories.slice(0,4);"); w.render();
  if(H().includes('catfind')) throw new Error('4 categories should NOT get a filter box');
  w.eval("D.categories="+keep+";"); w.render();
});
log('filtering narrows the pills and keeps keyboard focus',()=>{
  w.openAdd();
  const box=w.document.querySelector('.catfind'); box.focus();
  box.value='din'; box.dispatchEvent(new w.Event('input',{bubbles:true}));
  const after=w.document.querySelector('.catfind');
  if(w.document.activeElement!==after) throw new Error('focus lost while filtering');
  if(after.value!=='din') throw new Error('filter value lost: '+after.value);
  const h=H();
  if(!h.includes('Dining Out')) throw new Error('match missing');
  if(h.includes('>Utilities<')) throw new Error('non-match still shown');
});
log('the selected category stays visible even when it does not match',()=>{
  w.eval("S.form.cat='Groceries';S.catFilter='din';"); w.render();
  if(!H().includes('Groceries')) throw new Error('selected pill vanished behind the filter');
});
log('a filter matching nothing explains itself instead of going blank',()=>{
  w.eval("S.form.cat='Groceries';S.catFilter='zzzz';"); w.render();
  const h=H();
  if(!h.includes('Nothing matches')) throw new Error('no empty state for a dead filter');
  if(!h.includes('clear the filter')) throw new Error('no escape hatch');
  if(!h.includes('Groceries')) throw new Error('selected pill should still be reachable');
  w.eval("S.catFilter=''");
});
log('picking a category clears the filter',()=>{
  w.pickCat('Dining Out');
  if(w.eval('S.catFilter')!=='') throw new Error('filter survived the pick');
  if(w.eval('S.form.cat')!=='Dining Out') throw new Error('category not set');
});

console.log('\n── Activity ──');
log('Activity lists transactions AND unsettled card charges',()=>{
  w.eval("S.moneyTab='activity';S.person='All';clearAct();"); w.go('money');
  const r=w.eval('activityRows()');
  if(r.length!==7) throw new Error('expected 5 expenses + 1 income + 1 queued charge, got '+r.length);
  if(!r.some(x=>x.queued&&x.desc==='Gas')) throw new Error('queued card charge missing');
});
log('rows are newest first',()=>{
  const r=w.eval('activityRows().map(x=>x.date)');
  if(r.join()!==[...r].sort().reverse().join()) throw new Error('not sorted: '+r.join());
});
log('a queued charge is badged and does not open a missing transaction',()=>{
  const h=H();
  if(!h.includes('Queued')) throw new Error('no queued badge');
  if(h.includes(`openTxDetail('cc1')`)) throw new Error('queued row links to a transaction that does not exist');
});
log('search matches description, category, person and amount',()=>{
  const t=(q,n)=>{w.eval(`clearAct();S.act.q=${JSON.stringify(q)}`);const g=w.eval('filteredActivity().length');
    if(g!==n) throw new Error(`"${q}" -> ${g}, expected ${n}`);};
  t('sushi',1); t('dining',2); t('celeste',1); t('paycheck',1); t('420',1); t('',7);
});
log('the type filter separates spending, income and queued charges',()=>{
  const t=(k,n)=>{w.eval(`clearAct();S.act.kind='${k}'`);const g=w.eval('filteredActivity().length');
    if(g!==n) throw new Error(`${k} -> ${g}, expected ${n}`);};
  t('income',1); t('queued',1); t('expense',6); t('all',7);
});
log('category filter and search combine rather than override',()=>{
  w.eval("S.act={q:'sushi',cat:'Dining Out',kind:'expense'}");
  if(w.eval('filteredActivity().length')!==1) throw new Error('combined filter wrong');
  w.eval("S.act.cat='Groceries'");
  if(w.eval('filteredActivity().length')!==0) throw new Error('should be empty: sushi is not Groceries');
});
log('the person toggle still narrows Activity',()=>{
  w.eval("clearAct();S.person='celeste';");
  const n=w.eval('filteredActivity().length');
  if(!w.eval("filteredActivity().every(t=>t.payer==='celeste'||t.payer===BOTH)")) throw new Error('leaked another person');
  if(n===6) throw new Error('person filter had no effect');
  w.eval("S.person='All'");
});
log('empty results explain themselves and offer a way out',()=>{
  w.eval("S.act.q='nothingmatchesthis'"); w.render();
  const h=H();
  if(!h.includes('Nothing matches')) throw new Error('no empty state');
  if(!h.includes('Clear filters')) throw new Error('no escape hatch');
  w.clearAct();
});
log('a running count and totals are shown for what is on screen',()=>{
  w.eval("S.act.kind='expense'"); w.render();
  if(!H().includes('of 7 shown')) throw new Error('no result count');
  w.clearAct();
});

console.log('\n── Attention ──');
log('the never-paid debt is surfaced as the top item',()=>{
  // This fixture has debts and an empty DebtPayments sheet, which is the real
  // situation: not a missed month, a balance nobody has ever paid.
  const items=w.eval('attentionItems()');
  const i=items.find(x=>x.id==='debt-never-paid');
  if(!i) throw new Error('missed $4,026.77 of debt with no payment ever logged');
  if(items[0].id!=='debt-never-paid') throw new Error('not ranked first, got '+items[0].id);
  if(!i.title.includes('4,027')) throw new Error('title should name the amount owed: '+i.title);
  if(!i.sub.includes('Celeste')) throw new Error('should name whose debt it is');
  if(items.some(x=>x.id==='debt-mins')) throw new Error('the this-month item must not fire as well');
});
log('over-budget categories are flagged worst-first with real numbers',()=>{
  const o=ids().filter(x=>x.startsWith('over-'));
  if(!o.length) throw new Error('Dining Out is 340 over and was not flagged');
  if(o[0]!=='over-Dining Out') throw new Error('worst overspend not first: '+o[0]);
  const i=w.eval("attentionItems().find(x=>x.id==='over-Dining Out')");
  if(!i.title.includes('340')) throw new Error('should state the overage: '+i.title);
});
log('card utilisation over 30% is flagged with the percentage',()=>{
  const i=w.eval("attentionItems().find(x=>x.id==='util-card1')");
  if(!i) throw new Error('374/1000 = 37% went unflagged');
  if(!i.title.includes('37%')) throw new Error('title: '+i.title);
});
log('items are ordered now > soon > setup',()=>{
  const sev=w.eval('attentionItems().map(i=>i.sev)');
  const rank={now:0,soon:1,setup:2};
  for(let i=1;i<sev.length;i++) if(rank[sev[i]]<rank[sev[i-1]]) throw new Error('out of order: '+sev.join());
});
log('setup gaps appear for an empty household',()=>{
  const keep=w.eval('JSON.stringify({a:D.accounts,r:D.recurring,c:D.categories})');
  w.eval("D.accounts=[];D.recurring=[];D.categories=D.categories.map(c=>Object.assign({},c,{budget:0}));");
  const g=ids();
  ['no-accounts','no-budgets','no-recurring'].forEach(k=>{ if(!g.includes(k)) throw new Error('missing '+k); });
  if(w.eval('attentionItems()[0].sev')==='setup'&&g.includes('debt-mins')) throw new Error('setup outranked a live problem');
  const k=JSON.parse(keep); w.eval(`D.accounts=${JSON.stringify(k.a)};D.recurring=${JSON.stringify(k.r)};D.categories=${JSON.stringify(k.c)};`);
});
log('a fully-configured month reports all clear instead of rendering nothing',()=>{
  const snap=w.eval('JSON.stringify({d:D.debts,c:D.categories,a:D.accounts})');
  w.eval("D.debts=[];D.accounts=D.accounts.filter(a=>a.type!=='credit');D.categories=D.categories.map(c=>Object.assign({},c,{budget:99999}));localStorage.setItem(APIKEY_LS,'k');");
  if(w.eval('attentionItems().length')!==0) throw new Error('still flagging: '+ids().join());
  if(!w.eval('attentionHTML()').includes('Nothing needs you right now')) throw new Error('no all-clear state');
  const k=JSON.parse(snap); w.eval(`D.debts=${JSON.stringify(k.d)};D.categories=${JSON.stringify(k.c)};D.accounts=${JSON.stringify(k.a)};`);
  w.eval("localStorage.removeItem(APIKEY_LS)");
});
log('attention stays quiet on a month that already closed',()=>{
  const m=w.eval('S.month'), y=w.eval('S.year');
  w.eval("S.month=S.month===1?12:S.month-1; if(S.month===12)S.year--;");
  if(w.eval('attentionItems().length')!==0) throw new Error('nagging about a past month');
  w.eval(`S.month=${m};S.year=${y};`);
});
log('Home leads with the attention card',()=>{
  w.go('home');
  const h=H();
  if(!h.includes('Start here')) throw new Error('attention card missing from Home');
  if(h.indexOf('Start here')>h.indexOf('Left for everyday')) throw new Error('should sit above the hero');
});
log('Home caps the list at 3 with a way to see the rest',()=>{
  const n=w.eval('attentionItems().length');
  if(n>3){ const h=H();
    if(!h.includes('more')) throw new Error('no expander for '+n+' items');
    w.toggleAttentionAll();
    if(!H().includes('Show less')) throw new Error('expander did not toggle');
    w.toggleAttentionAll(); }
});
log('Settings badges the sections that actually have something waiting',()=>{
  w.go('settings');
  const h=H();
  if(!h.includes('attn-dot')) throw new Error('no badges rendered');
  if(w.eval("attentionCount('categories')")<1) throw new Error('categories should be badged');
  if(w.eval("attentionCount('people')")!==0) throw new Error('people has nothing pending and must not be badged');
});
log('the over-budget CTA lands on that category filtered in Activity',()=>{
  w.eval("attentionItems().find(i=>i.id==='over-Dining Out').action");
  w.eval(w.eval("attentionItems().find(i=>i.id==='over-Dining Out').action"));
  if(w.eval('S.act.cat')!=='Dining Out') throw new Error('filter not applied');
  if(w.eval('S.moneyTab')!=='activity') throw new Error('did not land on Activity');
  if(w.eval('filteredActivity().length')!==2) throw new Error('wrong rows');
  w.clearAct();
});
log('a queued offline write is surfaced as pending, not lost',()=>{
  w.eval(`localStorage.setItem(QUEUE_LS,JSON.stringify([{op:'addTransaction',params:{}}]))`);
  const i=w.eval("attentionItems().find(x=>x.id==='queued')");
  if(!i) throw new Error('pending write not surfaced');
  if(i.sev!=='now') throw new Error('should be urgent');
  w.eval(`localStorage.removeItem(QUEUE_LS)`);
});

console.log('\n── Regression ──');
['home','money','goals','recap','settings','add'].forEach(v=>log('go('+v+')',()=>w.go(v)));
log('every attention action is a real callable expression',()=>{
  w.eval("S.moneyTab='overview'");
  w.eval('attentionItems()').forEach(i=>{ try{ new w.Function(i.action); }catch(e){ throw new Error(i.id+': '+e.message); } });
});
log('no alert/prompt anywhere in source',()=>{
  const src=html.split('\n').filter(l=>!l.trim().startsWith('//')).join('\n');
  if(/\b(window\.)?(alert|prompt)\s*\(/.test(src)) throw new Error('found a native dialog');
});
console.log('\n--- window errors ---'); errors.forEach(e=>console.log(e));
console.log('TOTAL ERRORS:',errors.length);
process.exit(errors.length?1:0);
})();
