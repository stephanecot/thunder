import { Component, input } from '@angular/core';
import { Message } from './chat.service';

@Component({
  selector: 'app-chat-window',
  standalone: true,
  template: `<ul class="messages"></ul>`,
})
export class ChatWindowComponent {
  messages = input<Message[]>([]);
}
