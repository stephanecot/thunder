package com.demo.user;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/users")
public class UserController {

    private final UserService service;

    public UserController(UserService service) {
        this.service = service;
    }

    @PostMapping
    public User create(@RequestBody UserDto dto) {
        return service.register(dto);
    }

    @GetMapping("/{email}")
    public User get(@PathVariable String email) {
        return service.findByEmail(email);
    }
}
