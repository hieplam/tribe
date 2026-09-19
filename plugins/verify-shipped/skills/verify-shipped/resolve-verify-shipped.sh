#!/usr/bin/env bash
# resolve-verify-shipped.sh — print the absolute path of verify-shipped.sh.
#
# Why this is a script and not a line of shell in SKILL.md: SKILL.md used to name a
# hand-written path — `~/.claude/skills/verify-shipped/scripts/verify-shipped.sh` — that
# assumes an install under the user's home. That path does not exist when the skill is
# loaded as a local plugin (`options.plugins = [{ type: 'local', path: ... }]`, exactly
# how the campaign supervisor's closing session loads it): `ls` on it returns "No such
# file or directory". FU-CS-4 is precisely a model that ran that hand-written path,
# found nothing, and never noticed — the verdict file it was supposed to write was
# never written, and nothing downstream checked. Following
# `plugins/tribe/skills/orchestrate-campaign/resolve-runner.sh`'s exact precedent: a
# resolver that proves its answer, rather than a string a model has to get right from
# memory every session.
#
# This file cannot reproduce that failure. It ships INSIDE the skill directory, so it
# travels with the symlink install: if the repo is gone the script is gone and bash
# fails loudly on its own. It never prints a path it has not proven exists, and it
# never prints a relative one.
#
# Contract:
#   stdout  absolute path to verify-shipped.sh — ONLY on success
#   exit 0  resolved and proven (the file exists there)
#   exit 3  could not resolve; a named diagnostic is on stderr
#
# Usage (from the skill, via its announced base directory):
#   script_path="$(bash "<skill-dir>/resolve-verify-shipped.sh")" || exit 1
set -euo pipefail

die() { printf 'verify-shipped: %s\n' "$*" >&2; exit 3; }

REL="skills/verify-shipped/scripts/verify-shipped.sh"

# Tier 1 — Claude Code's own plugin root, set for a native/marketplace-cached
# install, where `skills/verify-shipped/scripts/verify-shipped.sh` hangs off the
# plugin root. Only honoured when it actually proves out: a stale or foreign value
# falls through to tier 2 rather than winning on presence alone.
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "$CLAUDE_PLUGIN_ROOT/$REL" ]; then
  script_dir="$(cd "$(dirname "$CLAUDE_PLUGIN_ROOT/$REL")" && pwd -P)"
  printf '%s/verify-shipped.sh\n' "$script_dir"
  exit 0
fi

# Tier 2 — locate ourselves. `cd … && pwd -P` resolves the install symlink to its
# physical home in the repo (the same idiom resolve-runner.sh already uses). Unlike
# `readlink -f`, a failure here is a non-zero cd, never a half-resolved path — and
# `set -e` plus the explicit guard both stop it. This file lives beside SKILL.md
# (skills/verify-shipped/), directly alongside the scripts/ directory it targets.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P)" || here=""
[ -n "$here" ] || die "cannot locate this skill's own directory — the install symlink is broken. Re-run ./install.sh from the tribe repo."

script_path="$here/scripts/verify-shipped.sh"
[ -f "$script_path" ] || die "no verify-shipped.sh at '$script_path'. The skill resolved to '$here', which does not look like a complete tribe plugin checkout. If the tribe repo moved, re-run ./install.sh from its new location."

printf '%s\n' "$script_path"
