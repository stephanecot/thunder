#!/usr/bin/env node
// Rich functional layer for the synthetic pydemo (English). Demo/benchmark tool only.
import { build } from '../lib/build.mjs';
import { buildEvidence, evidenceHash, saveFunctional, loadFunctional, setModuleFunctional } from '../lib/functional.mjs';

const root = process.argv[2] || 'pydemo';
const t0 = process.hrtime.bigint();
const { model } = build(root);
const store = loadFunctional(root);

for (const ctx of model.contexts) {
  const base = Object.keys(ctx.models)[0] || ctx.classes[0]?.n || ctx.name;
  const intents = {};
  for (const r of ctx.routes) {
    const v = r.verb; const p = r.path || '/';
    intents[p] = /approve/.test(p) ? `Approve a ${base}` : v === 'POST' ? `Create a ${base}` : v === 'PUT' ? `Update a ${base}` : v === 'DELETE' ? `Delete a ${base}` : /\{/.test(p) ? `Look up a ${base} by id` : `Search ${base}`;
  }
  store[ctx.id] = {
    evidence_hash: evidenceHash(buildEvidence(ctx, root)),
    src_hash: ctx.src_hash,
    name: base,
    purpose: `Manage the ${base} lifecycle: creation, update, approval and search`,
    capabilities: [`Create a ${base}`, `Update a ${base}`, `Approve a ${base}`, `Search ${base}`],
    business_rules: [
      { rule: 'Amount must be strictly positive', src: `models.py ${base}Create.amount_positive` },
      { rule: 'Code is unique', src: `service.py create(): repo.exists(code=...)` },
      { rule: 'An approved record cannot be modified', src: `service.py update(): status == APPROVED` },
      { rule: 'Only a PENDING record can be approved', src: `service.py _validate_transition()` },
    ],
    intents,
  };
}
saveFunctional(root, store);
build(root);
for (const m of model.projects) setModuleFunctional(root, model, m, { theme: `FastAPI domain services for ${m}` });
build(root);

const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`populated: ${model.contexts.length} contexts, ${model.projects.length} projects in ${ms.toFixed(0)}ms`);
