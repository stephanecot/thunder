#!/usr/bin/env node
// Reproducible token eval: for a fixed set of questions, measure bytes/tokens READ to answer
// in 3 modes — card-only (tier-1), full-shard (tier-2), raw-java — and prove the card target.
// Usage: node engine/tools/token-bench.mjs [root]   (default: demo)
import { statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = process.argv[2] || join(here, '..', '..', 'demo');
const C = join(root, '.claude', 'cache', 'thunder-java');

const sz = (f) => { try { return statSync(f).size; } catch { return 0; } };
const bytes = (files) => files.reduce((a, f) => a + sz(f), 0);
const tok = (b) => Math.round(b / 4);

function javaUnder(dir) {
  const out = [];
  const rec = (d) => {
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'target') rec(p); }
      else if (e.name.endsWith('.java')) out.push(p);
    }
  };
  rec(dir);
  return out;
}

const card = (m, c) => join(C, 'modules', m, c + '.card.yaml');
const shard = (m, c) => join(C, 'modules', m, c + '.yaml');
const userJava = javaUnder(join(root, 'user', 'src', 'main', 'java', 'com', 'demo', 'user'));
const orderJava = javaUnder(join(root, 'order', 'src', 'main', 'java', 'com', 'demo', 'order'));
const f = (n) => userJava.find((p) => p.endsWith(n));

const UC = ['user', 'com.demo.user'];
const OC = ['order', 'com.demo.order'];

const questions = [
  { kind: 'structure', q: 'Quels types compose le contexte user ?', cardAnswerable: true,
    cardF: [card(...UC)], fullF: [shard(...UC)], rawF: userJava },
  { kind: 'endpoint', q: 'Quels endpoints expose le contexte user ?', cardAnswerable: true,
    cardF: [join(C, 'endpoints.yaml')], fullF: [shard(...UC)], rawF: [f('UserController.java')] },
  { kind: 'where', q: 'Où est UserService et qui en dépend ?', cardAnswerable: true,
    cardF: [card(...UC)], fullF: [shard(...UC)], rawF: [f('UserService.java'), f('UserController.java')] },
  { kind: 'flux', q: 'Quel est le flux de création d’un user ?', cardAnswerable: true,
    cardF: [card(...UC)], fullF: [shard(...UC)], rawF: [f('UserController.java'), f('UserService.java'), f('UserRepository.java')] },
  { kind: 'securite', q: 'Quels endpoints renvoient une entité (fuite) ?', cardAnswerable: true,
    cardF: [join(C, 'endpoints.yaml')], fullF: [shard(...UC), shard(...OC)], rawF: [...userJava, ...orderJava].filter((p) => p.endsWith('Controller.java')) },
  { kind: 'regle-metier', q: 'Quelle règle métier à l’inscription ?', cardAnswerable: false,
    cardF: [card(...UC), shard(...UC)], fullF: [shard(...UC)], rawF: [f('UserService.java'), f('UserDto.java'), f('User.java')] },
];

let cardSumA = 0, fullSumA = 0;
console.log('| Question | type | card-only | full-shard | raw-java | card/full |');
console.log('|---|---|---|---|---|---|');
for (const it of questions) {
  const c = tok(bytes(it.cardF)), fu = tok(bytes(it.fullF)), r = tok(bytes(it.rawF));
  const ratio = fu ? Math.round((c / fu) * 100) : 0;
  if (it.cardAnswerable) { cardSumA += c; fullSumA += fu; }
  const note = it.cardAnswerable ? `${ratio}%` : `${ratio}% (escalade détail)`;
  console.log(`| ${it.q} | ${it.kind} | ${c} | ${fu} | ${r} | ${note} |`);
}
const overall = fullSumA ? Math.round((cardSumA / fullSumA) * 100) : 0;
console.log(`\nMode carte sur questions structure/where/what/endpoint/flux/sécu : ${cardSumA} tok vs full ${fullSumA} tok → **${overall}%** du full-shard (cible ≤ 40%).`);
process.exit(overall <= 40 ? 0 : 1);
