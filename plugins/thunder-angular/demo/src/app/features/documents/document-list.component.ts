import { Component, inject, OnInit } from '@angular/core';
import { KnowledgeService, Document } from './knowledge.service';

@Component({
  selector: 'app-document-list',
  standalone: true,
  template: `<table class="documents"></table>`,
})
export class DocumentListComponent implements OnInit {
  private readonly knowledge = inject(KnowledgeService);

  documents: Document[] = [];

  ngOnInit(): void {
    this.knowledge.list().subscribe((d) => (this.documents = d));
  }
}
