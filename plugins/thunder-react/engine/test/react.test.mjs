import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFile } from '../lib/parser.mjs';
import { derive } from '../lib/derive.mjs';
import { build } from '../lib/build.mjs';

const sym = (f, name) => (f.functionals || []).find((s) => s.name === name);

test('function component (declaration) → component symbol with hooks + custom-hook deps', () => {
  const src = `
import { useUsers } from './useUsers';
export function UserList() {
  const { users } = useUsers();
  const [open, setOpen] = useState(false);
  return <ul>{users.map((u) => <li key={u.id}>{u.name}</li>)}</ul>;
}`;
  const c = sym(parseFile(src, 'UserList.tsx'), 'UserList');
  assert.ok(c && c.kind === 'component');
  assert.ok(c.hooks.includes('useUsers') && c.hooks.includes('useState'));
  assert.deepStrictEqual(c.deps, ['useUsers'], 'deps = custom hooks only (builtins excluded)');
});

test('arrow component (export const = () => JSX) is detected; non-JSX const is not', () => {
  const f = parseFile(`export const Card = ({ title }: Props) => {\n  return <div>{title}</div>;\n};\nexport const helper = (x) => x * 2;`, 'Card.tsx');
  assert.ok(sym(f, 'Card') && sym(f, 'Card').kind === 'component', 'Card is a component');
  assert.deepStrictEqual(sym(f, 'Card').props, ['title'], 'destructured props captured');
  assert.ok(!sym(f, 'helper'), 'a non-JSX arrow const is NOT a component');
});

test('custom hook (useX) → hook symbol; generic-typed useState<T>() captured', () => {
  const src = `export function useCart() {\n  const [items, setItems] = useState<string[]>([]);\n  const add = useCallback((s) => setItems((p) => [...p, s]), []);\n  return { items, add };\n}`;
  const h = sym(parseFile(src, 'useCart.ts'), 'useCart');
  assert.ok(h && h.kind === 'hook');
  assert.ok(h.hooks.includes('useState') && h.hooks.includes('useCallback'), 'generic useState<T>() captured');
});

test('class component (extends React.Component) → component symbol', () => {
  const f = parseFile(`export class Legacy extends React.Component<P, S> {\n  render() { return <div/>; }\n}`, 'Legacy.tsx');
  const c = sym(f, 'Legacy');
  assert.ok(c && c.kind === 'component' && c.class === true);
});

test('React Router routes: JSX <Route> and data-router object', () => {
  const jsx = parseFile(`<Routes>\n  <Route path="/users" element={<UserList />} />\n  <Route path="/users/:id" element={<UserDetail />} />\n</Routes>`, 'App.tsx');
  assert.deepStrictEqual(jsx.routes.map((r) => `${r.path}→${r.target}`), ['/users→UserList', '/users/:id→UserDetail']);
  const data = parseFile(`createBrowserRouter([\n  { path: '/cart', element: <Cart /> },\n]);`, 'router.tsx');
  assert.deepStrictEqual(data.routes.map((r) => `${r.path}→${r.target}`), ['/cart→Cart']);
});

test('build: per-feature contexts, component→hook flow, src_hash, hook as service', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thunder-react-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app' }));
    mkdirSync(join(dir, 'src/features/users'), { recursive: true });
    writeFileSync(join(dir, 'src/App.tsx'),
      `import { Routes, Route } from 'react-router-dom';\nimport { UserList } from './features/users/UserList';\nexport default function App() {\n  return <Routes><Route path="/users" element={<UserList />} /></Routes>;\n}`);
    writeFileSync(join(dir, 'src/features/users/useUsers.ts'),
      `import { useState, useEffect } from 'react';\nexport function useUsers() {\n  const [users, setUsers] = useState([]);\n  useEffect(() => {}, []);\n  return users;\n}`);
    writeFileSync(join(dir, 'src/features/users/UserList.tsx'),
      `import { useUsers } from './useUsers';\nexport function UserList() {\n  const users = useUsers();\n  return <ul/>;\n}`);
    const { model } = build(dir);
    const users = model.contexts.find((c) => c.feature === 'features.users');
    assert.ok(users && users.framework === 'react');
    assert.ok(users.services.useUsers, 'useUsers is a service');
    assert.ok(users.components.find((c) => c.n === 'UserList'), 'UserList component');
    assert.ok(users.src_hash && users.src_hash.length === 8, 'src_hash');
    const r = model.routes.find((x) => x.path === '/users');
    assert.match(r.flow, /UserList → useUsers/, `flow: ${r.flow}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('build: container dir (features/<x>) descends into per-feature contexts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thunder-react-c-'));
  try {
    for (const f of ['users', 'cart']) {
      mkdirSync(join(dir, 'src/features', f), { recursive: true });
      writeFileSync(join(dir, 'src/features', f, `${f[0].toUpperCase() + f.slice(1)}.tsx`),
        `export function ${f[0].toUpperCase() + f.slice(1)}() { return <div/>; }`);
    }
    const feats = build(dir).model.contexts.map((c) => c.feature).sort();
    assert.ok(feats.includes('features.users') && feats.includes('features.cart'), `got ${feats}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
