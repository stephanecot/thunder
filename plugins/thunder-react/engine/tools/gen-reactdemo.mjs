#!/usr/bin/env node
// Generate a realistic React app (feature folders with function components + custom hooks + React
// Router routes, validation) to benchmark inline answering.
// Usage: node engine/tools/gen-reactdemo.mjs [outDir] [features]
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const out = process.argv[2] || join(dirname(new URL(import.meta.url).pathname), '..', '..', 'reactdemo');
const FEATURES = Number(process.argv[3] || 40);
if (existsSync(out)) rmSync(out, { recursive: true });
const W = (p, c) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
const cap = (s) => s[0].toUpperCase() + s.slice(1);

W(join(out, 'package.json'), JSON.stringify({ name: 'react-shop', version: '1.0.0', dependencies: { react: '^18', 'react-dom': '^18', 'react-router-dom': '^6' } }, null, 2) + '\n');

const feats = Array.from({ length: FEATURES }, (_, i) => `f${i}`);

// App.tsx wires every feature route
W(join(out, 'src/App.tsx'),
  `import { BrowserRouter, Routes, Route } from 'react-router-dom';\n` +
  feats.map((f) => `import { ${cap(f)}List } from './features/${f}/${cap(f)}List';\nimport { ${cap(f)}Detail } from './features/${f}/${cap(f)}Detail';`).join('\n') +
  `\n\nexport default function App() {\n  return (\n    <BrowserRouter>\n      <Routes>\n` +
  feats.map((f) => `        <Route path="/${f}" element={<${cap(f)}List />} />\n        <Route path="/${f}/:id" element={<${cap(f)}Detail />} />`).join('\n') +
  `\n      </Routes>\n    </BrowserRouter>\n  );\n}\n`);

for (const f of feats) {
  const F = cap(f);
  const dir = join(out, 'src/features', f);

  W(join(dir, `${f}.model.ts`), `export interface ${F} {\n  id: string;\n  code: string;\n  label: string;\n  amount: number;\n  status: string;\n}\n`);

  W(join(dir, `use${F}.ts`),
    `import { useState, useEffect, useCallback } from 'react';\nimport { ${F} } from './${f}.model';\n\n` +
    `export function use${F}() {\n  const [items, setItems] = useState<${F}[]>([]);\n  const [loading, setLoading] = useState(false);\n\n` +
    `  useEffect(() => {\n    setLoading(true);\n    fetch('/api/${f}')\n      .then((r) => r.json())\n      .then((data) => {\n        setItems(data);\n        setLoading(false);\n      });\n  }, []);\n\n` +
    `  const create = useCallback((item: ${F}) => {\n    if (!item.code) {\n      throw new Error('code is required');\n    }\n    if (item.amount < 0) {\n      throw new Error('amount must be positive');\n    }\n    setItems((prev) => [...prev, item]);\n  }, []);\n\n` +
    `  const remove = useCallback((id: string) => {\n    setItems((prev) => prev.filter((x) => x.id !== id));\n  }, []);\n\n  return { items, loading, create, remove };\n}\n`);

  W(join(dir, `${F}List.tsx`),
    `import { use${F} } from './use${F}';\n\n` +
    `export function ${F}List() {\n  const { items, loading } = use${F}();\n  if (loading) {\n    return <p>Loading…</p>;\n  }\n  return (\n    <ul>\n      {items.map((it) => (\n        <li key={it.id}>{it.label}</li>\n      ))}\n    </ul>\n  );\n}\n`);

  W(join(dir, `${F}Detail.tsx`),
    `import { useParams } from 'react-router-dom';\nimport { use${F} } from './use${F}';\n\n` +
    `export function ${F}Detail() {\n  const { id } = useParams();\n  const { items } = use${F}();\n  const item = items.find((x) => x.id === id);\n  return <section>{item?.label ?? 'Unknown'}</section>;\n}\n`);
}
console.log(`reactdemo: 1 project, ${FEATURES} feature folders, ${FEATURES * 4 + 1} files → ${out}`);
