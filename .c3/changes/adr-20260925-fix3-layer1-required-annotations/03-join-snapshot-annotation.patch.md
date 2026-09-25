---
target: rule-session-cwd-config-restored
scope: block
base: rule-session-cwd-config-restored#n2535@v1:sha256:1fd128c131aefa3ea2430ad3b0429c50de5d75762b1590a9932310b4913127d2
---
ts
// REQUIRED: snapshot before spawn, fail closed if it cannot be read; restore after, whatever wrote the change.
export async function runOneShotSession(input: RunOneShotInput, io: OneShotSessionSeam): Promise<OneShotSessionResult> {
  const homeDir = input.config.homeDir;
  // A home whose configuration cannot be read cannot be restored afterwards, so no session is
  // spawned into it (fail closed).
  let before: HomeConfigSnapshot;
  try {
    before = io.snapshotHomeConfig(homeDir);
  } catch (err) {
    return errorResult(new Error(`refusing to spawn: the campaign home's configuration could not be read (${messageOf(err)})`));
  }

  const abortController = new AbortController();
  const options = buildOneShotOptions(input.kind, input.config, abortController);
  const sessionPromise = consumeOneShot(input, io, options);
  const result = await raceWallClock(sessionPromise, input.sessionTimeoutMs, abortController);

  if (result.outcome === 'timeout') {
    // The race resolved before the aborted stream ended, so a write can still land after the pass
    // below: restore once more when the stream settles (`consumeOneShot` never rejects).
    void sessionPromise.then(() => restoreHomeAfterSession(io, homeDir, before, result.sessionId));
  }
  const restoreFailure = restoreHomeAfterSession(io, homeDir, before, result.sessionId);
  if (restoreFailure === null) return result;
  return {
    ...result,
    outcome: 'error',
    finalText: `the campaign home's configuration could not be restored after the session (${restoreFailure})`,
  };
}
