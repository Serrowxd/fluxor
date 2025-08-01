/**
 * Analytics Intelligence Module Types
 */

export interface KPI {
  id: string;
  name: string;
  value: number;
  unit: string;
  trend: 'up' | 'down' | 'stable';
  percentageChange: number;
  lastUpdated: Date;
  category: 'sales' | 'inventory' | 'operations' | 'financial';
}

export interface Dashboard {
  id: string;
  name: string;
  widgets: DashboardWidget[];
  createdBy: string;
  lastModified: Date;
  isDefault: boolean;
}

export interface DashboardWidget {
  id: string;
  type: 'chart' | 'metric' | 'table' | 'gauge';
  title: string;
  dataSource: string;
  config: WidgetConfig;
  position: { x: number; y: number; width: number; height: number };
}

export interface WidgetConfig {
  chartType?: 'line' | 'bar' | 'pie' | 'area';
  metrics?: string[];
  dimensions?: string[];
  filters?: Record<string, any>;
  timeRange?: TimeRange;
}

export interface TimeRange {
  start: Date;
  end: Date;
  granularity: 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
}

export interface Forecast {
  id: string;
  productId: string;
  warehouseId?: string;
  predictions: ForecastPrediction[];
  confidence: number;
  modelAccuracy: number;
  generatedAt: Date;
  validUntil: Date;
  factors: ForecastFactor[];
}

export interface ForecastPrediction {
  date: Date;
  quantity: number;
  confidenceInterval: {
    lower: number;
    upper: number;
  };
}

export interface ForecastFactor {
  name: string;
  impact: number;
  type: 'seasonal' | 'trend' | 'external' | 'promotional';
}

export interface Anomaly {
  id: string;
  type: 'inventory' | 'sales' | 'demand' | 'price';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  detectedAt: Date;
  affectedEntity: {
    type: 'product' | 'warehouse' | 'channel' | 'supplier';
    id: string;
    name: string;
  };
  metrics: AnomalyMetric[];
  suggestedActions: string[];
  isResolved: boolean;
}

export interface AnomalyMetric {
  name: string;
  expectedValue: number;
  actualValue: number;
  deviation: number;
  deviationPercentage: number;
}

export interface Report {
  id: string;
  name: string;
  type: 'inventory' | 'sales' | 'forecast' | 'performance' | 'custom';
  format: 'pdf' | 'excel' | 'csv' | 'json';
  schedule?: ReportSchedule;
  parameters: Record<string, any>;
  generatedAt?: Date;
  generatedBy: string;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  downloadUrl?: string;
}

export interface ReportSchedule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  dayOfWeek?: number;
  dayOfMonth?: number;
  time: string;
  recipients: string[];
  enabled: boolean;
}

export interface AnalyticsQuery {
  metrics: string[];
  dimensions?: string[];
  filters?: QueryFilter[];
  groupBy?: string[];
  orderBy?: OrderByClause[];
  limit?: number;
  timeRange?: TimeRange;
}

export interface QueryFilter {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'like';
  value: any;
}

export interface OrderByClause {
  field: string;
  direction: 'asc' | 'desc';
}

export interface AnalyticsResult {
  data: any[];
  metadata: {
    totalRows: number;
    executionTime: number;
    query: AnalyticsQuery;
  };
}

export interface ExportConfig {
  format: 'csv' | 'excel' | 'json' | 'parquet';
  includeHeaders: boolean;
  compression?: 'gzip' | 'zip';
  filters?: QueryFilter[];
  columns?: string[];
}

export interface PerformanceMetrics {
  inventoryTurnover: number;
  stockoutRate: number;
  overStockRate: number;
  orderFillRate: number;
  averageLeadTime: number;
  forecastAccuracy: number;
  costPerOrder: number;
  revenuePerSquareFoot?: number;
}