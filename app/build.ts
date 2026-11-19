// Production build: bundle the React application with Bun into dist/ (app.js, app.css, index.html).
// env.json is written at deploy time from the environment (never committed).
import { rmSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
rmSync('dist', { recursive: true, force: true }); mkdirSync('dist');
const r = await Bun.build({ entrypoints: ['src/main.tsx'], outdir: 'dist', naming: 'app.js', minify: true, target: 'browser', sourcemap: 'linked',
  define: { 'process.env.NODE_ENV': '"production"' } });
if (!r.success) { for (const l of r.logs) console.error(l); process.exit(1); }
copyFileSync('src/styles.css', 'dist/app.css'); copyFileSync('index.html', 'dist/index.html');
if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)
  writeFileSync('dist/env.json', JSON.stringify({ supabaseUrl: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY, environment: process.env.APP_ENV || 'production' }));
console.log('built', r.outputs.map(o => `${o.path.split('/').pop()} ${(o.size / 1024).toFixed(0)} KB`).join(', '));
