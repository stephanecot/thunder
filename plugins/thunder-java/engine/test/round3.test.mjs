import test from 'node:test';
import assert from 'node:assert';
import { parseFile } from '../lib/parser.mjs';
import { derive } from '../lib/derive.mjs';

const TAG_CONTROLLER = `
package com.demo.tag;
import org.springframework.web.bind.annotation.*;
import org.springframework.data.domain.*;
import io.swagger.v3.oas.annotations.tags.Tag;

@RestController
@RequestMapping("/api/v1/tags")
@io.swagger.v3.oas.annotations.tags.Tag(name = "Tags", description = "Tag management")
public class TagController {

  private final TagService service;

  public TagController(TagService service) { this.service = service; }

  @GetMapping
  public Page<TagDto> getTags(
      @RequestParam(required = false) String q,
      @PageableDefault(size = 20, sort = "code", direction = Sort.Direction.ASC) Pageable pageable
  ) {
    return service.list(q, pageable);
  }

  @GetMapping("/{id}")
  public TagDto getTagById(@PathVariable Long id) { return service.get(id); }

  @PostMapping
  public TagDto createTag(@Valid @RequestBody TagRequest request) { return service.create(request); }

  @PutMapping("/{id}")
  public TagDto updateTag(@PathVariable Long id, @Valid @RequestBody TagRequest request) {
    return service.update(id, request);
  }

  @DeleteMapping("/{id}")
  public void deleteTag(@PathVariable Long id) { service.delete(id); }
}
`;

function fact() {
  const f = parseFile(TAG_CONTROLLER, 'TagController.java');
  f.module = 'tags'; f.hash = 'h1';
  return f;
}

test('qualified Swagger annotation does not corrupt the controller annotations (R3.1a)', () => {
  const t = fact().types[0];
  assert.ok(t.ann.includes('@RestController'), '@RestController kept');
  assert.ok(t.ann.some((a) => a.startsWith('@RequestMapping')), '@RequestMapping kept');
});

test('all 5 controller methods are detected (R3.1: qualified + multi-line params)', () => {
  const t = fact().types[0];
  const names = t.methods.map((m) => m.name);
  for (const n of ['getTags', 'getTagById', 'createTag', 'updateTag', 'deleteTag']) {
    assert.ok(names.includes(n), `method ${n} detected`);
  }
});

test('all 5 endpoints are derived with correct verbs/paths', () => {
  const m = derive([fact()]);
  const paths = m.endpoints.map((e) => `${e.verb} ${e.path}`).sort();
  assert.deepStrictEqual(paths, [
    'DELETE /api/v1/tags/{id}',
    'GET /api/v1/tags',
    'GET /api/v1/tags/{id}',
    'POST /api/v1/tags',
    'PUT /api/v1/tags/{id}',
  ]);
});

test('fully-qualified annotation on a stereotype class is not mistaken for a member', () => {
  const src = `
package p;
import org.springframework.stereotype.Service;
@io.swagger.v3.oas.annotations.tags.Tag(name = "X")
@Service
public class Thing {
  public void go() {}
}
`;
  const t = parseFile(src, 'Thing.java').types[0];
  assert.ok(t.ann.includes('@Service'), '@Service preserved');
  assert.ok(t.methods.find((m) => m.name === 'go'), 'real method still detected');
});
