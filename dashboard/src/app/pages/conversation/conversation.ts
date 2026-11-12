import { Component, inject, OnInit, signal, effect } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { RealtimeService } from '../../core/realtime.service';
import type { AgentMessage, Conversation, Metrics } from '../../core/models';
import { roleColor, roleLabel, signalColor, statusColor, usd } from '../../core/ui';

@Component({
  selector: 'app-conversation',
  imports: [RouterLink],
  templateUrl: './conversation.html',
  styleUrl: './conversation.scss',
})
export class ConversationPage implements OnInit {
  private api = inject(ApiService);
  private rt = inject(RealtimeService);
  private route = inject(ActivatedRoute);

  readonly roleColor = roleColor;
  readonly roleLabel = roleLabel;
  readonly signalColor = signalColor;
  readonly statusColor = statusColor;
  readonly usd = usd;

  readonly conv = signal<Conversation | null>(null);
  readonly messages = signal<AgentMessage[]>([]);
  readonly metrics = signal<Metrics | null>(null);
  readonly busy = signal(false);

  private id = '';

  constructor() {
    // Recarga en vivo cuando llega un evento de ESTA conversación.
    effect(() => {
      const ev = this.rt.lastEvent();
      if (!ev) return;
      if (ev.payload?.conversationId === this.id) {
        this.refresh();
      }
    });
  }

  async ngOnInit() {
    this.id = this.route.snapshot.paramMap.get('id')!;
    this.rt.connect();
    await this.refresh();
  }

  private async refresh() {
    const [conv, messages, metrics] = await Promise.all([
      this.api.conversation(this.id).catch(() => null),
      this.api.messages(this.id).catch(() => [] as AgentMessage[]),
      this.api.metrics(this.id).catch(() => null),
    ]);
    if (conv) this.conv.set(conv);
    this.messages.set(messages);
    this.metrics.set(metrics);
  }

  async start() {
    this.busy.set(true);
    try { await this.api.start(this.id); await this.refresh(); }
    finally { this.busy.set(false); }
  }

  async stop() {
    this.busy.set(true);
    try { await this.api.stop(this.id); await this.refresh(); }
    finally { this.busy.set(false); }
  }

  roleOf(instance: string): string {
    return instance.split('#')[0];
  }
}
