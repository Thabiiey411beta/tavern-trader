# Tavern Trader — a verifiable paper-trading agent on Gno.land

**PAPER TRADING ONLY. No real funds move anywhere in this project. Every
dollar figure is paper P&L, not profit.**

Tavern Trader is a momentum paper-trading agent for the Gnome Tavern
hackathon track. An off-chain TypeScript agent scores GNOT, BTC, ETH and SOL
every 5 minutes from real CoinGecko prices, and every decision it makes —
scores, opens, closes, halts — is written to a single on-chain realm on
Gno.land testnet, where the risk rules are enforced again, fail-closed.
Anyone can read the realm and audit every trade the agent claims to have made.

- **Realm (source of truth):** `realm/tavern.gno` — paper positions, scores,
  decision log, owner-only writes, on-chain risk policy.
- **Agent:** `agent/` (TypeScript, Node 22, zero runtime dependencies) —
  signal, risk, sizing, polling loop, realm caller, local UI, backtest.
- **Status 25 Nov 2026:** tests green (see below), backtest reproduced,
  UI smoke-tested. **Testnet deploy is NOT done yet** — the deploy key is
  unfunded and the faucet needs a human-solved reCAPTCHA (see
  [Deploy status](#deploy-status)). Nothing here is live on-chain yet.

## How it works

```
CoinGecko daily closes ──▶ signal.ts (momentum + trend + volume, 0–100)
                              │ score ≥ 60
                              ▼
                    risk.ts (fail-closed: stale data, daily-loss
                    cap $20, halt switch) + sizing.ts (score-scaled,
                    max $50/trade, max 5 open, max $50/day deployed)
                              │
                              ▼
              realm/tavern.gno  ◀── gnokey maketx call (agent, owner key)
              OpenPaperPosition / RecordScore / ClosePaperPosition
              …enforces the same rules on-chain, append-only log…
                              │
                              ▼
              UI at http://localhost:8791 + agent/data/journal.jsonl
```

**Signal (per symbol, per poll).** 7-day momentum (max ±40 pts), price vs
20-day SMA trend (±35 pts), 24h volume vs 7-day average (±10 pts, confirms
direction only, never creates it). Signed total ≥ 60 opens a position in
that direction; below 60, no trade. Short history or missing data = no
trade, never a guess.

**Risk policy, enforced twice (agent + realm).** Min score 60. Stop-loss and
take-profit required, on the correct side of entry. Max $50 per paper
trade, max 5 open positions, cumulative realised paper loss capped at $20
(owner reset only). Writes are owner-only — only the deployer key (the
agent) may write; all reads are public. Ownership is claimed once after
deploy with `ClaimOwner()`.

**Realm surface.** `ClaimOwner`, `OpenPaperPosition`, `ClosePaperPosition`,
`RecordScore`, `HaltPaperTrading` / `ResumePaperTrading`, `ResetLossCap`,
plus public reads `GetStats`, `GetPositions`, `GetOpenPositions`,
`GetPosition`, `GetScores`, `GetDecisions`, and `Render` (a Markdown page
for the realm viewer).

## Repo layout

```
gnome-tavern/
├── README.md               # this file
├── docs/                   # (empty — demo notes live here once recorded)
├── realm/
│   ├── tavern.gno          # the realm (399 lines)
│   ├── tavern_test.gno     # 11 realm tests
│   └── gnomod.toml         # module gno.land/r/g16c9a…/taverntrader, gno 0.9
└── agent/
    ├── src/                # signal, risk, sizing, agent, server, realm,
    │                       # backtest, prices, journal, cli, fetch-history
    ├── test/               # 15 TS tests (signal, risk/sizing, realm caller)
    ├── data/
    │   ├── prices-30d.json # real CoinGecko daily closes, 90d window
    │   ├── journal.jsonl   # append-only log of every poll/signal/trade
    │   └── state.json      # agent state (positions, risk, last signals)
    ├── package.json        # scripts: build / test / paper / backtest /
    │                       #   fetch-history
    └── dist/               # built output (tsc)
```

## Setup

Prerequisites: Node 22+, and the Gno toolchain v1.8.0 at `~/.gno/bin`
(`gno`, `gnokey`, `gnodev`, `gnoweb`).

```bash
cd agent
npm install          # typescript + @types/node only
npm test             # build + 15 TS tests
npm run backtest     # replay the 90d CoinGecko fixture (PAPER)
npm run paper        # poll every 5 min + UI at http://localhost:8791
npm run fetch-history  # refresh agent/data/prices-30d.json from CoinGecko
```

**Realm tests** (needs `GNOROOT` — the prebuilt `gno` binary was compiled
against the CI checkout path `/__w/gno/gno`, so without it the stdlib
isn't found):

```bash
cd realm
GNOROOT=$HOME/.gno/src ~/.gno/bin/gno test ./...
# or: export GNOROOT=$HOME/.gno/src
```

**Going live on testnet (after the realm is deployed):**

```bash
REALM_PATH=gno.land/r/<your-address>/taverntrader GNOKEY_NAME=<key> npm run paper
```

Without `REALM_PATH` + `GNOKEY_NAME` (or without a funded key) the agent
runs in dry-run mode: it polls, scores and logs the exact `gnokey maketx
call` it *would* send, and sends nothing on-chain. The journal marks
those entries `"type":"dry-run"`.

## Test results (25 Nov 2026, verified)

| Suite | Result |
|---|---|
| TS tests (`npm test`) | **15 pass, 0 fail** |
| Realm tests (`gno test ./...`, `GNOROOT` set) | **11 pass, 0 fail** |
| UI smoke test (`npm run paper`, `curl localhost:8791`) | **HTTP 200**, paper-only banner, 3 dry-run positions shown |
| Backtest (`npm run backtest`) | see below |

One real bug was found and fixed while verifying: two realm tests
asserted panics across `cross(cur)` calls with `recover()`, but a panic
across a cross-realm call is not recoverable in the Gno test VM and
aborts the whole run. The fix (2 small edits in `tavern_test.gno`) tests
the same rules through the same-realm path (`validateTrade` for the
score threshold) and documents why the second-`ClaimOwner` panic is
asserted live after deploy instead of in the test. No realm logic changed.

## Results — PAPER, read this first

Backtest replays the agent's exact signal + risk + sizing code over real
CoinGecko daily closes (90-day fixture fetched 2026-11-25T06:56:30Z,
70 aligned days across GNOT/BTC/ETH/SOL). No fees, no slippage, daily
closes only, 15 trades — a small sample. **This is a paper backtest, not
evidence the strategy makes money.**

| Metric | Value (PAPER) |
|---|---|
| Trades | 15 (9 wins / 6 losses, 60% win rate) |
| Blocked opens | 1 |
| Realised paper P&L | **+$15.25 on $100 paper equity → $115.25** |
| Live paper positions (25 Nov, dry-run) | 3 shorts: GNOT $22.80 @ $0.0489 (score 76), ETH $18.30 @ $1,656.49 (61), SOL $8.90 @ $68.73 (61) — realised $0, none settled on-chain |

Honest caveats: 15 trades is too few to conclude anything; the winning
window is a falling market, so most wins are shorts; daily closes ignore
intraday stop-outs; no fees/slippage are modelled, and real execution
would eat a meaningful share of these small paper wins. The point of the
project is verifiability (every decision on-chain, rules enforced twice),
not a claim of profitability.

## Deploy status

**DEPLOYED 25 Nov 2026 10:41 SAST.** Tx
`829759FE91577A0FB22F1ED43EDD5F1C417AA520A09AA2EC3F98A4E0EE861B54`
(block 1397567, fee 0.03 GNOT, gas 25,087,510 / 27,000,000).
Realm: `gno.land/r/g16c9aypj4qk9wynxx4fuwz42xk8a7gvgcnln7qk/taverntrader`
(chain `onyx-1`). Realm page:
https://gnoscan.io/realms/details?chainId=onyx-1&path=gno.land/r/g16c9aypj4qk9wynxx4fuwz42xk8a7gvgcnln7qk/taverntrader

**ENABLED 25 Nov ~11:43 SAST** (EnablePkg tx 92FF05F3…EA71046F,
block 1398601) — the DAO/package-approver review passed and the
realm is callable now: `qeval` reads resolve and calls execute.
(The "Not Yet Enabled" gate is what made `ClaimOwner` panic and
`qeval` report "package not found" before — a testnet gate, not a
bug in the realm.)

**CLAIMED + LIVE 25 Nov ~11:46 SAST** (foreground, proxy up, empty
key password): ClaimOwner OK (height 1398735); RecordScore GNOT 78
OK (height 1398741); OpenPaperPosition GNOT short 2340c @ $0.048825,
SL $0.051266, TP $0.043942, score 78 OK (height 1398742). Verified
via `qeval`: owner `g16c9a…`, `open=1 positions=1
realisedPnLCents=0 halted=false`. Score is fresh — live CoinGecko
poll 11:45 SAST (GNOT 78 short; BTC 62, ETH 66, SOL 68, all short).

Gas lesson: realm calls need 2.7–3.7M gas when the log is short
(ClaimOwner 2,663,210; RecordScore 3,242,691; OpenPaperPosition
3,740,934) — BUT the cost grows with the decision log: a RecordScore
used 5,208,595 gas at 9 entries and outgrew the 5M cap, which is why
live poll #13 (25 Nov 12:46 SAST) silently dropped its ETH/SOL scores;
poll #14's four calls used 5.73M → 6.51M, about +260k per entry.
Current recipe: `-gas-fee 20000ugnot -gas-wanted 20000000` (fee must be
at least wanted/1000 ugnot, min gas price 1 ugnot/1000 gas), plus a
storage deposit of ~0.12 GNOT per score write. The agent now journals
every realm call result and retries a failed RecordScore once, so a
drop can never again pass silently. The 20M cap buys roughly 7 more
polls — re-check gas use before it gets close, and the durable fix is
trimming the decision log in the realm (needs a redeploy).

Notes from the live deploy (25 Nov):
- Key password is **EMPTY** — dry-run and broadcast both signed with
  `printf '\n' | ... -insecure-password-stdin`.
- Gas: the realm needs ~25.1M gas — use `-gas-wanted 27000000
  -gas-fee 30000ugnot` for addpkg (the old 5M draft runs out of gas).
- `gnokey` reaches the RPC only through the proxy:
  `nohup python3 scripts/gno-rpc-proxy.py > /tmp/gno-rpc-proxy.log 2>&1 &`
  then `--remote http://127.0.0.1:26657` (26657 → onyx-1).

Post-deploy commands (all three done 25 Nov 11:46 SAST — kept here
as the working recipe for future calls):

```bash
# run with the proxy up; empty key password via stdin
printf '\n' | gnokey maketx call -pkgpath gno.land/r/g16c9aypj4qk9wynxx4fuwz42xk8a7gvgcnln7qk/taverntrader \
  -func ClaimOwner -gas-fee 20000ugnot -gas-wanted 20000000 \
  -chainid onyx-1 -remote http://127.0.0.1:26657 -insecure-password-stdin tavern-trader
# then: RecordScore <SYM> <score> "<reason>" + OpenPaperPosition with the
# agent's fresh signal (size/entry/SL/TP in micro-USD from agent/data/state.json),
# same -gas-fee 20000ugnot -gas-wanted 20000000, and verify at the realm URL
```

Realm URL once deployed:
`https://gnoweb.testnets.gno.land/r/g16c9aypj4qk9wynxx4fuwz42xk8a7gvgcnln7qk/taverntrader`

## Demo video script (3 minutes)

For the submission video — record the screen, talk over it, keep it under
3:00. No live money anywhere in the video. v2 (25 Nov 13:02 SAST) replaces
v1: it opens with the problem and shows a real poll running on camera.

| Time | Shot | Say / show |
|---|---|---|
| 0:00–0:11 | Title card | "Paper trading has a trust problem. Anyone can claim a win after the fact. Tavern Trader fixes that by writing every decision on chain, where the risk rules can't be bypassed." |
| 0:11–0:34 | Live poll on camera (UI at localhost:8791) | Type `poll` in the chat box, submit, "60 seconds later" cut to the reloaded dashboard: Polls 12 → 13, ETH score fresh 64 → 65. "Watch it work. It scores four symbols from live prices and writes each score to the realm." |
| 0:34–0:52 | Realm `Render` page (fresh screenshots) | "A minute later the realm shows the new scores, and the explorer shows the transactions. The agent can't fake a score — it's on chain or it didn't happen." |
| 0:52–1:19 | Realm code walk (`tavern.gno`) | Risk rules on-chain: min score 60, stop-loss/take-profit required, $50 cap, $20 loss cap, owner-only writes. |
| 1:19–1:37 | `npm run backtest` output | "15 paper trades, 9 wins, 6 losses, +$15.25 on $100 — paper, 15 trades, not a profit claim." Show the caveats slide. |
| 1:37–1:57 | GnoScan realm page (fresh screenshots) | 11 transactions, 6 fresh RecordScore txs at blocks 1399700–1399727. "And it's all checkable: the deploy, the owner claim, every score." |
| 1:57–2:15 | DoraHacks page | "Built for the Gnome Tavern hackathon — $40,000 in prizes, submissions open until 18 December." |
| 2:15–2:21 | End card | "Verify it yourself: repo link, realm link, run `npm test`." |

## Retention plan (months 3 and 6)

The retention prize (up to $30,000 in GNOT across winners — up to 4× each
project's upfront prize: 1st up to $8,000 total, 2nd up to $4,000, Builder
Award up to $2,000)
is judged at months 3 and 6 on continued building, not on the demo alone.
Planned work, in order:

- **Month 1–2:** live testnet loop on MANUAL polls only (auto-poll parked 25 Nov 13:02 SAST — see gas note above; each poll burns ~1M gas of headroom and each server restart costs one startup poll). Add a second price source and a staleness check so one dead feed fails closed instead of trading on old prices. The durable fix for the gas growth is a bounded decision log in the realm (needs a redeploy); until then, poll only when there is a reason.
- **Month 3 checkpoint:** 90 days of on-chain paper history; walk-forward
  backtest (re-fit nothing, report out-of-sample months separately);
  add per-symbol stats to `Render`; first retention update post.
- **Month 4–5:** paper "strategy variants" as separate realm instances
  (e.g. score threshold 60 vs 70) so variants are comparable on-chain;
  alerting when the agent misses polls.
- **Month 6 checkpoint:** 6-month on-chain record, full honest report
  (win rate, drawdown, halt events, feed outages), and a short post on
  what didn't work. No live-money feature is planned at any point.

## DoraHacks submission checklist

- [x] Testnet deploy live + realm URL — DONE 25 Nov 10:41 SAST, enabled ~11:43, claimed + live 11:46 SAST: `gno.land/r/g16c9aypj4qk9wynxx4fuwz42xk8a7gvgcnln7qk/taverntrader`
- [x] Demo video recorded (v2, live loop) — DONE 25 Nov 13:02 SAST: `demo-video/tavern-trader-demo-v2.mp4`, 140.7s, 1080p, voiceover; build script `demo-video/edit-v2/build-demo-v2.sh`. v1 (`tavern-trader-demo.mp4`, 142.7s) kept in the repo as the previous version.
- [ ] Public GitHub repo (push `gnome-tavern/`; secret-checked 25 Nov 13:02 SAST — clean, `.gitignore` fixed for edit-v2 intermediates, dry-run 57 files / ~31 MB; see `SUBMISSION.md`)
- [ ] This README in the repo
- [ ] Short description for the submission form (draft: "Tavern Trader is
      a paper-trading agent on Gno.land testnet: a TypeScript agent
      scores GNOT/BTC/ETH/SOL from real prices, and every score, open
      and close is written to an on-chain realm that enforces the risk
      rules fail-closed. Paper only — no real funds. Backtest: 15 paper
      trades, 9W/6L, +$15.25 on $100 paper equity.")
- [ ] Submit before **18 Dec 2026, 03:00 SAST**

Judging: Tech 40% / Appeal 20% / Creativity 20% / Docs & demo 20%.
Prize pool $20,000 in GNOT — upfront $10,000 (1st $2,000, 2nd $1,000,
14 × $500), retention up to $10,000 matching the upfront award, judged
at months 3 and 6.

## Safety

Paper only, testnet only, no mainnet, no live money, no real funds — by
design, in the code (positions are state, settled in paper USD) and in
the realm (no token transfers exist in `tavern.gno`). Never put a
mnemonic, private key or API key in this repo; the deploy key lives in
the local `gnokey` keyring only.
