#!/usr/bin/env node
// Generate a realistic single-project Angular app (feature folders with standalone components,
// services with HttpClient + validation, routes) to benchmark inline answering.
// Usage: node engine/tools/gen-ngdemo.mjs [outDir] [features]
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const out = process.argv[2] || join(dirname(new URL(import.meta.url).pathname), '..', '..', 'ngdemo');
const FEATURES = Number(process.argv[3] || 40);
if (existsSync(out)) rmSync(out, { recursive: true });
const W = (p, c) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
const cap = (s) => s[0].toUpperCase() + s.slice(1);

W(join(out, 'angular.json'), JSON.stringify({ version: 1, projects: { shop: { projectType: 'application', root: '', sourceRoot: 'src' } } }, null, 2) + '\n');

const featNames = Array.from({ length: FEATURES }, (_, i) => `f${i}`);
W(join(out, 'src/app/app.routes.ts'),
  `import { Routes } from '@angular/router';\n\nexport const routes: Routes = [\n` +
  `  { path: '', redirectTo: '${featNames[0]}', pathMatch: 'full' },\n` +
  featNames.map((f) => `  { path: '${f}', loadChildren: () => import('./${f}/${f}.routes').then((m) => m.${cap(f)}Routes) },`).join('\n') +
  `\n];\n`);

for (const f of featNames) {
  const F = cap(f);
  const dir = join(out, 'src/app', f);
  W(join(dir, `${f}.model.ts`), `export interface ${F} {\n  id: number;\n  code: string;\n  label: string;\n  amount: number;\n  status: string;\n}\n`);

  W(join(dir, `${f}.service.ts`),
    `import { Injectable } from '@angular/core';\nimport { HttpClient } from '@angular/common/http';\nimport { Observable } from 'rxjs';\nimport { ${F} } from './${f}.model';\n\n` +
    `@Injectable({ providedIn: 'root' })\nexport class ${F}Service {\n  private readonly base = '/api/${f}';\n\n  constructor(private http: HttpClient) {}\n\n` +
    `  list(): Observable<${F}[]> {\n    return this.http.get<${F}[]>(this.base);\n  }\n\n` +
    `  create(\n    item: ${F},\n    notify: boolean\n  ): Observable<${F}> {\n    if (!item.code) {\n      throw new Error('code is required');\n    }\n    return this.http.post<${F}>(this.base, item);\n  }\n\n` +
    `  remove(id: number): Observable<void> {\n    return this.http.delete<void>(\`\${this.base}/\${id}\`);\n  }\n}\n`);

  W(join(dir, `${f}-list.component.ts`),
    `import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';\nimport { CommonModule } from '@angular/common';\nimport { ${F}Service } from './${f}.service';\nimport { ${F} } from './${f}.model';\n\n` +
    `@Component({\n  selector: 'app-${f}-list',\n  standalone: true,\n  imports: [CommonModule],\n  template: \`<ul><li *ngFor="let it of items">{{ it.label }}</li></ul>\`,\n})\n` +
    `export class ${F}ListComponent implements OnInit {\n  @Input() title = '${F}';\n  @Output() selected = new EventEmitter<${F}>();\n\n  items: ${F}[] = [];\n\n` +
    `  constructor(private service: ${F}Service) {}\n\n` +
    `  ngOnInit(): void {\n    this.service.list().subscribe((rows) => (this.items = rows));\n  }\n\n` +
    `  select(\n    item: ${F}\n  ): void {\n    this.selected.emit(item);\n  }\n}\n`);

  W(join(dir, `${f}.routes.ts`),
    `import { Routes } from '@angular/router';\nimport { ${F}ListComponent } from './${f}-list.component';\n\n` +
    `export const ${F}Routes: Routes = [\n  { path: '', component: ${F}ListComponent },\n];\n`);
}
console.log(`ngdemo: 1 project, ${FEATURES} features, ${FEATURES * 4 + 1} files → ${out}`);
