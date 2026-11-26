// One-port web UI for Tavern Trader (default 8791).
// Shows PAPER positions, PAPER P&L, signals, journal, and chat/status
// commands. Read-only GETs plus POST /api/chat.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Agent } from './agent.js';

export function handleChat(agent: Agent, text: string): string {
  const cmd = text.trim().toLowerCase();
  agent.journal.append({ type: 'chat', text });
  if (cmd === 'status') {
    const r = agent.state.risk;
    return `PAPER status — equity $${(r.equityCents / 100).toFixed(2)} (paper), realised ${(agent.state.realisedPnLCents / 100).toFixed(2)} paper USD, open ${agent.state.positions.length}, halted: ${r.halted ? r.haltReason : 'no'}, polls: ${agent.state.polls}, realm: ${agent.liveRealm ? 'LIVE ' + (agent.realmCfg?.realmPath ?? '') : 'dry-run (no funded testnet key)'}.`;
  }
  if (cmd === 'signal' || cmd === 'signals') {
    if (!agent.state.lastSignals.length) return 'No signals yet — poll has not run.';
    return agent.state.lastSignals
      .map((s) => `${s.symbol}: ${s.score}/100 ${s.direction} — ${s.reasons.join('; ')}`)
      .join('\n');
  }
  if (cmd === 'positions') {
    if (!agent.state.positions.length) return 'No open PAPER positions.';
    return agent.state.positions
      .map((p) => `#${p.realmId ?? '?'} ${p.symbol} ${p.side} $${(p.sizeCents / 100).toFixed(2)} paper @ $${p.entryPrice.toFixed(4)} SL $${p.stopLoss.toFixed(4)} TP $${p.takeProfit.toFixed(4)} (score ${p.score})`)
      .join('\n');
  }
  if (cmd === 'journal') {
    return agent.journal.tail(10).map((e) => JSON.stringify(e)).join('\n') || 'Journal is empty.';
  }
  if (cmd === 'halt') {
    agent.halt('halted by operator via chat');
    return 'Paper trading halted. No new positions will open.';
  }
  if (cmd === 'resume') {
    agent.resume();
    return 'Paper trading resumed.';
  }
  if (cmd === 'poll') {
    void agent.pollOnce().then(() => agent.journal.append({ type: 'chat', text: 'manual poll finished' }));
    return 'Poll started in the background — check status in a moment.';
  }
  if (cmd === 'help') {
    return 'Commands: status, signal, positions, journal, poll, halt, resume, help. Everything here is PAPER — no real funds.';
  }
  return `Unknown command "${text}". Try: status, signal, positions, journal, poll, halt, resume, help.`;
}

function dashboardHtml(agent: Agent): string {
  const s = agent.state;
  const rows = s.positions.map((p) => `<tr><td>${p.symbol}</td><td>${p.side}</td><td>$${(p.sizeCents / 100).toFixed(2)}</td><td>$${p.entryPrice.toFixed(4)}</td><td>$${p.stopLoss.toFixed(4)}</td><td>$${p.takeProfit.toFixed(4)}</td><td>${p.score}</td></tr>`).join('') || '<tr><td colspan="7">No open PAPER positions.</td></tr>';
  const sigs = s.lastSignals.map((x) => `<tr><td>${x.symbol}</td><td>${x.score}</td><td>${x.direction}</td><td>${x.reasons.join('; ')}</td></tr>`).join('') || '<tr><td colspan="4">No signals yet.</td></tr>';
  const journal = agent.journal.tail(15).map((e) => `<div>${e.ts} [${e.type}] ${JSON.stringify(e).slice(0, 300)}</div>`).join('') || '<div>Journal is empty.</div>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Tavern Trader — PAPER</title>
<style>body{font-family:system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}.paper{background:#fff3cd;padding:8px;border:1px solid #e6c200}</style></head><body>
<h1>🍺 Tavern Trader</h1>
<p class="paper"><strong>PAPER TRADING ONLY.</strong> No real funds move anywhere in this project. P&amp;L below is paper P&amp;L, not profit.</p>
<p>Realm: <strong>${agent.liveRealm ? agent.realmCfg?.realmPath : 'dry-run — no funded testnet key (intended realm calls are journaled, nothing sent on-chain)'}</strong><br>
Paper equity: <strong>$${(s.risk.equityCents / 100).toFixed(2)}</strong> &nbsp; Realised paper P&amp;L: <strong>$${(s.realisedPnLCents / 100).toFixed(2)}</strong> &nbsp; Open: <strong>${s.positions.length}</strong> &nbsp; Halted: <strong>${s.risk.halted ? s.risk.haltReason : 'no'}</strong> &nbsp; Polls: ${s.polls} &nbsp; Last poll: ${s.lastPollAt ?? 'never'}</p>
<h2>Open PAPER positions</h2><table><tr><th>Symbol</th><th>Side</th><th>Size (paper)</th><th>Entry</th><th>Stop-loss</th><th>Take-profit</th><th>Score</th></tr>${rows}</table>
<h2>Signals</h2><table><tr><th>Symbol</th><th>Score</th><th>Direction</th><th>Reasons</th></tr>${sigs}</table>
<h2>Journal (latest 15)</h2>${journal}
<h2>Chat / status commands</h2>
<form method="post" action="/api/chat"><input name="text" placeholder="status, signal, positions, journal, poll, halt, resume, help" style="width:70%"><button>Send</button></form>
<p><a href="/api/state">/api/state</a> · <a href="/api/journal">/api/journal</a> · <a href="/api/signals">/api/signals</a></p>
</body></html>`;
}

function send(res: ServerResponse, code: number, body: string, type = 'text/html'): void {
  res.writeHead(code, { 'content-type': type });
  res.end(body);
}

export function createUiServer(agent: Agent) {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, dashboardHtml(agent));
    if (req.method === 'GET' && url.pathname === '/api/state') {
      return send(res, 200, JSON.stringify({ paper: true, ...agent.state, realmLive: agent.liveRealm }, null, 2), 'application/json');
    }
    if (req.method === 'GET' && url.pathname === '/api/signals') {
      return send(res, 200, JSON.stringify(agent.state.lastSignals, null, 2), 'application/json');
    }
    if (req.method === 'GET' && url.pathname === '/api/journal') {
      const n = Number(url.searchParams.get('limit') ?? 50);
      return send(res, 200, JSON.stringify(agent.journal.tail(n), null, 2), 'application/json');
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let text = body;
        try { text = (JSON.parse(body) as { text?: string }).text ?? body; } catch { /* form-encoded */ }
        if (text.includes('=')) text = decodeURIComponent(text.split('=').slice(1).join('=').replace(/\+/g, ' '));
        send(res, 200, JSON.stringify({ reply: handleChat(agent, text) }, null, 2), 'application/json');
      });
      return;
    }
    return send(res, 404, 'not found', 'text/plain');
  });
}
