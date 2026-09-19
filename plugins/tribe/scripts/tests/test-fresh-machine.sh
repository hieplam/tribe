#!/usr/bin/env bash
# test-fresh-machine.sh — fixture tests for the fresh-machine install contract (offline).
#
# Simulates a second machine: a throwaway CLAUDE_DIR, a foreign target repo as cwd,
# and CLAUDE_PLUGIN_ROOT unset — then asserts that resolving the campaign runner
# either yields a real absolute path or FAILS LOUDLY. The wall these tests hold:
# no missing prerequisite may produce a relative path, a wrong path, or a bare
# stack trace. Silence is the bug; a named diagnostic is the pass.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$HERE/../.." && pwd)"
REPO_ROOT="$(cd "$PLUGIN_ROOT/../.." && pwd)"
RESOLVER="$PLUGIN_ROOT/skills/orchestrate-campaign/resolve-runner.sh"
DOCTOR="$PLUGIN_ROOT/scripts/doctor.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok - %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'not ok - %s\n' "$1"; }
check() { # check NAME ACTUAL WANT
  if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (got: $2, want: $3)"; fi
}
contains() { # contains NAME HAYSTACK NEEDLE
  if [[ "$2" == *"$3"* ]]; then ok "$1"; else bad "$1 (got: $2, want substring: $3)"; fi
}

# fresh_home — a throwaway machine: $1 is HOME, with the tribe plugin installed
# into its $HOME/.claude by ./install.sh, mirroring a real second machine's layout.
fresh_home() { # fresh_home HOME_DIR
  mkdir -p "$1/.claude"
  CLAUDE_DIR="$1/.claude" TRIBE_BIN_DIR="$1/.local/bin" bash "$REPO_ROOT/install.sh" tribe
}

# doctor_fixture — a throwaway scripts/ tree for doctor.sh: $1 is the dir, $2 is
# "provisioned" (runner/node_modules/ AND viewer/dist/index.html present) or "unprovisioned"
# (absent). doctor.sh is COPIED, not symlinked, because it resolves its own directory with
# `pwd -P`; a symlink would point it back at this checkout and the fixture would silently
# become the host's install state again. The stub index.html is a fixture-only placeholder —
# doctor.sh only checks the file's presence, it never reads or builds it (no `vite build` here).
doctor_fixture() { # doctor_fixture DIR provisioned|unprovisioned
  mkdir -p "$1/runner" "$1/viewer/dist"
  cp "$DOCTOR" "$1/doctor.sh"
  if [[ "$2" == provisioned ]]; then
    mkdir -p "$1/runner/node_modules"
    printf '<!doctype html>\n' > "$1/viewer/dist/index.html"
  fi
  return 0
}

# resolve_as — run the resolver as if on a machine whose HOME is $1, from the
# foreign target repo, with CLAUDE_PLUGIN_ROOT unset. HOME is isolated because the
# expression this replaced dereferenced `~/.claude` directly: without overriding
# HOME every probe would silently read THIS machine's real install and pass by
# accident — which is the exact flakiness these tests exist to catch.
resolve_as() { # resolve_as HOME_DIR SCRIPT_PATH [2>ERRFILE]
  ( cd "$FOREIGN" && env -u CLAUDE_PLUGIN_ROOT HOME="$1" bash "$2" )
}

# --- Probe 1: install onto a clean machine ----------------------------------
HOME_A="$TMP/home-a"; mkdir -p "$HOME_A"
install_out="$(fresh_home "$HOME_A" 2>&1)"
contains "install.sh reports no warnings on a clean machine" "$install_out" "0 warning(s)"
if [[ -L "$HOME_A/.claude/skills/orchestrate-campaign" ]]; then
  ok "install.sh links the orchestrate-campaign skill"
else
  bad "install.sh links the orchestrate-campaign skill"
fi

# --- Probe 2: resolve from a foreign cwd, CLAUDE_PLUGIN_ROOT unset ----------
# The real second-machine shape: cwd is the TARGET repo, not this plugin's repo.
FOREIGN="$TMP/foreign-repo"; mkdir -p "$FOREIGN"
git init -q "$FOREIGN" 2>/dev/null || true

if [[ -x "$RESOLVER" ]]; then
  set +e
  out="$(resolve_as "$HOME_A" "$HOME_A/.claude/skills/orchestrate-campaign/resolve-runner.sh" 2>"$TMP/err2")"
  rc=$?
  set -e
  check "resolver exits 0 when the repo is present" "$rc" "0"
  check "resolver finds the real runner via the installed symlink" \
    "$out" "$PLUGIN_ROOT/scripts/runner"
  if [[ -f "$out/run.ts" ]]; then
    ok "resolved path actually contains run.ts"
  else
    bad "resolved path actually contains run.ts (got: $out)"
  fi
  case "$out" in
    /*) ok "resolver output is absolute, never relative" ;;
    *)  bad "resolver output is absolute, never relative (got: $out)" ;;
  esac

  # --- Probe 3: CLAUDE_PLUGIN_ROOT wins when set (tier 1) -------------------
  set +e
  out="$(cd "$FOREIGN" && CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$RESOLVER" 2>/dev/null)"
  rc=$?
  set -e
  check "tier 1 honours CLAUDE_PLUGIN_ROOT" "$rc" "0"
  check "tier 1 resolves to that plugin root's runner" "$out" "$PLUGIN_ROOT/scripts/runner"

  # --- Probe 4: CLAUDE_PLUGIN_ROOT set but WRONG falls through to tier 2 ----
  # A stale/foreign plugin root must not win just because the var is set.
  set +e
  out="$(cd "$FOREIGN" && HOME="$HOME_A" CLAUDE_PLUGIN_ROOT="$TMP/not-a-plugin" \
    bash "$HOME_A/.claude/skills/orchestrate-campaign/resolve-runner.sh" 2>/dev/null)"
  rc=$?
  set -e
  check "a wrong CLAUDE_PLUGIN_ROOT falls through instead of winning" "$rc" "0"
  check "fallthrough still lands on the real runner" "$out" "$PLUGIN_ROOT/scripts/runner"

  # --- Probe 4b: THE REGRESSION PROBE — skill absent from $HOME/.claude -----
  # This is the case the old `readlink -f ~/.claude/skills/…` expression got wrong:
  # readlink printed nothing, exited 1, the code was swallowed, `dirname ""` gave
  # ".", and the result was a bare "./scripts/runner" pointed at the TARGET repo.
  # A self-locating resolver does not consult HOME at all, so it must still succeed
  # here. If this probe ever passes for a resolver that reads ~, the resolver is
  # reading this machine's real install and the whole suite is lying.
  HOME_EMPTY="$TMP/home-empty"; mkdir -p "$HOME_EMPTY/.claude/skills"
  set +e
  out="$(resolve_as "$HOME_EMPTY" "$HOME_A/.claude/skills/orchestrate-campaign/resolve-runner.sh" 2>"$TMP/err4b")"
  rc=$?
  set -e
  check "resolves even when HOME has no install (never consults ~)" "$rc" "0"
  check "and still lands on the real runner" "$out" "$PLUGIN_ROOT/scripts/runner"
  case "$out" in
    ./*|scripts/*|"") bad "an empty HOME never yields the forbidden relative path (got: '$out')" ;;
    *)                ok "an empty HOME never yields the forbidden relative path" ;;
  esac

  # --- Probe 5: the repo moved — dangling symlink ---------------------------
  # THE WALL: readlink -f prints a partial path and exits 1; a resolver that
  # ignores the exit code builds a confident WRONG path. Must fail loudly.
  MOVED="$TMP/moved"
  mkdir -p "$MOVED/plugins/tribe/skills/orchestrate-campaign" "$MOVED/plugins/tribe/scripts/runner"
  cp "$RESOLVER" "$MOVED/plugins/tribe/skills/orchestrate-campaign/resolve-runner.sh"
  touch "$MOVED/plugins/tribe/scripts/runner/run.ts"
  HOME_B="$TMP/home-b"; mkdir -p "$HOME_B/.claude/skills"
  ln -s "$MOVED/plugins/tribe/skills/orchestrate-campaign" "$HOME_B/.claude/skills/orchestrate-campaign"
  rm -rf "$MOVED"   # the repo is gone; the symlink now dangles
  set +e
  out="$(resolve_as "$HOME_B" "$HOME_B/.claude/skills/orchestrate-campaign/resolve-runner.sh" 2>"$TMP/err5")"
  rc=$?
  set -e
  if [[ "$rc" -ne 0 ]]; then
    ok "a moved repo fails loudly (non-zero exit)"
  else
    bad "a moved repo fails loudly (non-zero exit) (got rc=0, out=$out)"
  fi
  # stdout empty is the load-bearing assertion: the old expression's failure mode
  # was printing a confident WRONG path built from readlink's partial output.
  check "a moved repo prints NO path on stdout" "$out" ""

  # --- Probe 5b: partial checkout — skill present, runner missing -----------
  # Unlike a moved repo (where the script itself vanishes and bash fails), here the
  # resolver RUNS and must emit its own named diagnostic rather than a bad path.
  PARTIAL="$TMP/partial"
  mkdir -p "$PARTIAL/plugins/tribe/skills/orchestrate-campaign"   # no scripts/runner
  cp "$RESOLVER" "$PARTIAL/plugins/tribe/skills/orchestrate-campaign/resolve-runner.sh"
  HOME_C="$TMP/home-c"; mkdir -p "$HOME_C/.claude/skills"
  ln -s "$PARTIAL/plugins/tribe/skills/orchestrate-campaign" "$HOME_C/.claude/skills/orchestrate-campaign"
  set +e
  out="$(resolve_as "$HOME_C" "$HOME_C/.claude/skills/orchestrate-campaign/resolve-runner.sh" 2>"$TMP/err5b")"
  rc=$?
  set -e
  check "a partial checkout exits 3" "$rc" "3"
  check "a partial checkout prints NO path on stdout" "$out" ""
  contains "a partial checkout emits the resolver's OWN diagnostic" \
    "$(cat "$TMP/err5b")" "no campaign runner at"
  contains "and that diagnostic names the remedy" "$(cat "$TMP/err5b")" "install.sh"

  # --- Probe 6: the forbidden case — never emit a bare relative path --------
  # SKILL.md forbids it explicitly; the old readlink expression produced it.
  case "$out" in
    ./*|scripts/*) bad "resolver never emits a bare relative path (got: $out)" ;;
    *)             ok "resolver never emits a bare relative path" ;;
  esac
else
  bad "resolve-runner.sh exists and is executable (missing: $RESOLVER)"
fi

# --- Probe 7: the doctor names a missing prerequisite ------------------------
if [[ -x "$DOCTOR" ]]; then
  # bun stripped from PATH: the diagnostic must name bun and how to get it,
  # not die with "command not found" from some deeper callee.
  set +e
  dout="$(cd "$FOREIGN" && env PATH="/usr/bin:/bin" bash "$DOCTOR" 2>&1)"
  drc=$?
  set -e
  if [[ "$drc" -ne 0 ]]; then
    ok "doctor exits non-zero when bun is absent"
  else
    bad "doctor exits non-zero when bun is absent (got rc=0)"
  fi
  contains "doctor names bun as the missing prerequisite" "$dout" "bun"
  contains "doctor says how to install it" "$dout" "https://bun.sh"

  # On this machine, with a full PATH, the doctor should pass — against a fixture
  # this suite built itself, never against the host checkout's own install state.
  doctor_fixture "$TMP/doctor-provisioned" provisioned
  set +e
  dout="$(cd "$FOREIGN" && bash "$TMP/doctor-provisioned/doctor.sh" 2>&1)"; drc=$?
  set -e
  check "doctor passes on a fully-provisioned fixture" "$drc" "0"

  # A fresh machine has no runner/node_modules/ — the doctor must name the gap and
  # how to fix it, not silently borrow whatever state this checkout happens to be in.
  doctor_fixture "$TMP/doctor-unprovisioned" unprovisioned
  set +e
  dout="$(cd "$FOREIGN" && bash "$TMP/doctor-unprovisioned/doctor.sh" 2>&1)"; drc=$?
  set -e
  check "doctor exits non-zero when runner dependencies are absent" "$drc" "1"
  contains "doctor names runner dependencies as the gap" "$dout" "runner dependencies"
  contains "doctor says how to install them" "$dout" "bun install"

  # --- Probe 7b: P10 fix round — ANTHROPIC_API_KEY-only is never reported "ok" ------------
  # A machine whose ONLY credential source is ANTHROPIC_API_KEY (no Claude Code login) must
  # NOT be told its credentials are "ok": the runner unsets that variable before spawning any
  # session (unconditionally, every run), so it is never actually usable at spawn time. Isolate
  # HOME so no real login file is found, keep the full PATH so bun/deps still pass.
  HOME_KEYONLY="$TMP/home-keyonly"; mkdir -p "$HOME_KEYONLY"
  set +e
  dout_key="$(cd "$FOREIGN" && env -u CLAUDE_CONFIG_DIR HOME="$HOME_KEYONLY" ANTHROPIC_API_KEY="sk-ant-test-only" bash "$DOCTOR" 2>&1)"
  set -e
  case "$dout_key" in
    *'ok    Agent SDK credentials (ANTHROPIC_API_KEY is set)'*)
      bad "doctor never claims ANTHROPIC_API_KEY alone is 'ok' credentials (the runner strips it before every spawn)" ;;
    *)
      ok "doctor never claims ANTHROPIC_API_KEY alone is 'ok' credentials (the runner strips it before every spawn)" ;;
  esac
  contains "doctor flags ANTHROPIC_API_KEY-only as a credentials gap, not a pass" \
    "$dout_key" "MISSING Agent SDK credentials"
else
  bad "doctor.sh exists and is executable (missing: $DOCTOR)"
fi

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
