/**
 * The campaign home's configuration surface, read and restored on the real file system (card
 * supervisor-home-settings-containment, spec §6.3). It performs; it decides nothing: WHAT is a
 * surface is `core/supervisor/home-config.ts#isHomeConfigSurface`, and WHAT to undo is
 * `planHomeConfigRestore`. Every failure becomes a typed `HomeConfigError`
 * (`fail-closed-edges.md` obligation 1), which `runOneShotSession` turns into a fail-closed
 * outcome.
 */
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { errorCode } from '../core/errno.ts';
import { containPath } from '../core/supervisor/permit.ts';
import {
  isHomeConfigSurface,
  type HomeConfigEntry,
  type HomeConfigRestorePlan,
  type HomeConfigSnapshot,
} from '../core/supervisor/home-config.ts';

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

/** Applies `plan` inside `homeDir`: every removal, then every write. Before anything is removed
 * or written, obligation 4 (`fail-closed-edges.md`): the plan path is relative with no `..`, and the
 * real path of its deepest existing ancestor is the real home or inside it. A removal never
 * follows a symlink (`rmSync` unlinks the link itself); a write never goes THROUGH one (a link at
 * the target is unlinked first). Throws `HomeConfigError` on the first failure. */
export function restoreHomeConfig(homeDir: string, plan: HomeConfigRestorePlan): void {
  let realHome: string;
  try {
    realHome = realpathSync(homeDir);
  } catch (err) {
    throw new HomeConfigError('restore', homeDir, errorCode(err));
  }
  for (const entry of plan.remove) {
    const target = containedTarget(realHome, entry.path);
    try {
      rmSync(target, { recursive: true, force: true });
    } catch (err) {
      throw new HomeConfigError('restore', target, errorCode(err));
    }
  }
  for (const entry of plan.write) {
    const target = containedTarget(realHome, entry.path);
    try {
      mkdirSync(dirname(target), { recursive: true });
      if (isSymlink(target)) unlinkSync(target); // never write through a link
      if (entry.kind === 'dir') mkdirSync(target, { recursive: true });
      else if (entry.kind === 'file') writeFileSync(target, Buffer.from(entry.content, 'base64'));
      else symlinkSync(entry.content, target);
    } catch (err) {
      throw new HomeConfigError('restore', target, errorCode(err));
    }
  }
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return false;
    throw err;
  }
}

/** Obligation 4: proves `relativePath` stays inside `realHome` BEFORE it is used. */
function containedTarget(realHome: string, relativePath: string): string {
  const segments = relativePath.split('/');
  const isPlainRelative = relativePath !== '' && !isAbsolute(relativePath)
    && !segments.includes('..') && !segments.includes('');
  if (!isPlainRelative) throw new HomeConfigError('restore', relativePath, 'EPATH_NOT_CONTAINED');
  const target = join(realHome, relativePath);

  let ancestor = dirname(target);
  while (!pathExists(ancestor)) ancestor = dirname(ancestor);
  let realAncestor: string;
  try {
    realAncestor = realpathSync(ancestor);
  } catch (err) {
    throw new HomeConfigError('restore', ancestor, errorCode(err));
  }
  const isInsideHome = realAncestor === realHome || containPath(realAncestor, realHome);
  if (!isInsideHome) throw new HomeConfigError('restore', target, 'EPATH_NOT_CONTAINED');
  return target;
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return false;
    throw new HomeConfigError('restore', path, errorCode(err));
  }
}
