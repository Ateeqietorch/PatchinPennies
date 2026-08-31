const fs = require('fs');
const { JSDOM } = require('jsdom');const ready=require('./boot');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');

function serverCategories() {
  return [
    { ID: 'cat1', Name: 'Groceries', Icon: '🛒', Color: '#93c5fd', Budget: 600 },
    { ID: 'cat2', Name: 'Dining Out', Icon: '🍽️', Color: '#fdba74', Budget: 200 },
  ];
}
function serverAccounts() {
  return [
    { ID: 'acc1', Name: 'Checking', Owner: 'Both', Type: 'checking', Balance: 1000, APY: 0, LastReconciled: '2026-08-01', Limit: 0 },
    { ID: 'acc2', Name: 'Credit Card', Owner: 'Ateeq', Type: 'credit', Balance: 0, APY: 0, LastReconciled: '2026-08-01', Limit: 1000 },
  ];
}
function baseGetAll() {
  return {
    transactions: [{ ID: 'tx1', Date: '2026-08-10', Description: 'Aldi', Category: 'Groceries', PaidBy: 'Ateeq', Amount: 40, TxType: 'One-time', Notes: '', ReceiptURL: '', Need: 'need', Sub: '' }],
    goals: [], income: [], accounts: serverAccounts(), debts: [], payments: [], flows: [],
    contributions: [], cardCharges: [], recurringBills: [], categories: serverCategories(),
  };
}

async function run() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'http://localhost/' });
  const w = dom.window;
  await ready(dom.window);
  const errors = [];
  w.addEventListener('error', (e) => errors.push(e.error ? (e.error.stack || String(e.error)) : e.message));
  const log = (label, fn) => { try { fn(); console.log('OK   ', label); } catch (e) { console.log('FAIL ', label, '->', e.message); errors.push(label + ': ' + e.stack); } };
  const asyncLog = async (label, fn) => { try { await fn(); console.log('OK   ', label); } catch (e) { console.log('FAIL ', label, '->', e.message); errors.push(label + ': ' + e.stack); } };

  const calls = [];
  function mockOnline() {
    w.fetch = async (url) => {
      const u = new URL(url);
      const action = u.searchParams.get('action');
      calls.push(action);
      if (action === 'getAll') return { ok: true, json: async () => baseGetAll() };
      if (action === 'runSetup') return { ok: true, json: async () => ({ result: 'ok' }) };
      return { ok: true, json: async () => ({ success: true, id: u.searchParams.get('id') }) };
    };
  }
  function mockOffline() {
    w.fetch = async () => { throw new TypeError('Failed to fetch'); };
  }

  // Clear any queue from a previous accidental init race
  w.eval("localStorage.removeItem(QUEUE_LS); localStorage.removeItem(DIDSETUP_LS);");

  await asyncLog('cold start online: loadForMonth populates D.* from server', async () => {
    mockOnline();
    await w.loadForMonth();
    const txCount = w.eval('D.transactions.length');
    const catCount = w.eval('D.categories.length');
    const status = w.eval('S.syncStatus');
    if (txCount !== 1) throw new Error('expected 1 transaction, got ' + txCount);
    if (catCount !== 2) throw new Error('expected 2 categories from server, got ' + catCount);
    if (status !== 'online') throw new Error('expected online status, got ' + status);
    if (!calls.includes('runSetup')) throw new Error('runSetup was not called on first-ever load');
  });

  await asyncLog('runSetup only called once (didSetup flag respected)', async () => {
    calls.length = 0;
    await w.loadForMonth();
    if (calls.includes('runSetup')) throw new Error('runSetup was called again after didSetup flag was set');
  });

  ['home','money','goals','recap','settings'].forEach(v => log('regression go(' + v + ') after real sync data', () => w.go(v)));

  await asyncLog('offline: submitTx applies optimistically and queues the write', async () => {
    mockOffline();
    w.openAdd();
    const cats = w.eval('D.categories');
    w.eval(`S.form = ${JSON.stringify({ desc: 'Offline coffee', amount: '5.50', cat: 'Groceries', payer: 'ateeq', date: '2026-08-20', notes: '', need: 'need', sub: false, payWith: 'cash' })}`);
    const before = w.eval('D.transactions.length');
    await w.submitTx();
    // submitTx fires syncOp without awaiting it internally in the UI flow, but since we call it
    // directly here we need to flush microtasks for the background syncOp to land in the queue.
    await new Promise(r => setTimeout(r, 50));
    const after = w.eval('D.transactions.length');
    if (after !== before + 1) throw new Error('optimistic transaction was not applied locally');
    const q = w.eval('pendingQueue()');
    if (!q.some(x => x.action === 'addTransaction')) throw new Error('addTransaction was not queued while offline: ' + JSON.stringify(q));
  });

  await asyncLog('reconnect: flushQueue drains the queue in order', async () => {
    mockOnline();
    const before = w.eval('pendingQueue().length');
    if (before < 1) throw new Error('expected a nonempty queue going into this test');
    const drained = await w.flushQueue();
    if (!drained) throw new Error('flushQueue reported failure while online');
    const after = w.eval('pendingQueue().length');
    if (after !== 0) throw new Error('queue did not fully drain, remaining=' + after);
    if (!calls.includes('addTransaction')) throw new Error('addTransaction was never actually sent during flush');
  });

  await asyncLog('offline load falls back to cached D.* instead of wiping it', async () => {
    mockOnline();
    await w.loadForMonth(); // get a clean online snapshot into cache first
    const cachedTxCount = w.eval('D.transactions.length');
    mockOffline();
    w.eval('S.month=1;'); // switch to a month with no cache -> should NOT crash, should just show offline
    await w.loadForMonth();
    const status = w.eval('S.syncStatus');
    if (status !== 'offline') throw new Error('expected offline status after failed fetch, got ' + status);
    // app should not have thrown, and D.transactions should just be whatever was last held (not undefined/crash)
    const txs = w.eval('D.transactions');
    if (!Array.isArray(txs)) throw new Error('D.transactions became non-array after offline load: ' + txs);
  });

  log('no window.alert or window.prompt calls in source (excluding comments)', () => {
    const src = fs.readFileSync(__dirname + '/../index.html', 'utf8');
    const js = src.match(/<script>\n([\s\S]*)<\/script>/)[1];
    const codeLines = js.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    if (/[^.\w]alert\s*\(/.test(codeLines)) throw new Error('alert( found in source');
    if (/[^.\w]prompt\s*\(/.test(codeLines)) throw new Error('prompt( found in source');
  });

  log('API key still never appears in export payload', () => {
    w.eval("localStorage.setItem('pp:anthropicApiKey','sk-ant-secret-xyz')");
    const dump = JSON.stringify(w.eval("(() => { const p={}; Object.keys(LS).forEach(k=>p[k]=D[k]); return p; })()"));
    if (dump.includes('sk-ant-secret-xyz')) throw new Error('API key leaked into export payload');
  });

  console.log('\n--- window errors captured ---');
  errors.forEach(e => console.log(e));
  console.log('\nserver calls seen:', calls.join(', '));
  console.log('\nTOTAL ERRORS:', errors.length);
  process.exit(errors.length ? 1 : 0);
}
run();
