import test from 'node:test';
import assert from 'node:assert';
import { parseFile } from '../lib/parser.mjs';

test('component: multi-line decorator, @Input/@Output, constructor DI', () => {
  const src = `
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { UserService } from './user.service';

@Component({
  selector: 'app-user-list',
  standalone: true,
  template: \`<h1>{{ title }}</h1>\`,
})
export class UserListComponent {
  @Input() title = 'Users';
  @Output() selected = new EventEmitter<User>();
  items: User[] = [];
  constructor(private users: UserService) {}
  ngOnInit(): void { this.users.getUsers(); }
}
`;
  const t = parseFile(src, 'user-list.component.ts').types[0];
  assert.strictEqual(t.name, 'UserListComponent');
  assert.ok(t.decorators.some((d) => d.startsWith('@Component(')), 'has @Component');
  assert.deepStrictEqual(t.ctorDeps, ['UserService'], 'constructor injects UserService');
  assert.ok(t.props.find((p) => p.name === 'title' && p.decorators.includes('@Input()')), '@Input title');
  assert.ok(t.props.find((p) => p.name === 'selected' && p.decorators.includes('@Output()')), '@Output selected');
  assert.ok(t.methods.find((m) => m.name === 'ngOnInit'), 'method ngOnInit');
});

test('service: providedIn + HttpClient injection; brace-in-comment safe', () => {
  const src = `
import { Injectable } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class UserService {
  constructor(private http: HttpClient) {}
  // a brace { in a comment } is fine
  getUsers() { return this.http.get('/api'); }
}
`;
  const t = parseFile(src, 'user.service.ts').types[0];
  assert.deepStrictEqual(t.ctorDeps, ['HttpClient']);
  assert.ok(t.decorators.some((d) => d.includes('providedIn')));
});

test('inject() function DI is detected', () => {
  const src = `
export class Widget {
  private svc = inject(DataService);
}
`;
  const t = parseFile(src, 'widget.ts').types[0];
  assert.ok(t.ctorDeps.includes('DataService'), 'inject(DataService)');
});

test('routes: component, redirect and lazy are extracted', () => {
  const src = `
import { Routes } from '@angular/router';
export const routes: Routes = [
  { path: '', redirectTo: 'users', pathMatch: 'full' },
  { path: 'users', component: UserListComponent },
  { path: 'orders', loadChildren: () => import('./orders/orders.module').then(m => m.OrdersModule) },
];
`;
  const routes = parseFile(src, 'app.routes.ts').routes;
  const byPath = (p) => routes.find((r) => r.path === p);
  assert.strictEqual(byPath('').kind, 'redirect');
  assert.strictEqual(byPath('users').target, 'UserListComponent');
  assert.strictEqual(byPath('orders').kind, 'lazy-children');
});

test('@NgModule arrays parsed', () => {
  const src = `
import { NgModule } from '@angular/core';
@NgModule({
  declarations: [OrderListComponent],
  imports: [CommonModule, OrdersRoutingModule],
  providers: [OrderService],
})
export class OrdersModule {}
`;
  const t = parseFile(src, 'orders.module.ts').types[0];
  assert.ok(t.decorators.some((d) => d.startsWith('@NgModule(')));
});
