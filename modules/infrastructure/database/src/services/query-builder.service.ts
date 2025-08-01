/**
 * Query Builder Service
 * Provides a fluent interface for building SQL queries
 */

export interface QueryCondition {
  column: string;
  operator: string;
  value: any;
  paramIndex?: number;
}

export interface JoinCondition {
  type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';
  table: string;
  on: string;
}

export class QueryBuilder {
  private table: string = '';
  private schema: string = 'public';
  private selectColumns: string[] = ['*'];
  private whereConditions: QueryCondition[] = [];
  private joinConditions: JoinCondition[] = [];
  private groupByColumns: string[] = [];
  private havingConditions: QueryCondition[] = [];
  private orderByColumns: Array<{ column: string; direction: 'ASC' | 'DESC' }> = [];
  private limitValue?: number;
  private offsetValue?: number;
  private paramCounter = 0;
  private params: any[] = [];

  /**
   * Start a SELECT query
   */
  select(columns?: string | string[]): QueryBuilder {
    const query = new QueryBuilder();
    if (columns) {
      query.selectColumns = Array.isArray(columns) ? columns : [columns];
    }
    return query;
  }

  /**
   * Specify the table
   */
  from(table: string, schema?: string): QueryBuilder {
    this.table = table;
    if (schema) {
      this.schema = schema;
    }
    return this;
  }

  /**
   * Add WHERE condition
   */
  where(column: string, operator: string, value?: any): QueryBuilder {
    if (value === undefined) {
      // Handle where('column', 'value') syntax
      value = operator;
      operator = '=';
    }
    
    this.paramCounter++;
    this.params.push(value);
    
    this.whereConditions.push({
      column,
      operator,
      value,
      paramIndex: this.paramCounter
    });
    
    return this;
  }

  /**
   * Add AND WHERE condition
   */
  andWhere(column: string, operator: string, value?: any): QueryBuilder {
    return this.where(column, operator, value);
  }

  /**
   * Add WHERE IN condition
   */
  whereIn(column: string, values: any[]): QueryBuilder {
    const placeholders = values.map(() => {
      this.paramCounter++;
      return `$${this.paramCounter}`;
    }).join(', ');
    
    this.params.push(...values);
    
    this.whereConditions.push({
      column,
      operator: 'IN',
      value: `(${placeholders})`,
      paramIndex: -1 // Special case for IN
    });
    
    return this;
  }

  /**
   * Add WHERE NULL condition
   */
  whereNull(column: string): QueryBuilder {
    this.whereConditions.push({
      column,
      operator: 'IS NULL',
      value: null,
      paramIndex: -1
    });
    
    return this;
  }

  /**
   * Add WHERE NOT NULL condition
   */
  whereNotNull(column: string): QueryBuilder {
    this.whereConditions.push({
      column,
      operator: 'IS NOT NULL',
      value: null,
      paramIndex: -1
    });
    
    return this;
  }

  /**
   * Add JOIN
   */
  join(table: string, on: string, type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' = 'INNER'): QueryBuilder {
    this.joinConditions.push({ type, table, on });
    return this;
  }

  /**
   * Add LEFT JOIN
   */
  leftJoin(table: string, on: string): QueryBuilder {
    return this.join(table, on, 'LEFT');
  }

  /**
   * Add RIGHT JOIN
   */
  rightJoin(table: string, on: string): QueryBuilder {
    return this.join(table, on, 'RIGHT');
  }

  /**
   * Add GROUP BY
   */
  groupBy(columns: string | string[]): QueryBuilder {
    this.groupByColumns = Array.isArray(columns) ? columns : [columns];
    return this;
  }

  /**
   * Add HAVING condition
   */
  having(column: string, operator: string, value: any): QueryBuilder {
    this.paramCounter++;
    this.params.push(value);
    
    this.havingConditions.push({
      column,
      operator,
      value,
      paramIndex: this.paramCounter
    });
    
    return this;
  }

  /**
   * Add ORDER BY
   */
  orderBy(column: string, direction: 'ASC' | 'DESC' = 'ASC'): QueryBuilder {
    this.orderByColumns.push({ column, direction });
    return this;
  }

  /**
   * Set LIMIT
   */
  limit(value: number): QueryBuilder {
    this.limitValue = value;
    return this;
  }

  /**
   * Set OFFSET
   */
  offset(value: number): QueryBuilder {
    this.offsetValue = value;
    return this;
  }

  /**
   * Build INSERT query
   */
  insert(table: string, data: Record<string, any>, schema?: string): { text: string; params: any[] } {
    const actualSchema = schema || this.schema;
    const columns = Object.keys(data);
    const values = Object.values(data);
    
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    
    const text = `INSERT INTO ${actualSchema}.${table} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`;
    
    return { text, params: values };
  }

  /**
   * Build UPDATE query
   */
  update(
    table: string,
    data: Record<string, any>,
    where: Record<string, any>,
    schema?: string
  ): { text: string; params: any[] } {
    const actualSchema = schema || this.schema;
    const setColumns = Object.keys(data);
    const setValues = Object.values(data);
    const whereColumns = Object.keys(where);
    const whereValues = Object.values(where);
    
    let paramIndex = 0;
    const setClauses = setColumns.map(col => {
      paramIndex++;
      return `${col} = $${paramIndex}`;
    }).join(', ');
    
    const whereClauses = whereColumns.map(col => {
      paramIndex++;
      return `${col} = $${paramIndex}`;
    }).join(' AND ');
    
    const text = `UPDATE ${actualSchema}.${table} SET ${setClauses} WHERE ${whereClauses} RETURNING *`;
    
    return { text, params: [...setValues, ...whereValues] };
  }

  /**
   * Build DELETE query
   */
  delete(table: string, where: Record<string, any>, schema?: string): { text: string; params: any[] } {
    const actualSchema = schema || this.schema;
    const whereColumns = Object.keys(where);
    const whereValues = Object.values(where);
    
    const whereClauses = whereColumns.map((col, index) => `${col} = $${index + 1}`).join(' AND ');
    
    const text = `DELETE FROM ${actualSchema}.${table} WHERE ${whereClauses} RETURNING *`;
    
    return { text, params: whereValues };
  }

  /**
   * Build the SELECT query
   */
  build(): { text: string; params: any[] } {
    if (!this.table) {
      throw new Error('Table not specified');
    }
    
    let query = `SELECT ${this.selectColumns.join(', ')} FROM ${this.schema}.${this.table}`;
    
    // Add JOINs
    for (const join of this.joinConditions) {
      query += ` ${join.type} JOIN ${join.table} ON ${join.on}`;
    }
    
    // Add WHERE
    if (this.whereConditions.length > 0) {
      const whereClauses = this.whereConditions.map(condition => {
        if (condition.paramIndex === -1) {
          // Special cases like IN, IS NULL
          if (condition.operator === 'IN') {
            return `${condition.column} ${condition.operator} ${condition.value}`;
          } else {
            return `${condition.column} ${condition.operator}`;
          }
        }
        return `${condition.column} ${condition.operator} $${condition.paramIndex}`;
      });
      
      query += ` WHERE ${whereClauses.join(' AND ')}`;
    }
    
    // Add GROUP BY
    if (this.groupByColumns.length > 0) {
      query += ` GROUP BY ${this.groupByColumns.join(', ')}`;
    }
    
    // Add HAVING
    if (this.havingConditions.length > 0) {
      const havingClauses = this.havingConditions.map(condition => 
        `${condition.column} ${condition.operator} $${condition.paramIndex}`
      );
      
      query += ` HAVING ${havingClauses.join(' AND ')}`;
    }
    
    // Add ORDER BY
    if (this.orderByColumns.length > 0) {
      const orderClauses = this.orderByColumns.map(order => 
        `${order.column} ${order.direction}`
      );
      
      query += ` ORDER BY ${orderClauses.join(', ')}`;
    }
    
    // Add LIMIT
    if (this.limitValue !== undefined) {
      query += ` LIMIT ${this.limitValue}`;
    }
    
    // Add OFFSET
    if (this.offsetValue !== undefined) {
      query += ` OFFSET ${this.offsetValue}`;
    }
    
    return { text: query, params: this.params };
  }

  /**
   * Build a raw query with parameter substitution
   */
  static raw(text: string, params?: any[]): { text: string; params: any[] } {
    return { text, params: params || [] };
  }

  /**
   * Escape identifier (table/column name)
   */
  static escapeIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  /**
   * Build pagination query
   */
  paginate(page: number, perPage: number): QueryBuilder {
    const offset = (page - 1) * perPage;
    return this.limit(perPage).offset(offset);
  }
}