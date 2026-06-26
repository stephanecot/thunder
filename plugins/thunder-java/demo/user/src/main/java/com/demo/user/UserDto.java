package com.demo.user;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

public class UserDto {

    @NotBlank
    @Email
    private String email;

    @Min(18)
    private int age;

    private String displayName;

    public String getEmail() { return email; }
    public int getAge() { return age; }
    public String getDisplayName() { return displayName; }
}
