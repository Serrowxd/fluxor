const fs = require('fs');
const path = require('path');
const db = require('../../config/database');

class MigrationRunner {
  constructor() {
    this.migrationsPath = path.join(__dirname, '../migrations');
  }

  async init() {
    // Create migrations tracking table
    await db.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        migration_name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async getExecutedMigrations() {
    const result = await db.query(
      'SELECT migration_name FROM schema_migrations ORDER BY id'
    );
    return result.rows.map(row => row.migration_name);
  }

  async getPendingMigrations() {
    const allMigrations = this.getAllMigrationFiles();
    const executedMigrations = await this.getExecutedMigrations();
    
    return allMigrations.filter(migration => 
      !executedMigrations.includes(migration)
    );
  }

  getAllMigrationFiles() {
    if (!fs.existsSync(this.migrationsPath)) {
      return [];
    }

    return fs.readdirSync(this.migrationsPath)
      .filter(file => file.endsWith('.js'))
      .sort()
      .map(file => file.replace('.js', ''));
  }

  async runMigrations() {
    await this.init();
    
    const pendingMigrations = await this.getPendingMigrations();
    
    if (pendingMigrations.length === 0) {
      console.log('No pending migrations found.');
      return;
    }

    console.log(`Running ${pendingMigrations.length} pending migrations...`);

    for (const migrationName of pendingMigrations) {
      try {
        console.log(`\nExecuting migration: ${migrationName}`);
        
        const migrationPath = path.join(this.migrationsPath, `${migrationName}.js`);
        const migration = require(migrationPath);
        
        // Run the migration
        await migration.up();
        
        // Record successful execution
        await db.query(
          'INSERT INTO schema_migrations (migration_name) VALUES ($1)',
          [migrationName]
        );
        
        console.log(`✓ Migration ${migrationName} completed successfully`);
      } catch (error) {
        console.error(`✗ Migration ${migrationName} failed:`, error.message);
        throw error;
      }
    }

    console.log('\nAll migrations completed successfully!');
  }

  async rollback(migrationName) {
    await this.init();
    
    const executedMigrations = await this.getExecutedMigrations();
    
    if (!executedMigrations.includes(migrationName)) {
      throw new Error(`Migration ${migrationName} has not been executed`);
    }

    try {
      console.log(`Rolling back migration: ${migrationName}`);
      
      const migrationPath = path.join(this.migrationsPath, `${migrationName}.js`);
      const migration = require(migrationPath);
      
      // Run rollback
      await migration.down();
      
      // Remove from executed migrations
      await db.query(
        'DELETE FROM schema_migrations WHERE migration_name = $1',
        [migrationName]
      );
      
      console.log(`✓ Migration ${migrationName} rolled back successfully`);
    } catch (error) {
      console.error(`✗ Rollback of ${migrationName} failed:`, error.message);
      throw error;
    }
  }

  async getStatus() {
    await this.init();
    
    const allMigrations = this.getAllMigrationFiles();
    const executedMigrations = await this.getExecutedMigrations();
    
    console.log('\nMigration Status:');
    console.log('================');
    
    allMigrations.forEach(migration => {
      const status = executedMigrations.includes(migration) ? '✓ Executed' : '✗ Pending';
      console.log(`${status} ${migration}`);
    });
    
    const pendingCount = allMigrations.length - executedMigrations.length;
    console.log(`\nTotal: ${allMigrations.length} migrations, ${pendingCount} pending`);
  }
}

module.exports = MigrationRunner;