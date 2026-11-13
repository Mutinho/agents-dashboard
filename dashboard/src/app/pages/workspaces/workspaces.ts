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
  readonly error = signal<string | null>(null);
  readonly warnings = signal<string[]>([]);

  name = '';
  description = '';
  sourceType: 'empty' | 'local' | 'github' = 'empty';
  localSubpath = '';
  reposText = ''; // una URL por línea

  async ngOnInit() {
    await this.reload();
  }

  async reload() {
    this.items.set(await this.api.workspaces().catch(() => []));
  }

  async create() {
    if (!this.name.trim()) return;
    this.creating.set(true);
    this.error.set(null);
    this.warnings.set([]);
    try {
      const repos = this.reposText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const ws = await this.api.createWorkspace({
        name: this.name.trim(),
        description: this.description.trim() || undefined,
        sourceType: this.sourceType,
        repos: this.sourceType === 'github' ? repos : undefined,
        localSubpath: this.sourceType === 'local' ? this.localSubpath.trim() : undefined,
      });
      if (ws.warnings?.length) this.warnings.set(ws.warnings);
      this.name = '';
      this.description = '';
      this.localSubpath = '';
      this.reposText = '';
      this.sourceType = 'empty';
      await this.reload();
    } catch (e: any) {
      this.error.set(e?.error?.error ?? e?.message ?? 'Error al crear el workspace');
    } finally {
      this.creating.set(false);
    }
  }
}
