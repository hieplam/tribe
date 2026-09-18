// client/src/components/ConnectionNote.tsx — the SSE connection state note (spec §8.1's top-level
// `<ConnectionNote>`, §8.4, §13; R13 plan gap). It READS the connection status `useEventStream`
// already tracks and renders:
//   - NOTHING while the stream is connecting or live — the happy path is silent;
//   - a `warn`-token "reconnecting…" note while a reconnect is pending — no stack, no raw error;
//   - a PERSISTENT note when the stream is closed by a terminal server frame (`gone`, §13) or by a
//     frame the client could not decode (R15.6).
// It NEVER triggers a reconnect itself (§8.4: the two reconnect triggers both live in the hook).
import type { ConnectionStatus } from '../useEventStream.ts';

export function ConnectionNote({ status }: { status: ConnectionStatus | null }) {
  if (status === null || status.phase === 'connecting' || status.phase === 'open') return null;

  const text =
    status.phase === 'reconnecting'
      ? 'reconnecting…'
      : status.phase === 'gone'
        ? "this session's file is gone"
        : 'the live connection sent a frame the viewer could not read';

  return (
    <div
      className="connection-note"
      data-testid="connection-note"
      data-note={status.phase}
      style={{ color: 'var(--warn)' }}
    >
      {text}
    </div>
  );
}
