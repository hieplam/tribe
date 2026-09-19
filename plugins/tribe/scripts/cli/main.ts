// main.ts — composition root of the `tribe` CLI: the only file that reads process.argv and
// exits the process. `bin/tribe` imports it; every decision lives in core/.
import plugin from '../../.claude-plugin/plugin.json';
import { buildViewerIo } from './adapters/viewer.adapter.ts';
import { HELP, parseArgs } from './core/args.ts';
import { runViewer } from './core/viewer.ts';

const command = parseArgs(process.argv.slice(2));

if (command.kind === 'help') {
  console.log(HELP);
  process.exit(0);
}
if (command.kind === 'version') {
  console.log(plugin.version);
  process.exit(0);
}
if (command.kind === 'refuse') {
  console.error(command.message);
  process.exit(2);
}

process.exit(await runViewer(command, buildViewerIo()));
