#!/usr/bin/env node
// Generate a large synthetic decision corpus to bench scaling (cf. plan §9).
//   node engine/tools/gen-minddemo.mjs <dir> <count>
// Writes <dir>/.thunder/mind/decisions/<domain>/<date>-<slug>.yaml. Deterministic (seeded by index).
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { emitDecision, makeId } from '../lib/decision.mjs';

const dir = process.argv[2] || 'minddemo-big';
const count = Number(process.argv[3] || 2000);

const DOMAINS = ['auth', 'api', 'data', 'billing', 'search', 'frontend', 'infra', 'observability', 'messaging', 'payments'];
const TYPES = ['architecture', 'technical', 'functional', 'convention'];
const TOPICS = ['caching strategy', 'retry policy', 'pagination', 'rate limiting', 'schema migration',
  'token refresh', 'idempotency keys', 'feature flags', 'audit logging', 'error taxonomy', 'circuit breaker',
  'bulk import', 'soft delete', 'timezone handling', 'currency rounding', 'webhook delivery', 'data retention'];
const TECH = ['Postgres', 'Redis', 'Kafka', 'gRPC', 'OpenAPI', 'JWT', 'S3', 'cron', 'OAuth2', 'GraphQL'];

const base = join(dir, '.thunder', 'mind', 'decisions');
if (existsSync(base)) rmSync(base, { recursive: true, force: true });

for (let i = 0; i < count; i++) {
  const domain = DOMAINS[i % DOMAINS.length];
  const type = TYPES[i % TYPES.length];
  const topic = TOPICS[i % TOPICS.length];
  const tech = TECH[i % TECH.length];
  const yyyy = 2024 + (i % 3);
  const mm = String((i % 12) + 1).padStart(2, '0');
  const dd = String((i % 28) + 1).padStart(2, '0');
  const date = `${yyyy}-${mm}-${dd}`;
  const title = `${topic} for ${domain} using ${tech} #${i}`;
  const id = makeId(domain, date, title);
  const d = {
    id, title, type, status: i % 11 === 0 ? 'superseded' : 'active', domain, date,
    authors: ['gen'],
    context: `Synthetic decision ${i} about ${topic} in the ${domain} domain.`,
    decision: `Standardize ${topic} on ${tech} across ${domain}.`,
    rationale: `Consistency and operational simplicity for ${topic}.`,
    consequences: [`Teams adopt ${tech} for ${topic} in ${domain}.`],
    alternatives: [{ choice: `ad-hoc ${topic}`, rejected_because: 'inconsistent across services' }],
    tags: [domain, topic.split(' ')[0], tech.toLowerCase()],
    conflicts_with: [], evidence: [],
  };
  const p = join(base, ...id.split('/')) + '.yaml';
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, emitDecision(d));
}
console.log(`generated ${count} decisions under ${base}`);
