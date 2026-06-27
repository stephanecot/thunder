import test from 'node:test';
import assert from 'node:assert';
import { parseFile } from '../lib/parser.mjs';
import { derive } from '../lib/derive.mjs';

const fact = (src, file, pkg) => { const f = parseFile(src, file); f.project = 'app'; f.package = pkg; f.hash = 'h'; return f; };

test('FastAPI verb decorators + Pydantic model + Depends flow', () => {
  const f = fact(`
from pydantic import BaseModel
class Item(BaseModel):
    id: int
@router.post("/items")
def create(data: Item, db = Depends(get_db)):
    return data
`, 'app/items/routes.py', 'app.items');
  const m = derive([f]);
  const ctx = m.contexts[0];
  assert.strictEqual(ctx.framework, 'fastapi');
  assert.ok(ctx.models.Item && ctx.models.Item.kind === 'pydantic');
  const r = m.routes.find((x) => x.verb === 'POST' && x.path === '/items');
  assert.ok(r, 'route derived');
  assert.match(r.flow, /create → get_db/, 'DI in flow');
});

test('Flask @route with methods list', () => {
  const f = fact(`
bp = Blueprint("o", __name__)
@bp.route("/orders", methods=["POST", "PUT"])
def place():
    return 1
`, 'app/orders/views.py', 'app.orders');
  const m = derive([f]);
  assert.strictEqual(m.contexts[0].framework, 'flask');
  const verbs = m.routes.filter((r) => r.path === '/orders').map((r) => r.verb).sort();
  assert.deepStrictEqual(verbs, ['POST', 'PUT']);
});

test('Django urlpatterns + models.Model', () => {
  const f = fact(`
from django.db import models
class Product(models.Model):
    code = models.CharField(max_length=64)
urlpatterns = [
    path("products/", views.list_products),
    path("products/<int:pk>/", views.Detail.as_view()),
]
`, 'app/catalog/urls.py', 'app.catalog');
  const m = derive([f]);
  assert.strictEqual(m.contexts[0].framework, 'django');
  assert.ok(m.contexts[0].models.Product && m.contexts[0].models.Product.kind === 'django');
  assert.strictEqual(m.routes.filter((r) => /products/.test(r.path)).length, 2);
});

test('dataclass is recognised as a model', () => {
  const f = fact(`
@dataclass
class Order:
    id: int
    amount: float
`, 'app/orders/models.py', 'app.orders');
  const ctx = derive([f]).contexts[0];
  assert.ok(ctx.models.Order && ctx.models.Order.kind === 'dataclass');
});
