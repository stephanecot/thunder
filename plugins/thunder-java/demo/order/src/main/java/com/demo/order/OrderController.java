package com.demo.order;

import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.List;

@RestController
@RequestMapping("/orders")
public class OrderController {

    private final OrderService service;

    public OrderController(OrderService service) {
        this.service = service;
    }

    @PostMapping
    public Order place(@RequestParam Long userId, @RequestParam BigDecimal amount) {
        return service.place(userId, amount);
    }

    @GetMapping("/by-user/{userId}")
    public List<Order> byUser(@PathVariable Long userId) {
        return service.ordersOf(userId);
    }
}
