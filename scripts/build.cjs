'use strict';
const { spawnSync } = require('node:child_process');
const { copyFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const args = ['build', '--locked', '-p', 'rspack_sources_js', '--message-format=json-render-diagnostics'];
if (!process.argv.includes('--debug')) args.push('--release');
const result = spawnSync('cargo', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
let artifact;
for (const line of result.stdout.split('\n')) {
  if (!line) continue;
  const message = JSON.parse(line);
  if (message.reason === 'compiler-artifact' && message.target.name === 'rspack_sources_js') {
    artifact = message.filenames.find(file => /\.(dylib|so|dll)$/.test(file));
  }
}
if (!artifact) throw new Error('Cargo did not produce the native library');
mkdirSync(path.join(root, 'native'), { recursive: true });
copyFileSync(artifact, path.join(root, 'native/rspack_sources.node'));
console.log('Built native/rspack_sources.node');
