import { connect, type NatsConnection, JSONCodec } from 'nats';

/**
 * Bus de mensajes del orquestador (PLAN §4.3).
 * Publica eventos de conversación en topics NATS para desacoplar la producción
 * (agentes/pipeline) del consumo (dashboard, métricas, futuros procesos).
 *
 * Topics:
 *   conv.<conversationId>.events   -> eventos de ciclo de vida y turnos
 *   conv.<conversationId>.messages -> mensajes/aportaciones de agentes
 */
export interface MessageBus {
  publishEvent(conversationId: string, event: string, payload: unknown): void;
  publishMessage(conversationId: string, message: unknown): void;
  close(): Promise<void>;
}

/** Implementación NATS. */
export class NatsBus implements MessageBus {
  private readonly codec = JSONCodec();

  private constructor(private readonly nc: NatsConnection) {}

  static async connect(url: string): Promise<NatsBus> {
    const nc = await connect({ servers: url, name: 'orchestrator' });
    return new NatsBus(nc);
  }

  publishEvent(conversationId: string, event: string, payload: unknown): void {
    this.nc.publish(
      `conv.${conversationId}.events`,
      this.codec.encode({ event, payload, ts: Date.now() }),
    );
  }

  publishMessage(conversationId: string, message: unknown): void {
    this.nc.publish(
      `conv.${conversationId}.messages`,
      this.codec.encode({ message, ts: Date.now() }),
    );
  }

  async close(): Promise<void> {
    await this.nc.drain();
  }
}

/** Fallback no-op: si NATS no está disponible, el sistema sigue funcionando. */
export class NoopBus implements MessageBus {
  publishEvent(): void {}
  publishMessage(): void {}
  async close(): Promise<void> {}
}

/** Intenta NATS; si falla, cae a NoopBus sin tumbar el orquestador. */
export async function createBus(url: string | undefined): Promise<MessageBus> {
  if (!url) return new NoopBus();
  try {
    const bus = await NatsBus.connect(url);
    console.log(`[bus] conectado a NATS en ${url}`);
    return bus;
  } catch (err) {
    console.warn(`[bus] no se pudo conectar a NATS (${url}); usando NoopBus`, err);
    return new NoopBus();
  }
}
