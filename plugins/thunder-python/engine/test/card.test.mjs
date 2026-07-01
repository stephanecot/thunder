import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFile } from '../lib/parser.mjs';
import { derive } from '../lib/derive.mjs';
import { emit } from '../lib/emit.mjs';

function facts() {
  const mk = (src, file, pkg) => { const f = parseFile(src, file); f.project = 'shop'; f.package = pkg; f.hash = file; return f; };
  return [
    mk('from pydantic import BaseModel\nclass User(BaseModel):\n    id: int\n', 'shop/users/models.py', 'shop.users'),
    mk('router = APIRouter()\n@router.post("/users")\ndef create(data, db = Depends(get_db)):\n    return data\n', 'shop/users/routes.py', 'shop.users'),
  ];
}

function emitToTmp() {
  const dir = mkdtempSync(join(tmpdir(), 'thunder-py-card-'));
  emit(dir, derive(facts()), {});
  return { dir, base: join(dir, '.thunder', 'python') };
}

test('emit produces a small tier-1 card', () => {
  const { dir, base } = emitToTmp();
  try {
    const card = readFileSync(join(base, 'projects/shop/shop.users.card.yaml'), 'utf8');
    assert.ok(card.split('\n').filter(Boolean).length <= 20, 'card ≤ 20 lines');
    assert.ok(card.includes('User'), 'model name');
    assert.ok(card.includes('POST /users'), 'route signature');
    assert.ok(card.includes('detail: projects/shop/shop.users.yaml'), 'pointer to detail');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detail shard exists (retro-compat); _index points to card; routes.yaml present', () => {
  const { dir, base } = emitToTmp();
  try {
    const detail = readFileSync(join(base, 'projects/shop/shop.users.yaml'), 'utf8');
    assert.ok(detail.includes('models:') && detail.includes('routes:'), 'detail retained');
    const idx = readFileSync(join(base, 'projects/shop/_index.yaml'), 'utf8');
    assert.ok(/card: projects\/shop\/shop\.users\.card\.yaml/.test(idx), '_index card pointer');
    assert.ok(readFileSync(join(base, 'project-brief.yaml'), 'utf8').includes('frameworks:'), 'brief frameworks');
    const rts = readFileSync(join(base, 'routes.yaml'), 'utf8');
    assert.ok(rts.includes('format:'), 'routes.yaml documents its line format');
    assert.ok(/POST \/users\s+create\s+\(shop\/shop\.users\)/.test(rts), 'one grep-friendly line per route');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
