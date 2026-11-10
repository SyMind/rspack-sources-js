import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const checkout = join(root, '.bench/ant-design-examples');
const commit = '447d77affd96d7e0d841683cdc4314f6fc22d71c';
if (!existsSync(checkout)) {
  execFileSync('git', ['clone', '--depth', '1', 'https://github.com/ant-design/ant-design-examples.git', checkout], { stdio: 'inherit' });
}
let actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim();
if (actual !== commit) {
  if (execFileSync('git', ['status', '--porcelain'], { cwd: checkout, encoding: 'utf8' }).trim()) throw new Error('Official example checkout has local changes');
  execFileSync('git', ['fetch', '--depth', '1', 'origin', commit], { cwd: checkout, stdio: 'inherit' });
  execFileSync('git', ['checkout', '--detach', commit], { cwd: checkout, stdio: 'inherit' });
  actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim();
}
const app = join(root, '.bench/antd-webpack-app');
mkdirSync(app, { recursive: true });
cpSync(join(checkout, 'examples/rsbuild-normal/src'), join(app, 'src'), { recursive: true });
const dependencies = { antd: '5.19.2', react: '18.3.1', 'react-dom': '18.3.1' };
writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'antd-official-webpack-capture', private: true, packageManager: 'pnpm@11.10.0', dependencies }, null, 2) + '\n');
cpSync(join(root, 'benchmark/fixtures/antd-official/app-pnpm-lock.yaml'), join(app, 'pnpm-lock.yaml'));
const sourceHash = createHash('sha256').update(readFileSync(join(app, 'src/App.tsx'))).digest('hex');
const sourceFiles = Object.fromEntries(readdirSync(join(app, 'src'), { recursive: true }).sort().map(name => [name, createHash('sha256').update(readFileSync(join(app, 'src', name))).digest('hex')]));
const appLockSha256 = createHash('sha256').update(readFileSync(join(app, 'pnpm-lock.yaml'))).digest('hex');
writeFileSync(join(app, 'provenance.json'), JSON.stringify({ repository: 'https://github.com/ant-design/ant-design-examples', commit: actual, example: 'examples/rsbuild-normal', sourceHash, sourceFiles, appLockSha256, sourceChanges: [], buildAdapter: 'fixed webpack 5.111.1 replaces Rsbuild; application source is unchanged', dependencies }, null, 2) + '\n');
console.log('Official example:', actual, 'examples/rsbuild-normal');
const install = spawnSync('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], { cwd: app, stdio: 'inherit' });
process.exit(install.status ?? 1);
