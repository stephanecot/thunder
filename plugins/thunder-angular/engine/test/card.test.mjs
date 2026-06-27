import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { derive } from '../lib/derive.mjs';
import { emit } from '../lib/emit.mjs';

function facts() {
  return [
    {
      file: 'src/app/users/user-list.component.ts', project: 'shop', feature: 'users', hash: 'h1', routes: [],
      types: [{
        kind: 'class', name: 'UserListComponent', line: 9,
        decorators: ["@Component({ selector: 'app-user-list', standalone: true })"],
        ctorDeps: ['UserService'],
        props: [{ name: 'title', decorators: ['@Input()'] }], methods: [],
      }],
    },
    {
      file: 'src/app/users/user.service.ts', project: 'shop', feature: 'users', hash: 'h2', routes: [],
      types: [{ kind: 'class', name: 'UserService', line: 5, decorators: ["@Injectable({ providedIn: 'root' })"], ctorDeps: ['HttpClient'], props: [], methods: [] }],
    },
  ];
}

function emitToTmp() {
  const dir = mkdtempSync(join(tmpdir(), 'thunder-ng-card-'));
  emit(dir, derive(facts()), {});
  return { dir, base: join(dir, '.thunder', 'angular') };
}

test('emit produces a small tier-1 card for the feature', () => {
  const { dir, base } = emitToTmp();
  try {
    const card = readFileSync(join(base, 'projects/shop/users.card.yaml'), 'utf8');
    assert.ok(card.split('\n').filter(Boolean).length <= 20, 'card ≤ 20 lines');
    assert.ok(card.includes('UserListComponent'), 'component name');
    assert.ok(card.includes('UserService'), 'service name');
    assert.ok(card.includes('detail: projects/shop/users.yaml'), 'pointer to detail');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detail shard still exists (retro-compat); _index points to card', () => {
  const { dir, base } = emitToTmp();
  try {
    const detail = readFileSync(join(base, 'projects/shop/users.yaml'), 'utf8');
    assert.ok(detail.includes('components:') && detail.includes('services:'), 'detail retained');
    const idx = readFileSync(join(base, 'projects/shop/_index.yaml'), 'utf8');
    assert.ok(/card: projects\/shop\/users\.card\.yaml/.test(idx), '_index card pointer');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
