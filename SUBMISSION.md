# Tavern Trader — DoraHacks submission pack

Gnome Tavern Hackathon | Gno.land — deadline **Fri 18 Dec 2026, 03:00 SAST**.
Prize: $40,000 in GNOT ($10,000 upfront across 16 projects + up to $30,000 retention; winners can earn up to 4× their upfront prize).

## Status (verified 25 Nov 2026)

| Requirement | State |
|---|---|
| Live testnet deployment + realm link | DONE — deployed 10:41 SAST, enabled ~11:43, claimed + first score/position live 11:46 SAST. Realm: `gno.land/r/g16c9aypj4qk9wynxx4fuwz42xk8a7gvgcnln7qk/taverntrader` |
| Public repo | READY TO PUSH — `~/workspace/gnome-tavern/` is a git repo, secret-checked 25 Nov 13:02 SAST (no mnemonic, private key, API key or .env in the tree; `.gitignore` covers `agent/data/`, the Chrome binaries/profile, and video edit intermediates incl. edit-v2). Dry-run: 57 files, ~31 MB. Not yet created on GitHub. |
| README | In the repo (`README.md`), includes setup, architecture, honest backtest results, retention plan, demo script. |
| Demo video | DONE (v2) — `demo-video/tavern-trader-demo-v2.mp4`, 140.7s, 1080p, voiceover, verified frames. v2 opens with the problem and shows a real poll running on camera (Polls 12 → 13, ETH 64 → 65) plus fresh Render/GnoScan proof. v1 kept in the repo as the previous version. Needs a public URL before the form can take it (see step 2). |
| Short description | Draft (from README): "Tavern Trader is a paper-trading agent on Gno.land testnet: a TypeScript agent scores GNOT/BTC/ETH/SOL from real prices, and every score, open and close is written to an on-chain realm that enforces the risk rules fail-closed. Paper only — no real funds. Backtest: 15 paper trades, 9W/6L, +$15.25 on $100 paper equity." |

## Step 1 — Push the repo (public)

Create the repo `tavern-trader` under `Thabiiey411beta` on GitHub (public), add it as remote, push `main`. The GitHub App is authorized for Newton's repos; note the App can only *initialize* an empty repo via the API — follow-up writes to a non-empty repo go through the browser UI with Newton's GitHub session (found 25 Nov 10:04 SAST). Suggested repo name: `tavern-trader`.

## Step 2 — Host the demo video (two options)

The DoraHacks form takes a demo video **URL**, not a file upload. Two hosts are actually observed on submitted projects:

**Option A — YouTube (unlisted).** Upload with the youtube-publisher skill:

```bash
cd ~/workspace/custom-skills/youtube-publisher/scripts
npx ts-node youtube-upload.ts \
  --video ~/workspace/gnome-tavern/demo-video/tavern-trader-demo-v2.mp4 \
  --title "Tavern Trader — paper-trading agent on Gno.land testnet" \
  --description "Tavern Trader is a paper-trading agent on Gno.land testnet: a TypeScript agent scores GNOT, BTC, ETH and SOL from real prices, and every score, open and close is written to an on-chain realm that enforces the risk rules fail-closed. Paper only — no real funds. Realm: gno.land/r/g16c9aypj4qk9wynxx4fuwz42xk8a7gvgcnln7qk/taverntrader" \
  --tags "gnoland,gno,dorahacks,paper-trading,ai-agent" \
  --privacy unlisted
```

Note: no YouTube refresh token file was found in the skill's scripts dir (only `.env` with client id/secret), so first-time authorization will open a browser for Newton's Google sign-in. That sign-in is the one step that needs him.

**Option B — jsDelivr straight from the repo (no sign-in needed).** Another submitted project (FairDrop) serves its demo as `cdn.jsdelivr.net/gh/<user>/<repo>@main/demo.mp4`. Once the repo is pushed with the mp4 in it, the video URL is:

`https://cdn.jsdelivr.net/gh/Thabiiey411beta/tavern-trader@main/demo-video/tavern-trader-demo-v2.mp4`

The file is 15.0 MB, under jsDelivr's 20 MB per-file limit for GitHub files. This is the simpler path — no Google sign-in, no extra upload.

## Step 3 — File the submission on DoraHacks

Verified 25 Nov 12:29–12:33 SAST (read-only check): the entry point is a "Submit Build" button on https://dorahacks.io/hackathon/gnome-tavern/build (the hackathon URL redirects there). Registration is required to submit. The form itself could not be opened in read-only mode, so exact field labels and character limits are **not verified** — what the form asks is evidenced by submitted BUIDL pages: project name, short description, long description ("What it does"), logo, tags, demo-video link, code-repository link, website/live-deployment link, team members.

Fill in: project name `Tavern Trader` (no "Gno" prefix, per the rules), the short description above, the public repo URL, the demo video URL (YouTube unlisted or the jsDelivr link), and the live deployment link `https://onyx.testnets.gno.land/r/g16c9aypj4qk9wynxx4fuwz42xk8a7gvgcnln7qk/taverntrader`. The project must be deployed and working on the testnet at the time of submission — it is.

## Links

- Realm (GnoScan): https://gnoscan.io/realms/details?chainId=onyx-1&path=gno.land/r/g16c9aypj4qk9wynxx4fuwz42xk8a7gvgcnln7qk/taverntrader
- Render page: https://onyx.testnets.gno.land/r/g16c9aypj4qk9wynxx4fuwz42xk8a7gvgcnln7qk/taverntrader
- Hackathon: https://dorahacks.io/hackathon/gnome-tavern
