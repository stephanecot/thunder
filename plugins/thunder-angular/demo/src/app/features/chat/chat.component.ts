import { Component, inject } from '@angular/core';
import { ChatService } from './chat.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  template: `<div class="chat"></div>`,
})
export class ChatComponent {
  private readonly chat = inject(ChatService);

  history = this.chat.history;

  send(text: string): void {
    this.chat.send(text).subscribe();
  }
}
