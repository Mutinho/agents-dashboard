import { Component, inject, OnInit, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import type { AgentProfile } from '../../core/models';
import { roleColor, roleLabel } from '../../core/ui';

@Component({
  selector: 'app-agents',
  imports: [],
  templateUrl: './agents.html',
  styleUrl: './agents.scss',
})
export class Agents implements OnInit {
  private api = inject(ApiService);

  readonly roleColor = roleColor;
  readonly roleLabel = roleLabel;
  readonly agents = signal<AgentProfile[]>([]);
  readonly loading = signal(true);

  async ngOnInit() {
    try {
      this.agents.set(await this.api.agents());
    } finally {
      this.loading.set(false);
    }
  }

  permissionEntries(p: Record<string, string>) {
    return Object.entries(p);
  }
}
