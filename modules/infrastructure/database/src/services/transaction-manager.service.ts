/**
 * Transaction Manager Service
 * Handles database transactions with proper isolation levels
 */

import { PoolClient } from 'pg';
import { DatabaseService } from './database.service';

export type IsolationLevel = 
  | 'READ UNCOMMITTED'
  | 'READ COMMITTED'
  | 'REPEATABLE READ'
  | 'SERIALIZABLE';

export interface TransactionOptions {
  isolationLevel?: IsolationLevel;
  readOnly?: boolean;
  deferrable?: boolean;
}

export interface Transaction {
  client: PoolClient;
  id: string;
  startTime: Date;
  options: TransactionOptions;
}

export class TransactionManager {
  private activeTransactions = new Map<string, Transaction>();
  
  constructor(private databaseService: DatabaseService) {}

  /**
   * Begin a new transaction
   */
  async begin(options?: TransactionOptions): Promise<Transaction> {
    const client = await this.databaseService.getClient();
    const id = this.generateTransactionId();
    const startTime = new Date();
    
    try {
      // Start transaction with options
      let beginQuery = 'BEGIN';
      
      if (options?.isolationLevel) {
        beginQuery += ` ISOLATION LEVEL ${options.isolationLevel}`;
      }
      
      if (options?.readOnly) {
        beginQuery += ' READ ONLY';
      }
      
      if (options?.deferrable) {
        beginQuery += ' DEFERRABLE';
      }
      
      await client.query(beginQuery);
      
      const transaction: Transaction = {
        client,
        id,
        startTime,
        options: options || {}
      };
      
      this.activeTransactions.set(id, transaction);
      
      return transaction;
    } catch (error) {
      client.release();
      throw error;
    }
  }

  /**
   * Commit a transaction
   */
  async commit(transaction: Transaction): Promise<void> {
    try {
      await transaction.client.query('COMMIT');
      this.activeTransactions.delete(transaction.id);
    } finally {
      transaction.client.release();
    }
  }

  /**
   * Rollback a transaction
   */
  async rollback(transaction: Transaction): Promise<void> {
    try {
      await transaction.client.query('ROLLBACK');
      this.activeTransactions.delete(transaction.id);
    } finally {
      transaction.client.release();
    }
  }

  /**
   * Create a savepoint
   */
  async savepoint(transaction: Transaction, name: string): Promise<void> {
    await transaction.client.query(`SAVEPOINT ${name}`);
  }

  /**
   * Rollback to a savepoint
   */
  async rollbackToSavepoint(transaction: Transaction, name: string): Promise<void> {
    await transaction.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
  }

  /**
   * Release a savepoint
   */
  async releaseSavepoint(transaction: Transaction, name: string): Promise<void> {
    await transaction.client.query(`RELEASE SAVEPOINT ${name}`);
  }

  /**
   * Execute a function within a transaction
   */
  async runInTransaction<T>(
    fn: (transaction: Transaction) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T> {
    const transaction = await this.begin(options);
    
    try {
      const result = await fn(transaction);
      await this.commit(transaction);
      return result;
    } catch (error) {
      await this.rollback(transaction);
      throw error;
    }
  }

  /**
   * Execute a function with automatic retry on serialization failure
   */
  async runWithRetry<T>(
    fn: (transaction: Transaction) => Promise<T>,
    options?: TransactionOptions & { maxRetries?: number; retryDelay?: number }
  ): Promise<T> {
    const maxRetries = options?.maxRetries || 3;
    const retryDelay = options?.retryDelay || 100;
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.runInTransaction(fn, options);
      } catch (error: any) {
        lastError = error;
        
        // Check if it's a serialization failure (40001) or deadlock (40P01)
        if (error.code === '40001' || error.code === '40P01') {
          if (attempt < maxRetries) {
            // Exponential backoff
            await this.delay(retryDelay * Math.pow(2, attempt - 1));
            continue;
          }
        }
        
        // For other errors, throw immediately
        throw error;
      }
    }
    
    throw lastError;
  }

  /**
   * Set transaction-level configuration
   */
  async setTransactionConfig(
    transaction: Transaction,
    config: Record<string, any>
  ): Promise<void> {
    for (const [key, value] of Object.entries(config)) {
      await transaction.client.query(`SET LOCAL ${key} = $1`, [value]);
    }
  }

  /**
   * Lock rows for update
   */
  async lockForUpdate(
    transaction: Transaction,
    table: string,
    where: Record<string, any>,
    options?: { nowait?: boolean; skipLocked?: boolean }
  ): Promise<any[]> {
    const whereClause = Object.keys(where)
      .map((col, index) => `${col} = $${index + 1}`)
      .join(' AND ');
    
    let query = `SELECT * FROM ${table} WHERE ${whereClause} FOR UPDATE`;
    
    if (options?.nowait) {
      query += ' NOWAIT';
    } else if (options?.skipLocked) {
      query += ' SKIP LOCKED';
    }
    
    const result = await transaction.client.query(query, Object.values(where));
    return result.rows;
  }

  /**
   * Advisory lock
   */
  async advisoryLock(
    transaction: Transaction,
    key: number | string,
    options?: { shared?: boolean; tryLock?: boolean }
  ): Promise<boolean> {
    const isShared = options?.shared ? 'share' : 'exclusive';
    const isTry = options?.tryLock ? 'try_' : '';
    
    let query: string;
    let params: any[];
    
    if (typeof key === 'number') {
      query = `SELECT pg_${isTry}advisory_lock${isShared === 'share' ? '_shared' : ''}($1)`;
      params = [key];
    } else {
      // Convert string to two integers for pg_advisory_lock
      const hash1 = this.hashString(key.substring(0, key.length / 2));
      const hash2 = this.hashString(key.substring(key.length / 2));
      query = `SELECT pg_${isTry}advisory_lock${isShared === 'share' ? '_shared' : ''}($1, $2)`;
      params = [hash1, hash2];
    }
    
    const result = await transaction.client.query(query, params);
    
    if (options?.tryLock) {
      return result.rows[0].pg_try_advisory_lock || false;
    }
    
    return true;
  }

  /**
   * Release advisory lock
   */
  async advisoryUnlock(
    transaction: Transaction,
    key: number | string,
    options?: { shared?: boolean }
  ): Promise<boolean> {
    const isShared = options?.shared ? '_shared' : '';
    
    let query: string;
    let params: any[];
    
    if (typeof key === 'number') {
      query = `SELECT pg_advisory_unlock${isShared}($1)`;
      params = [key];
    } else {
      const hash1 = this.hashString(key.substring(0, key.length / 2));
      const hash2 = this.hashString(key.substring(key.length / 2));
      query = `SELECT pg_advisory_unlock${isShared}($1, $2)`;
      params = [hash1, hash2];
    }
    
    const result = await transaction.client.query(query, params);
    return result.rows[0].pg_advisory_unlock || false;
  }

  /**
   * Get active transactions
   */
  getActiveTransactions(): Array<{
    id: string;
    duration: number;
    options: TransactionOptions;
  }> {
    const now = new Date();
    
    return Array.from(this.activeTransactions.entries()).map(([id, transaction]) => ({
      id,
      duration: now.getTime() - transaction.startTime.getTime(),
      options: transaction.options
    }));
  }

  /**
   * Kill long-running transactions
   */
  async killLongRunningTransactions(maxDurationMs: number): Promise<number> {
    const now = new Date();
    let killed = 0;
    
    for (const [id, transaction] of this.activeTransactions.entries()) {
      const duration = now.getTime() - transaction.startTime.getTime();
      
      if (duration > maxDurationMs) {
        try {
          await this.rollback(transaction);
          killed++;
        } catch (error) {
          console.error(`Failed to kill transaction ${id}:`, error);
        }
      }
    }
    
    return killed;
  }

  private generateTransactionId(): string {
    return `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}