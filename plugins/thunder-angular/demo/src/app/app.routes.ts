import { Routes } from '@angular/router';
import { UserListComponent } from './users/user-list.component';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'users', pathMatch: 'full' },
  { path: 'users', component: UserListComponent, canActivate: [authGuard] },
  {
    path: 'chat',
    loadComponent: () => import('./features/chat/chat.component').then((m) => m.ChatComponent),
    canActivate: [authGuard],
  },
  {
    path: 'documents',
    loadComponent: () =>
      import('./features/documents/document-list.component').then((m) => m.DocumentListComponent),
    canMatch: [authGuard],
  },
  {
    path: 'orders',
    loadChildren: () => import('./orders/orders.module').then((m) => m.OrdersModule),
  },
];
