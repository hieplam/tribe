#!/usr/bin/env bash
# install.sh — tribe plugin post-install hook. Five jobs:
#
# 1. Symlinks each machine-global rule file in rules/ into $CLAUDE_DIR/rules/,
#    where reviewers (tracker, skinner) read every *.md fresh on each run.
#    Symlink — not copy — so the repo stays the single source of truth.
#    Idempotent: an already-correct link is skipped; a conflicting real file is
#    backed up to <name>.bak.<epoch> first (same behavior as the root installer).
#
# 2. Symlinks each shipped canvas definition in canvases/ into $CLAUDE_DIR/canvases/,
#    the same way and for the same reason as rules/ above — so an installed tribe
#    (e.g. Scout self-provisioning the `debt` canvas in a target repo, CU-3 D10) can
#    resolve the canvas file at a stable machine-global path.
#
# 3. Appends each guidance snippet in claude-md/ to the global CLAUDE.md if not
#    already present. Idempotent: a snippet's first line (its section heading) is
#    the presence marker — if that exact line exists in CLAUDE.md, the snippet is
#    skipped.
#
# 4. Links the `tribe` command (scripts/cli/bin/tribe) into $TRIBE_BIN_DIR (default
#    ~/.local/bin) so a bare `tribe` starts the session viewer from any directory.
#    Same link/backup behavior as rules/; warns when that directory is not on PATH.
#
# 5. Builds the viewer client (scripts/viewer/dist) — see the block at the end.
#
# The first line alone is not a sufficient guard. When a snippet grows a NEW
# top-level heading above an existing section, the marker misses against a
# CLAUDE.md that already carries that section under the old shape — the snippet
# appends and the target ends up with the section twice. Two copies of one rule
# drift apart and then contradict each other, which is worse than either copy
# alone. So ANY heading the snippet shares with the target also blocks the
# append: the hook reports the overlap and leaves reconciliation to the owner,
# whose copy may hold local edits this script must never silently bury.
#
# CLAUDE_DIR overrides the target root (default: ~/.claude) and TRIBE_BIN_DIR the command
# directory (default: ~/.local/bin) — both used by tests.

set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
TARGET="$CLAUDE_DIR/CLAUDE.md"

# --- rules/ -> $CLAUDE_DIR/rules/ (symlinked machine-global rule files) ------
if [ -d "$PLUGIN_DIR/rules" ]; then
  mkdir -p "$CLAUDE_DIR/rules"
  for rule in "$PLUGIN_DIR/rules"/*.md; do
    [ -e "$rule" ] || continue
    dst="$CLAUDE_DIR/rules/$(basename "$rule")"
    if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$rule" ]; then
      printf '  ok      rules/%s (already linked)\n' "$(basename "$rule")"
      continue
    fi
    if [ -e "$dst" ] || [ -L "$dst" ]; then
      bak="$dst.bak.$(date +%s)"
      mv "$dst" "$bak"
      printf 'WARN: rules/%s: existing target backed up to %s\n' "$(basename "$rule")" "$bak" >&2
    fi
    ln -s "$rule" "$dst"
    printf '  linked  rules/%s -> %s\n' "$(basename "$rule")" "$dst"
  done
fi

# --- canvases/ -> $CLAUDE_DIR/canvases/ (symlinked shipped canvas definitions) ---
if [ -d "$PLUGIN_DIR/canvases" ]; then
  mkdir -p "$CLAUDE_DIR/canvases"
  for canvas in "$PLUGIN_DIR/canvases"/*.md; do
    [ -e "$canvas" ] || continue
    dst="$CLAUDE_DIR/canvases/$(basename "$canvas")"
    if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$canvas" ]; then
      printf '  ok      canvases/%s (already linked)\n' "$(basename "$canvas")"
      continue
    fi
    if [ -e "$dst" ] || [ -L "$dst" ]; then
      bak="$dst.bak.$(date +%s)"
      mv "$dst" "$bak"
      printf 'WARN: canvases/%s: existing target backed up to %s\n' "$(basename "$canvas")" "$bak" >&2
    fi
    ln -s "$canvas" "$dst"
    printf '  linked  canvases/%s -> %s\n' "$(basename "$canvas")" "$dst"
  done
fi

# --- scripts/cli/bin/tribe -> $TRIBE_BIN_DIR/tribe (the `tribe` command on PATH) ---
# Placed before the claude-md/ block, whose `exit 0` ends the hook when claude-md/ is absent.
TRIBE_CMD_SRC="$PLUGIN_DIR/scripts/cli/bin/tribe"
TRIBE_BIN_DIR="${TRIBE_BIN_DIR:-$HOME/.local/bin}"
if [ -f "$TRIBE_CMD_SRC" ]; then
  mkdir -p "$TRIBE_BIN_DIR"
  dst="$TRIBE_BIN_DIR/tribe"
  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$TRIBE_CMD_SRC" ]; then
    printf '  ok      command tribe (already linked)\n'
  else
    if [ -e "$dst" ] || [ -L "$dst" ]; then
      bak="$dst.bak.$(date +%s)"
      mv "$dst" "$bak"
      printf 'WARN: command tribe: existing %s backed up to %s\n' "$dst" "$bak" >&2
    fi
    ln -s "$TRIBE_CMD_SRC" "$dst"
    printf '  linked  command tribe -> %s\n' "$dst"
  fi
  case ":$PATH:" in
    *":$TRIBE_BIN_DIR:"*) ;;
    *) printf 'WARN: %s is not on PATH — add `export PATH="%s:$PATH"` to your shell profile to run `tribe`\n' \
         "$TRIBE_BIN_DIR" "$TRIBE_BIN_DIR" >&2 ;;
  esac
fi

# --- claude-md/ -> appended to $CLAUDE_DIR/CLAUDE.md -------------------------
[ -d "$PLUGIN_DIR/claude-md" ] || exit 0

mkdir -p "$CLAUDE_DIR"
touch "$TARGET"

for snippet in "$PLUGIN_DIR/claude-md"/*.md; do
  [ -e "$snippet" ] || continue
  marker="$(head -n 1 "$snippet")"
  if [ -z "$marker" ]; then
    printf 'WARN: %s: first line empty — cannot use as marker, skipped\n' "$(basename "$snippet")" >&2
    continue
  fi
  if grep -qxF "$marker" "$TARGET"; then
    printf '  ok      CLAUDE.md %s (already present)\n' "$(basename "$snippet")"
    continue
  fi

  # Marker missed — but check every other heading before appending (see header note).
  overlap=""
  while IFS= read -r heading; do
    [ -n "$heading" ] || continue
    if grep -qxF "$heading" "$TARGET"; then overlap="$heading"; break; fi
  done < <(grep -E '^#{1,6} ' "$snippet" || true)

  if [ -n "$overlap" ]; then
    printf '  skip    CLAUDE.md %s (section already present, under a different top heading)\n' "$(basename "$snippet")"
    printf 'WARN: %s: not appended — "%s" already exists in %s.\n' "$(basename "$snippet")" "$overlap" "$TARGET" >&2
    printf 'WARN: appending would duplicate it. Reconcile by hand, then re-run to pick up the rest.\n' >&2
    continue
  fi

  { printf '\n'; cat "$snippet"; } >> "$TARGET"
  printf '  added   CLAUDE.md %s -> %s\n' "$(basename "$snippet")" "$TARGET"
done

# --- viewer client build (D1: React + Vite, served as static files) ---------
# spec §10.3: builds the client into dist/, warns and continues (never fails the whole
# install) when bun is absent or the build itself fails — this hook also links agents,
# rules and canvases, which must keep working on a machine with no bun at all.
VIEWER_DIR="$PLUGIN_DIR/scripts/viewer"
if [ -d "$VIEWER_DIR" ]; then
  if command -v bun >/dev/null 2>&1; then
    ( cd "$VIEWER_DIR" && bun install --frozen-lockfile && bun run build ) \
      && printf '  built   viewer client -> %s/dist\n' "$VIEWER_DIR" \
      || printf 'WARN: viewer client build failed — the viewer will refuse to start until `bun run build` succeeds\n' >&2
  else
    printf 'WARN: bun not found — skipping the viewer client build\n' >&2
  fi
fi
