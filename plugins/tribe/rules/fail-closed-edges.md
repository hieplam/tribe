# Impure edges fail closed

## Rule

An **impure edge** — the thin layer that reads a file, parses external input, spawns a
subprocess, or resolves a path — sits between hostile reality and a pure core that assumes
well-formed input. It must fail *closed*: refuse with a clear message, never crash, never hang,
never reach outside its root.

Four obligations, each earned from a real defect:

1. **Catch narrowly, never bare.** Wrap external input in the *specific* exceptions it can
   raise — `json.JSONDecodeError`, `UnicodeDecodeError`, `re.error`, `OSError` — and convert
   each to a typed refusal. Never `except Exception`, and never let a traceback escape into a
   git hook or a CLI: a traceback is an unhandled case, and to the user it is a crash, not a
   verdict. The same obligation covers argument parsing: a CLI flag whose value is missing must
   refuse with a message, never silently consume the next argv token as its value (campaign
   gap-gate-2026-09-10, PR #128: `--card --base <sha>` read `--base` as the card name).
2. **Isolate every subprocess the tool spawns.** A tool that shells out to `git` must neutralise
   the host's configuration — `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` set to `os.devnull` —
   so an unusual-but-legal host setting (`commit.gpgsign=true` with no usable key, a global
   hooks path, a template dir) cannot change the tool's behaviour or a test's verdict.
3. **Every `subprocess.run` carries `timeout=`.** A subprocess without a timeout is an
   unbounded hang waiting for the one network call, lock, or prompt that never returns. A hung
   pre-commit hook is indistinguishable from a broken one, and it blocks the user's work with
   no output at all.
4. **A path from outside is contained before it is used.** Any path read from a manifest,
   config, or user input is resolved and proven to sit inside its declared root — no `..`
   escape, no absolute path, no symlink that leaves the tree — *before* anything opens, writes,
   or deletes through it.

## Why

The pure core earns its determinism by assuming its inputs are already valid. That assumption
is only true if something enforces it, and the edge is the only place that can. An edge that
lets a malformed byte, a hostile path, or a hung child through has not merely failed itself —
it has broken the guarantee the whole core rests on.

The failure mode is consistently *silent-then-loud*: the tool works on every well-formed input
during development, then a single malformed manifest turns a lint run into a Python traceback
in front of a user who only wanted to commit. In one extraction campaign, eight consecutive fix
commits on a single task were all variants of obligation 1 — the same missing narrow-catch,
found one input class at a time, because it was never stated as a rule.

## Golden pattern

```python
# EDGE — hostile input in, typed refusal or clean data out.
def load_manifest(path, root):
    resolved = (root / path).resolve()
    if not resolved.is_relative_to(root.resolve()):        # obligation 4
        raise ManifestError(f"manifest path {path!r} escapes the wiki root")
    try:
        data = json.loads(resolved.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError) as exc:   # obligation 1
        raise ManifestError(f"manifest {path} is unreadable: {exc}") from None
    if not isinstance(data, dict):
        raise ManifestError(f"manifest {path} is not a JSON object")
    return data

# EDGE — subprocess, isolated and bounded.
def git(root, *args):
    env = dict(os.environ)
    env["GIT_CONFIG_GLOBAL"] = os.devnull                  # obligation 2
    env["GIT_CONFIG_SYSTEM"] = os.devnull
    return subprocess.run(["git", "-C", str(root), *args],
                          capture_output=True, text=True, env=env,
                          timeout=30)                      # obligation 3

# CORE — pure, and entitled to assume the dict is well-formed.
def diff_manifest(recorded, observed): ...
```

## Not this

- `except Exception:` around a parse, or no handler at all, in anything a git hook invokes.
- A `git` call that inherits the host's global config inside a tool or a test.
- `subprocess.run(...)` with no `timeout=` — including in tests, where a hang stalls CI with no
  failing assertion to point at.
- Opening or deleting a manifest-supplied path without proving containment first.

## Pragmatism — how reviewers grade it

- A traceback reachable from a git hook or a user-facing CLI on malformed input →
  **Blocker**.
- An uncontained path used for a write or a delete → **Blocker**.
- A bare `except Exception` around external input → **Should-fix** (narrow it, or justify in a
  comment why the catch-all is the correct failure boundary).
- `subprocess.run` without `timeout=` in tool code → **Should-fix**; in test code →
  **Optional**, but note it.
- Missing git-config isolation where no test or behaviour currently depends on it →
  **Optional**; **Should-fix** the moment a verdict could turn on host config.
