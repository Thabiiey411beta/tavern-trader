import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCallArgs, callRealm, realmConfigFromEnv, toMicroUsd, type RealmConfig } from '../src/realm.js';

const CFG: RealmConfig = {
  realmPath: 'gno.land/r/g16c9aypj4qk9wynxx4fuwz42xk8a7gvgcnln7qk/taverntrader',
  keyName: 'tavern-trader',
  chainId: 'onyx-1',
  remote: 'https://rpc.latest.testnets.gno.land:443',
  gasFee: '20000ugnot',
  gasWanted: '20000000',
};

test('buildCallArgs produces the documented gnokey call', () => {
  const argv = buildCallArgs(CFG, 'OpenPaperPosition', ['BTC', 'long', '1500', '59143000000', '56185850000', '65057300000', '72', 'test']);
  assert.equal(argv[0], 'maketx');
  assert.ok(argv.includes('gno.land/r/g16c9aypj4qk9wynxx4fuwz42xk8a7gvgcnln7qk/taverntrader'));
  assert.ok(argv.includes('onyx-1'));
  assert.ok(argv.includes('tavern-trader'));
  assert.ok(argv.includes('-func'));
  assert.ok(argv.includes('-insecure-password-stdin'));
  assert.ok(argv.includes('20000ugnot'));
  assert.ok(argv.includes('20000000'));
});

test('no env config means dry-run, never a live call', () => {
  assert.equal(realmConfigFromEnv({}), null);
  const call = callRealm(null, 'OpenPaperPosition', ['BTC', 'long']);
  assert.equal(call.dryRun, true);
  assert.match(call.command, /gnokey/);
});

test('toMicroUsd converts dollars to realm micro-USD units', () => {
  assert.equal(toMicroUsd(100), 100_000_000);
  assert.equal(toMicroUsd(0.5), 500_000);
});

test('live call uses the injected runner, not the real gnokey', () => {
  const seen: string[][] = [];
  const call = callRealm(CFG, 'RecordScore', ['BTC', '72', 'test'], (cmd, argv) => {
    seen.push([cmd, ...argv]);
    return { ok: true, output: 'ok' };
  });
  assert.equal(call.dryRun, false);
  assert.equal(call.ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], 'gnokey');
});
