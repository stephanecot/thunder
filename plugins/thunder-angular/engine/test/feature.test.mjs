import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFile } from '../lib/parser.mjs';
import { derive } from '../lib/derive.mjs';
import { build } from '../lib/build.mjs';

test('#2 functional guard/interceptor → symbol with inject() DI edge', () => {
  const src = `
import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { HttpInterceptorFn } from '@angular/common/http';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isLoggedIn();
};

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  return next(req);
};
`;
  const fns = parseFile(src, 'auth.guard.ts').functionals;
  const g = fns.find((f) => f.name === 'authGuard');
  assert.ok(g && g.kind === 'guard', 'authGuard is a guard symbol');
  assert.ok(g.deps.includes('AuthService'), 'guard injects AuthService');
  assert.ok(fns.find((f) => f.name === 'authInterceptor' && f.kind === 'interceptor'), 'interceptor symbol');
});

test('#3 route with canActivate captures guards', () => {
  const src = `
export const routes: Routes = [
  { path: 'admin', component: AdminComponent, canActivate: [authGuard, scopeGuard('aura:admin')] },
];
`;
  const r = parseFile(src, 'app.routes.ts').routes.find((x) => x.path === 'admin');
  assert.deepStrictEqual(r.guards, ['authGuard', "scopeGuard('aura:admin')"]);
});

test('R2.1 factory-call guards keep their args (depth-aware split, multi-arg safe)', () => {
  const src = `
export const routes: Routes = [
  { path: 'a', component: A, canActivate: [authGuard, scopeGuard('aura:admin', 'rw')] },
];
`;
  const r = parseFile(src, 'app.routes.ts').routes.find((x) => x.path === 'a');
  // the comma inside scopeGuard(...) must NOT split into a phantom guard
  assert.deepStrictEqual(r.guards, ['authGuard', "scopeGuard('aura:admin', 'rw')"]);
});

test('R2.2 verb+URL: non-http-named HttpClient field, real verbs, normalized template URLs', () => {
  const src = `
@Injectable({ providedIn: 'root' })
export class DocService {
  private api = inject(HttpClient);
  list() { return this.api.get(\`\${environment.apiUrl}/documents\`); }
  upload(d) { return this.api.post(\`\${environment.apiUrl}/documents\`, d); }
  remove(id) { return this.api.delete(\`\${environment.apiUrl}/documents/\${id}\`); }
}
`;
  const t = parseFile(src, 'doc.service.ts').types[0];
  assert.deepStrictEqual((t.http || []).map((h) => h.verb), ['GET', 'POST', 'DELETE'], 'verbs mapped per call, not all GET');
  assert.deepStrictEqual((t.http || []).map((h) => h.url),
    ['{apiUrl}/documents', '{apiUrl}/documents', '{apiUrl}/documents/{id}'], 'template URLs normalized (no null)');
});

test('#4 service HTTP facet (http.<verb> + httpResource)', () => {
  const src = `
@Injectable({ providedIn: 'root' })
export class KnowledgeService {
  private http = inject(HttpClient);
  private apiUrl = '/api/v1';
  feed = httpResource<Doc[]>(() => \`\${this.apiUrl}/feed\`);
  create(d) { return this.http.post('/api/v1/documents', d); }
  remove(id) { return this.http.delete(\`/api/v1/documents/\${id}\`); }
}
`;
  const t = parseFile(src, 'knowledge.service.ts').types[0];
  const verbs = (t.http || []).map((h) => h.verb).sort();
  assert.deepStrictEqual(verbs, ['DELETE', 'GET', 'POST'], 'httpResource counts as GET');
  assert.ok(t.http.some((h) => /documents/.test(h.url || '')), 'url captured');
  assert.ok(t.http.some((h) => /feed/.test(h.url || '')), 'httpResource url captured');
});

test('#1 feature granularity: features/<x> become separate contexts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thunder-ng-grain-'));
  try {
    writeFileSync(join(dir, 'angular.json'), JSON.stringify({ projects: { app: { sourceRoot: 'src' } } }));
    for (const f of ['chat', 'documents']) {
      mkdirSync(join(dir, 'src/app/features', f), { recursive: true });
      writeFileSync(join(dir, 'src/app/features', f, `${f}.component.ts`),
        `@Component({ selector: 'app-${f}', standalone: true })\nexport class ${f[0].toUpperCase() + f.slice(1)}Component {}\n`);
    }
    const { model } = build(dir);
    const feats = model.contexts.map((c) => c.feature).sort();
    assert.ok(feats.includes('features.chat') && feats.includes('features.documents'), `got ${feats}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
