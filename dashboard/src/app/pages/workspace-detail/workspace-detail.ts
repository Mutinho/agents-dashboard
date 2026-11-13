import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import type { Conversation, Workspace } from '../../core/models';
import { statusColor, usd } from '../../core/ui';
import { FileExplorer } from './file-explorer';

@Component({
  selector: 'app-workspace-detail',
  imports: [RouterLink, FormsModule, FileExplorer],
  templateUrl: './workspace-detail.html',
  styleUrl: './workspace-detail.scss',
})
export class WorkspaceDetail implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly statusColor = statusColor;
  readonly usd = usd;

  readonly ws = signal<Workspace | null>(null);
  readonly conversations = signal<Conversation[]>([]);
  readonly creating = signal(false);

  // form
  title = '';
  goal = '';
  budgetUsd = 0;
  parallelDev = 1;
  maxIterations = 10;

  private id = '';

  async ngOnInit() {
    this.id = this.route.snapshot.paramMap.get('id')!;
    await this.reload();
  }

  async reload() {
    const detail = await this.api.workspace(this.id).catch(() => null);
    if (detail) {
      this.ws.set(detail);
      this.conversations.set(detail.conversations ?? []);
    }
  }

  async create() {
    if (!this.goal.trim()) return;
    this.creating.set(true);
    try {
      const conv = await this.api.createConversation(this.id, {
        title: this.title.trim() || 'Conversación',
        goal: this.goal.trim(),
        budgetUsd: Number(this.budgetUsd) || 0,
        parallelDev: Number(this.parallelDev) || 1,
        maxIterations: Number(this.maxIterations) || 10,
      });
      this.router.navigate(['/conversations', conv.id]);
    } finally {
      this.creating.set(false);
    }
  }
}
