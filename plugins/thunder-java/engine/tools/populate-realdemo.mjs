#!/usr/bin/env node
// Rich, accurate functional layer for the realistic realdemo (English), reflecting the actual
// 7 operations + approval state machine + grounded business rules. Demo/benchmark tool only.
import { build } from '../lib/build.mjs';
import { buildEvidence, evidenceHash, saveFunctional, loadFunctional, setModuleFunctional } from '../lib/functional.mjs';

const root = process.argv[2] || 'realdemo';
const t0 = process.hrtime.bigint();
const { model } = build(root);
const store = loadFunctional(root);

const intentFor = (meth, base) => ({
  create: `Create a ${base}`, get: `Look up a ${base} by id`, update: `Update a ${base}`,
  delete: `Delete a ${base}`, search: `Search ${base} by owner and status`,
  approve: `Approve a ${base}`, reject: `Reject a ${base}`,
}[meth] || meth);

for (const ctx of model.contexts) {
  const base = (ctx.types.find((t) => t.n.endsWith('Controller'))?.n || ctx.name).replace('Controller', '');
  const intents = {};
  for (const e of ctx.endpoints) intents[e.fn] = intentFor(e.fn.split('.')[1], base);
  store[ctx.id] = {
    evidence_hash: evidenceHash(buildEvidence(ctx, root)),
    src_hash: ctx.src_hash,
    name: base,
    purpose: `Manage the ${base} lifecycle: creation, update, approval and search`,
    capabilities: [
      `Create a ${base}`, `Update a ${base}`, `Delete a ${base}`,
      `Look up a ${base} by id`, `Search ${base} by owner and status`,
      `Approve a ${base}`, `Reject a ${base}`,
    ],
    business_rules: [
      { rule: 'Code is required, unique and at most 64 chars', src: `${base}Request.java @NotBlank @Size(max=64); ${base}.java @Column(unique=true)` },
      { rule: 'Amount must be strictly positive', src: `${base}Service.java validate(); ${base}Request.java @DecimalMin("0.01")` },
      { rule: 'An approved record cannot be modified', src: `${base}Service.java update(): status == APPROVED` },
      { rule: 'Only a PENDING record can be approved or rejected', src: `${base}Service.java validateTransition()` },
      { rule: 'A new record starts in PENDING status', src: `${base}Service.java create(): setStatus(PENDING)` },
    ],
    intents,
    glossary: [
      { term: base, def: 'A coded, owner-attributed record with an amount and an approval status' },
      { term: 'Approval', def: 'State transition PENDING -> APPROVED or REJECTED' },
    ],
    confidence: 'high',
  };
}
saveFunctional(root, store);
build(root);
for (const m of model.modules) setModuleFunctional(root, model, m, { theme: `Lifecycle domain services for ${m}` });
build(root);

const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`populated realdemo: ${model.contexts.length} contexts, ${model.modules.length} modules in ${ms.toFixed(0)}ms`);
