// client/src/components/SessionList.tsx — route `/` and `/p/<dir>` (spec §8.1). Deliberately does
// NOT filter by age: D10 (spec §5.6) applies the 30-day window to PROJECTS only — "sessions inside
// a project are never hidden" — so this component has no age-related prop or logic at all, and a
// session's `mtimeIso` never gates whether it renders here.
import type { SessionSummary } from '../../../core/model.ts';
import { SessionRow } from './SessionRow.tsx';

export interface SessionListProps {
  sessions: SessionSummary[];
  /** The raw `<repoKey>/<slug>` pair from `CampaignFilter` (empty string = no filter). Matches
   * spec §9's own contract: match on the PAIR, never the slug alone. */
  campaignFilter?: string;
}

/** Pure: `sessions` narrowed to those carrying a badge for the exact `(repoKey, slug)` pair
 * `campaignFilter` names (spec §9 — "the filter parameter is `?campaign=<repoKey>/<slug>` … and it
 * matches on the pair"). An empty/blank filter is "no filter" and returns every session
 * unchanged. Exported so the matching rule itself — not just "the list got shorter" — is directly
 * assertable. */
export function filterSessionsByCampaign(sessions: SessionSummary[], campaignFilter: string): SessionSummary[] {
  const trimmed = campaignFilter.trim();
  if (trimmed === '') return sessions;
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0 || slashIndex === trimmed.length - 1) return []; // not a clean pair: matches nothing
  const repoKey = trimmed.slice(0, slashIndex);
  const slug = trimmed.slice(slashIndex + 1);
  return sessions.filter((s) => s.badges.some((b) => b.repoKey === repoKey && b.slug === slug));
}

export function SessionList({ sessions, campaignFilter = '' }: SessionListProps) {
  const filtered = filterSessionsByCampaign(sessions, campaignFilter);
  if (filtered.length === 0) {
    return (
      <p className="session-list__empty" style={{ color: 'var(--ink-soft)' }}>
        No sessions match this filter.
      </p>
    );
  }
  return (
    <ul className="session-list">
      {filtered.map((session) => (
        <li key={session.id}>
          <SessionRow session={session} />
        </li>
      ))}
    </ul>
  );
}
