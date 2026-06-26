import { Component, Input } from '@angular/core';
import { OrderService } from './order.service';
import { Order } from './order.model';

@Component({
  selector: 'app-order-list',
  template: `<div *ngFor="let o of orders">{{ o.amount }} — {{ o.status }}</div>`,
})
export class OrderListComponent {
  @Input() userId = 0;

  orders: Order[] = [];

  constructor(private ordersService: OrderService) {}

  load(): void {
    this.ordersService.ordersOf(this.userId).subscribe((o) => (this.orders = o));
  }
}
