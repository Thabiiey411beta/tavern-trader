// Realm caller. When REALM_PATH + GNOKEY_NAME are set (and a funded
// testnet key exists), calls go on-chain via `gnokey maketx call`.
// Otherwise the exact command is recorded in the journal as a dry-run and
// nothing is sent — the agent still works end-to-end offline.
//
// No secrets are ever handled here: gnokey owns the key; this module only
// builds argument lists and records what it ran. Prices are micro-USD
// (1_000_000 = $1.00); sizes are USD cents — the realm's units.
import { spawnSync } from 'node:child_process';

export interface RealmConfig {
  realmPath: string; // e.g. gno.land/r/g1.../taverntrader
  keyName: string; // gnokey key name, e.g. tavern-trader
  chainId: string; // onyx-1
  remote: string; // https://rpc.latest.testnets.gno.land:443
  gasFee: string; // e.g. 10000ugnot
  gasWanted: string; // e.g. 10000000
}

export function realmConfigFromEnv(env: NodeJS.ProcessEnv): RealmConfig | null {
  if (!env.REALM_PATH || !env.GNOKEY_NAME) return null;
  return {
    realmPath: env.REALM_PATH,
    keyName: env.GNOKEY_NAME,
    chainId: env.CHAIN_ID ?? 'onyx-1',
    remote: env.GNO_RPC ?? 'https://rpc.latest.testnets.gno.land:443',
    // Realm gas cost grows with the decision log: a RecordScore used ~3.2M
    // gas at 5 entries, ~5.2M at 9, ~6.5M at 12 (25 Nov 2026) — about
    // +260k per appended entry, so each poll (4 entries) adds ~1M to the
    // next poll's first call. 20M buys roughly 7 more polls; the durable
    // fix is trimming the decision log in the realm (needs a redeploy).
    // Fee must stay >= gas-wanted/1000 ugnot (min gas price).
    gasFee: env.GAS_FEE ?? '20000ugnot',
    gasWanted: env.GAS_WANTED ?? '20000000',
  };
}

export interface RealmCall {
  func: string;
  args: string[];
  dryRun: boolean;
  /** The exact shell command that would run (safe to log: no secrets). */
  command: string;
  ok?: boolean;
  output?: string;
}

export function buildCallArgs(cfg: RealmConfig, funcName: string, args: string[]): string[] {
  return [
    'maketx', 'call',
    '-pkgpath', cfg.realmPath,
    '-func', funcName,
    ...args.flatMap((a) => ['-args', a]),
    '-gas-fee', cfg.gasFee,
    '-gas-wanted', cfg.gasWanted,
    '-chainid', cfg.chainId,
    '-remote', cfg.remote,
    // Key password is empty; gnokey still prompts, so the flag + a blank
    // line on stdin answer it (verified live 25 Nov 2026).
    '-insecure-password-stdin',
    cfg.keyName,
  ];
}

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** Run a realm call, or record it as a dry-run when no live config exists. */
export function callRealm(
  cfg: RealmConfig | null,
  funcName: string,
  args: string[],
  runner: (cmd: string, argv: string[]) => { ok: boolean; output: string } = defaultRunner,
): RealmCall {
  if (!cfg) {
    const fake = ['gnokey', 'maketx', 'call', '-pkgpath', '<REALM_PATH>', '-func', funcName,
      ...args.flatMap((a) => ['-args', a]), '-gas-fee', '20000ugnot', '-gas-wanted', '20000000',
      '-chainid', 'onyx-1', '-remote', 'https://rpc.latest.testnets.gno.land:443', '-insecure-password-stdin', '<KEY>'];
    return { func: funcName, args, dryRun: true, command: fake.map(shellQuote).join(' ') };
  }
  const argv = buildCallArgs(cfg, funcName, args);
  const res = runner('gnokey', argv);
  return {
    func: funcName, args, dryRun: false,
    command: ['gnokey', ...argv].map(shellQuote).join(' '),
    ok: res.ok, output: res.output,
  };
}

function defaultRunner(cmd: string, argv: string[]): { ok: boolean; output: string } {
  const env = { ...process.env, GNOROOT: process.env.GNOROOT ?? `${process.env.HOME}/.gno/src` };
  // Empty password on stdin: the deploy key's password is empty, and
  // -insecure-password-stdin reads it from here (never a real secret).
  const r = spawnSync(cmd, argv, { encoding: 'utf8', env, timeout: 120_000, input: '\n' });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.slice(0, 4000);
  return { ok: r.status === 0, output };
}

export function toMicroUsd(priceUsd: number): number {
  return Math.round(priceUsd * 1_000_000);
}
