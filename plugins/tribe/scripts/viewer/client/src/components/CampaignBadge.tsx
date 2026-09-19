// client/src/components/CampaignBadge.tsx — a campaign's claim on one session (spec §9): slug,
// card, status and the runner's alive/dead state. `SessionSummary.badges` is an array because a
// session can carry more than one (§9's measured 2-slug, 6-session collision) — the caller
// (`SessionRow`) renders one `<CampaignBadge>` per entry; this component never de-dupes or picks.
//
// Clicking fills the campaign filter: `?campaign=<repoKey>/<slug>`, the PAIR, never the slug
// alone (§9). `history` is injected (`pure-core.md`) and defaults to the real `window.history` —
// a test can supply a fake to observe the call without touching the real address bar.
import type { Badge } from '../../../core/model.ts';

export interface HistoryLike {
  pushState(data: unknown, unused: string, url?: string | URL | null): void;
}

/** `?campaign=<repoKey>/<slug>` — both halves percent-encoded (spec §9). Exported so the click
 * handler and a test can share the exact same construction, never two copies that could drift. */
export function campaignFilterQuery(badge: Badge): string {
  return `?campaign=${encodeURIComponent(badge.repoKey)}/${encodeURIComponent(badge.slug)}`;
}

export interface CampaignBadgeProps {
  badge: Badge;
  history?: HistoryLike;
}

export function CampaignBadge({ badge, history }: CampaignBadgeProps) {
  const onClick = () => {
    const h = history ?? window.history;
    h.pushState(null, '', campaignFilterQuery(badge));
  };

  return (
    <button type="button" className="campaign-badge" onClick={onClick}>
      <span className="campaign-badge__slug">{badge.slug}</span>
      <span className="campaign-badge__sep" aria-hidden="true">·</span>
      <span className="campaign-badge__card">{badge.cardId}</span>
      <span className="campaign-badge__sep" aria-hidden="true">·</span>
      <span className="campaign-badge__status">{badge.cardStatus}</span>
      <span className="campaign-badge__sep" aria-hidden="true">·</span>
      <span
        className="campaign-badge__runner"
        style={badge.runnerAlive ? undefined : { color: 'var(--warn)' }}
      >
        {badge.runnerAlive ? 'runner alive' : 'runner dead'}
      </span>
    </button>
  );
}
