import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Order } from './order.model';

@Injectable()
export class OrderService {
  private readonly base = '/api/orders';

  constructor(private http: HttpClient) {}

  ordersOf(userId: number): Observable<Order[]> {
    return this.http.get<Order[]>(`${this.base}?userId=${userId}`);
  }

  place(order: Order): Observable<Order> {
    return this.http.post<Order>(this.base, order);
  }
}
