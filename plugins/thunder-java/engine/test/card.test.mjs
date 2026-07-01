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
      file: 'src/main/java/com/demo/user/UserController.java', pkg: 'com.demo.user', module: 'user', hash: 'h1',
      types: [{
        kind: 'class', name: 'UserController', line: 1,
        ann: ['@RestController', '@RequestMapping("/users")'],
        methods: [
          { kind: 'method', name: 'UserController', sig: '(UserService)', isCtor: true, ann: [] },
          { kind: 'method', name: 'create', sig: '(UserDto):User', reqBody: 'UserDto', ann: ['@PostMapping'] },
        ],
        fields: [],
      }],
    },
    {
      file: 'src/main/java/com/demo/user/UserService.java', pkg: 'com.demo.user', module: 'user', hash: 'h2',
      types: [{ kind: 'class', name: 'UserService', line: 1, ann: ['@Service'], methods: [{ kind: 'method', name: 'UserService', sig: '(UserRepository)', isCtor: true, ann: [] }], fields: [] }],
    },
    {
      file: 'src/main/java/com/demo/user/UserRepository.java', pkg: 'com.demo.user', module: 'user', hash: 'h3',
      types: [{ kind: 'interface', name: 'UserRepository', line: 1, ann: [], ext: 'JpaRepository<User, Long>', methods: [], fields: [] }],
    },
    {
      file: 'src/main/java/com/demo/user/User.java', pkg: 'com.demo.user', module: 'user', hash: 'h4',
      types: [{ kind: 'class', name: 'User', line: 1, ann: ['@Entity'], methods: [], fields: [] }],
    },
  ];
}

function emitToTmp() {
  const dir = mkdtempSync(join(tmpdir(), 'thunder-card-'));
  emit(dir, derive(facts()), {});
  return { dir, base: join(dir, '.thunder', 'java') };
}

test('emit produces a small tier-1 card', () => {
  const { dir, base } = emitToTmp();
  try {
    const card = readFileSync(join(base, 'modules/user/com.demo.user.card.yaml'), 'utf8');
    assert.ok(card.split('\n').filter(Boolean).length <= 20, 'card ≤ 20 lines');
    for (const n of ['User', 'UserController', 'UserRepository', 'UserService']) assert.ok(card.includes(n), `type ${n}`);
    assert.ok(card.includes('POST /users'), 'endpoint signature');
    assert.ok(card.includes('detail: modules/user/com.demo.user.yaml'), 'pointer to detail');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('detail shard still exists (retro-compat) and drops redundant per-type file path', () => {
  const { dir, base } = emitToTmp();
  try {
    const detail = readFileSync(join(base, 'modules/user/com.demo.user.yaml'), 'utf8');
    assert.ok(detail.includes('beans:') && detail.includes('entities:'), 'detail retained');
    assert.ok(!/file: src\/main/.test(detail), 'redundant per-type file path removed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('_index points to cards; endpoints.yaml carries req/resp', () => {
  const { dir, base } = emitToTmp();
  try {
    const idx = readFileSync(join(base, 'modules/user/_index.yaml'), 'utf8');
    assert.ok(/card: modules\/user\/com\.demo\.user\.card\.yaml/.test(idx), '_index card pointer');
    const eps = readFileSync(join(base, 'endpoints.yaml'), 'utf8');
    assert.ok(eps.includes('UserDto -> User'), 'endpoints enriched with req/resp on one line');
    assert.ok(/POST \/users\s+UserController\.create/.test(eps), 'one grep-friendly line per endpoint');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
