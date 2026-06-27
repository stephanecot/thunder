import test from 'node:test';
import assert from 'node:assert';
import { parseFile } from '../lib/parser.mjs';

test('class with bases, fields (annotation + default), and methods', () => {
  const src = `
from pydantic import BaseModel

class User(BaseModel):
    id: int
    email: str
    name: str = ""

    def label(self) -> str:
        return self.name
`;
  const t = parseFile(src, 'm.py').types[0];
  assert.strictEqual(t.name, 'User');
  assert.deepStrictEqual(t.bases, ['BaseModel']);
  assert.deepStrictEqual(t.fields.map((f) => f.name), ['id', 'email', 'name']);
  assert.ok(t.methods.find((m) => m.name === 'label'));
});

test('multi-line def signature with Depends is captured (params + deps)', () => {
  const src = `
@router.get("/users/{id}")
async def get_user(
    id: int,
    svc: UserService = Depends(get_service),
) -> User:
    return svc.get(id)
`;
  const fn = parseFile(src, 'r.py').functions[0];
  assert.strictEqual(fn.name, 'get_user');
  assert.ok(fn.async);
  assert.ok(fn.sig.includes('id: int') && fn.sig.endsWith('-> User'));
  assert.deepStrictEqual(fn.decorators, ['@router.get("/users/{id}")']);
  assert.deepStrictEqual(fn.deps, ['get_service']);
});

test('module-level assignment (urlpatterns) captured', () => {
  const src = `
from django.urls import path
urlpatterns = [
    path("products/", views.list_products),
]
`;
  const a = parseFile(src, 'urls.py').assigns.find((x) => x.name === 'urlpatterns');
  assert.ok(a && /path\("products\/"/.test(a.value), 'urlpatterns value captured across lines');
});

test('@dataclass decorator and Django models.Model field are detected', () => {
  const src = `
@dataclass
class Order:
    id: int
    amount: Decimal

class Product(models.Model):
    code = models.CharField(max_length=64)
`;
  const types = parseFile(src, 'models.py').types;
  const order = types.find((t) => t.name === 'Order');
  assert.deepStrictEqual(order.decorators, ['@dataclass']);
  const product = types.find((t) => t.name === 'Product');
  assert.strictEqual(product.fields.find((f) => f.name === 'code').type, 'models.CharField');
});

test('method bodies do not leak as class fields', () => {
  const src = `
class C:
    def m(self):
        x = 1
        y: int = 2
`;
  const t = parseFile(src, 'c.py').types[0];
  assert.strictEqual(t.fields.length, 0, 'no fields from method body');
  assert.ok(t.methods.find((m) => m.name === 'm'));
});
