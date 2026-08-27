const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');

function fakeSSEBody(events) {
  const text = events.map(e => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('');
  return {
    getReader() {
      let sent = false;
      return {
        async read() {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: new TextEncoder().encode(text) };
        }
      };
    }
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

  w.eval("localStorage.setItem('pp:anthropicApiKey','sk-ant-test')");

  await asyncLog('streamClaudeMessage accumulates text_delta chunks and captures stop_reason', async () => {
    w.fetch = async () => ({ ok: true, body: fakeSSEBody([
      { event: 'message_start', data: { type: 'message_start', message: { id: 'msg_1' } } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"transactions":[' } } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"date":"2026-08-10","description":"Test","amount":5,"kind":"expense","category":""}]}' } } },
      { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } } },
      { event: 'message_stop', data: { type: 'message_stop' } },
    ])});
    const {text, stopReason} = await w.streamClaudeMessage('sk-ant-test', {model:'claude-opus-5', max_tokens: 100, messages: []});
    const parsed = JSON.parse(text);
    if (parsed.transactions.length !== 1 || parsed.transactions[0].description !== 'Test') throw new Error('accumulated text did not parse to expected JSON: ' + text);
    if (stopReason !== 'end_turn') throw new Error('stop reason not captured: ' + stopReason);
  });

  await asyncLog('streamClaudeMessage surfaces a non-ok HTTP error', async () => {
    w.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) });
    try {
      await w.streamClaudeMessage('bad-key', {model:'claude-opus-5', max_tokens: 100, messages: []});
      throw new Error('expected streamClaudeMessage to throw');
    } catch (e) {
      if (!e.message.includes('invalid x-api-key')) throw new Error('wrong error surfaced: ' + e.message);
    }
  });

  await asyncLog('runStatementScan: truncated JSON (max_tokens cutoff) gives an actionable error, not a raw parse error', async () => {
    w.openAdd(); w.setAddMode('scan');
    w.eval(`S.scan.images = [{dataUrl:'data:image/jpeg;base64,AAA', b64:'AAA', mediaType:'image/jpeg'}];`);
    w.streamClaudeMessage = async () => ({ text: '{"transactions":[{"date":"2026-08-10","desc', stopReason: 'max_tokens' });
    await w.runStatementScan();
    const status = w.eval('S.scan.status');
    const errMsg = w.eval('S.scan.error');
    if (status !== 'error') throw new Error('expected error status, got ' + status);
    if (!/fewer photos/i.test(errMsg)) throw new Error('error message not actionable: ' + errMsg);
  });

  await asyncLog('runStatementScan: successful stream with multiple photos + notes produces rows', async () => {
    w.eval(`S.scan.images = [
      {dataUrl:'data:image/jpeg;base64,AAA', b64:'AAA', mediaType:'image/jpeg'},
      {dataUrl:'data:image/jpeg;base64,BBB', b64:'BBB', mediaType:'image/jpeg'}
    ]; S.scan.status='ready'; S.scan.error='';`);
    w.eval("setScanNotes('the $40 charge was a gift')");
    let capturedBody = null;
    w.streamClaudeMessage = async (key, body) => {
      capturedBody = body;
      return { text: JSON.stringify({ transactions: [
        { date: '2026-08-11', description: 'Gift Shop', amount: 40, kind: 'expense', category: '' }
      ] }), stopReason: 'end_turn' };
    };
    await w.runStatementScan();
    const status = w.eval('S.scan.status');
    if (status !== 'results') throw new Error('expected results, got ' + status + ' / ' + w.eval('S.scan.error'));
    const imageBlocks = capturedBody.messages[0].content.filter(c => c.type === 'image');
    if (imageBlocks.length !== 2) throw new Error('expected 2 image blocks in request, got ' + imageBlocks.length);
    const textBlock = capturedBody.messages[0].content.find(c => c.type === 'text');
    if (!textBlock.text.includes('the $40 charge was a gift')) throw new Error('notes not included in prompt');
    if (capturedBody.max_tokens < 16000) throw new Error('max_tokens looks too low for non-Haiku model: ' + capturedBody.max_tokens);
  });

  await asyncLog('Haiku model uses a lower, safe max_tokens', async () => {
    w.eval("setScanModel('claude-haiku-4-5-20251001')");
    let capturedBody = null;
    w.streamClaudeMessage = async (key, body) => { capturedBody = body; return { text: JSON.stringify({transactions:[]}), stopReason:'end_turn' }; };
    try { await w.runStatementScan(); } catch(e) {}
    if (!capturedBody || capturedBody.max_tokens > 8192) throw new Error('expected Haiku max_tokens <= 8192, got ' + (capturedBody && capturedBody.max_tokens));
    w.eval("setScanModel('claude-opus-5')");
  });

  log('no window.alert or window.prompt calls in source (excluding comments)', () => {
    const src = fs.readFileSync(__dirname + '/../index.html', 'utf8');
    const js = src.match(/<script>\n([\s\S]*)<\/script>/)[1];
    const codeLines = js.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    if (/[^.\w]alert\s*\(/.test(codeLines)) throw new Error('alert( found in source');
    if (/[^.\w]prompt\s*\(/.test(codeLines)) throw new Error('prompt( found in source');
  });

  console.log('\n--- window errors captured ---');
  errors.forEach(e => console.log(e));
  console.log('\nTOTAL ERRORS:', errors.length);
  process.exit(errors.length ? 1 : 0);
}
run();
