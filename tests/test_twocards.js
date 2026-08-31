const fs = require('fs');
const { JSDOM } = require('jsdom');const ready=require('./boot');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');

// Two cards for Ateeq (the $1k and the new $5k) plus one hypothetical Celeste card,
// so we can prove a charge lands on the right person and not just people[0].
function serverGetAll() {
  return {
    transactions: [], goals: [], income: [], payments: [], flows: [], contributions: [],
    recurringBills: [], insights: { prevCategoryTotals: {}, monthly: [] }, cardCharges: [],
    accounts: [
      { ID: 'a1', Name: "Ateeq's HYSA", Owner: 'Ateeq', Type: 'hysa', Balance: 410, APY: 2.8, LastReconciled: '', Limit: 0 },
      { ID: 'card1', Name: 'Credit Card', Owner: 'Ateeq', Type: 'credit', Balance: 374.04, APY: 0, LastReconciled: '', Limit: 1000 },
      { ID: 'card5k', Name: "Ateeq's $5K Card", Owner: 'Ateeq', Type: 'credit', Balance: 0, APY: 0, LastReconciled: '', Limit: 5000 },
      { ID: 'cardC', Name: "Celeste's Card", Owner: 'Celeste', Type: 'credit', Balance: 0, APY: 0, LastReconciled: '', Limit: 2000 },
    ],
    debts: [{ ID: 'd1', Name: 'Loan', Owner: 'Celeste', StartBalance: 1000, Balance: 1000, APR: 0, MinPayment: 100, HighPriority: false }],
    categories: [{ ID: 'c1', Name: 'Groceries', Icon: '🛒', Color: '#93c5fd', Budget: 600, Kind: 'flex' }],
  };
}

async function run() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/' });
  const w = dom.window;
  await ready(dom.window);
  const errors = [];
  w.addEventListener('error', e => errors.push(e.error ? (e.error.stack || String(e.error)) : e.message));
  const log = (l, fn) => { try { fn(); console.log('OK   ', l); } catch (e) { console.log('FAIL ', l, '->', e.message); errors.push(l + ': ' + e.stack); } };
  const aLog = async (l, fn) => { try { await fn(); console.log('OK   ', l); } catch (e) { console.log('FAIL ', l, '->', e.message); errors.push(l + ': ' + e.stack); } };
  const round = n => Math.round(n * 100) / 100;

  w.eval("localStorage.removeItem(QUEUE_LS); localStorage.removeItem(DIDSETUP_LS);");
  w.fetch = async (url) => {
    const a = new URL(url).searchParams.get('action');
    if (a === 'getAll') return { ok: true, json: async () => serverGetAll() };
    return { ok: true, json: async () => ({ success: true }) };
  };
  await aLog('load', async () => { await w.loadForMonth(); });

  log('both of Ateeq\'s cards present with correct limits', () => {
    const cs = w.eval('cards()');
    if (cs.length !== 3) throw new Error('expected 3 cards, got ' + cs.length);
    const k5 = cs.find(c => c.id === 'card5k');
    if (!k5 || k5.limit !== 5000 || k5.owner !== 'ateeq') throw new Error('5k card wrong: ' + JSON.stringify(k5));
  });

  log('a new $5k card at zero adds no debt', () => {
    const nw = w.eval("netWorth('ateeq')");
    if (round(nw.owed) !== 374.04) throw new Error('Ateeq owed should still be 374.04, got ' + nw.owed);
  });

  log('charging the 5k card raises only Ateeq\'s debt', () => {
    const cBefore = w.eval("netWorth('celeste').owed");
    w.eval("chargeCard('card5k',{date:todayStr(),desc:'Flights',category:'Groceries',payer:cardOwnerId('card5k'),amount:1200,notes:''})");
    const a = w.eval("netWorth('ateeq').owed");
    if (round(a) !== 1574.04) throw new Error('Ateeq owed = ' + a);
    if (round(w.eval("netWorth('celeste').owed")) !== round(cBefore)) throw new Error("Celeste's debt moved");
  });

  log('cardOwnerId attributes each card to its real owner, not people[0]', () => {
    if (w.eval("cardOwnerId('card5k')") !== 'ateeq') throw new Error('5k card owner wrong');
    if (w.eval("cardOwnerId('cardC')") !== 'celeste') throw new Error("Celeste's card attributed to the wrong person");
  });

  log('an expense on Celeste\'s card is logged as Celeste, not Ateeq', () => {
    w.openAdd();
    w.setForm('payWith', 'cardC');
    if (w.eval('S.form.payer') !== 'celeste') throw new Error('payer = ' + w.eval('S.form.payer'));
    const h = w.document.getElementById('app').innerHTML;
    if (!h.includes('Celeste')) throw new Error('form does not name Celeste as cardholder');
    if (h.includes('sole cardholder')) throw new Error('stale "sole cardholder" copy still present');
    w.eval("S.form.desc='Books'; S.form.amount='42'; S.form.cat='Groceries';");
    w.submitTx();
    const ch = w.eval("D.cardCharges.find(c=>c.desc==='Books')");
    if (!ch || ch.payer !== 'celeste') throw new Error('charge payer = ' + (ch && ch.payer));
    if (round(w.eval("netWorth('celeste').owed")) !== 1042) throw new Error("Celeste owed = " + w.eval("netWorth('celeste').owed"));
  });

  log('Money tab lists both Ateeq cards under his debt, not Celeste\'s', () => {
    w.eval("S.person='ateeq'; S.moneyTab='overview';"); w.go('money');
    const h = w.document.getElementById('app').innerHTML;
    if (!h.includes('$5K Card')) throw new Error('5k card missing from Ateeq view');
    if (!h.includes('Credit Card')) throw new Error('original card missing from Ateeq view');
    if (h.includes("Celeste's Card")) throw new Error("Celeste's card showing under Ateeq");
  });

  log('utilization on the 5k card reads against 5000, not 1000', () => {
    const h = w.document.getElementById('app').innerHTML;
    if (!h.includes('$5,000')) throw new Error('5000 limit not rendered');
  });

  ['home','money','goals','recap','settings'].forEach(v => log('regression go(' + v + ')', () => w.go(v)));

  console.log('\n--- window errors ---'); errors.forEach(e => console.log(e));
  console.log('TOTAL ERRORS:', errors.length);
  process.exit(errors.length ? 1 : 0);
}
run();
