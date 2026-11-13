import { Component, computed, inject, OnInit, signal, effect } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { RealtimeService } from '../../core/realtime.service';
import { MarkdownPipe } from '../../core/markdown.pipe';
import type { AgentMessage, Conversation, Metrics } from '../../core/models';
import { roleColor, roleLabel, signalColor, statusColor, usd } from '../../core/ui';

type Tab = 'chat' | 'flow';

interface FlowStep {
  index: number;
  role: string;        // po/ux/dev/validator
  instance: string;    // dev#1, etc.
  signal: string | null;
}

@Component({
  selector: 'app-conversation',
  imports: [RouterLink, MarkdownPipe],
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
  readonly tab = signal<Tab>('chat');

  // Etapas fijas del pipeline para la barra de progreso.
  readonly stages = ['po', 'ux', 'dev', 'validator'];

  /** Rol del último mensaje no-system (etapa "activa"). */
  readonly activeRole = computed(() => {
    const msgs = this.messages().filter((m) => m.fromInstance !== 'system');
    const last = msgs[msgs.length - 1];
    return last ? this.roleOf(last.fromInstance) : null;
  });

  /** Conjunto de roles que ya han intervenido (para marcar etapas completadas). */
  readonly doneRoles = computed(() => {
    const s = new Set<string>();
    for (const m of this.messages()) {
      if (m.fromInstance !== 'system') s.add(this.roleOf(m.fromInstance));
    }
    return s;
  });

  /** Pasos del flujo (para el diagrama SVG), en orden cronológico. */
  readonly flow = computed<FlowStep[]>(() =>
    this.messages()
      .filter((m) => m.fromInstance !== 'system')
      .map((m, i) => ({
        index: i,
        role: this.roleOf(m.fromInstance),
        instance: m.fromInstance,
        signal: m.signal,
      })),
  );

  private id = '';

  constructor() {
    effect(() => {
      const ev = this.rt.lastEvent();
      if (ev && ev.payload?.conversationId === this.id) this.refresh();
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

  stageState(role: string): 'done' | 'active' | 'pending' {
    if (this.activeRole() === role && this.conv()?.status === 'running') return 'active';
    if (this.doneRoles().has(role)) return 'done';
    return 'pending';
  }

  isRunning(): boolean {
    return this.conv()?.status === 'running';
  }
}
