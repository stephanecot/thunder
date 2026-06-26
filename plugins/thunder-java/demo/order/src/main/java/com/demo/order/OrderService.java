package com.demo.order;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.List;

@Service
public class OrderService {

    @Autowired
    private OrderRepository repository;

    public Order place(Long userId, BigDecimal amount) {
        if (amount.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException("Montant doit être positif");
        }
        Order order = new Order();
        order.setUserId(userId);
        order.setAmount(amount);
        order.setStatus("NEW");
        return repository.save(order);
    }

    public List<Order> ordersOf(Long userId) {
        return repository.findByUserId(userId);
    }
}
