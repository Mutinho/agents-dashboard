import { WebSocketServer, WebSocket } from 'ws';

/**
 * Hub WebSocket simple: los clientes del dashboard se conectan y reciben
 * todos los eventos del orquestador (message.created, turn.*, conversation.status).
 * v1: broadcast global; el cliente filtra por conversationId.
 */
export class RealtimeHub {
  private wss: WebSocketServer;

  constructor(port: number) {
    this.wss = new WebSocketServer({ host: '0.0.0.0', port });
    this.wss.on('connection', (ws: WebSocket) => {
      ws.send(JSON.stringify({ event: 'hello', payload: { ts: Date.now() } }));
    });
  }

  emit = (event: string, payload: unknown): void => {
    const msg = JSON.stringify({ event, payload });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  };
}
