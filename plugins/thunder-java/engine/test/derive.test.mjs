import test from 'node:test';
import assert from 'node:assert';
import { derive } from '../lib/derive.mjs';

function facts() {
  return [
    {
      file: 'UserController.java', pkg: 'com.demo.user', module: 'user', hash: 'h1',
      types: [{
        kind: 'class', name: 'UserController', line: 1,
        ann: ['@RestController', '@RequestMapping("/users")'],
        methods: [
          { kind: 'method', name: 'UserController', sig: '(UserService)', isCtor: true, ann: [] },
          { kind: 'method', name: 'create', sig: '(UserDto):User', ann: ['@PostMapping'] },
          { kind: 'method', name: 'get', sig: '(String):User', ann: ['@GetMapping("/{id}")'] },
        ],
        fields: [],
      }],
    },
    {
      file: 'UserService.java', pkg: 'com.demo.user', module: 'user', hash: 'h2',
      types: [{
        kind: 'class', name: 'UserService', line: 1, ann: ['@Service'],
        methods: [{ kind: 'method', name: 'UserService', sig: '(UserRepository)', isCtor: true, ann: [] }],
        fields: [],
      }],
    },
    {
      file: 'UserRepository.java', pkg: 'com.demo.user', module: 'user', hash: 'h3',
      types: [{ kind: 'interface', name: 'UserRepository', line: 1, ann: [], ext: 'JpaRepository<User, Long>', methods: [], fields: [] }],
    },
    {
      file: 'User.java', pkg: 'com.demo.user', module: 'user', hash: 'h4',
      types: [{
        kind: 'class', name: 'User', line: 1, ann: ['@Entity', '@Table(name = "users")'],
        methods: [],
        fields: [{ name: 'orders', type: 'List<Order>', ann: ['@OneToMany'] }],
      }],
    },
  ];
}

test('endpoint paths join class + method mappings', () => {
  const m = derive(facts());
  const paths = m.endpoints.map((e) => `${e.verb} ${e.path}`).sort();
  assert.deepStrictEqual(paths, ['GET /users/{id}', 'POST /users']);
});

test('bean dependency graph from constructor injection', () => {
  const ctx = derive(facts()).contexts[0];
  assert.deepStrictEqual(ctx.beans.UserController.deps, ['UserService']);
  assert.deepStrictEqual(ctx.beans.UserService.deps, ['UserRepository']);
});

test('entity table, relation and repository link', () => {
  const ctx = derive(facts()).contexts[0];
  assert.strictEqual(ctx.entities.User.table, 'users');
  assert.deepStrictEqual(ctx.entities.User.rel, [{ OneToMany: 'Order' }]);
  assert.strictEqual(ctx.entities.User.repo, 'UserRepository');
});

test('flow derived from wiring graph', () => {
  const ctx = derive(facts()).contexts[0];
  const create = ctx.endpoints.find((e) => e.fn === 'UserController.create');
  assert.match(create.flow, /UserController\.create → UserService → UserRepository/);
});

test('one context, one module for single package', () => {
  const m = derive(facts());
  assert.strictEqual(m.contexts.length, 1);
  assert.deepStrictEqual(m.modules, ['user']);
  assert.ok(m.contexts[0].src_hash, 'src_hash computed');
});
