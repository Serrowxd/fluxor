/**
 * Event Bus Service
 * Manages event publishing and subscription using Kafka
 */

import { EventBus, DomainEvent } from '../../../../shared/interfaces/module.interface';
import { SchemaRegistry } from './schema-registry';
import { EventStore } from './event-store';
import { v4 as uuidv4 } from 'uuid';

export interface EventBusConfig {
  brokers: string[];
  clientId: string;
}

export class EventBusService implements EventBus {
  private handlers = new Map<string, Set<(event: DomainEvent) => Promise<void>>>();
  private isConnectedFlag = false;

  constructor(
    private schemaRegistry: SchemaRegistry,
    private eventStore: EventStore,
    private config: EventBusConfig
  ) {}

  async connect(): Promise<void> {
    // In a real implementation, this would connect to Kafka
    // For now, we'll simulate the connection
    console.log(`Connecting to event bus with brokers: ${this.config.brokers.join(', ')}`);
    this.isConnectedFlag = true;
  }

  async disconnect(): Promise<void> {
    this.isConnectedFlag = false;
    this.handlers.clear();
  }

  async publish<T>(event: DomainEvent<T>): Promise<void> {
    if (!this.isConnectedFlag) {
      throw new Error('Event bus not connected');
    }

    // Validate event schema
    await this.schemaRegistry.validate(event.eventType, event);

    // Add event metadata
    const enrichedEvent: DomainEvent<T> = {
      ...event,
      id: event.id || uuidv4(),
      timestamp: event.timestamp || new Date(),
      eventVersion: event.eventVersion || 1,
      headers: {
        ...event.headers,
        'X-Event-ID': event.id || uuidv4(),
        'X-Timestamp': new Date().toISOString()
      }
    };

    // Store event
    await this.eventStore.append(enrichedEvent);

    // Publish to subscribers (in-memory for now)
    const eventHandlers = this.handlers.get(event.eventType);
    if (eventHandlers) {
      const promises = Array.from(eventHandlers).map(handler => 
        handler(enrichedEvent).catch(error => 
          console.error(`Error in event handler for ${event.eventType}:`, error)
        )
      );
      await Promise.all(promises);
    }

    console.log(`Published event: ${event.eventType} for aggregate ${event.aggregateId}`);
  }

  subscribe<T>(
    eventType: string,
    handler: (event: DomainEvent<T>) => Promise<void>
  ): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
    console.log(`Subscribed to event type: ${eventType}`);
  }

  unsubscribe(eventType: string, handler: Function): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      handlers.delete(handler as any);
      if (handlers.size === 0) {
        this.handlers.delete(eventType);
      }
    }
  }

  async isConnected(): Promise<boolean> {
    return this.isConnectedFlag;
  }

  getSubscriberCount(eventType: string): number {
    return this.handlers.get(eventType)?.size || 0;
  }
}