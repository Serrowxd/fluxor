/**
 * Migration Service
 * Handles database schema migrations
 */

import { DatabaseService } from './database.service';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface Migration {
  id: number;
  name: string;
  up: string;
  down: string;
  checksum: string;
}

export interface MigrationRecord {
  id: number;
  name: string;
  checksum: string;
  executed_at: Date;
  execution_time_ms: number;
}

export class MigrationService {
  private migrationsTable = 'schema_migrations';
  private migrationsPath: string;

  constructor(
    private databaseService: DatabaseService,
    migrationsPath: string = path.join(process.cwd(), 'migrations')
  ) {
    this.migrationsPath = migrationsPath;
  }

  /**
   * Initialize migrations table
   */
  async initialize(): Promise<void> {
    const tableExists = await this.databaseService.tableExists(this.migrationsTable);
    
    if (!tableExists) {
      await this.databaseService.query(`
        CREATE TABLE ${this.migrationsTable} (
          id INTEGER PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          checksum VARCHAR(64) NOT NULL,
          executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          execution_time_ms INTEGER NOT NULL,
          UNIQUE(name)
        )
      `);
      
      // Create index on executed_at for performance
      await this.databaseService.query(`
        CREATE INDEX idx_migrations_executed_at 
        ON ${this.migrationsTable}(executed_at DESC)
      `);
    }
  }

  /**
   * Run all pending migrations
   */
  async up(steps?: number): Promise<MigrationRecord[]> {
    await this.initialize();
    
    const pending = await this.getPendingMigrations();
    const toRun = steps ? pending.slice(0, steps) : pending;
    const executed: MigrationRecord[] = [];
    
    for (const migration of toRun) {
      console.log(`Running migration: ${migration.name}`);
      
      const start = Date.now();
      
      try {
        // Execute migration in a transaction
        const client = await this.databaseService.getClient();
        
        try {
          await client.query('BEGIN');
          
          // Execute the up migration
          await client.query(migration.up);
          
          // Record the migration
          await client.query(
            `INSERT INTO ${this.migrationsTable} (id, name, checksum, execution_time_ms) 
             VALUES ($1, $2, $3, $4)`,
            [
              migration.id,
              migration.name,
              migration.checksum,
              Date.now() - start
            ]
          );
          
          await client.query('COMMIT');
          
          executed.push({
            id: migration.id,
            name: migration.name,
            checksum: migration.checksum,
            executed_at: new Date(),
            execution_time_ms: Date.now() - start
          });
          
          console.log(`✓ Migration ${migration.name} completed in ${Date.now() - start}ms`);
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      } catch (error) {
        console.error(`✗ Migration ${migration.name} failed:`, error);
        throw new Error(`Migration ${migration.name} failed: ${error.message}`);
      }
    }
    
    return executed;
  }

  /**
   * Rollback migrations
   */
  async down(steps: number = 1): Promise<MigrationRecord[]> {
    await this.initialize();
    
    const executed = await this.getExecutedMigrations();
    const toRollback = executed.slice(0, steps);
    const rolledBack: MigrationRecord[] = [];
    
    for (const record of toRollback) {
      const migration = await this.loadMigration(record.name);
      
      if (!migration) {
        throw new Error(`Migration file not found: ${record.name}`);
      }
      
      console.log(`Rolling back migration: ${migration.name}`);
      
      const start = Date.now();
      
      try {
        // Execute rollback in a transaction
        const client = await this.databaseService.getClient();
        
        try {
          await client.query('BEGIN');
          
          // Execute the down migration
          await client.query(migration.down);
          
          // Remove the migration record
          await client.query(
            `DELETE FROM ${this.migrationsTable} WHERE name = $1`,
            [migration.name]
          );
          
          await client.query('COMMIT');
          
          rolledBack.push(record);
          
          console.log(`✓ Rolled back ${migration.name} in ${Date.now() - start}ms`);
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      } catch (error) {
        console.error(`✗ Rollback of ${migration.name} failed:`, error);
        throw new Error(`Rollback of ${migration.name} failed: ${error.message}`);
      }
    }
    
    return rolledBack;
  }

  /**
   * Get migration status
   */
  async status(): Promise<{
    executed: MigrationRecord[];
    pending: Migration[];
  }> {
    await this.initialize();
    
    const executed = await this.getExecutedMigrations();
    const pending = await this.getPendingMigrations();
    
    return { executed, pending };
  }

  /**
   * Create a new migration file
   */
  async create(name: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
    const id = parseInt(timestamp);
    const fileName = `${timestamp}_${name.toLowerCase().replace(/\s+/g, '_')}.sql`;
    const filePath = path.join(this.migrationsPath, fileName);
    
    const template = `-- Migration: ${name}
-- Created: ${new Date().toISOString()}

-- UP
-- Add your forward migration here

-- DOWN
-- Add your rollback migration here
`;
    
    await fs.mkdir(this.migrationsPath, { recursive: true });
    await fs.writeFile(filePath, template);
    
    console.log(`Created migration: ${filePath}`);
    
    return filePath;
  }

  /**
   * Get pending migrations
   */
  private async getPendingMigrations(): Promise<Migration[]> {
    const allMigrations = await this.loadAllMigrations();
    const executed = await this.getExecutedMigrations();
    const executedNames = new Set(executed.map(m => m.name));
    
    return allMigrations
      .filter(m => !executedNames.has(m.name))
      .sort((a, b) => a.id - b.id);
  }

  /**
   * Get executed migrations
   */
  private async getExecutedMigrations(): Promise<MigrationRecord[]> {
    const result = await this.databaseService.query<MigrationRecord>(
      `SELECT * FROM ${this.migrationsTable} ORDER BY executed_at DESC`
    );
    
    return result.rows;
  }

  /**
   * Load all migrations from disk
   */
  private async loadAllMigrations(): Promise<Migration[]> {
    try {
      const files = await fs.readdir(this.migrationsPath);
      const sqlFiles = files.filter(f => f.endsWith('.sql'));
      
      const migrations: Migration[] = [];
      
      for (const file of sqlFiles) {
        const migration = await this.loadMigration(file);
        if (migration) {
          migrations.push(migration);
        }
      }
      
      return migrations.sort((a, b) => a.id - b.id);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Load a single migration
   */
  private async loadMigration(fileName: string): Promise<Migration | null> {
    const filePath = path.join(this.migrationsPath, fileName);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const name = path.basename(fileName, '.sql');
      
      // Extract ID from filename (assuming format: YYYYMMDDHHMMSS_name.sql)
      const idMatch = fileName.match(/^(\d+)_/);
      if (!idMatch) {
        console.warn(`Invalid migration filename format: ${fileName}`);
        return null;
      }
      
      const id = parseInt(idMatch[1]);
      
      // Parse UP and DOWN sections
      const upMatch = content.match(/--\s*UP\s*\n([\s\S]*?)(?:--\s*DOWN|$)/i);
      const downMatch = content.match(/--\s*DOWN\s*\n([\s\S]*?)$/i);
      
      if (!upMatch) {
        console.warn(`No UP section found in migration: ${fileName}`);
        return null;
      }
      
      const up = upMatch[1].trim();
      const down = downMatch ? downMatch[1].trim() : '';
      
      // Calculate checksum
      const checksum = this.calculateChecksum(content);
      
      return { id, name, up, down, checksum };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Calculate checksum for migration content
   */
  private calculateChecksum(content: string): string {
    // Simple checksum using Node's crypto
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Validate migration checksums
   */
  async validate(): Promise<{ valid: boolean; errors: string[] }> {
    const executed = await this.getExecutedMigrations();
    const errors: string[] = [];
    
    for (const record of executed) {
      const migration = await this.loadMigration(record.name + '.sql');
      
      if (!migration) {
        errors.push(`Migration file missing: ${record.name}`);
        continue;
      }
      
      if (migration.checksum !== record.checksum) {
        errors.push(`Checksum mismatch for ${record.name}: expected ${record.checksum}, got ${migration.checksum}`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Reset database (dangerous!)
   */
  async reset(): Promise<void> {
    console.warn('⚠️  Resetting database - this will drop all tables!');
    
    // Get all tables except system tables
    const tables = await this.databaseService.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables 
       WHERE schemaname = 'public' 
       AND tablename NOT IN ('schema_migrations')`
    );
    
    // Drop all tables
    for (const { tablename } of tables.rows) {
      await this.databaseService.dropTable(tablename, { cascade: true });
      console.log(`Dropped table: ${tablename}`);
    }
    
    // Clear migrations table
    await this.databaseService.query(`TRUNCATE TABLE ${this.migrationsTable}`);
    
    console.log('Database reset complete');
  }
}