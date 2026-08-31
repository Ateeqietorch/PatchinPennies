// Waits until the app's inline <script> has actually run, instead of guessing
// with a fixed sleep. A 400ms guess was enough for one suite in isolation but
// not for nine running back to back, which produced false failures that looked
// like real regressions ("loadForMonth is not a function").
module.exports = function ready(win, ms){
  const limit = ms || 15000;
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll(){
      if (typeof win.loadForMonth === 'function' && typeof win.render === 'function') return resolve(win);
      if (Date.now() - t0 > limit) return reject(new Error('app script never initialised within ' + limit + 'ms'));
      setTimeout(poll, 10);
    })();
  });
};
