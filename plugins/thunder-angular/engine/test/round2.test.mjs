import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFile } from '../lib/parser.mjs';
import { derive } from '../lib/derive.mjs';
import { emit } from '../lib/emit.mjs';

const SERVICE = `
import { Injectable } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class OrderService {
  constructor(private http: HttpClient) {}

  create(
    order: Order,
    notify: boolean
  ): Observable<Order> {
    return this.http.post('/api/orders', order);
  }
}
`;

test('multi-line method signature is detected (Angular parser)', () => {
  const t = parseFile(SERVICE, 'order.service.ts').types[0];
  assert.deepStrictEqual(t.ctorDeps, ['HttpClient']);
  assert.ok(t.methods.find((m) => m.name === 'create'), 'multi-line create() detected');
});

test('project-brief.yaml is emitted with arch, projects and routes', () => {
  const facts = [
    {
      file: 'src/app/users/user-list.component.ts', project: 'shop', feature: 'users', hash: 'h1', routes: [],
      types: [{ kind: 'class', name: 'UserListComponent', line: 1, decorators: ["@Component({ selector: 'app-user-list', standalone: true })"], ctorDeps: ['UserService'], props: [], methods: [] }],
    },
    {
      file: 'src/app/app.routes.ts', project: 'shop', feature: 'app', hash: 'h2', types: [],
      routes: [{ path: 'users', target: 'UserListComponent', kind: 'component', line: 1 }],
    },
  ];
  const dir = mkdtempSync(join(tmpdir(), 'thunder-ngbrief-'));
  try {
    emit(dir, derive(facts), {});
    const brief = readFileSync(join(dir, '.thunder', 'angular', 'project-brief.yaml'), 'utf8');
    assert.ok(/arch:/.test(brief), 'arch style');
    assert.ok(/projects:/.test(brief), 'projects');
    assert.ok(brief.includes('users → UserListComponent'), 'route listed in brief');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
