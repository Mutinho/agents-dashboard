import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import type { Workspace } from '../../core/models';

@Component({
  selector: 'app-workspaces',
  imports: [RouterLink, FormsModule],
  templateUrl: './workspaces.html',
  styleUrl: './workspaces.scss',
})
export class Workspaces implements OnInit {
  private api = inject(ApiService);

  readonly items = signal<Workspace[]>([]);
  readonly creating = signal(false);
  name = '';
  description = '';

  async ngOnInit() {
    await this.reload();
  }

  async reload() {
    this.items.set(await this.api.workspaces().catch(() => []));
  }

  async create() {
    if (!this.name.trim()) return;
    this.creating.set(true);
    try {
      await this.api.createWorkspace(this.name.trim(), this.description.trim() || undefined);
      this.name = '';
      this.description = '';
      await this.reload();
    } finally {
      this.creating.set(false);
    }
  }
}
