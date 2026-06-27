import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFile } from '../lib/parser.mjs';
import { derive } from '../lib/derive.mjs';
import { build } from '../lib/build.mjs';

// ---- NestJS ----------------------------------------------------------------
test('NestJS: @Controller + @Get/@Post/@Delete → endpoints with verb + joined path + handler', () => {
  const src = `
import { Controller, Get, Post, Delete, Param } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @Get() findAll() { return this.users.findAll(); }
  @Get(':id') findOne(@Param('id') id: string) { return this.users.findOne(id); }
  @Post() create(dto: any) { return this.users.create(dto); }
  @Delete(':id') remove(@Param('id') id: string) { return this.users.remove(id); }
}`;
  const f = parseFile(src, 'users.controller.ts');
  assert.deepStrictEqual(f.routes.map((r) => `${r.verb} ${r.path}`),
    ['GET /users', 'GET /users/:id', 'POST /users', 'DELETE /users/:id']);
  assert.equal(f.routes[0].target, 'UsersController.findAll');
  assert.deepStrictEqual(f.types[0].ctorDeps, ['UsersService'], 'constructor DI captured');
  assert.equal(f.types[0].basePath, 'users');
  assert.deepStrictEqual(f.fw, ['nestjs']);
});

test('NestJS: @Injectable service and @Module are derived', () => {
  const files = [
    { ...parseFile(`import { Injectable } from '@nestjs/common';\n@Injectable()\nexport class UsersService { findAll() {} }`, 'users.service.ts'), project: 'app', feature: 'users', hash: 'h1' },
    { ...parseFile(`import { Module } from '@nestjs/common';\n@Module({ controllers: [UsersController], providers: [UsersService] })\nexport class UsersModule {}`, 'users.module.ts'), project: 'app', feature: 'users', hash: 'h2' },
  ];
  const { contexts } = derive(files);
  const ctx = contexts.find((c) => c.feature === 'users');
  assert.ok(ctx.services.UsersService, 'service registered');
  assert.equal(ctx.modules[0].n, 'UsersModule');
  assert.deepStrictEqual(ctx.modules[0].providers, ['UsersService']);
  assert.equal(ctx.framework, 'nestjs');
});

// ---- Express ---------------------------------------------------------------
test('Express: router.<verb>(path, …) → endpoints; inline arrow handler → (inline)', () => {
  const src = `
import { Router } from 'express';
const router = Router();
router.get('/orders', (req, res) => res.json([]));
router.post('/orders', (req, res) => res.json(req.body));
router.delete('/orders/:id', (req, res) => res.sendStatus(204));`;
  const f = parseFile(src, 'orders.routes.ts');
  assert.deepStrictEqual(f.routes.map((r) => `${r.verb} ${r.path}`), ['GET /orders', 'POST /orders', 'DELETE /orders/:id']);
  assert.equal(f.routes[0].target, '(inline)', 'inline arrow → no param captured as handler');
  assert.ok(f.fw.includes('express'));
});

test('Express: named handler reference is captured', () => {
  const f = parseFile(`import { Router } from 'express';\nconst router = Router();\nrouter.post('/users', usersController.create);`, 'r.ts');
  assert.equal(f.routes[0].target, 'usersController.create');
});

// ---- Fastify ---------------------------------------------------------------
test('Fastify: fastify.<verb>(path, …) → endpoints + framework detected', () => {
  const src = `
import { FastifyInstance } from 'fastify';
export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => ({ status: 'ok' }));
  fastify.get('/health/ready', async () => ({ ready: true }));
}`;
  const f = parseFile(src, 'health.routes.ts');
  assert.deepStrictEqual(f.routes.map((r) => r.path), ['/health', '/health/ready']);
  assert.ok(f.fw.includes('fastify'));
});

// ---- false positives -------------------------------------------------------
test('a plain `map.get(key)` is NOT mistaken for a route', () => {
  const f = parseFile(`const m = new Map();\nfunction f(k) { return m.get(k); }`, 'util.ts');
  assert.equal(f.routes.length, 0);
});

// ---- end-to-end build + emit ----------------------------------------------
test('build: per-feature contexts, endpoint flow, src_hash, card+detail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thunder-node-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'svc' }));
    mkdirSync(join(dir, 'src/users'), { recursive: true });
    writeFileSync(join(dir, 'src/users/users.controller.ts'),
      `import { Controller, Get } from '@nestjs/common';\n@Controller('users')\nexport class UsersController {\n  constructor(private users: UsersService) {}\n  @Get() findAll() {}\n}`);
    writeFileSync(join(dir, 'src/users/users.service.ts'),
      `import { Injectable } from '@nestjs/common';\n@Injectable()\nexport class UsersService { findAll() {} }`);
    const { model } = build(dir);
    const ctx = model.contexts.find((c) => c.feature === 'users');
    assert.ok(ctx, 'users context exists');
    assert.equal(ctx.framework, 'nestjs');
    assert.ok(ctx.src_hash && ctx.src_hash.length === 8, 'src_hash present');
    assert.equal(ctx.routes[0].flow, 'GET /users → UsersController.findAll → UsersService');
    assert.ok(ctx.services.UsersService, 'service in context');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('build: container dir (modules/<x>) descends one level into per-feature contexts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thunder-node-c-'));
  try {
    for (const f of ['users', 'orders']) {
      mkdirSync(join(dir, 'src/modules', f), { recursive: true });
      writeFileSync(join(dir, 'src/modules', f, `${f}.controller.ts`),
        `import { Controller, Get } from '@nestjs/common';\n@Controller('${f}')\nexport class ${f}Controller { @Get() all() {} }`);
    }
    const feats = build(dir).model.contexts.map((c) => c.feature).sort();
    assert.ok(feats.includes('modules.users') && feats.includes('modules.orders'), `got ${feats}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
