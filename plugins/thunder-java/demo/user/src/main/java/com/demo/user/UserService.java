package com.demo.user;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/*
 * Service métier des utilisateurs.
 * Note piège pour le lexer : une accolade } dans un commentaire { ne doit rien casser.
 */
@Service
public class UserService {

    private final UserRepository repository;

    public UserService(UserRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public User register(UserDto dto) {
        // règle métier : email unique
        if (repository.existsByEmail(dto.getEmail())) {
            String msg = "Email déjà pris: {email} -> " + dto.getEmail();
            throw new IllegalStateException(msg);
        }
        User user = new User();
        user.setEmail(dto.getEmail());
        return repository.save(user);
    }

    public User findByEmail(String email) {
        return repository.findByEmail(email).orElseThrow();
    }

    public String describe() {
        return """
            Utilisateur {
              email: requis et unique
              age: >= 18
            }
            """;
    }
}
