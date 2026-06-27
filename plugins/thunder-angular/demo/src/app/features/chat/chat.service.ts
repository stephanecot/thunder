import { Injectable, inject } from '@angular/core';
import { HttpClient, httpResource } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1';

  history = httpResource<Message[]>(() => `${this.apiUrl}/chat/history`);

  send(text: string): Observable<Message> {
    return this.http.post<Message>(`${this.apiUrl}/chat/messages`, { text });
  }

  clear(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/chat/messages/${id}`);
  }
}

export interface Message {
  id: number;
  text: string;
}
