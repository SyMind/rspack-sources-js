import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// codspeed-linux shares its source directory with macOS. A separate source copy
// prevents a Linux build from replacing native/rspack_sources.node on the host.
const root = fileURLToPath(new URL('..', import.meta.url));
mkdirSync(join(root, '.bench'), { recursive: true });
const destination = mkdtempSync(join(root, '.bench/linux-capture-'));
const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
for (const path of paths) {
  mkdirSync(dirname(join(destination, path)), { recursive: true });
  cpSync(join(root, path), join(destination, path));
}
const gitDirectory = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: root, encoding: 'utf8' }).trim();
writeFileSync(join(destination, '.git'), `gitdir: ${gitDirectory}\n`);
writeFileSync(join(root, '.bench/linux-workspace'), destination + '\n');
console.log(destination);
