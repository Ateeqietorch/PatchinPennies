const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');

function serverGetAll() {
  return {
    transactions: [
      { ID: 'tx1', Date: '2026-08-10', Description: 'Aldi', Category: 'Groceries', PaidBy: 'Ateeq', Amount: 40, TxType: 'One-time', Notes: '', Need: 'need', Sub: '' },
      { ID: 'tx2', Date: '2026-08-01', Description: 'Rent', Category: 'Rent', PaidBy: 'Both', Amount: 1800, TxType: 'Recurring', Notes: 'AUTO_SEED', Need: '', Sub: '' },
      { ID: 'tx3', Date: '2026-08-05', Description: 'Dinner', Category: 'Dining Out', PaidBy: 'Celeste', Amount: 60, TxType: 'One-time', Notes: '', Need: 'want', Sub: '' },
    ],
    goals: [], income: [
      { ID: 'in1', Date: '2026-08-01', Description: 'Paycheck', Source: 'Ateeq', Amount: 2000, Notes: '' },
      { ID: 'in2', Date: '2026-08-01', Description: 'Paycheck', Source: 'Celeste', Amount: 1800, Notes: '' },
    ],
    accounts: [{ ID: 'acc1', Name: 'HYSA', Owner: 'Ateeq', Type: 'hysa', Balance: 410, APY: 2.8, LastReconciled: '2026-08-14', Limit: 0 }],
    debts: [{ ID: 'd1', Name: 'Loan', Owner: 'Celeste', StartBalance: 1000, Balance: 800, APR: 0, MinPayment: 100, HighPriority: false }],
    payments: [], flows: [], contributions: [], cardCharges: [],
    recurringBills: [
      { ID: 'rb1', Description: 'Rent', Category: 'Rent', PaidBy: 'Both', Amount: 1800, Active: true, Frequency: 'monthly', DayOfMonth: 1, LastRun: '2026-08-01' },
      { ID: 'rb2', Description: 'Internet', Category: 'Utilities', PaidBy: 'Ateeq', Amount: 95, Active: true, Frequency: 'monthly', DayOfMonth: 1, LastRun: '2026-08-01' },
    ],
    categories: [
      { ID: 'c1', Name: 'Groceries', Icon: '🛒', Color: '#93c5fd', Budget: 600, Kind: 'flex' },
      { ID: 'c2', Name: 'Dining Out', Icon: '🍽️', Color: '#fdba74', Budget: 200, Kind: 'flex' },
      { ID: 'c3', Name: 'Rent', Icon: '🏠', Color: '#a5b4fc', Budget: 1800, Kind: 'bill' },
      { ID: 'c4', Name: 'Utilities', Icon: '💡', Color: '#fde68a', Budget: 150, Kind: 'bill' },
    ],
    insights: {
      prevCategoryTotals: { 'Groceries': 100, 'Dining Out': 90 },
      monthly: [
        { month: 3, year: 2026, expenses: 500, income: 0 }, { month: 4, year: 2026, expenses: 1500, income: 0 },
        { month: 5, year: 2026, expenses: 0, income: 0 }, { month: 6, year: 2026, expenses: 0, income: 0 },
        { month: 7, year: 2026, expenses: 4000, income: 4900 }, { month: 8, year: 2026, expenses: 1900, income: 3800 },
      ],
    },
  };
}

async function run() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/' });
  const w = dom.window;
  await new Promise(r => setTimeout(r, 400));
  const errors = [];
  w.addEventListener('error', (e) => errors.push(e.error ? (e.error.stack || String(e.error)) : e.message));
  const log = (label, fn) => { try { fn(); console.log('OK   ', label); } catch (e) { console.log('FAIL ', label, '->', e.message); errors.push(label + ': ' + e.stack); } };
  const asyncLog = async (label, fn) => { try { await fn(); console.log('OK   ', label); } catch (e) { console.log('FAIL ', label, '->', e.message); errors.push(label + ': ' + e.stack); } };

  w.eval("localStorage.removeItem(QUEUE_LS); localStorage.removeItem(DIDSETUP_LS);");
  w.fetch = async (url) => {
    const action = new URL(url).searchParams.get('action');
    if (action === 'getAll') return { ok: true, json: async () => serverGetAll() };
    return { ok: true, json: async () => ({ success: true }) };
  };

  await asyncLog('load with kinds + insights', async () => {
    w.eval('S.month=8; S.year=2026;');
    await w.loadForMonth();
    const kinds = w.eval('D.categories.map(c=>c.kind).join(",")');
    if (kinds !== 'flex,flex,bill,bill') throw new Error('kinds not mapped: ' + kinds);
    if (!w.eval('D.insights.monthly.length')) throw new Error('insights not stored');
  });

  log('home renders: safe-to-spend hero uses only flex budgets', () => {
    w.go('home');
    const h = w.document.getElementById('app').innerHTML;
    if (!h.includes('Left for everyday spending')) throw new Error('hero missing');
    // flex budget 800 (600+200), flex spent 100 (40 groceries + 60 dining) -> left 700
    if (!h.includes('$700')) throw new Error('expected $700 left, hero shows otherwise');
    if (h.includes('$2,750')) throw new Error('bill budgets leaked into the hero');
  });

  log('home: bills ledger separate from everyday bars', () => {
    const h = w.document.getElementById('app').innerHTML;
    if (!h.includes('Everyday budgets')) throw new Error('everyday budgets section missing');
    if (!h.includes('🏠 Bills')) throw new Error('bills section missing');
  });

  log('home: person cards show earned amounts', () => {
    const h = w.document.getElementById('app').innerHTML;
    if (!h.includes('earned $2,000') || !h.includes('earned $1,800')) throw new Error('income per person missing from cards');
  });

  log('home: top categories with delta vs last month', () => {
    const h = w.document.getElementById('app').innerHTML;
    if (!h.includes('Where it\'s going') && !h.includes('Where it&#039;s going') && !h.includes('Where it')) throw new Error('top cats card missing');
    if (!h.includes('vs last mo')) throw new Error('delta vs last month missing');
  });

  log('home: plan equation card lists income/bills/debt/budget lines', () => {
    const h = w.document.getElementById('app').innerHTML;
    if (!h.includes("This month's plan")) throw new Error('plan card missing');
    ['Income', 'Bills (recurring)', 'Debt minimums', 'Everyday budgets'].forEach(t => { if (!h.includes(t)) throw new Error('plan line missing: ' + t); });
  });

  log('trends chart pulls 6-month series from insights', () => {
    w.eval("S.moneyTab='trends'"); w.go('money');
    // drawCharts runs via rAF; call directly to check it doesn't throw with insights present
    try { w.drawCharts(); } catch (e) { /* Chart.js missing in jsdom is fine */ if (!/Chart/.test(e.message)) throw e; }
  });

  await asyncLog('scan: new proposed category kept, marked, and created on import', async () => {
    w.eval("localStorage.setItem('pp:anthropicApiKey','sk-ant-test')");
    w.openAdd(); w.setAddMode('scan');
    w.eval(`S.scan.images=[{dataUrl:'data:image/jpeg;base64,AAA',b64:'AAA',mediaType:'image/jpeg'}];`);
    w.streamClaudeMessage = async () => ({ text: JSON.stringify({ transactions: [
      { date: '2026-08-20', description: 'Jiffy Lube', amount: 89.99, kind: 'expense', category: 'Car Repairs' },
      { date: '2026-08-21', description: 'Kroger', amount: 25, kind: 'expense', category: 'Groceries' },
    ]}), stopReason: 'end_turn' });
    await w.runStatementScan();
    const rows = w.eval('S.scan.rows');
    if (!rows[0].isNewCategory) throw new Error('proposed category not flagged as new');
    if (rows[1].isNewCategory) throw new Error('existing category wrongly flagged as new');
    const h = w.document.getElementById('app').innerHTML;
    if (!h.includes('(new)')) throw new Error('review UI does not mark new category');
    const before = w.eval('D.categories.length');
    w.eval("S.scan.payer='ateeq'");
    w.importScanRows();
    await new Promise(r => setTimeout(r, 30));
    const after = w.eval('D.categories.length');
    if (after !== before + 1) throw new Error('new category not created on import');
    const created = w.eval('D.categories.find(c=>c.name==="Car Repairs")');
    if (!created || created.kind !== 'flex') throw new Error('created category malformed: ' + JSON.stringify(created));
  });

  log('settings: category form has bill/everyday toggle and syncs kind', () => {
    w.go('settings'); w.setSettingsTab('categories');
    const h = w.document.getElementById('app').innerHTML;
    if (!h.includes('🏠 Bill') || !h.includes('🛒 Everyday')) throw new Error('kind toggle missing');
    if (!h.includes('everyday') || !h.includes('bill')) throw new Error('kind labels missing on rows');
  });

  log('inMonth tolerates slash dates', () => {
    if (!w.inMonth('7/31/2026', 7, 2026)) throw new Error('slash date not matched');
    if (w.inMonth('7/31/2026', 8, 2026)) throw new Error('slash date matched wrong month');
    if (!w.inMonth('2026-08-10', 8, 2026)) throw new Error('ISO date broke');
  });

  ['home','money','goals','recap','settings','moneydate'].forEach(v => log('regression go(' + v + ')', () => w.go(v)));

  log('no alert/prompt in source (excluding comments)', () => {
    const js = fs.readFileSync(__dirname + '/../index.html', 'utf8').match(/<script>\n([\s\S]*)<\/script>/)[1];
    const code = js.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    if (/[^.\w]alert\s*\(/.test(code) || /[^.\w]prompt\s*\(/.test(code)) throw new Error('alert/prompt found');
  });

  console.log('\n--- window errors ---'); errors.forEach(e => console.log(e));
  console.log('TOTAL ERRORS:', errors.length);
  process.exit(errors.length ? 1 : 0);
}
run();
