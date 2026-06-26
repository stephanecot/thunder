import test from 'node:test';
import assert from 'node:assert';
import { parseFile } from '../lib/parser.mjs';

test('package, class, annotation, constructor, method, field', () => {
  const src = [
    'package com.demo.user;',
    'import x.Y;',
    '',
    '@Service',
    'public class UserService {',
    '    private final UserRepository repository;',
    '    public UserService(UserRepository repository) { this.repository = repository; }',
    '    @Transactional',
    '    public User register(UserDto dto) { return null; }',
    '}',
  ].join('\n');
  const f = parseFile(src, 'UserService.java');

  assert.strictEqual(f.pkg, 'com.demo.user');
  assert.strictEqual(f.types.length, 1);
  const t = f.types[0];
  assert.strictEqual(t.name, 'UserService');
  assert.deepStrictEqual(t.ann, ['@Service']);

  const ctor = t.methods.find((m) => m.name === 'UserService');
  assert.ok(ctor && ctor.isCtor, 'constructor flagged');

  const reg = t.methods.find((m) => m.name === 'register');
  assert.strictEqual(reg.sig, '(UserDto):User');
  assert.deepStrictEqual(reg.ann, ['@Transactional']);

  const field = t.fields.find((fl) => fl.name === 'repository');
  assert.strictEqual(field.type, 'UserRepository');
});

test('interface extends generic is captured', () => {
  const src = [
    'package p;',
    'public interface UserRepository extends JpaRepository<User, Long> {',
    '    Optional<User> findByEmail(String email);',
    '}',
  ].join('\n');
  const t = parseFile(src, 'R.java').types[0];
  assert.strictEqual(t.kind, 'interface');
  assert.ok(t.ext.startsWith('JpaRepository<User'));
  assert.ok(t.methods.find((m) => m.name === 'findByEmail' && m.sig === '(String):Optional<User>'));
});

test('text block does not produce phantom types', () => {
  const src = [
    'package p;',
    'public class S {',
    '    public String help() {',
    '        return """',
    '            Block { with } braces and class Fake {',
    '            """;',
    '    }',
    '}',
  ].join('\n');
  const f = parseFile(src, 'S.java');
  assert.strictEqual(f.types.length, 1);
  assert.strictEqual(f.types[0].name, 'S');
  assert.ok(f.types[0].methods.find((m) => m.name === 'help'));
});

test('generic return and param types preserved in signature', () => {
  const src = [
    'package p;',
    'public class C {',
    '    public List<Order> find(Map<String, Integer> filter) { return null; }',
    '}',
  ].join('\n');
  const m = parseFile(src, 'C.java').types[0].methods[0];
  assert.strictEqual(m.sig, '(Map<String, Integer>):List<Order>');
});

test('control-flow keywords are not mistaken for methods', () => {
  const src = [
    'package p;',
    'public class C {',
    '    public void go() {',
    '        if (x) { y(); }',
    '        while (z) { }',
    '    }',
    '}',
  ].join('\n');
  const methods = parseFile(src, 'C.java').types[0].methods;
  assert.deepStrictEqual(methods.map((m) => m.name), ['go']);
});
