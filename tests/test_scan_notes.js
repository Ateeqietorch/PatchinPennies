const fs=require('fs');const {JSDOM}=require('jsdom');const ready=require('./boot');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const CATS=[{ID:'c1',Name:'Groceries',Icon:'🛒',Color:'#93c5fd',Budget:600,Kind:'flex'},
            {ID:'c2',Name:'Shopping',Icon:'🛍',Color:'#f0abfc',Budget:150,Kind:'flex'}];
function payload(){return{transactions:[],goals:[],income:[],payments:[],flows:[],contributions:[],
 recurringBills:[],insights:{prevCategoryTotals:{},monthly:[]},cardCharges:[],
 accounts:[{ID:'k',Name:'Credit Card',Owner:'Ateeq',Type:'credit',Balance:0,APY:0,LastReconciled:'',Limit:1000}],
 debts:[],categories:CATS};}
// What Claude returns once the note names who paid for specific rows.
const MODEL={transactions:[
 {date:'2026-03-16',description:'Jewel-Osco',amount:82.40,kind:'expense',category:'Groceries',paidBy:'Celeste'},
 {date:'2026-03-17',description:'Target',amount:45.00,kind:'expense',category:'Shopping',paidBy:'Both'},
 {date:'2026-03-18',description:'Shell',amount:30.00,kind:'expense',category:'Groceries',paidBy:''},
 {date:'2026-03-01',description:'Statement balance',amount:900,kind:'skip',category:'Groceries',paidBy:''}]};
function sse(obj){
  const t=JSON.stringify(obj); const parts=[];
  // The parser dispatches on the event object's own `type`, not the SSE
  // `event:` line, so the payload must carry it.
  parts.push('event: content_block_delta\ndata: '+JSON.stringify({type:'content_block_delta',index:0,delta:{type:'text_delta',text:t}})+'\n\n');
  parts.push('event: message_delta\ndata: '+JSON.stringify({type:'message_delta',delta:{stop_reason:'end_turn'}})+'\n\n');
  const enc=new TextEncoder(); let i=0;
  return {getReader(){return{read(){ if(i>=parts.length) return Promise.resolve({done:true});
    return Promise.resolve({done:false,value:enc.encode(parts[i++])}); }};}};
}
(async()=>{
const dom=new JSDOM(html,{runScripts:'dangerously',resources:'usable',url:'http://localhost/'});
const w=dom.window; await ready(dom.window);
const errors=[]; w.addEventListener('error',e=>errors.push(e.error?(e.error.stack||String(e.error)):e.message));
const log=(l,fn)=>{try{fn();console.log('OK   ',l)}catch(e){console.log('FAIL ',l,'->',e.message);errors.push(l+': '+e.stack)}};
const aLog=async(l,fn)=>{try{await fn();console.log('OK   ',l)}catch(e){console.log('FAIL ',l,'->',e.message);errors.push(l+': '+e.stack)}};
w.eval("localStorage.removeItem(QUEUE_LS);localStorage.removeItem(DIDSETUP_LS);localStorage.setItem(APIKEY_LS,'k');");
let sentBody=null;
w.fetch=async(u,opt)=>{
  if(String(u).indexOf('anthropic')>-1){ sentBody=JSON.parse(opt.body); return {ok:true,body:sse(MODEL)}; }
  const a=new URL(u).searchParams.get('action');
  if(a==='getAll')return{ok:true,json:async()=>payload()};
  return{ok:true,json:async()=>({success:true})};};
await w.loadForMonth();
const H=()=>w.document.getElementById('app').innerHTML;

log('the notes box is discoverable and says what it can do',()=>{
  w.openAdd(); w.setAddMode('scan');
  const h=H();
  if(!h.includes('Anything I should know?')) throw new Error('notes box not labelled clearly');
  if(!h.includes('who paid')) throw new Error('does not mention attribution');
  if(!h.includes('Celeste only')) throw new Error('no worked example of the payer case');
  if(!h.includes('setScanNotes')) throw new Error('textarea not wired');
});
log('typing a note does not re-render and lose the cursor',()=>{
  const ta=w.document.querySelector('textarea.finput'); ta.focus();
  ta.value='The grocery charge on 3/16 was paid for by Celeste only.';
  ta.dispatchEvent(new w.Event('input',{bubbles:true}));
  if(w.document.activeElement!==ta) throw new Error('focus lost while typing the note');
  if(!w.eval('S.scan.notes').includes('Celeste')) throw new Error('note not captured');
});
await aLog('the note is sent to Claude, and paidBy is in the schema',async()=>{
  w.eval("S.scan.images=[{b64:'x',mediaType:'image/png',dataUrl:'d'}]");
  await w.runStatementScan();
  const txt=sentBody.messages[0].content.find(c=>c.type==='text').text;
  if(!txt.includes('Celeste only')) throw new Error('the note never reached the prompt');
  if(!txt.includes('WHO PAID')) throw new Error('prompt does not explain the attribution rule');
  const props=sentBody.output_config.format.schema.properties.transactions.items;
  if(!props.properties.paidBy) throw new Error('paidBy missing from the schema');
  if(props.properties.paidBy.enum.indexOf('Celeste')<0) throw new Error('people not in the enum');
  if(props.properties.paidBy.enum.indexOf('')<0) throw new Error('no way to say "not stated"');
});
log('a row the note named is attributed to that person',()=>{
  const r=w.eval("S.scan.rows.find(r=>r.desc==='Jewel-Osco')");
  if(r.payer!=='celeste') throw new Error('payer = '+r.payer);
  if(!r.payerFromNote) throw new Error('not flagged as coming from the note');
});
log('"Both" from the note becomes a split row',()=>{
  const r=w.eval("S.scan.rows.find(r=>r.desc==='Target')");
  if(r.payer!==w.eval('BOTH')) throw new Error('payer = '+r.payer);
});
log('a row the note said nothing about stays unset, not guessed',()=>{
  const r=w.eval("S.scan.rows.find(r=>r.desc==='Shell')");
  if(r.payer!==null) throw new Error('should be null, got '+r.payer);
  if(r.payerFromNote) throw new Error('falsely flagged as from the note');
});
log('the review screen shows the attribution and marks its source',()=>{
  w.render(); const h=H();
  if(!h.includes('from your note')) throw new Error('no indication the note was applied');
  if(!h.includes('(default)')) throw new Error('unset rows do not show the fallback');
  if(!h.includes("setScanRowField")) throw new Error('per-row payer not editable');
});
log('the per-row dropdown overrides, and clearing it restores the default',()=>{
  // Row 2 (Shell) is the unattributed one, so this leaves the note-driven rows
  // intact for the import assertions below.
  w.setScanRowField(2,'payer','celeste');
  const r=w.eval("S.scan.rows[2]");
  if(r.payer!=='celeste') throw new Error('override ignored');
  if(r.payerFromNote) throw new Error('a manual pick must not claim it came from the note');
  w.setScanRowField(2,'payer','');
  if(w.eval("S.scan.rows[2].payer")!==null) throw new Error('clearing did not restore the default');
});
log('import honours per-row payers and falls back for the rest',()=>{
  w.eval("S.scan.payer='ateeq'");
  w.importScanRows();
  const g=w.eval("D.transactions.find(t=>t.desc==='Jewel-Osco')");
  const t=w.eval("D.transactions.find(t=>t.desc==='Target')");
  const s=w.eval("D.transactions.find(t=>t.desc==='Shell')");
  if(!g||g.payer!=='celeste') throw new Error('Jewel-Osco payer = '+(g&&g.payer));
  if(!t||t.payer!==w.eval('BOTH')) throw new Error('Target payer = '+(t&&t.payer));
  if(!s||s.payer!=='ateeq') throw new Error('Shell should fall back to the owner, got '+(s&&s.payer));
  if(w.eval("D.transactions.some(t=>t.desc==='Statement balance')")) throw new Error('a skip row was imported');
});
log('per-person totals reflect the note, not a blanket owner',()=>{
  // The rows are dated March (matching the "3/16" example), and personTotals()
  // only sees the month in view - so look at March.
  w.eval("S.month=3;S.year=2026;");
  const pt=w.eval('personTotals()');
  // Celeste 82.40 + half of the 45 split = 104.90 ; Ateeq 30 + 22.50 = 52.50
  if(Math.round(pt.celeste*100)/100!==104.90) throw new Error('Celeste = '+pt.celeste);
  if(Math.round(pt.ateeq*100)/100!==52.50) throw new Error('Ateeq = '+pt.ateeq);
});
['home','money','goals','recap','settings'].forEach(v=>log('regression go('+v+')',()=>w.go(v)));
console.log('\n--- window errors ---'); errors.forEach(e=>console.log(e));
console.log('TOTAL ERRORS:',errors.length);
process.exit(errors.length?1:0);
})();
