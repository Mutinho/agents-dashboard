import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { RealtimeService } from './core/realtime.service';
import { ApiService } from './core/api.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App implements OnInit {
  private rt = inject(RealtimeService);
  private api = inject(ApiService);

  readonly connected = this.rt.connected;
  readonly opencodeOk = signal<boolean | null>(null);

  readonly nav = [
    { path: '/home', label: 'Inicio', icon: 'home' },
    { path: '/agents', label: 'Agentes', icon: 'bot' },
    { path: '/workspaces', label: 'Workspaces', icon: 'folder' },
    { path: '/settings', label: 'Ajustes', icon: 'gear' },
  ];

  async ngOnInit() {
    this.rt.connect();
    try {
      const h = await this.api.health();
      this.opencodeOk.set(h.opencode?.healthy ?? false);
    } catch {
      this.opencodeOk.set(false);
    }
  }
}
