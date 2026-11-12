import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { JsonPipe } from '@angular/common';
import { ApiService } from '../../core/api.service';
import { RealtimeService } from '../../core/realtime.service';
import type { Conversation, Workspace } from '../../core/models';
import { statusColor, usd } from '../../core/ui';

@Component({
  selector: 'app-home',
  imports: [RouterLink, JsonPipe],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home implements OnInit {
  private api = inject(ApiService);
  private rt = inject(RealtimeService);

  readonly statusColor = statusColor;
  readonly usd = usd;

  readonly opencodeVersion = signal<string>('…');
  readonly totalCost = signal<number>(0);
  readonly active = signal<{ conv: Conversation; ws: Workspace }[]>([]);
  readonly lastEvent = this.rt.lastEvent;

  async ngOnInit() {
    const [health, workspaces] = await Promise.all([
      this.api.health().catch(() => null),
      this.api.workspaces().catch(() => [] as Workspace[]),
    ]);
    this.opencodeVersion.set(health?.opencode?.version ?? 'caído');

    let cost = 0;
    const active: { conv: Conversation; ws: Workspace }[] = [];
    for (const ws of workspaces) {
      const [detail, metrics] = await Promise.all([
        this.api.workspace(ws.id).catch(() => null),
        this.api.workspaceMetrics(ws.id).catch(() => null),
      ]);
      cost += metrics?.costUsd ?? 0;
      for (const conv of detail?.conversations ?? []) {
        if (conv.status === 'running') active.push({ conv, ws });
      }
    }
    this.totalCost.set(cost);
    this.active.set(active);
  }
}
