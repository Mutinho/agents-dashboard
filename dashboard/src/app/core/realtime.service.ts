import { Injectable, signal } from '@angular/core';
import type { RealtimeEvent } from './models.js';

/**
 * Cliente WebSocket del orquestador. Se conecta a /ws (proxy nginx), reconecta
 * automáticamente, y expone el último evento y el estado de conexión como signals.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  readonly connected = signal(false);
  readonly lastEvent = signal<RealtimeEvent | null>(null);

  private ws: WebSocket | null = null;
  private reconnectTimer: any = null;

  connect(): void {
    if (this.ws && this.ws.readyState <= 1) return; // ya conectando/conectado
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws`;
    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => this.connected.set(true);
    this.ws.onclose = () => {
      this.connected.set(false);
      this.scheduleReconnect();
    };
    this.ws.onerror = () => this.ws?.close();
    this.ws.onmessage = (ev) => {
      try {
        this.lastEvent.set(JSON.parse(ev.data) as RealtimeEvent);
      } catch {
        /* ignora frames no-JSON */
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }
}
