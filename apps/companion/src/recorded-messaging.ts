import type { DemoMessageEventInput } from '@math-study-companion/contracts';
import type {
  InboundMessageEvent,
  InboundSource,
  MessagingProvider,
  OutboundImage,
  OutboundText,
  SendResult,
} from '@math-study-companion/conversation';

import type { StoredEvent } from './api-client.js';

export interface MessagingEventApi {
  reserveOutbound(
    interactionId: string,
    idempotencyKey: string,
  ): Promise<'reserved' | 'duplicate'>;
  recordEvent(
    interactionId: string,
    event: DemoMessageEventInput,
  ): Promise<'recorded' | 'duplicate'>;
  listEvents(interactionId: string): Promise<StoredEvent[]>;
}

export class RecordedMessagingProvider
  implements MessagingProvider, InboundSource
{
  readonly name: string;

  constructor(
    private readonly interactionId: string,
    private readonly provider: MessagingProvider & InboundSource,
    private readonly api: MessagingEventApi,
  ) {
    this.name = provider.name;
  }

  sendMessage(input: OutboundText): Promise<SendResult> {
    return this.#send(input, () => this.provider.sendMessage(input));
  }

  sendImage(input: OutboundImage): Promise<SendResult> {
    return this.#send(input, () => this.provider.sendImage(input));
  }

  async *listen(
    options: { signal?: AbortSignal } = {},
  ): AsyncIterable<InboundMessageEvent> {
    for await (const event of this.provider.listen(options)) {
      const outcome = await this.api.recordEvent(this.interactionId, {
        provider: event.provider,
        direction: 'inbound',
        eventType: 'received',
        providerEventId: event.providerEventId,
        providerMessageId: event.providerMessageId,
        idempotencyKey: null,
        occurredAt: event.receivedAt,
      });
      if (outcome === 'recorded') yield event;
    }
  }

  async #send(
    input: { idempotencyKey: string },
    send: () => Promise<SendResult>,
  ): Promise<SendResult> {
    const reservation = await this.api.reserveOutbound(
      this.interactionId,
      input.idempotencyKey,
    );
    if (reservation === 'duplicate') {
      const existing = findAcceptedEvent(
        await this.api.listEvents(this.interactionId),
        input.idempotencyKey,
      );
      if (!existing?.providerMessageId) {
        throw new Error(
          `Outbound ${input.idempotencyKey} is reserved with an uncertain delivery state`,
        );
      }
      return {
        providerMessageId: existing.providerMessageId,
        acceptedAt: existing.occurredAt,
        deduplicated: true,
      };
    }

    const result = await send();
    const event: DemoMessageEventInput = {
      provider: this.provider.name,
      direction: 'outbound',
      eventType: 'accepted',
      providerEventId: null,
      providerMessageId: result.providerMessageId,
      idempotencyKey: input.idempotencyKey,
      occurredAt: result.acceptedAt,
    };
    const outcome = await this.api.recordEvent(this.interactionId, event);
    if (outcome !== 'recorded') {
      throw new Error(
        `Outbound event ${input.idempotencyKey} was unexpectedly duplicated`,
      );
    }
    return result;
  }
}

function findAcceptedEvent(
  events: StoredEvent[],
  idempotencyKey: string,
): StoredEvent | undefined {
  return events.find(
    (event) =>
      event.direction === 'outbound' &&
      event.eventType === 'accepted' &&
      event.idempotencyKey === idempotencyKey,
  );
}
