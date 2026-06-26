import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UserService } from './user.service';
import { User } from './user.model';

@Component({
  selector: 'app-user-list',
  standalone: true,
  imports: [CommonModule],
  template: `
    <h1>{{ title }}</h1>
    <ul>
      <li *ngFor="let u of items" (click)="select(u)">{{ u.displayName }}</li>
    </ul>
  `,
})
export class UserListComponent implements OnInit {
  @Input() title = 'Users';
  @Output() selected = new EventEmitter<User>();

  items: User[] = [];

  constructor(private users: UserService) {}

  ngOnInit(): void {
    this.users.getUsers().subscribe((u) => (this.items = u));
  }

  select(user: User): void {
    this.selected.emit(user);
  }
}
