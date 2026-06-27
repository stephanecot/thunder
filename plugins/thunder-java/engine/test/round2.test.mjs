import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFile } from '../lib/parser.mjs';
import { derive } from '../lib/derive.mjs';
import { emit } from '../lib/emit.mjs';

const CONTROLLER = `
package com.demo.tag;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/tags")
public class TagController {

  @PostMapping
  public ResponseEntity<TagDto> create(
      @Valid @RequestBody TagRequest request,
      @AuthenticationPrincipal User user
  ) {
    return null;
  }

  @GetMapping("/{id}")
  public TagDto get(@PathVariable Long id) { return null; }
}
`;

function controllerFact() {
  const f = parseFile(CONTROLLER, 'TagController.java');
  f.module = 'tag'; f.hash = 'h1';
  return f;
}

test('multi-line method signature is detected (R2.5 endpoint bug)', () => {
  const t = controllerFact().types[0];
  assert.ok(t.methods.find((m) => m.name === 'create'), 'create() with multi-line params detected');
  assert.ok(t.methods.find((m) => m.name === 'get'), 'get() detected');
});

test('endpoints of a multi-line controller are derived (incl. POST)', () => {
  const m = derive([controllerFact()]);
  const paths = m.endpoints.map((e) => `${e.verb} ${e.path}`).sort();
  assert.deepStrictEqual(paths, ['GET /api/v1/tags/{id}', 'POST /api/v1/tags']);
  const post = m.endpoints.find((e) => e.verb === 'POST');
  assert.strictEqual(post.controller, 'TagController');
  assert.strictEqual(post.req, 'TagRequest', 'request body type captured');
});

test('project-brief.yaml is emitted with arch, modules and the endpoint list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thunder-brief-'));
  try {
    emit(dir, derive([controllerFact()]), {});
    const brief = readFileSync(join(dir, '.thunder', 'java', 'project-brief.yaml'), 'utf8');
    assert.ok(/arch:/.test(brief), 'arch style');
    assert.ok(/modules:/.test(brief), 'modules');
    assert.ok(brief.includes('POST /api/v1/tags'), 'endpoint listed in brief');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
