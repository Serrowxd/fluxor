/**
 * Event Store
 * Persists domain events for event sourcing
 */

import { DomainEvent } from '../../../../shared/interfaces/module.interface';

export interface StoredEvent {
  id: string;
  aggregateId: string;
  aggregateType: string;
  eventType: string;
  eventVersion: number;
  eventData: any;
  metadata: any;
  timestamp: Date;
  sequenceNumber: number;
}

export class EventStore {
  private events: StoredEvent[] = [];
  private sequenceCounter = 0;

  async append<T>(event: DomainEvent<T>): Promise<void> {
    const storedEvent: StoredEvent = {
      id: event.id,
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      eventType: event.eventType,
      eventVersion: event.eventVersion,
      eventData: event.data,
      metadata: event.metadata,
      timestamp: event.timestamp,
      sequenceNumber: ++this.sequenceCounter
    };

    this.events.push(storedEvent);
  }

  async getEvents(
    aggregateId: string,
    fromSequence?: number,
    toSequence?: number
  ): Promise<StoredEvent[]> {
    let filtered = this.events.filter(e => e.aggregateId === aggregateId);

    if (fromSequence !== undefined) {
      filtered = filtered.filter(e => e.sequenceNumber >= fromSequence);
    }

    if (toSequence !== undefined) {
      filtered = filtered.filter(e => e.sequenceNumber <= toSequence);
    }

    return filtered.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }

  async getEventsByType(
    eventType: string,
    limit: number = 100
  ): Promise<StoredEvent[]> {
    return this.events
      .filter(e => e.eventType === eventType)
      .slice(-limit);
  }

  async getLastSequenceNumber(aggregateId: string): Promise<number> {
    const events = this.events.filter(e => e.aggregateId === aggregateId);
    if (events.length === 0) return 0;
    
    return Math.max(...events.map(e => e.sequenceNumber));
  }

  async createSnapshot(aggregateId: string, data: any): Promise<void> {
    // In a real implementation, this would store snapshots
    // for faster aggregate rebuilding
    console.log(`Creating snapshot for aggregate ${aggregateId}`);
  }

  isReady(): boolean {
    return true;
  }

  async close(): Promise<void> {
    // Cleanup if needed
  }
}