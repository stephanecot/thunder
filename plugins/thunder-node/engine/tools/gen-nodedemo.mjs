#!/usr/bin/env node
// Generate a realistic NestJS-style Node.js backend (modules/<feature> with controller + service +
// module + model, real CRUD endpoints & validation) to benchmark inline answering.
// Usage: node engine/tools/gen-nodedemo.mjs [outDir] [features]
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const out = process.argv[2] || join(dirname(new URL(import.meta.url).pathname), '..', '..', 'nodedemo');
const FEATURES = Number(process.argv[3] || 40);
if (existsSync(out)) rmSync(out, { recursive: true });
const W = (p, c) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
const cap = (s) => s[0].toUpperCase() + s.slice(1);

W(join(out, 'package.json'), JSON.stringify({ name: 'node-shop', version: '1.0.0', dependencies: { '@nestjs/common': '^10', '@nestjs/core': '^10' } }, null, 2) + '\n');

const feats = Array.from({ length: FEATURES }, (_, i) => `f${i}`);

// AppModule wires every feature module
W(join(out, 'src/app.module.ts'),
  `import { Module } from '@nestjs/common';\n` +
  feats.map((f) => `import { ${cap(f)}Module } from './modules/${f}/${f}.module';`).join('\n') +
  `\n\n@Module({\n  imports: [\n${feats.map((f) => `    ${cap(f)}Module,`).join('\n')}\n  ],\n})\nexport class AppModule {}\n`);

for (const f of feats) {
  const F = cap(f);
  const dir = join(out, 'src/modules', f);

  W(join(dir, `${f}.model.ts`),
    `export interface ${F} {\n  id: string;\n  code: string;\n  label: string;\n  amount: number;\n  status: string;\n}\n`);

  W(join(dir, `${f}.service.ts`),
    `import { Injectable, NotFoundException } from '@nestjs/common';\nimport { ${F} } from './${f}.model';\n\n` +
    `@Injectable()\nexport class ${F}Service {\n  private items: ${F}[] = [];\n\n` +
    `  findAll(): ${F}[] {\n    return this.items;\n  }\n\n` +
    `  findOne(id: string): ${F} {\n    const it = this.items.find((x) => x.id === id);\n    if (!it) {\n      throw new NotFoundException('${f} not found');\n    }\n    return it;\n  }\n\n` +
    `  create(dto: ${F}): ${F} {\n    this.validate(dto);\n    this.items.push(dto);\n    return dto;\n  }\n\n` +
    `  update(id: string, dto: ${F}): ${F} {\n    this.validate(dto);\n    if (dto.status === 'CLOSED') {\n      throw new Error('cannot update a closed ${f}');\n    }\n    const i = this.items.findIndex((x) => x.id === id);\n    this.items[i] = dto;\n    return dto;\n  }\n\n` +
    `  remove(id: string): void {\n    this.items = this.items.filter((x) => x.id !== id);\n  }\n\n` +
    `  private validate(dto: ${F}): void {\n    if (!dto.code) {\n      throw new Error('code is required');\n    }\n    if (dto.amount < 0) {\n      throw new Error('amount must be positive');\n    }\n  }\n}\n`);

  W(join(dir, `${f}.controller.ts`),
    `import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';\nimport { ${F}Service } from './${f}.service';\nimport { ${F} } from './${f}.model';\n\n` +
    `@Controller('${f}')\nexport class ${F}Controller {\n  constructor(private readonly service: ${F}Service) {}\n\n` +
    `  @Get()\n  findAll(): ${F}[] {\n    return this.service.findAll();\n  }\n\n` +
    `  @Get(':id')\n  findOne(@Param('id') id: string): ${F} {\n    return this.service.findOne(id);\n  }\n\n` +
    `  @Post()\n  create(@Body() dto: ${F}): ${F} {\n    return this.service.create(dto);\n  }\n\n` +
    `  @Put(':id')\n  update(@Param('id') id: string, @Body() dto: ${F}): ${F} {\n    return this.service.update(id, dto);\n  }\n\n` +
    `  @Delete(':id')\n  remove(@Param('id') id: string): void {\n    return this.service.remove(id);\n  }\n}\n`);

  W(join(dir, `${f}.module.ts`),
    `import { Module } from '@nestjs/common';\nimport { ${F}Controller } from './${f}.controller';\nimport { ${F}Service } from './${f}.service';\n\n` +
    `@Module({\n  controllers: [${F}Controller],\n  providers: [${F}Service],\n  exports: [${F}Service],\n})\nexport class ${F}Module {}\n`);
}
console.log(`nodedemo: 1 project, ${FEATURES} NestJS feature modules, ${FEATURES * 4 + 2} files → ${out}`);
