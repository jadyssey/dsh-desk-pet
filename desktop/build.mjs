// Bundle the frontend for Tauri: esbuild-bundle src/main.js (with gifuct-js
// inlined) into dist/main.js, and copy static assets.
import { build } from 'esbuild';
import { cpSync, rmSync, mkdirSync } from 'fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  // iife classic script: this webkit2gtk webview silently refuses to run
  // module scripts, which made the whole app look dead (CSS-only page).
  format: 'iife',
  platform: 'browser',
  outfile: 'dist/main.js',
  target: 'es2022',
  sourcemap: false,
  minify: false,
});

// Copy static files (HTML/CSS/assets) — no transform needed.
cpSync('src/index.html', 'dist/index.html');
cpSync('src/styles.css', 'dist/styles.css');
cpSync('src/assets', 'dist/assets', { recursive: true });

console.log('Frontend bundled to dist/');
