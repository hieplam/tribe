---
target: ref-plugin-layout
scope: block
base: ref-plugin-layout#n1932@v1:sha256:bb0685a155263366632dfa9c161edb536a3ef0bde56943cc16777b8b104a15b7
---
A plugin is a directory under `plugins/<name>/` containing `.claude-plugin/plugin.json` (name, description, version) plus any of exactly these component directories: `agents/*.md` (symlinked file-by-file into `~/.claude/agents/`), `skills/<skill-name>/` with a `SKILL.md` (symlinked as a directory into `~/.claude/skills/`), `install.sh` (post-install hook, receives `CLAUDE_DIR`), `claude-md/` (snippets consumed by such hooks), `rules/*.md` (machine-global rule files a hook symlinks into `~/.claude/rules/`), `canvases/*.md` (shipped canvas definitions a hook symlinks into `~/.claude/canvases/`), `hooks/` (hook config), `scripts/` (repo-invoked validators, not installed — the one exception is a command entry file such as `scripts/cli/bin/tribe`, which the plugin's own hook symlinks onto PATH at `$TRIBE_BIN_DIR`, default `~/.local/bin`, so the link still points into the checkout), and `evals/` (dev fixtures, not installed).
