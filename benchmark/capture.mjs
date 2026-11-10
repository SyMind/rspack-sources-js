import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const webpack = require('webpack');
const CaptureSourcesPlugin = require('./capture-plugin.cjs');
const root = fileURLToPath(new URL('..', import.meta.url));
const app = join(root, '.bench/antd-webpack-app');
const provenance = { ...JSON.parse(readFileSync(join(app, 'provenance.json'), 'utf8')), capturePlatform: `${process.platform}-${process.arch}`, captureNode: process.version };
const directory = resolve(root, 'benchmark/fixtures/antd-official');
const modes = process.argv.find(arg => arg.startsWith('--mode='))?.slice(7).split(',') ?? ['development', 'production'];
const captureOnly = process.argv.includes('--no-control-build');

function build(mode, instrument) {
  const output = join(root, '.bench/webpack-output', `${mode}-${instrument ? 'captured' : 'control'}`);
  const compiler = webpack({
    name: `antd-official-${mode}`, mode, context: app, entry: './src/index.tsx', cache: false,
    devtool: 'source-map',
    output: { path: output, filename: 'app.js', cssFilename: 'app.css', clean: true, hashFunction: 'xxhash64', uniqueName: 'antd-official' },
    resolve: { extensions: ['.tsx', '.ts', '.jsx', '.js'], modules: [join(app, 'node_modules'), 'node_modules'] },
    module: { rules: [
      { test: /\.tsx?$/, include: join(app, 'src'), use: [join(root, 'benchmark/typescript-loader.cjs')] },
      { test: /\.css$/, type: 'css' },
    ] },
    experiments: { css: true },
    optimization: { moduleIds: 'deterministic', chunkIds: 'deterministic' },
    plugins: instrument ? [new CaptureSourcesPlugin({ mode, directory, provenance })] : [],
    stats: 'errors-warnings', infrastructureLogging: { level: 'error' },
  });
  return new Promise((resolve, reject) => {
    compiler.run((error, stats) => {
      compiler.close(closeError => {
        if (error || closeError) return reject(error ?? closeError);
        if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })));
        const json = stats.toJson({ all: false, hash: true, assets: true, modules: true, timings: true });
        const files = Object.fromEntries(readdirSync(output).filter(name => /\.(js|css)(\.map)?$/.test(name)).map(name => [name, createHash('sha256').update(readFileSync(join(output, name))).digest('hex')]));
        const modules = stats.compilation.modules.size;
        console.log(`[${mode}/${instrument ? 'captured' : 'control'}] ${modules} modules, assets=${Object.keys(files).join(',')}`);
        resolve({ files, compilationHash: json.hash, modules, timeMs: json.time });
      });
    });
  });
}

mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
const summary = { provenance, webpack: webpack.version, webpackSources: require('webpack-sources/package.json').version, builds: {} };
for (const mode of modes) {
  if (!['development', 'production'].includes(mode)) throw new Error(`Unknown mode ${mode}`);
  const control = captureOnly ? null : await build(mode, false);
  const captured = await build(mode, true);
  if (control && JSON.stringify(control.files) !== JSON.stringify(captured.files)) throw new Error(`${mode}: capture instrumentation changed emitted bytes`);
  summary.builds[mode] = { control, captured, identicalAssets: control ? true : null };
  writeFileSync(join(directory, 'builds.json'), JSON.stringify(summary, null, 2) + '\n');
}
console.log(captureOnly ? 'Captured official Ant Design webpack graphs; control build was explicitly skipped.' : 'Captured official Ant Design webpack graphs and observed calls; emitted assets match control builds.');
