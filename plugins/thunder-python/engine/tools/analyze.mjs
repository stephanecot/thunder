#!/usr/bin/env node
// Higher-order ARCHITECTURE / SECURITY queries answered from the thunder-python index alone
// (deterministic, ~0 model tokens). Usage: node engine/tools/analyze.mjs <root>
import { build } from '../lib/build.mjs';

const root = process.argv[2] || 'demo';
const { model } = build(root);

const mutating = [];
const noDI = [];
for (const c of model.contexts) {
  for (const r of c.routes) {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(r.verb)) mutating.push(`${r.verb} ${r.path}`);
    const deps = (c.di || {})[r.fn] || (c.di || {})[r.fn?.split('.').pop()] || [];
    if (c.framework === 'fastapi' && !deps.length) noDI.push(`${r.verb} ${r.path}  (${r.fn})`);
  }
}
const fw = {};
for (const c of model.contexts) fw[c.framework] = (fw[c.framework] || 0) + 1;

console.log(`# Analyse de ${root}`);
console.log(`contexts=${model.contexts.length}  routes=${model.routes.length}  frameworks=${Object.entries(fw).map(([k, v]) => `${k}:${v}`).join(' ')}`);
console.log(`[SÉCURITÉ] routes mutatrices (POST/PUT/DELETE/PATCH) : ${mutating.length}`);
console.log(`[SÉCURITÉ] routes FastAPI SANS dépendance injectée (auth/DI manquante ?) : ${noDI.length}`);
for (const l of noDI.slice(0, 10)) console.log(`   - ${l}`);
