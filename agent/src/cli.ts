// Tavern Trader entrypoint: one poll, then serve the UI and poll on an interval.
// `npm run paper` — PAPER ONLY, no real funds.
import { Agent } from './agent.js';
import { createUiServer } from './server.js';

const port = Number(process.env.PORT ?? 8791);
const agent = new Agent({ pollMs: Number(process.env.POLL_MS ?? 5 * 60 * 1000) });

const server = createUiServer(agent);
server.listen(port, () => {
  console.log(`Tavern Trader (PAPER) UI on http://localhost:${port}`);
  console.log(`Realm: ${agent.liveRealm ? agent.realmCfg?.realmPath + ' (LIVE)' : 'dry-run — set REALM_PATH + GNOKEY_NAME with a funded testnet key to go live on testnet'}`);
});

void agent.pollOnce();
setInterval(() => void agent.pollOnce(), agent.cfg.pollMs);
