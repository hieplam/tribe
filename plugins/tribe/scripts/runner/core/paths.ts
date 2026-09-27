/**
 * Pure path math for a campaign's machine-local home (`--home`, i.e.
 * `~/.tribe/<repo-key>/campaigns/<slug>/`). One campaign per home, so every artifact
 * has a fixed name and needs no CLI flag. No IO, no clock, no fs — string math only.
 */
import { join } from 'node:path';

export const CAMPAIGN_STATE_FILENAME = 'campaign-state.json';
export const ANSWERS_FILENAME = 'answers.md';
export const ESCALATIONS_DIRNAME = 'escalations';

/** `<home>/campaign-state.json` */
export function campaignStatePathOf(homeDir: string): string {
  return join(homeDir, CAMPAIGN_STATE_FILENAME);
}

/** `<home>/answers.md` */
export function answersPathOf(homeDir: string): string {
  return join(homeDir, ANSWERS_FILENAME);
}

/** `<home>/escalations` */
export function escalationsDirOf(homeDir: string): string {
  return join(homeDir, ESCALATIONS_DIRNAME);
}

/** `<home>/escalations/<cardId>.md` */
export function escalationPathOf(homeDir: string, cardId: string): string {
  return join(escalationsDirOf(homeDir), `${cardId}.md`);
}

/** Where `campaign-report.json`/`.md`, `.runner.lock` and `STOP` live: the home itself. */
export function reportDirOf(homeDir: string): string {
  return homeDir;
}

/** `<home>/supervisor/ledger.jsonl` — the campaign's session tree (spec §4.4): one file both the
 * executor (`core/session.ts` `consumeSession`) and the supervisor (`core/supervisor/loop.ts`
 * `supervisorPathsOf`) append rows to, so both writers derive the one path from this helper. */
export function supervisorLedgerPathOf(homeDir: string): string {
  return join(homeDir, 'supervisor', 'ledger.jsonl');
}
