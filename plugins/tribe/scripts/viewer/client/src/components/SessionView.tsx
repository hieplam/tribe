// client/src/components/SessionView.tsx — route /s/<id>[/a/<agent>] (spec §8.1). Owns one stream
// per open session view and reads its rows exclusively from the store (`rowStore.ts` is the single
// owner of row identity; this view keeps no copy). The header carries the title, liveness, badges,
// and the "found in N projects" collision count (§5.2) relocated here from the list's SessionRow.
import { useSyncExternalStore, useState } from 'react';
import type { Agent, Badge, SessionSummary } from '../../../core/model.ts';
import { useEventStream, type MetaUpdate } from '../useEventStream.ts';
import { LoadEarlier } from './LoadEarlier.tsx';
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
  const onMeta = (m: MetaUpdate) => setMeta(m);
  const { store, fetchRows } = useEventStream(sessionId, agentId, onMeta);
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [busy, setBusy] = useState(false);

  const agents: Agent[] = meta?.agents ?? [];
  const badges: Badge[] = meta?.badges ?? [];

  async function loadEarlier(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await store.loadEarlier(fetchRows);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="session-view">
      <SessionHeader session={session} />
      {agents.length > 0 && <div className="session-view__agents" data-agent-count={agents.length} />}
      {badges.length > 0 && <div className="session-view__badges" data-badge-count={badges.length} />}
      {snap.truncatedBefore && <LoadEarlier onLoad={loadEarlier} busy={busy} />}
      <RowList nodes={snap.nodes} />
    </div>
  );
}
