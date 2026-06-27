import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class KnowledgeService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = '/api/v1';

  list(): Observable<Document[]> {
    return this.http.get<Document[]>(`${this.apiUrl}/documents`);
  }

  upload(file: Document): Observable<Document> {
    return this.http.post<Document>(`${this.apiUrl}/documents`, file);
  }

  remove(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/documents/${id}`);
  }
}

export interface Document {
  id: number;
  title: string;
}
