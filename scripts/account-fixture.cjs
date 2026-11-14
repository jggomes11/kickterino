'use strict';
const assert = require('node:assert/strict');
const { isRunning } = require('./profile-process.cjs');
const { evaluate } = require('./cdp-client.cjs');
function assertAccountReady(state, accountId) {
  assert.equal(state?.accountId, accountId);
  assert.deepEqual(state.accounts.map(a => a.id), ['account-1', 'account-2', 'account-3', 'account-4']);
  assert(state.channels.length > 0, 'Configured channel list must be present');
  assert.equal(state.loggedIn, false, 'Native fixture must not use real accounts');
  assert.equal(state.maxWatchers, 2); assert.equal(state.rotation, true);
  assert.equal(state.farming, true); assert.equal(state.lowQuality, true);
}
async function quitApplication(client, timeoutMs = 10000) {
  if (client.ui && isRunning(client.child)) { try { await evaluate(client.ui, 'window.kick.quit()'); } catch {} }
  const deadline = Date.now() + timeoutMs;
  while (isRunning(client.child) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  assert(!isRunning(client.child), 'Application did not quit gracefully');
  assert.equal(client.child.exitCode, 0, 'Application did not exit successfully after quit');
}
async function clickAccountLoginWhenReady(evaluatePage, selector, { timeoutMs = 5000, onObserve = () => {} } = {}) {
  const deadline = Date.now() + timeoutMs;
  let control;
  while (Date.now() < deadline) {
    control = await evaluatePage(`(() => {
      const button = document.querySelector(${JSON.stringify(selector)});
      if (!button) return { present: false, clicked: false };
      const result = { present: true, accountId: button.closest('[data-account-id]')?.dataset.accountId, disabled: button.disabled, clicked: false };
      if (!button.disabled) { button.click(); result.clicked = true; }
      return result;
    })()`);
    onObserve(control);
    if (control.clicked) return control;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for enabled Add account control: ' + JSON.stringify(control));
}
module.exports = { assertAccountReady, quitApplication, clickAccountLoginWhenReady };
