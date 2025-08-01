/**
 * Schema Registry
 * Validates event schemas for consistency
 */

import { DomainEvent } from '../../../../shared/interfaces/module.interface';

export interface EventSchema {
  eventType: string;
  version: number;
  schema: Record<string, any>;
}

export class SchemaRegistry {
  private schemas = new Map<string, EventSchema>();

  constructor() {
    // Register default schemas
    this.registerDefaultSchemas();
  }

  registerSchema(schema: EventSchema): void {
    const key = `${schema.eventType}:${schema.version}`;
    this.schemas.set(key, schema);
    console.log(`Registered schema for ${schema.eventType} v${schema.version}`);
  }

  async validate<T>(eventType: string, event: DomainEvent<T>): Promise<void> {
    const key = `${eventType}:${event.eventVersion || 1}`;
    const schema = this.schemas.get(key);

    if (!schema) {
      // In production, this might be stricter
      console.warn(`No schema found for ${key}, allowing event`);
      return;
    }

    // Basic validation - in production, use a proper schema validator like Joi or Zod
    if (!event.aggregateId || !event.aggregateType || !event.eventType) {
      throw new Error('Event missing required fields');
    }

    // Additional schema validation would go here
  }

  getSchema(eventType: string, version: number = 1): EventSchema | undefined {
    return this.schemas.get(`${eventType}:${version}`);
  }

  private registerDefaultSchemas(): void {
    // Register common event schemas
    this.registerSchema({
      eventType: 'InventoryAllocated',
      version: 1,
      schema: {
        productId: 'string',
        quantity: 'number',
        channelId: 'string',
        orderId: 'string'
      }
    });

    this.registerSchema({
      eventType: 'StockLevelChanged',
      version: 1,
      schema: {
        productId: 'string',
        previousLevel: 'number',
        newLevel: 'number',
        changeReason: 'string'
      }
    });

    this.registerSchema({
      eventType: 'PurchaseOrderCreated',
      version: 1,
      schema: {
        orderId: 'string',
        supplierId: 'string',
        items: 'array',
        totalAmount: 'number'
      }
    });
  }
}