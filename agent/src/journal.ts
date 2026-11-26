// Append-only JSONL decision journal. Every decision carries its reasons,
// so any paper trade can be audited after the fact. No secrets are ever logged.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface JournalEntry {
  ts: string;
  type: 'poll' | 'signal' | 'decision' | 'open' | 'close' | 'block' | 'halt' | 'chat' | 'backtest' | 'dry-run' | 'realm' | 'error';
  [key: string]: unknown;
}

export class Journal {
  constructor(private file: string) {
    mkdirSync(dirname(file), { recursive: true });
  }

  append(entry: Omit<JournalEntry, 'ts'> & { ts?: string }): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    appendFileSync(this.file, line + '\n', 'utf8');
  }

  readAll(): JournalEntry[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as JournalEntry);
  }

  tail(n: number): JournalEntry[] {
    return this.readAll().slice(-n);
  }
}
