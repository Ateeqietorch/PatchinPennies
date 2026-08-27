const fs=require('fs');const {JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const CATS=[{ID:'c1',Name:'Groceries',Icon:'🛒',Color:'#93c5fd',Budget:600,Kind:'flex'},
            {ID:'c2',Name:'Dining Out',Icon:'🍜',Color:'#fca5a5',Budget:200,Kind:'flex'}];
const TX=[
 {ID:'t1',Date:'2026-08-02',Description:'Aldi run',Category:'Groceries',PaidBy:'Ateeq',Amount:52,TxType:'one-time',Notes:'',Need:'need',Sub:''},
 {ID:'t2',Date:'2026-08-09',Description:'Aldi run',Category:'Groceries',PaidBy:'Ateeq',Amount:48,TxType:'one-time',Notes:'',Need:'need',Sub:''},
 {ID:'t3',Date:'2026-08-14',Description:'Coffee',Category:'Dining Out',PaidBy:'Ateeq',Amount:6,TxType:'one-time',Notes:'',Need:'want',Sub:''},
];
function serverGetAll(){return{transactions:TX,goals:[],income:[],payments:[],flows:[],contributions:[],
 recurringBills:[],insights:{prevCategoryTotals:{},monthly:[]},cardCharges:[],
 accounts:[{ID:'card1',Name:'Credit Card',Owner:'Ateeq',Type:'credit',Balance:0,APY:0,LastReconciled:'',Limit:1000}],
 debts:[],categories:CATS};}

(async()=>{
const dom=new JSDOM(html,{runScripts:'dangerously',resources:'usable',url:'http://localhost/'});
const w=dom.window; await new Promise(r=>setTimeout(r,400));
const errors=[];
w.addEventListener('error',e=>errors.push(e.error?(e.error.stack||String(e.error)):e.message));
const log=(l,fn)=>{try{fn();console.log('OK   ',l)}catch(e){console.log('FAIL ',l,'->',e.message);errors.push(l+': '+e.stack)}};
w.eval("localStorage.removeItem(QUEUE_LS);localStorage.removeItem(DIDSETUP_LS);");
w.fetch=async(u)=>{const a=new URL(u).searchParams.get('action');
  if(a==='getAll')return{ok:true,json:async()=>serverGetAll()};return{ok:true,json:async()=>({success:true})};};
await w.loadForMonth();
const H=()=>w.document.getElementById('app').innerHTML;

log('THE BUG: typing an amount no longer destroys the input or drops focus',()=>{
  w.openAdd();
  const inp=w.document.querySelector('.finput.big'); inp.focus();
  if(w.document.activeElement!==inp) throw new Error('could not focus to begin with');
  '12.50'.split('').forEach((c,i)=>{ inp.value=inp.value+c; inp.dispatchEvent(new w.Event('input',{bubbles:true})); });
  const now=w.document.querySelector('.finput.big');
  if(now!==inp) throw new Error('input element was replaced mid-typing');
  if(w.document.activeElement!==inp) throw new Error('focus lost while typing');
  if(inp.value!=='12.50') throw new Error('value = '+inp.value);
  if(w.eval('S.form.amount')!=='12.50') throw new Error('state not captured: '+w.eval('S.form.amount'));
});

log('typing a description also keeps focus, and state still records it',()=>{
  const d=[...w.document.querySelectorAll('.finput')].find(e=>e.placeholder&&e.placeholder.indexOf('Aldi')>=0);
  d.focus(); d.value='Coffee'; d.dispatchEvent(new w.Event('input',{bubbles:true}));
  if(w.document.activeElement!==d) throw new Error('focus lost on description');
  if(w.eval('S.form.desc')!=='Coffee') throw new Error('desc = '+w.eval('S.form.desc'));
});

log('tapping a category pill DOES still re-render (state-driven UI intact)',()=>{
  w.setForm('cat','Dining Out');
  if(!H().includes('Dining Out')) throw new Error('category pill missing');
  if(w.eval("S.form.cat")!=='Dining Out') throw new Error('cat not set');
});

log('expense form opens with only the essentials visible',()=>{
  w.openAdd();
  const h=H();
  if(h.includes('Need or want?')) throw new Error('Need/want should be folded away by default');
  if(h.includes('type="date"')) throw new Error('date field should be folded away by default');
  if(!h.includes('Amount')||!h.includes('Category')) throw new Error('essential fields missing');
  if(!h.includes('More details')) throw new Error('no disclosure affordance');
});

log('the disclosure summarises the defaults it is hiding',()=>{
  const h=H();
  if(!h.includes('need')||!h.includes('today')) throw new Error('summary does not state the hidden defaults');
});

log('More details expands the advanced fields, and collapses again',()=>{
  w.toggleAddDetails();
  let h=H();
  if(!h.includes('Need or want?')) throw new Error('did not expand');
  if(!h.includes('type="date"')) throw new Error('date missing after expand');
  if(!h.includes('Fewer details')) throw new Error('toggle label did not flip');
  w.toggleAddDetails();
  if(H().includes('Need or want?')) throw new Error('did not collapse again');
});

log('quick add is built from real history, never canned values',()=>{
  const q=w.eval('frequentTx(6)');
  const aldi=q.find(x=>x.desc==='Aldi run');
  if(!aldi) throw new Error('most-repeated item missing');
  if(aldi.count!==2) throw new Error('count = '+aldi.count);
  if(aldi.amount!==50) throw new Error('should average 52 and 48 -> 50, got '+aldi.amount);
  if(q[0].desc!=='Aldi run') throw new Error('not sorted by frequency');
  if(q.some(x=>x.amount===1000&&x.category==='Groceries')) throw new Error('canned $1000 charge is back');
});

log('quick add renders and one tap prefills without submitting',()=>{
  w.openAdd();
  if(!H().includes('qa-btn')) throw new Error('quick add not rendered');
  const before=w.eval('D.transactions.length');
  w.quickFill(0);
  if(w.eval('S.form.desc')!=='Aldi run') throw new Error('desc not prefilled');
  if(w.eval('S.form.amount')!=='50') throw new Error('amount not prefilled: '+w.eval('S.form.amount'));
  if(w.eval('S.form.cat')!=='Groceries') throw new Error('category not prefilled');
  if(w.eval('D.transactions.length')!==before) throw new Error('quick add submitted on its own!');
});

log('a prefilled quick add saves correctly end to end',()=>{
  const before=w.eval('D.transactions.length');
  w.submitTx();
  if(w.eval('D.transactions.length')!==before+1) throw new Error('did not save');
  const t=w.eval("D.transactions.find(t=>t.desc==='Aldi run'&&t.amount===50)");
  if(!t) throw new Error('saved row wrong');
  if(t.category!=='Groceries') throw new Error('category = '+t.category);
});

log('quick add hides itself when there is no history to draw on',()=>{
  const keep=w.eval('JSON.stringify(D.transactions)');
  w.eval("D.transactions=[];D.cardCharges=[];");
  if(w.eval('quickAddHTML()')!=='') throw new Error('should render nothing with no history');
  w.eval("D.transactions="+keep+";");
});

log('income form keeps focus while typing too',()=>{
  w.openAdd(); w.setAddMode('income');
  const inp=w.document.querySelector('.finput.big'); inp.focus();
  inp.value='2400'; inp.dispatchEvent(new w.Event('input',{bubbles:true}));
  if(w.document.activeElement!==inp) throw new Error('focus lost in income form');
  if(w.eval('S.incomeForm.amount')!=='2400') throw new Error('income amount not captured');
});

log('income still submits correctly after the quiet-setter change',()=>{
  const before=w.eval("D.transactions.filter(t=>t.kind==='income').length");
  w.eval("S.incomeForm.desc='Paycheck'");
  w.submitIncome();
  if(w.eval("D.transactions.filter(t=>t.kind==='income').length")!==before+1) throw new Error('income not saved');
  const t=w.eval("D.transactions.find(t=>t.desc==='Paycheck')");
  if(!t||t.amount!==2400) throw new Error('income amount wrong: '+(t&&t.amount));
});

log('move money form keeps focus while typing',()=>{
  w.openAdd(); w.setAddMode('move');
  const inp=w.document.querySelector('.finput.big');
  if(inp){ inp.focus(); inp.value='100'; inp.dispatchEvent(new w.Event('input',{bubbles:true}));
    if(w.document.activeElement!==inp) throw new Error('focus lost in move form');
    if(w.eval('S.moveForm.amount')!=='100') throw new Error('move amount not captured'); }
});

log('validation still fires on an empty amount',()=>{
  w.openAdd();
  const before=w.eval('D.transactions.length');
  w.eval("S.form.amount='';S.form.desc='x'");
  w.submitTx();
  if(w.eval('D.transactions.length')!==before) throw new Error('saved an empty amount');
});

['home','money','goals','recap','settings'].forEach(v=>log('regression go('+v+')',()=>w.go(v)));
console.log('\n--- window errors ---'); errors.forEach(e=>console.log(e));
console.log('TOTAL ERRORS:',errors.length);
process.exit(errors.length?1:0);
})();
