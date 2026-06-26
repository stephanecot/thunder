import test from 'node:test';
import assert from 'node:assert';
import { derive } from '../lib/derive.mjs';

function facts() {
  return [
    {
      file: 'src/app/users/user-list.component.ts', project: 'shop', feature: 'users', hash: 'h1',
      routes: [],
      types: [{
        kind: 'class', name: 'UserListComponent', line: 9,
        decorators: ["@Component({ selector: 'app-user-list', standalone: true })"],
        ctorDeps: ['UserService'],
        props: [{ name: 'title', decorators: ['@Input()'] }, { name: 'selected', decorators: ['@Output()'] }],
        methods: [],
      }],
    },
    {
      file: 'src/app/users/user.service.ts', project: 'shop', feature: 'users', hash: 'h2',
      routes: [],
      types: [{
        kind: 'class', name: 'UserService', line: 5,
        decorators: ["@Injectable({ providedIn: 'root' })"],
        ctorDeps: ['HttpClient'], props: [], methods: [],
      }],
    },
    {
      file: 'src/app/app.routes.ts', project: 'shop', feature: 'app', hash: 'h3', types: [],
      routes: [{ path: 'users', target: 'UserListComponent', kind: 'component', line: 4 }],
    },
  ];
}

test('components carry selector, standalone, inputs/outputs and deps', () => {
  const m = derive(facts());
  const users = m.contexts.find((c) => c.id === 'shop/users');
  const cmp = users.components[0];
  assert.strictEqual(cmp.selector, 'app-user-list');
  assert.strictEqual(cmp.standalone, true);
  assert.deepStrictEqual(cmp.inputs, ['title']);
  assert.deepStrictEqual(cmp.outputs, ['selected']);
  assert.deepStrictEqual(cmp.deps, ['UserService']);
});

test('services carry providedIn and deps', () => {
  const users = derive(facts()).contexts.find((c) => c.id === 'shop/users');
  assert.strictEqual(users.services.UserService.providedIn, 'root');
  assert.deepStrictEqual(users.services.UserService.deps, ['HttpClient']);
});

test('route flow is derived: route → component → injected service', () => {
  const r = derive(facts()).routes.find((x) => x.path === 'users');
  assert.match(r.flow, /UserListComponent → UserService/);
});

test('one project, feature contexts, src_hash present', () => {
  const m = derive(facts());
  assert.deepStrictEqual(m.projects, ['shop']);
  assert.ok(m.contexts.every((c) => c.src_hash));
  assert.ok(m.contexts.find((c) => c.id === 'shop/app'), 'root app context for routes');
});
