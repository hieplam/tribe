// vite.config.ts — the client build (plan Task 22, spec §3.1/§10.3/§12.4). `root` is left at its
// default (this package's directory — `install.sh`/`bun run build` always `cd` here first, spec
// §10.3), because `index.html` lives at this same directory (spec §3.1's Create list: `V/index.html`,
// not `V/client/index.html`) — Vite/Rolldown refuse to emit an HTML entry that sits OUTSIDE the
// configured `root` (verified empirically: `root: 'client'` with the entry one level above it
// fails with "the fileName ... must not be a relative or absolute path, received '../index.html'").
// `build.outDir: 'dist'` therefore resolves to this package's own `dist/`, exactly where spec
// §3.1's package-layout tree puts it (a sibling of `client/`, not nested inside it).
//
// `base` is deliberately left at its default (`/`), NOT `/assets/`: `assetsDir` already defaults
// to `assets` (so every hashed chunk physically lands at `dist/assets/<name>`, matching serve.ts's
// `readdir(dist/assets)` boot scan, §12.4), and Vite prepends `base` IN ADDITION to `assetsDir`
// when building each `<script>`/`<link>` URL. Setting `base: '/assets/'` on top of the default
// `assetsDir` produces `/assets/assets/<name>` (verified empirically) — a TWO-segment path that
// `core/routes.ts`'s `/^\/assets\/([^/]+)$/` (single segment, no slash) can never match, so the
// built page's own script and stylesheet would 404. Leaving `base` at `/` yields exactly
// `/assets/<name>`, the one shape serve.ts's route and boot-time map agree on.
//
// No copy step for the design tokens (D18): `client/src/styles/index.css` `@import`s
// `design/sea-salt/tokens.css` directly, and Vite/Rollup resolve that at build time — adding a
// filesystem write here would be exactly the runtime-adjacent write the D16 wall forbids.
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
