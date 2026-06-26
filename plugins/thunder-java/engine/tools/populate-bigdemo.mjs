#!/usr/bin/env node
// Populate the FUNCTIONAL layer of the synthetic bigdemo in one in-process pass.
// (bigdemo is template-generated, so its business meaning is deterministic — no need to
//  spend tokens on the cartographer. Real projects use /thunder:reindex instead.)
// All index text is ENGLISH, per project convention.
import { build } from '../lib/build.mjs';
import {
  buildEvidence, evidenceHash, saveFunctional, loadFunctional,
  setModuleFunctional,
} from '../lib/functional.mjs';

const root = process.argv[2] || 'bigdemo';
const t0 = process.hrtime.bigint();

const { model } = build(root);
const store = loadFunctional(root);

for (const ctx of model.contexts) {
  const ctrl = ctx.types.find((t) => t.n.endsWith('Controller'));
  const base = (ctrl?.n || ctx.name).replace('Controller', '');
  const intents = {};
  for (const e of ctx.endpoints) {
    const meth = e.fn.split('.')[1];
    intents[e.fn] = meth === 'create' ? `Create a ${base}`
      : meth === 'get' ? `Look up a ${base} by code`
        : meth === 'remove' ? `Delete a ${base}` : meth;
  }
  store[ctx.id] = {
    evidence_hash: evidenceHash(buildEvidence(ctx, root)),
    src_hash: ctx.src_hash,
    name: base,
    purpose: `Manage the ${base} domain`,
    capabilities: [`Create a ${base}`, `Look up a ${base} by code`, `Delete a ${base}`],
    business_rules: [
      { rule: 'Code is unique', src: `${base}.java @Column(unique=true)` },
      { rule: 'Code is required', src: `${base}Dto.java @NotBlank` },
      { rule: 'Quantity must be at least 1', src: `${base}Dto.java @Min(1)` },
      { rule: 'Creation is rejected if the code already exists', src: `${base}Service.java existsByCode()` },
    ],
    intents,
    confidence: 'high',
  };
}
saveFunctional(root, store);

// module-level rollup theme (English)
build(root); // ensure store is reflected before computing module hashes
for (const m of model.modules) {
  setModuleFunctional(root, model, m, { theme: `Domain services for ${m}` });
}

build(root); // re-emit shards + index with functional + module themes merged

const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`populated: ${model.contexts.length} contexts, ${model.modules.length} module themes in ${ms.toFixed(0)}ms`);
