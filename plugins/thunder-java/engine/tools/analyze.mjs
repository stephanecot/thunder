#!/usr/bin/env node
// Higher-order ARCHITECTURE / SECURITY / IMPACT queries answered from the thunder index alone
// (deterministic, ~0 model tokens). Demonstrates questions that are infeasible by reading source.
// Usage: node engine/tools/analyze.mjs <root>
import { build } from '../lib/build.mjs';

const root = process.argv[2] || 'demo';
const { model } = build(root);

const entities = new Set();
for (const c of model.contexts) Object.keys(c.entities).forEach((e) => entities.add(e));

const beanOwner = {};
for (const c of model.contexts) for (const b of Object.keys(c.beans)) beanOwner[b] = c.id;

const mutating = [];
const leaks = [];
const crossDeps = [];

for (const c of model.contexts) {
  for (const ep of c.endpoints) {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(ep.verb)) mutating.push(`${ep.verb} ${ep.path}`);
    const t = c.types.find((x) => x.n === ep.controller);
    const m = t?.methods.find((x) => x.n === ep.fn.split('.')[1]);
    if (m) {
      const ret = (m.sig.split('):')[1] || '').replace(/<.*>/, '').replace(/[^\w]/g, '');
      if (entities.has(ret)) leaks.push(`${ep.verb} ${ep.path}  → returns entity ${ret}  (${ep.fn})`);
    }
  }
  for (const [b, info] of Object.entries(c.beans)) {
    for (const d of info.deps) if (beanOwner[d] && beanOwner[d] !== c.id) crossDeps.push(`${c.id}:${b} → ${d} (defined in ${beanOwner[d]})`);
  }
}

console.log(`# Analyse de ${root}`);
console.log(`contexts=${model.contexts.length}  entities=${entities.size}  endpoints=${model.endpoints.length}`);
console.log(`[SÉCURITÉ] endpoints mutateurs (POST/PUT/DELETE/PATCH) : ${mutating.length}`);
console.log(`[SÉCURITÉ] endpoints qui exposent une ENTITÉ JPA directement (risque de fuite) : ${leaks.length}`);
for (const l of leaks.slice(0, 10)) console.log(`   - ${l}`);
console.log(`[ARCHITECTURE] dépendances de beans inter-contextes : ${crossDeps.length}`);
for (const l of crossDeps.slice(0, 10)) console.log(`   - ${l}`);
