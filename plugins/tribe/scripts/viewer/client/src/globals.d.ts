// client/src/globals.d.ts — ambient declarations for the client type-check (`check:client`,
// tsconfig.client.json). A side-effect CSS import (`import './styles/app.css'` in main.tsx) has no
// TypeScript type of its own; this declares the `*.css` module shape so the client config resolves
// it as a bundler (Vite) would, rather than erroring TS2882. It carries no runtime code.
declare module '*.css';
