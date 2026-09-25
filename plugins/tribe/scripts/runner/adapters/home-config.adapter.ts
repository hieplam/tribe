/**
 * The campaign home's configuration surface, read and restored on the real file system (card
 * supervisor-home-settings-containment, spec §6.3). It performs; it decides nothing: WHAT is a
 * surface is `core/supervisor/home-config.ts#isHomeConfigSurface`, and WHAT to undo is
 * `planHomeConfigRestore`. Every failure becomes a typed `HomeConfigError`
 * (`fail-closed-edges.md` obligation 1), which `runOneShotSession` turns into a fail-closed
 * outcome.
 */
import { readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { errorCode } from '../core/errno.ts';
import { isHomeConfigSurface, type HomeConfigEntry, type HomeConfigSnapshot } from '../core/supervisor/home-config.ts';

export class HomeConfigError extends Error {
  constructor(action: 'snapshot' | 'restore', path: string, code: string | null) {
    super(`home configuration ${action} failed at ${path}: ${code ?? 'unknown error'}`);
    this.name = 'HomeConfigError';
  }
}

/** Walks `homeDir` WITHOUT following any symlink and records, sorted by path: every
 * configuration-surface directory and file (a file with its bytes, base64), and every symlink
 * anywhere in the home (with its target, never resolved). The symlink clause closes what the name
 * rule alone would miss: a directory replaced by a link to one holding a `CLAUDE.md` (spec §6.3).
 * Every other file is only listed, never read. */
export function snapshotHomeConfig(homeDir: string): HomeConfigSnapshot {
  const entries: HomeConfigEntry[] = [];
  const walk = (relativeDir: string): void => {
    const absoluteDir = relativeDir === '' ? homeDir : join(homeDir, relativeDir);
    let children;
    try {
      children = readdirSync(absoluteDir, { withFileTypes: true });
    } catch (err) {
      throw new HomeConfigError('snapshot', absoluteDir, errorCode(err));
    }
    for (const child of children) {
      const relativePath = relativeDir === '' ? child.name : `${relativeDir}/${child.name}`;
      const absolutePath = join(homeDir, relativePath);
      try {
        if (child.isSymbolicLink()) {
          entries.push({ path: relativePath, kind: 'symlink', content: readlinkSync(absolutePath) });
        } else if (child.isDirectory()) {
          if (isHomeConfigSurface(relativePath)) entries.push({ path: relativePath, kind: 'dir', content: '' });
          walk(relativePath);
        } else if (child.isFile() && isHomeConfigSurface(relativePath)) {
          entries.push({ path: relativePath, kind: 'file', content: readFileSync(absolutePath).toString('base64') });
        }
      } catch (err) {
        if (err instanceof HomeConfigError) throw err;
        throw new HomeConfigError('snapshot', absolutePath, errorCode(err));
      }
    }
  };
  walk('');
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
