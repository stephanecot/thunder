import { Injectable } from '@nestjs/common';

@Injectable()
export class UsersService {
  private items: any[] = [];

  findAll() {
    return this.items;
  }

  findOne(id: string) {
    return this.items.find((u) => u.id === id);
  }

  create(dto: any) {
    if (!dto.email) {
      throw new Error('email is required');
    }
    this.items.push(dto);
    return dto;
  }

  remove(id: string) {
    this.items = this.items.filter((u) => u.id !== id);
  }
}
