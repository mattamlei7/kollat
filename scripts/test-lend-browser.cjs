/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser/fork verification. */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const local = 'http://127.0.0.1:8545';
const url = 'http://localhost:3000/lend';
const out = `test-results/lend-browser-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.mkdirSync(out, { recursive: true });
const results = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function rpc(method, params = []) {
  const response = await fetch(local, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(60000) }).catch(e => { throw Error(`${method}: ${e.message}`); });
  const data = await response.json();
  if (data.error) throw Error(data.error.message);
  return data.result;
}
function assert(value, message) { if (!value) throw Error(message); }
let anvil, browser, livePage;
(async () => {
  // Never reuse or reset someone else's fork.
  let occupied = false;
  try { await rpc('web3_clientVersion'); occupied = true; } catch {}
  assert(!occupied, 'Port 8545 already has an RPC server; do not disturb it.');
  const configured = process.env.RPC_URL_BASE;
  const upstream = configured && !['localhost', '127.0.0.1'].includes(new URL(configured).hostname) ? configured : 'https://base-rpc.publicnode.com';
  const blockResponse = await fetch(upstream, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }), signal: AbortSignal.timeout(15000) });
  const block = (await blockResponse.json()).result;
  assert(block, 'Could not read upstream block');
  anvil = spawn('anvil', ['--host', '127.0.0.1', '--port', '8545', '--chain-id', '31337', '--fork-url', upstream, '--fork-block-number', String(Number(block)), '--retries', '2', '--timeout', '15000', '--silent'], { windowsHide: true });
  let forkLog = '';
  anvil.stdout.on('data', x => { forkLog += String(x).split(upstream).join('[RPC]'); });
  anvil.stderr.on('data', x => { forkLog += String(x).split(upstream).join('[RPC]'); });
  let ready = false;
  for (let i = 0; i < 30; i++) { try { assert(/anvil/i.test(await rpc('web3_clientVersion')), 'Not Anvil'); ready = true; break; } catch {} await sleep(1000); }
  assert(ready, `Fork did not start: ${forkLog.slice(-1200)}`);
  console.log(`Browser fork ready at Base block ${Number(block)}`);
  const user = `0x${randomBytes(20).toString('hex')}`;
  const other = `0x${randomBytes(20).toString('hex')}`;
  const usdc = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  await rpc('anvil_impersonateAccount', [user]);
  await rpc('anvil_setBalance', [user, '0x8ac7230489e80000']);
  await rpc('anvil_dealERC20', [user, usdc, '0x12a05f200']); // 5,000 USDC
  console.log('Browser test wallet funded');
  const snapshot = await (await fetch('http://localhost:3000/api/earn')).json();
  fs.writeFileSync(`${out}/opportunities.json`, JSON.stringify(snapshot, null, 2));
  assert(snapshot.opportunities?.length === 12, 'Expected 12 destinations');
  console.log('Loaded 12 earning destinations');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  let rejectNext = false;
  let transactions = 0;
  await context.exposeBinding('forkRpc', async (_, method, params) => {
    if (method === 'eth_sendTransaction') { if (rejectNext) { rejectNext = false; return { error: { code: 4001, message: 'User rejected request' } }; } transactions++; }
    try { return { result: await rpc(method, params) }; } catch (e) { return { error: { code: -32000, message: e.message } }; }
  });
  await context.addInitScript(({ user }) => {
    const listeners = {};
    window.testAccount = user;
    window.changeAccount = account => { window.testAccount = account; (listeners.accountsChanged || []).forEach(fn => fn(account ? [account] : [])); };
    window.ethereum = {
      on(event, fn) { (listeners[event] ||= []).push(fn); },
      removeListener(event, fn) { listeners[event] = (listeners[event] || []).filter(x => x !== fn); },
      async request({ method, params = [] }) {
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return window.testAccount ? [window.testAccount] : [];
        if (method === 'wallet_switchEthereumChain') { if (params[0].chainId !== '0x7a69') throw Error('Only the local fork is allowed'); return null; }
        const response = await window.forkRpc(method, params);
        if (response.error) throw Object.assign(new Error(response.error.message), { code: response.error.code });
        return response.result;
      },
    };
  }, { user });
  await context.route('https://**/*', r => r.abort()); // Other networks are intentionally unavailable in this Base browser test.
  let responseSnapshot = snapshot;
  let apiFailure = false;
  await context.route('**/api/earn', r => apiFailure ? r.fulfill({ status: 503, json: { error: 'Test outage' } }) : r.fulfill({ json: responseSnapshot }));
  const page = await context.newPage();
  livePage = page;
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.getByText('Available 5,000.00 USDC on Base.', { exact: true }).waitFor({ timeout: 60000 });
  const destinations = snapshot.opportunities.filter(o => o.chainId === 8453);
  for (const dest of process.argv.includes('--checks-only') ? [] : destinations) {
    console.log(`BROWSER START ${dest.name}`);
    await page.locator('#deposit-amount').fill('100');
    const row = page.locator('.earn-item').filter({ has: page.getByText(dest.name, { exact: false }) }).filter({ has: page.getByText(dest.product === 'aave-supply' ? 'Aave supply' : dest.product === 'morpho-vault' ? 'Morpho vault' : 'Spark Savings', { exact: true }) });
    await row.locator('input[type=radio]').check({ force: true });
    await page.getByRole('button', { name: 'Review deposit', exact: true }).click();
    await page.getByRole('heading', { name: 'Review deposit', exact: true }).waitFor();
    // Verify signature rejection once, then retry without a phantom success.
    if (dest.product === 'aave-supply') {
      rejectNext = true;
      await page.getByRole('button', { name: 'Deposit', exact: true }).click();
      await page.getByText('You declined the approval in your wallet. Nothing was sent.', { exact: true }).waitFor({ timeout: 60000 });
      results.push({ validation: 'approval rejection', status: 'passed' });
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
    } else await page.getByRole('button', { name: 'Deposit', exact: true }).click();
    await page.getByRole('heading', { name: 'Deposit complete.' }).waitFor({ timeout: 90000 });
    await page.getByRole('button', { name: 'View position', exact: true }).click();
    const position = page.locator('.deposit-item').filter({ hasText: dest.name });
    await position.getByRole('button', { name: 'Withdraw', exact: true }).click({ timeout: 60000 });
    await position.getByRole('textbox').fill('40');
    await position.getByRole('button', { name: 'Review withdrawal', exact: true }).click();
    await position.getByRole('button', { name: 'Withdraw', exact: true }).last().click();
    await page.getByText(/Withdrawal complete\. About 40\.00 USDC/).waitFor({ timeout: 90000 });
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await position.getByRole('button', { name: 'Withdraw', exact: true }).click();
    await position.getByRole('button', { name: 'Withdraw everything', exact: true }).click();
    await position.getByRole('button', { name: 'Withdraw', exact: true }).last().click();
    await page.getByText(/Withdrawal complete\./).waitFor({ timeout: 90000 });
    await page.waitForFunction(() => document.querySelectorAll('.deposit-item').length === 0, { timeout: 60000 });
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    results.push({ destination: dest.id, flow: 'deposit 100, withdraw 40, full exit', status: 'passed' });
    console.log(`BROWSER PASS ${dest.name}`);
  }
  await page.locator('#deposit-amount').fill('100');
  await page.locator('input[name=earn]:enabled').first().check({ force: true });
  await page.getByRole('button', { name: 'Review deposit', exact: true }).click();
  await page.getByRole('heading', { name: 'Review deposit', exact: true }).waitFor();
  await page.locator('#deposit-amount').fill('101');
  assert(await page.getByRole('heading', { name: 'Review deposit', exact: true }).count() === 0, 'Amount change retained an old review');
  await page.getByRole('button', { name: 'Review deposit', exact: true }).click();
  await page.getByRole('heading', { name: 'Review deposit', exact: true }).waitFor();
  const beforeStale = transactions;
  responseSnapshot = { ...snapshot, opportunities: snapshot.opportunities.map(o => ({ ...o, fetchedAt: Date.now() - 20 * 60 * 1000 })) };
  await page.getByRole('button', { name: 'Deposit', exact: true }).click();
  await page.getByText(/Rate out of date\. Review fresh destination data/).waitFor();
  assert(transactions === beforeStale, 'Stale review sent a transaction');
  results.push({ validation: 'amount change invalidates review; stale confirmation sends nothing', status: 'passed' });
  responseSnapshot = snapshot;
  await page.reload();
  await page.getByText(/Available .* USDC on Base\./).waitFor();
  await page.locator('#deposit-amount').fill('999999');
  assert(await page.getByText(/More than your available/).isVisible(), 'Missing over-balance warning');
  await page.locator('#deposit-amount').fill('1.0000001');
  assert(await page.getByText('Use at most 6 decimal places.').first().isVisible(), 'Missing precision warning');
  await page.locator('#deposit-amount').fill('100');
  await page.locator('input[name=earn]:enabled').first().check({ force: true });
  for (const width of [1440, 1280, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/lend-${width}.png`, fullPage: true });
    const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert(dimensions.scroll <= dimensions.client + 1, `Horizontal overflow at ${width}: ${JSON.stringify(dimensions)}`);
    results.push({ layout: width, status: 'passed' });
  }
  await page.evaluate(other => window.changeAccount(other), other);
  await page.getByText('Available 0.00 USDC on Base.', { exact: true }).waitFor({ timeout: 60000 });
  assert(await page.getByText('Choose an earning option to review your deposit.', { exact: true }).isVisible(), 'Old review survived account change');
  await page.evaluate(() => window.changeAccount(null));
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).waitFor();
  assert(await page.locator('.deposit-item').count() === 0, 'Positions survived disconnect');
  results.push({ validation: 'balance, precision, account change, disconnect', status: 'passed' });
  responseSnapshot = { ...snapshot, opportunities: snapshot.opportunities.map(o => ({ ...o, fetchedAt: Date.now() - 20 * 60 * 1000 })) };
  await page.reload();
  await page.getByText('No destination is accepting this deposit right now.', { exact: true }).waitFor();
  assert(await page.locator('input[name=earn]:enabled').count() === 0, 'Stale destinations remained selectable');
  results.push({ validation: 'stale destinations excluded', status: 'passed' });
  responseSnapshot = { ...snapshot, failures: [{ source: 'Aave', chainId: 8453, message: 'Test unavailable provider' }], opportunities: snapshot.opportunities.map(o => o.protocol === 'Aave' ? { ...o, baseApy: null, capacity: null, liquidity: null, status: 'unknown', fetchedAt: null, error: 'Test unavailable provider' } : o) };
  await page.reload();
  await page.getByText(/Some data could not be read: Aave/).waitFor();
  assert(await page.locator('.earn-item').filter({ hasText: 'Aave supply' }).locator('input').isDisabled(), 'Failed provider remained selectable');
  results.push({ validation: 'partial provider failure', status: 'passed' });
  apiFailure = true;
  await page.reload();
  await page.getByText(/Could not load earning options/).waitFor();
  apiFailure = false; responseSnapshot = snapshot;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.locator('input[name=earn]:enabled').first().waitFor({ state: 'attached' });
  results.push({ validation: 'API outage and retry', status: 'passed' });
  assert(errors.length === 0, `Browser errors: ${JSON.stringify(errors)}`);
  console.log(JSON.stringify({ results, transactions, errors }, null, 2));
})().catch(async e => { results.push({ status: 'failed', error: e.message }); console.error(e.message); process.exitCode = 1;
  if (livePage) { fs.writeFileSync(`${out}/failure.txt`, await livePage.locator('body').innerText()); await livePage.screenshot({ path: `${out}/failure.png`, fullPage: true }); }
}).finally(async () => {
  fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
  if (browser) await browser.close();
  if (anvil) anvil.kill();
  console.log(`Browser report: ${out}`);
});
