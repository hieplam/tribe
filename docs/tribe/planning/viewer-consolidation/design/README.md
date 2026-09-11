# Design candidates — transcript viewer

Three candidate design systems for the read-only Claude Code transcript viewer described in
`option-a`, offered so the owner can pick one. The brief was "something chill, matcha or coffee
theme"; the third candidate is the deliberate contrast, neither green nor brown.

| Candidate | Ground | Accent | Character |
| --- | --- | --- | --- |
| [`matcha/`](matcha/) | cream paper, foam panels | deep matcha green | softest — rounded, washed labels |
| [`coffee/`](coffee/) | oat-milk paper, crema panels | cinnamon espresso | most typographic — square, double rules |
| [`sea-salt/`](sea-salt/) | cool mist paper, salt panels | deep harbour blue | crispest — hairlines, 2px corners |

## What is in each folder

- **`tokens.css`** — the whole theme: colour, type, space, radius, shadow and focus ring as CSS
  custom properties. Light values sit on `:root`; dark values are declared twice, once under
  `@media (prefers-color-scheme: dark)` and once under `[data-theme="dark"]`, so the theme follows
  the OS by default but can be forced either way from JavaScript.
- **`preview.html`** — one self-contained page that inlines `tokens.css` and renders the swatch
  strip, a type specimen, both screens as faithful mockups, and a component row.
- **`preview-light.png` / `preview-dark.png`** — that page rendered at 1280×900 in headless
  Chromium, both modes.
- **`README.md`** — the mood, the accent and the reason for it, and what the theme is bad at.

## How to open them

Every page is plain HTML, CSS and about forty lines of JavaScript, with no build step, no
framework and no network request of any kind. Open them straight off disk:

```
open docs/tribe/planning/viewer-consolidation/design/index.html
```

`index.html` puts the three swatch strips side by side for comparison and links to each full
preview. Inside a preview, the button at the top right cycles **auto → light → dark**; `auto`
follows the OS appearance, the other two force it by setting `data-theme` on `<html>`.

## About the contrast figures

Every ratio shown beside a swatch is **computed in the browser at load**, never typed: a hidden
probe element resolves each token to its rendered `rgb()`, and a WCAG relative-luminance ratio is
computed against that theme's own `--paper`. Changing the theme repaints the figures, so the dark
numbers are as measured as the light ones. All three candidates clear the bar with room:

| Candidate | body ink on paper (light) | body ink on paper (dark) |
| --- | --- | --- |
| Matcha | 13.39:1 | 15.35:1 |
| Coffee | 15.18:1 | 15.46:1 |
| Sea salt | 14.41:1 | 15.57:1 |

The floor for any text token is 4.5:1 and for the live dot 3:1; body text targets 7:1. Colour is
used as stroke, rule and small text only — there are no large saturated fills, and no status is
signalled by hue alone (every coloured state also carries a word or a glyph).

## How the chosen theme becomes the client's source of truth

Exactly one file survives the choice: the winner's `tokens.css`. The intended path is

1. Copy the chosen `tokens.css` to the React client's source as the single stylesheet imported once
   at the app root, before any component styles.
2. Delete the two rejected folders, or keep them here as a design record — either way nothing
   outside `tokens.css` is referenced by the app.
3. Component styles consume tokens only: `color: var(--ink)`, `border-color: var(--rule)`,
   `padding: var(--space-12)`. No component declares a literal colour, size or radius. That rule is
   what makes the theme swappable later — a second theme is one more `tokens.css`, not a refactor.
4. The mockups in `preview.html` are the reference implementation of the two screens: the class
   names there (`.item`, `.badge`, `.tool`, `.tab`, `.thinking`, `.pill`) map one-to-one onto the
   components the client needs, so the preview doubles as the spec for the markup.

Dark mode needs no application code: it is already in the tokens, via the media query. Only if the
client offers a manual override does it need to set `data-theme` on `<html>`, which the tokens
already honour.
