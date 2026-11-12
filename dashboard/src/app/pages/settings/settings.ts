import { Component, inject, OnInit, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import type { AgentProfile, Health } from '../../core/models';

@Component({
  selector: 'app-settings',
  imports: [],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings implements OnInit {
  private api = inject(ApiService);

  readonly health = signal<Health | null>(null);
  readonly agents = signal<AgentProfile[]>([]);

  async ngOnInit() {
    const [h, a] = await Promise.all([
      this.api.health().catch(() => null),
      this.api.agents().catch(() => []),
    ]);
    this.health.set(h);
    this.agents.set(a);
  }

  models() {
    return this.agents().map((a) => ({ key: a.key, model: a.defaultModel }));
  }
}
