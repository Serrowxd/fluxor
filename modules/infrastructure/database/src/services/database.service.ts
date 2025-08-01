/**
 * Database Service
 * Manages PostgreSQL connections with pooling and query execution
 */

import { Pool, PoolClient, QueryResult, PoolConfig } from 'pg';
import { EventEmitter } from 'events';

export interface DatabaseConfig extends PoolConfig {
  enableSSL?: boolean;
  statementTimeout?: number;
  queryTimeout?: number;
}

export interface QueryOptions {
  client?: PoolClient;
  timeout?: number;
  logQuery?: boolean;
}

export class DatabaseService extends EventEmitter {
  private pool: Pool;
  private config: DatabaseConfig;
  private connected = false;

  constructor(config: DatabaseConfig) {
    super();
    this.config = {
      ...config,
      ssl: config.enableSSL ? { rejectUnauthorized: false } : false,
      statement_timeout: config.statementTimeout || 30000,
      query_timeout: config.queryTimeout || 30000,
    };
  }

  /**
   * Connect to the database
   */
  async connect(): Promise<void> {
    try {
      this.pool = new Pool(this.config);
      
      // Test connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      
      this.connected = true;
      this.emit('connected');
      console.log('Database connected successfully');
      
      // Setup pool error handling
      this.pool.on('error', (err) => {
        console.error('Unexpected error on idle database client', err);
        this.emit('error', err);
      });
    } catch (error) {
      console.error('Failed to connect to database:', error);
      throw error;
    }
  }

  /**
   * Disconnect from the database
   */
  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.connected = false;
      this.emit('disconnected');
      console.log('Database disconnected');
    }
  }

  /**
   * Execute a query
   */
  async query<T = any>(
    text: string,
    params?: any[],
    options?: QueryOptions
  ): Promise<QueryResult<T>> {
    const start = Date.now();
    const client = options?.client;

    try {
      if (options?.logQuery) {
        console.log('Executing query:', text, params);
      }

      let result: QueryResult<T>;
      
      if (client) {
        // Use provided client (for transactions)
        result = await client.query(text, params);
      } else {
        // Use pool
        result = await this.pool.query(text, params);
      }

      const duration = Date.now() - start;
      this.emit('query', { text, duration, rowCount: result.rowCount });
      
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.emit('queryError', { text, duration, error });
      throw error;
    }
  }

  /**
   * Execute a query and return the first row
   */
  async queryOne<T = any>(
    text: string,
    params?: any[],
    options?: QueryOptions
  ): Promise<T | null> {
    const result = await this.query<T>(text, params, options);
    return result.rows[0] || null;
  }

  /**
   * Execute a query and return all rows
   */
  async queryMany<T = any>(
    text: string,
    params?: any[],
    options?: QueryOptions
  ): Promise<T[]> {
    const result = await this.query<T>(text, params, options);
    return result.rows;
  }

  /**
   * Get a client from the pool
   */
  async getClient(): Promise<PoolClient> {
    return await this.pool.connect();
  }

  /**
   * Execute multiple queries in a batch
   */
  async batch(queries: Array<{ text: string; params?: any[] }>): Promise<QueryResult[]> {
    const client = await this.getClient();
    const results: QueryResult[] = [];

    try {
      await client.query('BEGIN');
      
      for (const query of queries) {
        const result = await client.query(query.text, query.params);
        results.push(result);
      }
      
      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check if a table exists
   */
  async tableExists(tableName: string, schema = 'public'): Promise<boolean> {
    const result = await this.queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = $1 
        AND table_name = $2
      )`,
      [schema, tableName]
    );
    
    return result?.exists || false;
  }

  /**
   * Create a new table
   */
  async createTable(
    tableName: string,
    columns: Record<string, string>,
    options?: {
      ifNotExists?: boolean;
      schema?: string;
      primaryKey?: string | string[];
      indexes?: Array<{ name: string; columns: string[]; unique?: boolean }>;
    }
  ): Promise<void> {
    const schema = options?.schema || 'public';
    const ifNotExists = options?.ifNotExists ? 'IF NOT EXISTS' : '';
    
    // Build column definitions
    const columnDefs = Object.entries(columns)
      .map(([name, type]) => `${name} ${type}`)
      .join(', ');
    
    // Add primary key if specified
    let primaryKeyDef = '';
    if (options?.primaryKey) {
      const pkColumns = Array.isArray(options.primaryKey) 
        ? options.primaryKey.join(', ')
        : options.primaryKey;
      primaryKeyDef = `, PRIMARY KEY (${pkColumns})`;
    }
    
    // Create table
    await this.query(
      `CREATE TABLE ${ifNotExists} ${schema}.${tableName} (${columnDefs}${primaryKeyDef})`
    );
    
    // Create indexes
    if (options?.indexes) {
      for (const index of options.indexes) {
        const unique = index.unique ? 'UNIQUE' : '';
        const indexColumns = index.columns.join(', ');
        await this.query(
          `CREATE ${unique} INDEX ${index.name} ON ${schema}.${tableName} (${indexColumns})`
        );
      }
    }
  }

  /**
   * Drop a table
   */
  async dropTable(tableName: string, options?: { cascade?: boolean; schema?: string }): Promise<void> {
    const schema = options?.schema || 'public';
    const cascade = options?.cascade ? 'CASCADE' : '';
    
    await this.query(`DROP TABLE IF EXISTS ${schema}.${tableName} ${cascade}`);
  }

  /**
   * Enable row-level security for multi-tenancy
   */
  async enableRLS(tableName: string, schema = 'public'): Promise<void> {
    await this.query(`ALTER TABLE ${schema}.${tableName} ENABLE ROW LEVEL SECURITY`);
  }

  /**
   * Create RLS policy
   */
  async createRLSPolicy(
    policyName: string,
    tableName: string,
    options: {
      command?: 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
      using?: string;
      withCheck?: string;
      schema?: string;
    }
  ): Promise<void> {
    const schema = options.schema || 'public';
    const command = options.command || 'ALL';
    
    let policyDef = `CREATE POLICY ${policyName} ON ${schema}.${tableName} FOR ${command}`;
    
    if (options.using) {
      policyDef += ` USING (${options.using})`;
    }
    
    if (options.withCheck) {
      policyDef += ` WITH CHECK (${options.withCheck})`;
    }
    
    await this.query(policyDef);
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get pool statistics
   */
  getPoolSize(): number {
    return this.pool?.totalCount || 0;
  }

  getActiveConnections(): number {
    return (this.pool?.totalCount || 0) - (this.pool?.idleCount || 0);
  }

  getIdleConnections(): number {
    return this.pool?.idleCount || 0;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Set runtime parameters
   */
  async setRuntimeParameter(parameter: string, value: string, client?: PoolClient): Promise<void> {
    const query = `SET ${parameter} = $1`;
    await this.query(query, [value], { client });
  }

  /**
   * Set tenant context for RLS
   */
  async setTenantContext(tenantId: string, client?: PoolClient): Promise<void> {
    await this.setRuntimeParameter('app.tenant_id', tenantId, client);
  }

  /**
   * Set user context for auditing
   */
  async setUserContext(userId: string, client?: PoolClient): Promise<void> {
    await this.setRuntimeParameter('app.user_id', userId, client);
  }
}