export class OrderService {
  private orders: any[] = [];

  list() {
    return this.orders;
  }

  create(order: any) {
    if (order.amount < 0) {
      throw new Error('amount must be positive');
    }
    this.orders.push(order);
    return order;
  }

  remove(id: string) {
    this.orders = this.orders.filter((o) => o.id !== id);
  }
}
