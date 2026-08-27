const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');

// Mirrors the real sheet: all 8 debts Celeste's, card is Ateeq's, mixed accounts.
function serverGetAll() {
  return {
    transactions: [], goals: [], income: [], payments: [], flows: [], contributions: [],
    recurringBills: [], insights: { prevCategoryTotals: {}, monthly: [] },
    accounts: [
      { ID: 'a1', Name: "Ateeq's HYSA", Owner: 'Ateeq', Type: 'hysa', Balance: 410, APY: 2.8, LastReconciled: '', Limit: 0 },
      { ID: 'a2', Name: '401k — Ateeq', Owner: 'Ateeq', Type: 'retirement', Balance: 400, APY: 0, LastReconciled: '', Limit: 0 },
      { ID: 'a3', Name: '401k — Celeste', Owner: 'Celeste', Type: 'retirement', Balance: 500, APY: 0, LastReconciled: '', Limit: 0 },
      { ID: 'a4', Name: "Celeste's HYSA", Owner: 'Celeste', Type: 'hysa', Balance: 0, APY: 4.2, LastReconciled: '', Limit: 0 },
      { ID: 'a5', Name: 'Joint Checking', Owner: 'Both', Type: 'checking', Balance: 200, APY: 0, LastReconciled: '', Limit: 0 },
      { ID: 'card', Name: 'Credit Card', Owner: 'Ateeq', Type: 'credit', Balance: 374.04, APY: 0, LastReconciled: '', Limit: 1000 },
    ],
    debts: [
      { ID: 'd1', Name: '1-01 Direct Loan', Owner: 'Celeste', StartBalance: 3626.77, Balance: 3626.77, APR: 0, MinPayment: 200, HighPriority: false },
      { ID: 'd2', Name: 'Team Health', Owner: 'Celeste', StartBalance: 400, Balance: 400, APR: 0, MinPayment: 400, HighPriority: true },
    ],
    cardCharges: [], categories: [{ ID: 'c1', Name: 'Groceries', Icon: '🛒', Color: '#93c5fd', Budget: 600, Kind: 'flex' }],
  };
}

async function run() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/' });
  const w = dom.window;
  await new Promise(r => setTimeout(r, 400));
  const errors = [];
  w.addEventListener('error', e => errors.push(e.error ? (e.error.stack || String(e.error)) : e.message));
  const log = (l, fn) => { try { fn(); console.log('OK   ', l); } catch (e) { console.log('FAIL ', l, '->', e.message); errors.push(l + ': ' + e.stack); } };
  const aLog = async (l, fn) => { try { await fn(); console.log('OK   ', l); } catch (e) { console.log('FAIL ', l, '->', e.message); errors.push(l + ': ' + e.stack); } };

  w.eval("localStorage.removeItem(QUEUE_LS); localStorage.removeItem(DIDSETUP_LS);");
  w.fetch = async (url) => {
    const a = new URL(url).searchParams.get('action');
    if (a === 'getAll') return { ok: true, json: async () => serverGetAll() };
    return { ok: true, json: async () => ({ success: true }) };
  };

  await aLog('load', async () => { await w.loadForMonth(); });

  const round = n => Math.round(n * 100) / 100;

  log('allDebts() includes the credit card as its owner\'s debt', () => {
    const ds = w.eval('allDebts()');
    const card = ds.find(d => d.source === 'card');
    if (!card) throw new Error('card not present in allDebts');
    if (card.owner !== 'ateeq') throw new Error('card owner should be ateeq, got ' + card.owner);
    if (round(card.balance) !== 374.04) throw new Error('card balance wrong: ' + card.balance);
  });

  log('household net worth counts everything exactly once', () => {
    w.eval("S.person='All'");
    const nw = w.eval('netWorth()');
    // assets 410+400+500+0+200 = 1510 ; owed 3626.77+400+374.04 = 4400.81
    if (round(nw.assets) !== 1510) throw new Error('assets ' + nw.assets);
    if (round(nw.owed) !== 4400.81) throw new Error('owed ' + nw.owed);
    if (round(nw.net) !== -2890.81) throw new Error('net ' + nw.net);
  });

  log('Ateeq carries the card, NOT Celeste\'s loans', () => {
    const nw = w.eval("netWorth('ateeq')");
    // assets 410+400 + half of joint 100 = 910 ; owed = card 374.04 only
    if (round(nw.assets) !== 910) throw new Error('assets ' + nw.assets);
    if (round(nw.owed) !== 374.04) throw new Error('Ateeq should owe only the card, got ' + nw.owed);
    if (round(nw.net) !== 535.96) throw new Error('net ' + nw.net);
  });

  log('Celeste carries the loans, NOT the card', () => {
    const nw = w.eval("netWorth('celeste')");
    // assets 500+0 + half joint 100 = 600 ; owed 3626.77+400 = 4026.77
    if (round(nw.assets) !== 600) throw new Error('assets ' + nw.assets);
    if (round(nw.owed) !== 4026.77) throw new Error('Celeste owed ' + nw.owed);
    if (round(nw.net) !== -3426.77) throw new Error('net ' + nw.net);
  });

  log('the two individual views sum back to the household total', () => {
    const all = w.eval('netWorth("All")'), a = w.eval('netWorth("ateeq")'), c = w.eval('netWorth("celeste")');
    if (round(a.net + c.net) !== round(all.net)) throw new Error(`${a.net} + ${c.net} != ${all.net}`);
    if (round(a.owed + c.owed) !== round(all.owed)) throw new Error('owed does not reconcile');
  });

  log('the old bug is gone: the two people no longer show the same number', () => {
    const a = w.eval("netWorth('ateeq').net"), c = w.eval("netWorth('celeste').net");
    if (round(a) === round(c)) throw new Error('both people still show ' + a);
  });

  log('card debt grows dynamically when a charge is queued', () => {
    const before = w.eval("netWorth('ateeq').owed");
    w.eval("chargeCard('card',{date:todayStr(),desc:'Coffee',category:'Groceries',payer:'ateeq',amount:25,notes:''})");
    const after = w.eval("netWorth('ateeq').owed");
    if (round(after - before) !== 25) throw new Error(`expected +25 owed, got ${after - before}`);
    const cNow = w.eval("netWorth('celeste').owed");
    if (round(cNow) !== 4026.77) throw new Error("Celeste's debt moved when Ateeq charged: " + cNow);
  });

  log('Money tab renders per-person debt itemized, not the household total', () => {
    w.eval("S.person='ateeq'; S.moneyTab='overview';"); w.go('money');
    const h = w.document.getElementById('app').innerHTML;
    if (!h.includes('Credit Card')) throw new Error('card missing from Ateeq debt list');
    if (h.includes('1-01 Direct Loan')) throw new Error("Celeste's loan showing under Ateeq");
    w.eval("S.person='celeste'"); w.render();
    const h2 = w.document.getElementById('app').innerHTML;
    if (!h2.includes('1-01 Direct Loan')) throw new Error('loan missing from Celeste debt list');
    if (h2.includes('Credit Card')) throw new Error("Ateeq's card showing under Celeste");
  });

  log('debt rows in Goals show the owner name', () => {
    w.eval("S.person='All'"); w.go('goals');
    const h = w.document.getElementById('app').innerHTML;
    if (!h.includes('Celeste')) throw new Error('owner name missing on debt row');
  });

  log('scan defaults the payer to the cardholder, not Both', () => {
    if (w.eval('scanPayer()') !== 'ateeq') throw new Error('scanPayer is ' + w.eval('scanPayer()'));
    w.eval("localStorage.setItem('pp:anthropicApiKey','k')");
    w.openAdd(); w.setAddMode('scan');
    w.eval("S.scan.rows=[{id:0,date:'2026-08-20',desc:'X',amount:10,kind:'expense',category:'Groceries',include:true,duplicate:false}]; S.scan.status='results';");
    w.render();
    const h = w.document.getElementById('app').innerHTML;
    const seg = h.slice(h.indexOf('Whose statement'));
    const ateeqOn = /seg-opt on[^>]*>\s*🧔/.test(seg) || seg.indexOf('on"') < seg.indexOf('Celeste');
    if (!ateeqOn) throw new Error('Ateeq is not preselected in the scan payer toggle');
    w.importScanRows();
    const tx = w.eval("D.transactions.find(t=>t.desc==='X')");
    if (!tx || tx.payer !== 'ateeq') throw new Error('imported row payer = ' + (tx && tx.payer));
  });

  ['home','money','goals','recap','settings'].forEach(v => log('regression go(' + v + ')', () => w.go(v)));

  console.log('\n--- window errors ---'); errors.forEach(e => console.log(e));
  console.log('TOTAL ERRORS:', errors.length);
  process.exit(errors.length ? 1 : 0);
}
run();
