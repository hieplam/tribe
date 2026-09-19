// client/src/components/SessionRow.tsx — title, id, size, age (spec §8.1), plus the
// `projects: string[]` collision header and the campaign badges the session carries.
//
// `pure-core.md`: the relative-age computation reads the clock, so it takes `now` as an injected
// argument (defaulting to `Date.now()` at render time) rather than reaching for `Date.now()`
// inside the pure formatting helper itself — a test supplies a fixed value so the assertion never
// races the real clock.
import type { SessionSummary } from '../../../core/model.ts';
import { CampaignBadge } from './CampaignBadge.tsx';
import type { ClientRoute } from '../routes.ts';
import { LiveDot } from './LiveDot.tsx';
import { RouteLink } from './RouteLink.tsx';

const SHORT_ID_LENGTH = 8;

/** The first 8 characters of a session id (spec §4/§5.2's charset is `[0-9a-fA-F-]{8,64}`) — long
 * enough to disambiguate on this machine's corpus, short enough for a list row. Exported so the
 * truncation itself is directly assertable, not just "some short string is present". */
export function shortSessionId(id: string): string {
  return id.slice(0, SHORT_ID_LENGTH);
}

const SIZE_UNITS = ['KB', 'MB', 'GB'];

/** Bytes -> a short human label ("482 B", "2.0 KB", "3.4 MB"). Pure, base-1024. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${SIZE_UNITS[unit]}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** `mtimeIso` relative to the supplied `nowMs` clock reading — never `Date.now()` read directly
 * from this pure helper (`pure-core.md`). Coarse buckets are enough for a list row; the row's
 * `ts`/`mtimeIso` is carried for display only, exactly as spec §4 states for `RowAnchor.ts`. */
export function formatRelativeAge(mtimeIso: string, nowMs: number): string {
  const deltaMs = Math.max(0, nowMs - new Date(mtimeIso).getTime());
  if (deltaMs < MINUTE_MS) return 'just now';
  if (deltaMs < HOUR_MS) return `${Math.floor(deltaMs / MINUTE_MS)}m ago`;
  if (deltaMs < DAY_MS) return `${Math.floor(deltaMs / HOUR_MS)}h ago`;
  return `${Math.floor(deltaMs / DAY_MS)}d ago`;
}

export interface SessionRowProps {
  session: SessionSummary;
  now?: number;
  /** In-app navigation owned by `App`; the row links to the session's `/s/<id>` route. */
  onNavigate?: (route: ClientRoute) => void;
}

export function SessionRow({ session, now, onNavigate }: SessionRowProps) {
  const nowMs = now ?? Date.now();
  return (
    <div className="session-row">
      {/* The title and meta line are the link to the session. The campaign badges below are
          buttons of their own, so they sit outside the link: a button inside an <a> is invalid. */}
      <RouteLink route={{ kind: 'session', sessionId: session.id }} onNavigate={onNavigate} className="session-row__link">
        {/* preview §C `.item .top`: the status dot, the title (taking the slack), the age at the
            right. The dot is filled when live (LiveDot) and a hollow ring when idle — LiveDot renders
            nothing when idle by design, so the ring is its own element here. */}
        <div className="session-row__top">
          {session.live ? <LiveDot live={true} /> : <span className="idle-dot" aria-hidden="true" />}
          <span className="session-row__title">{session.title}</span>
          <span className="session-row__age">{formatRelativeAge(session.mtimeIso, nowMs)}</span>
        </div>
        {/* preview §C `.item .sub`: the mono metadata line, its parts separated by a middot. */}
        <div className="session-row__meta">
          <span className="session-row__id">{shortSessionId(session.id)}</span>
          <span className="session-row__sep" aria-hidden="true">·</span>
          <span className="session-row__size">{formatSize(session.sizeBytes)}</span>
          <span className="session-row__sep" aria-hidden="true">·</span>
          <span className="session-row__subagents">
            {session.subagentCount} subagent{session.subagentCount === 1 ? '' : 's'}
          </span>
          {/* spec §4/§5.2: `projects.length === 1` is the ordinary case and renders nothing; at 2+
              the real count is shown, never a guess ("multiple") and never a hard-coded "2". */}
          {session.projects.length >= 2 && (
            <>
              <span className="session-row__sep" aria-hidden="true">·</span>
              <span className="session-row__projects">found in {session.projects.length} projects</span>
            </>
          )}
        </div>
      </RouteLink>
      {session.badges.length > 0 && (
        <div className="session-row__badges">
          {session.badges.map((badge) => (
            <CampaignBadge key={`${badge.repoKey}/${badge.slug}`} badge={badge} />
          ))}
        </div>
      )}
    </div>
  );
}
