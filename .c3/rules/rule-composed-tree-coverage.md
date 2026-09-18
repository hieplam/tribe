---
id: rule-composed-tree-coverage
c3-seal: d5ffa55be4c644de7757865d44f6d2be987fa122e7aab4653bd20d6c7ec5170e
title: composed-tree-coverage
type: rule
goal: |-
    Every UI component in this repo is proven to render through the composed tree a user actually
    reaches it in, not only in isolation. A component suite that mounts each component directly can be
    fully green while the page that ships never mounts that component at all — the dispatch table in
    between is the untested part, and it is the part that breaks. This holds across the 30 client
    components in `plugins/tribe/scripts/viewer/client/src/components` today.
---

## Goal

Every UI component in this repo is proven to render through the composed tree a user actually
reaches it in, not only in isolation. A component suite that mounts each component directly can be
fully green while the page that ships never mounts that component at all — the dispatch table in
between is the untested part, and it is the part that breaks. This holds across the 30 client
components in `plugins/tribe/scripts/viewer/client/src/components` today.

## Rule

Every component reachable from a rendered page has at least one test that mounts it through its real parent dispatcher or route — never only by rendering the component directly.

## Golden Example

Literal, from `plugins/tribe/scripts/viewer/client/src/components/composed.test.tsx:253`. The test
renders the real `RowList` dispatcher and asserts, per kind, that a marker only the *dedicated*
component emits is present:

```tsx
test('each of the 12 kinds mounts its real dedicated component (not an inline placeholder span)', () => {
  const kinds = Object.keys(RENDER_NODE_KINDS) as RenderNode['k'][];          // REQUIRED — enumerate from the union, not a hand list
  const nodes = kinds.map((k, idx) => nodeOfKind(k, 1000 + idx * 100));
  const { container, root } = renderInto(<RowList nodes={nodes} sessionId="sess-1" agentId={null} />);  // REQUIRED — the real parent, not the leaf
  for (const k of kinds) {
    const row = container.querySelector(`[data-kind="${k}"]`);
    expect({ kind: k, rowPresent: row !== null }).toEqual({ kind: k, rowPresent: true });
    const marker = REAL_COMPONENT_MARKER[k](row!);                            // REQUIRED — a marker ONLY the real component emits
    expect({ kind: k, realComponentMounted: marker !== null }).toEqual({ kind: k, realComponentMounted: true });
  }
  cleanup(container, root);
});
```

The same file's route-level shape (`composed.test.tsx:206`) mounts `App` at a URL and asserts a
real card renders — REQUIRED for any component whose parent is a route rather than a dispatcher.
Enumerating the kinds from the exported union rather than a literal array is REQUIRED: it is what
makes a newly added kind with no component fail the test instead of being silently skipped.

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| Asserting only that the dispatcher emitted a [data-kind] wrapper | Assert a marker only the dedicated component emits (.raw__type, [data-testid="image-expand"]) | The wrapper is emitted by the dispatcher itself, so kind coverage stayed green while five kinds rendered dead placeholder spans — the exact defect composed.test.tsx:236 records |
| A per-component test file only, with no composed test anywhere | Add one composed test that mounts the component through its real parent | A component can be perfectly correct and never mounted; the isolation test cannot see the dispatch table that decides whether it is |
| A hand-written literal list of kinds in the composed test | Enumerate from the exported union (Object.keys(RENDER_NODE_KINDS)) | A new union member silently skips the loop, so the one case the test exists to catch is the one it misses |
| Treating the composed test as redundant because "the unit tests already cover it" | Keep both — the units cover the units | Stated in plugins/tribe/rules/fixtures-mirror-reality.md; the composed tree is a distinct code path with its own defects |

## Scope

Applies to `client/src/components/**` and any future UI package in this repo: components rendered
through a dispatcher (a `k`/`type` switch), a route table, or a list renderer. It does not apply to
a pure presentational helper with no parent that selects it, nor to non-UI modules — those are
covered by ordinary unit tests. It mandates one composed test per component, not that every
component behaviour be re-asserted through the tree.

## Override

A component only ever mounted by a parent that cannot run under the test DOM (a native host view, a
third-party portal) may be exercised in isolation alone — record the unmountable parent by name in
the test file. "The composed test is slow" is not an override; it is one mount per kind.
