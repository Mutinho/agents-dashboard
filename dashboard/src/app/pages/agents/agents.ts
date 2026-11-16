import { Component, inject, OnInit, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import type { AgentProfile, Runtimes } from '../../core/models';
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
  readonly runtimes = signal<Runtimes | null>(null);

  async ngOnInit() {
    try {
      this.agents.set(await this.api.agents());
      this.runtimes.set(await this.api.runtimes().catch(() => null));
    } finally {
      this.loading.set(false);
    }
  }

  /** Modelo de Kiro de un rol en el perfil por defecto. */
  kiroModel(role: string): string | null {
    const k = this.runtimes()?.kiro;
    const p = k?.profiles.find((x) => x.name === k.defaultProfile);
    return p?.models[role] ?? null;
  }

  permissionEntries(p: Record<string, string>) {
    return Object.entries(p);
  }
}
