# BOARD — <slug>

> **Resume protocol for any Shaman session.** Read this file top to bottom. Then open exactly what
> "Now" points at. Never write a handoff document: update this board at every milestone and append
> the detail to `LOG.md` beside it. The board is the state; the log is the history.
>
> Location: `~/.tribe/<repo-key>/<slug>/BOARD.md` (+ `LOG.md`). One board per piece of work.

## 0. Identity
| Field | Value |
| --- | --- |
| Repo / branch / worktree | |
| Card (What/Why, goals, fence, authority) | |
| Spec / Plan (revision, approval decision id) | |
| Owner artifact (rendered) | |
| References (research, reviews) | |
| Design system | |
| Log | `LOG.md` |

## 1. Now
**Phase:** `RESEARCH | SPEC | APPROVED | BUILD (phase N) | PR OPEN | MERGED | VERIFIED`
**Next action:** one sentence, with the file or task it points at.
**Blocked on:** nothing | owner: <question> | external: <what>

## 2. Progress board
| Phase | Tasks | Status | Evidence / PR |
| --- | --- | --- | --- |
Status vocabulary: `todo` · `in-progress (task N)` · `blocked: <why>` · `done (<commit/PR>)`.

## 3. Rulings index
One line per ruling id (D<n>): who ruled, one clause. Verbatim text lives in the spec and LOG.md.
Mark owner rulings and delegated (Shaman) rulings separately.

## 4. Reviewer configuration
| Lens | Default | Fallback |
| --- | --- | --- |
(See the owner's standing rule in the Shaman's memory: cross-vendor reviewers to avoid bias.)

## 5. Owner-level abstractions
For each detailed area the owner delegated: what it does, the oracle, the test cases the owner can
name, and where the detail lives. The owner reviews this section, not the delegated rulings.

## 6. Open questions for the owner
## 7. Follow-ups (outside this card's fence)
