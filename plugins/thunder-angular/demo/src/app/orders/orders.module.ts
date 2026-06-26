import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrderListComponent } from './order-list.component';
import { OrderService } from './order.service';
import { OrdersRoutingModule } from './orders-routing.module';

@NgModule({
  declarations: [OrderListComponent],
  imports: [CommonModule, OrdersRoutingModule],
  providers: [OrderService],
  exports: [OrderListComponent],
})
export class OrdersModule {}
