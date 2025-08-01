const Handlebars = require('handlebars');
const fs = require('fs').promises;
const path = require('path');

class TemplateService {
  constructor(config = {}) {
    this.config = config;
    this.templates = new Map();
    this.compiledTemplates = new Map();
    this.handlebars = Handlebars.create();
    
    // Register default helpers
    this.registerDefaultHelpers();
  }

  async initialize() {
    // Load templates from database or filesystem
    if (this.config.storage === 'database' && this.config.database) {
      await this.loadTemplatesFromDatabase();
    } else if (this.config.templateDir) {
      await this.loadTemplatesFromDirectory(this.config.templateDir);
    }

    // Register custom helpers
    if (this.config.helpers) {
      Object.entries(this.config.helpers).forEach(([name, helper]) => {
        this.handlebars.registerHelper(name, helper);
      });
    }
  }

  registerDefaultHelpers() {
    // Date formatting
    this.handlebars.registerHelper('formatDate', (date, format) => {
      const d = new Date(date);
      if (format === 'short') {
        return d.toLocaleDateString();
      }
      return d.toLocaleString();
    });

    // Currency formatting
    this.handlebars.registerHelper('currency', (amount, currency = 'USD') => {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency
      }).format(amount);
    });

    // Pluralization
    this.handlebars.registerHelper('pluralize', (count, singular, plural) => {
      return count === 1 ? singular : plural;
    });

    // Conditional helpers
    this.handlebars.registerHelper('eq', (a, b) => a === b);
    this.handlebars.registerHelper('ne', (a, b) => a !== b);
    this.handlebars.registerHelper('lt', (a, b) => a < b);
    this.handlebars.registerHelper('gt', (a, b) => a > b);
    this.handlebars.registerHelper('lte', (a, b) => a <= b);
    this.handlebars.registerHelper('gte', (a, b) => a >= b);

    // Array helpers
    this.handlebars.registerHelper('includes', (array, value) => {
      return Array.isArray(array) && array.includes(value);
    });

    // String helpers
    this.handlebars.registerHelper('capitalize', (str) => {
      return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
    });

    this.handlebars.registerHelper('truncate', (str, length = 50) => {
      if (!str || str.length <= length) return str;
      return str.substring(0, length) + '...';
    });
  }

  async loadTemplatesFromDatabase() {
    if (!this.config.database) {
      throw new Error('Database configuration required for database storage');
    }

    const query = 'SELECT * FROM notification_templates WHERE active = true';
    const result = await this.config.database.query(query);

    result.rows.forEach(template => {
      this.templates.set(template.id, {
        id: template.id,
        name: template.name,
        channel: template.channel,
        subject: template.subject,
        body: template.body,
        metadata: template.metadata || {}
      });
    });
  }

  async loadTemplatesFromDirectory(directory) {
    try {
      const files = await fs.readdir(directory);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(directory, file);
          const content = await fs.readFile(filePath, 'utf8');
          const template = JSON.parse(content);
          
          this.templates.set(template.id, template);
        }
      }
    } catch (error) {
      console.error('Error loading templates from directory:', error);
    }
  }

  async getTemplate(templateId) {
    // Check cache first
    if (this.templates.has(templateId)) {
      return this.templates.get(templateId);
    }

    // Try to load from database
    if (this.config.database) {
      const query = 'SELECT * FROM notification_templates WHERE id = $1 AND active = true';
      const result = await this.config.database.query(query, [templateId]);
      
      if (result.rows.length > 0) {
        const template = result.rows[0];
        this.templates.set(templateId, template);
        return template;
      }
    }

    throw new Error(`Template not found: ${templateId}`);
  }

  async renderTemplate(templateId, data = {}) {
    const template = await this.getTemplate(templateId);
    
    // Compile templates if not already compiled
    const subjectKey = `${templateId}_subject`;
    const bodyKey = `${templateId}_body`;
    
    if (!this.compiledTemplates.has(subjectKey)) {
      this.compiledTemplates.set(
        subjectKey,
        this.handlebars.compile(template.subject)
      );
    }
    
    if (!this.compiledTemplates.has(bodyKey)) {
      this.compiledTemplates.set(
        bodyKey,
        this.handlebars.compile(template.body)
      );
    }

    // Add default data
    const renderData = {
      ...this.config.defaultData,
      ...data,
      template: {
        id: template.id,
        name: template.name
      },
      timestamp: new Date()
    };

    // Render templates
    const rendered = {
      subject: this.compiledTemplates.get(subjectKey)(renderData),
      body: this.compiledTemplates.get(bodyKey)(renderData),
      channel: template.channel,
      metadata: template.metadata
    };

    // Post-process if configured
    if (this.config.postProcess) {
      return this.config.postProcess(rendered, template, data);
    }

    return rendered;
  }

  async createTemplate(template) {
    if (!this.config.database) {
      throw new Error('Database required for creating templates');
    }

    const query = `
      INSERT INTO notification_templates (
        id, name, channel, subject, body, metadata, active
      ) VALUES ($1, $2, $3, $4, $5, $6, true)
      RETURNING *
    `;

    const params = [
      template.id || this.generateTemplateId(template.name),
      template.name,
      template.channel,
      template.subject,
      template.body,
      JSON.stringify(template.metadata || {})
    ];

    const result = await this.config.database.query(query, params);
    const created = result.rows[0];
    
    // Update cache
    this.templates.set(created.id, created);
    
    return created;
  }

  async updateTemplate(templateId, updates) {
    if (!this.config.database) {
      throw new Error('Database required for updating templates');
    }

    const sets = [];
    const params = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      sets.push(`name = $${paramIndex}`);
      params.push(updates.name);
      paramIndex++;
    }

    if (updates.subject !== undefined) {
      sets.push(`subject = $${paramIndex}`);
      params.push(updates.subject);
      paramIndex++;
    }

    if (updates.body !== undefined) {
      sets.push(`body = $${paramIndex}`);
      params.push(updates.body);
      paramIndex++;
    }

    if (updates.metadata !== undefined) {
      sets.push(`metadata = $${paramIndex}`);
      params.push(JSON.stringify(updates.metadata));
      paramIndex++;
    }

    sets.push(`updated_at = CURRENT_TIMESTAMP`);

    const query = `
      UPDATE notification_templates 
      SET ${sets.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;
    params.push(templateId);

    const result = await this.config.database.query(query, params);
    const updated = result.rows[0];
    
    // Update cache
    this.templates.set(templateId, updated);
    
    // Clear compiled templates
    this.compiledTemplates.delete(`${templateId}_subject`);
    this.compiledTemplates.delete(`${templateId}_body`);
    
    return updated;
  }

  async deleteTemplate(templateId) {
    if (!this.config.database) {
      throw new Error('Database required for deleting templates');
    }

    // Soft delete
    const query = `
      UPDATE notification_templates 
      SET active = false, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `;

    await this.config.database.query(query, [templateId]);
    
    // Remove from cache
    this.templates.delete(templateId);
    this.compiledTemplates.delete(`${templateId}_subject`);
    this.compiledTemplates.delete(`${templateId}_body`);
  }

  generateTemplateId(name) {
    return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  }

  async validateTemplate(template) {
    const errors = [];

    // Required fields
    if (!template.name) {
      errors.push('Template name is required');
    }

    if (!template.channel) {
      errors.push('Template channel is required');
    }

    if (!template.subject) {
      errors.push('Template subject is required');
    }

    if (!template.body) {
      errors.push('Template body is required');
    }

    // Try to compile templates
    try {
      this.handlebars.compile(template.subject);
    } catch (error) {
      errors.push(`Invalid subject template: ${error.message}`);
    }

    try {
      this.handlebars.compile(template.body);
    } catch (error) {
      errors.push(`Invalid body template: ${error.message}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  clearCache() {
    this.templates.clear();
    this.compiledTemplates.clear();
  }
}

module.exports = TemplateService;