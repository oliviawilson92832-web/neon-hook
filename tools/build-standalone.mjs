/**
 * Builds a single, dependency-free standalone index.html.
 *
 *   node tools/build-standalone.mjs
 *
 * Output: dist/standalone/index.html
 *   • vanilla JS (TypeScript sources transpiled + bundled with esbuild)
 *   • CSS inlined, web fonts embedded as base64 woff2 (no network needed)
 *   • CrazyGames SDK v3 integration preserved
 *
 * Nothing here depends on Vite, React or Tailwind at runtime.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...a) => join(root, ...a);

const FONTS = [
  {
    file: 'node_modules/@fontsource-variable/orbitron/files/orbitron-latin-wght-normal.woff2',
    family: 'Orbitron Variable',
    weight: '400 900',
    style: 'normal',
  },
  {
    file: 'node_modules/@fontsource/chakra-petch/files/chakra-petch-latin-500-normal.woff2',
    family: 'Chakra Petch',
    weight: '500',
    style: 'normal',
  },
  {
    file: 'node_modules/@fontsource/chakra-petch/files/chakra-petch-latin-600-normal.woff2',
    family: 'Chakra Petch',
    weight: '600',
    style: 'normal',
  },
];

const kb = (n) => (n / 1024).toFixed(1) + ' KB';

/* ── 1. bundle the game (TypeScript → ES2019 JS, single IIFE) ── */
const result = await build({
  entryPoints: [p('standalone/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2019'],
  platform: 'browser',
  charset: 'utf8',
  legalComments: 'none',
  write: false,
  logLevel: 'warning',
});
let js = result.outputFiles[0].text;

// A literal </script> inside the bundle would close our tag early.
js = js.replace(/<\/script/gi, '<\\/script');

/* ── 2. fonts as base64 data URIs ── */
const fontCss = FONTS.map(({ file, family, weight, style }) => {
  const buf = readFileSync(p(file));
  const b64 = buf.toString('base64');
  return `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
}).join('\n');

const css = fontCss + '\n' + readFileSync(p('standalone/style.css'), 'utf8');

/* ── 3. inline into the template ── */
let html = readFileSync(p('standalone/index.template.html'), 'utf8');
html = html.replace('/*__INLINE_CSS__*/', () => css).replace('/*__INLINE_JS__*/', () => js);

if (html.includes('__INLINE_CSS__') || html.includes('__INLINE_JS__')) {
  throw new Error('Inline placeholders were not substituted');
}

/* ── 4. write ──
   NOTE: deliberately NOT inside dist/ — `vite build` empties that directory. */
const outDir = p('export');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'index.html');
writeFileSync(outFile, html, 'utf8');

const size = statSync(outFile).size;
const gz = gzipSync(readFileSync(outFile)).length;
console.log('✔ standalone build → export/index.html');
console.log(`  html       ${kb(size)}  (gzip ${kb(gz)})`);
console.log(`  js bundle  ${kb(Buffer.byteLength(js))}`);
console.log(`  css+fonts  ${kb(Buffer.byteLength(css))}`);

/* ── 5. zip for upload (CrazyGames takes a zipped index.html) ── */
const zipPath = join(outDir, 'neon-hook.zip');
try {
  rmSync(zipPath, { force: true });
  execFileSync('python3', ['-m', 'zipfile', '-c', zipPath, 'index.html'], { cwd: outDir, stdio: 'pipe' });
  console.log(`  zip        ${kb(statSync(zipPath).size)} → export/neon-hook.zip`);
} catch (e) {
  console.log('  zip        skipped (python3 zipfile unavailable):', String(e.message).split('\n')[0]);
}
