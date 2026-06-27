import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1';

  login(email: string, password: string): Observable<{ token: string }> {
    return this.http.post<{ token: string }>(`${this.apiUrl}/auth/login`, { email, password });
  }

  me(): Observable<{ id: number }> {
    return this.http.get<{ id: number }>(`${this.apiUrl}/auth/me`);
  }

  logout(): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/auth/session`);
  }

  isLoggedIn(): boolean {
    return true;
  }
}
