// client/src/components/SessionView.tsx — route /s/<id>[/a/<agent>] (spec §8.1). Owns one stream
// per open session view and reads its rows exclusively from the store (`rowStore.ts` is the single
// owner of row identity; this view keeps no copy). The header carries the title, liveness, badges,
// and the "found in N projects" collision count (§5.2) relocated here from the list's SessionRow.
import { useEffect, useSyncExternalStore, useState } from 'react';
import type { Agent, Badge, SessionSummary } from '../../../core/model.ts';
import { useEventStream, type ConnectionStatus, type MetaUpdate } from '../useEventStream.ts';
import { AgentTabs } from './AgentTabs.tsx';
import { CampaignBadge } from './CampaignBadge.tsx';
import { ConnectionNote } from './ConnectionNote.tsx';
import { LoadEarlier } from './LoadEarlier.tsx';
import { NewBelowPill } from './NewBelowPill.tsx';
import { RowList } from './RowList.tsx';

/** The session header (spec §8.1): title, liveness, badges, and the collision count. `projects`
 * length 1 is the ordinary case and renders nothing; 2+ shows the real number, never a guess. */
export function SessionHeader({ session }: { session: SessionSummary | null }) {
  if (session === null) return null;
  return (
    <header className="session-header" style={{ color: 'var(--ink)', borderColor: 'var(--rule)' }}>
      <span className="session-header__title">{session.title}</span>
      {session.live && <span className="session-header__live" style={{ color: 'var(--live)' }}>live</span>}
      {session.projects.length >= 2 && (
        <span className="session-header__projects" style={{ color: 'var(--warn)' }}>
          found in {session.projects.length} projects
        </span>
      )}
    </header>
  );
}

export interface SessionViewProps {
  sessionId: string;
  agentId: string | null;
  session?: SessionSummary | null;
}

export function SessionView({ sessionId, agentId, session = null }: SessionViewProps) {
  const [meta, setMeta] = useState<MetaUpdate | null>(null);
  // The session summary the header renders arrives on the `hello` frame (title, `projects`, §5.2)
  // and is KEPT — a later `meta` frame carries no session, so it only refreshes liveness. Seeded
  // from the optional `session` prop for the (rare) case a caller supplies one directly.
  const [helloSession, setHelloSession] = useState<SessionSummary | null>(session);
  const onMeta = (m: MetaUpdate) => {
    setMeta(m);
    if (m.session !== null) setHelloSession(m.session);
  };
  // The active agent is the route's agent by default; selecting a tab re-points it, which re-keys
  // `useEventStream` and opens a fresh stream for that agent (AgentTabs' documented `onSelect`
  // contract). It follows the route prop when the address bar changes (back/forward).
  const [activeAgentId, setActiveAgentId] = useState<string | null>(agentId);
  useEffect(() => {
    setActiveAgentId(agentId);
  }, [agentId]);
  // The SSE connection state `<ConnectionNote>` renders (§8.1, §8.4, §13; R13). Tracked here because
  // this view owns the one stream (§8.4); the note itself never triggers a reconnect.
  const [connection, setConnection] = useState<ConnectionStatus | null>(null);
  const { store, fetchRows } = useEventStream(sessionId, activeAgentId, onMeta, setConnection);
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const agents: Agent[] = meta?.agents ?? [];
  const badges: Badge[] = meta?.badges ?? [];
  // The header shows the hello session's title/projects with the LATEST liveness (a `meta` frame
  // updates `live` without re-sending the summary).
  const headerSession: SessionSummary | null =
    helloSession === null ? null : { ...helloSession, live: meta?.live ?? helloSession.live };

  async function loadEarlier(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setLoadError(null);
    try {
      await store.loadEarlier(fetchRows);
    } catch {
      // Fail closed (fail-closed-edges.md at the browser edge): a failed back-fill leaves the
      // current window intact AND surfaces a visible note instead of swallowing the failure.
      setLoadError('could not load earlier history');
    } finally {
      setBusy(false);
    }
  }

  function reloadTail(): void {
    // §6.3: "N new below" → replace the window with a fresh tail fetch (distinct from RowList's
    // local scroll-to-bottom). A failure fails closed with a visible note, leaving the counted
    // window as-is rather than silently swallowing the rejection.
    setLoadError(null);
    store.reloadTail(fetchRows).catch(() => setLoadError('could not reload the tail'));
  }

  return (
    <div className="session-view">
      {/* §8.1's top-level connection note — silent while open, a warn note while reconnecting, a
          persistent note when the stream is gone (§13) or sent an undecodable frame (R15.6). */}
      <ConnectionNote status={connection} />
      <SessionHeader session={headerSession} />
      {agents.length > 0 && (
        <AgentTabs
          sessionId={sessionId}
          agents={agents}
          activeAgentId={activeAgentId}
          onSelect={setActiveAgentId}
        />
      )}
      {badges.length > 0 && (
        <div className="session-view__badges" data-badge-count={badges.length}>
          {badges.map((badge) => (
            <CampaignBadge key={`${badge.repoKey}/${badge.slug}`} badge={badge} />
          ))}
        </div>
      )}
      {loadError !== null && (
        <p className="session-view__load-error" data-testid="session-load-error" style={{ color: 'var(--warn)' }}>
          {loadError}
        </p>
      )}
      {snap.truncatedBefore && <LoadEarlier onLoad={loadEarlier} busy={busy} />}
      <RowList
        nodes={snap.nodes}
        sessionId={sessionId}
        agentId={activeAgentId}
        newBelow={snap.newBelow}
        onReloadTail={reloadTail}
        onSelectAgent={setActiveAgentId}
      />
      {snap.newBelow > 0 && <NewBelowPill count={snap.newBelow} onClick={reloadTail} />}
    </div>
  );
}
