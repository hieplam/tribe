---
target: c3-215
scope: block
base: c3-215#n1585@v1:sha256:835d218e1be5bdb0163692dda989e3b54458dfb81a74218c2af9722c0774faba
---
| Global CLAUDE.md append | OUT | Install hook appends each claude-md/*.md snippet idempotently, keyed on the snippet's first line and refusing when any of its headings already exists in the target: global-rules.md — the owner's consolidated global standing rules, the authored source of the global CLAUDE.md content — and shaman-brainstorm-together.md, the short form of the Shaman's Mode 1 (its default mode) so any session in any project (including a main chat playing the Shaman without loading agents/shaman.md) runs the owner's brainstorm-together protocol. A snippet added later reaches an already-installed machine only because its first line and headings are new, so each snippet carries its own unique top heading | user's global config | install.sh + claude-md/; plugins/tribe/scripts/tests/test-install-hook.sh |
