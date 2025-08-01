/**
 * Procurement Module Types
 */

export interface PurchaseOrder {
  id: string;
  orderNumber: string;
  supplierId: string;
  warehouseId: string;
  status: PurchaseOrderStatus;
  items: PurchaseOrderItem[];
  subtotal: number;
  tax: number;
  shipping: number;
  totalAmount: number;
  currency: string;
  paymentTerms: PaymentTerms;
  deliveryTerms: DeliveryTerms;
  expectedDeliveryDate: Date;
  actualDeliveryDate?: Date;
  notes?: string;
  attachments?: Attachment[];
  approvalStatus: ApprovalStatus;
  approvalHistory: ApprovalHistoryItem[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PurchaseOrderItem {
  id: string;
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  taxRate: number;
  discount?: number;
  receivedQuantity?: number;
  notes?: string;
}

export type PurchaseOrderStatus = 
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'sent'
  | 'acknowledged'
  | 'partially_received'
  | 'received'
  | 'completed'
  | 'cancelled';

export interface Supplier {
  id: string;
  code: string;
  name: string;
  type: 'manufacturer' | 'distributor' | 'wholesaler' | 'other';
  status: 'active' | 'inactive' | 'suspended';
  contact: SupplierContact;
  address: Address;
  taxId?: string;
  website?: string;
  paymentTerms: PaymentTerms;
  deliveryTerms: DeliveryTerms;
  minimumOrderValue?: number;
  leadTimeDays: number;
  products: string[]; // Product IDs
  certifications?: Certification[];
  performanceScore?: number;
  tags?: string[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SupplierContact {
  primaryContact: ContactPerson;
  alternateContacts?: ContactPerson[];
  accountingEmail?: string;
  orderEmail?: string;
}

export interface ContactPerson {
  name: string;
  title?: string;
  email: string;
  phone?: string;
  mobile?: string;
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
}

export interface PaymentTerms {
  code: string;
  description: string;
  netDays: number;
  discountPercent?: number;
  discountDays?: number;
}

export interface DeliveryTerms {
  incoterm: string;
  location?: string;
  responsibleParty: 'buyer' | 'seller';
}

export interface Certification {
  name: string;
  issuingBody: string;
  certificateNumber: string;
  validFrom: Date;
  validTo: Date;
  documentUrl?: string;
}

export interface ApprovalWorkflow {
  id: string;
  name: string;
  type: 'purchase_order' | 'supplier' | 'contract';
  status: 'active' | 'inactive';
  rules: ApprovalRule[];
  escalationRules?: EscalationRule[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ApprovalRule {
  id: string;
  sequence: number;
  condition: ApprovalCondition;
  approvers: Approver[];
  requiredApprovals: number;
  autoApprove?: boolean;
  timeoutHours?: number;
}

export interface ApprovalCondition {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'between';
  value: any;
  logicalOperator?: 'and' | 'or';
  nestedConditions?: ApprovalCondition[];
}

export interface Approver {
  type: 'user' | 'role' | 'manager' | 'dynamic';
  value: string;
  delegateToId?: string;
}

export interface EscalationRule {
  afterHours: number;
  escalateTo: Approver;
  notifyOriginalApprover: boolean;
}

export type ApprovalStatus = 
  | 'not_required'
  | 'pending'
  | 'partially_approved'
  | 'approved'
  | 'rejected'
  | 'expired';

export interface ApprovalHistoryItem {
  id: string;
  action: 'submitted' | 'approved' | 'rejected' | 'escalated' | 'delegated';
  userId: string;
  userName: string;
  timestamp: Date;
  comments?: string;
  ruleId?: string;
}

export interface ReorderRule {
  id: string;
  productId: string;
  warehouseId?: string;
  supplierId: string;
  enabled: boolean;
  reorderPoint: number;
  reorderQuantity: number;
  maxStock?: number;
  leadTimeDays: number;
  safetyStockDays?: number;
  autoCreate: boolean;
  requiresApproval: boolean;
  lastTriggered?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SupplierPerformance {
  supplierId: string;
  period: {
    start: Date;
    end: Date;
  };
  metrics: {
    onTimeDeliveryRate: number;
    qualityScore: number;
    priceCompetitiveness: number;
    communicationScore: number;
    overallScore: number;
  };
  statistics: {
    totalOrders: number;
    completedOrders: number;
    cancelledOrders: number;
    totalValue: number;
    averageLeadTime: number;
    defectRate: number;
  };
  trends: {
    scoreChange: number;
    deliveryImprovement: number;
    priceChange: number;
  };
  issues: PerformanceIssue[];
  calculatedAt: Date;
}

export interface PerformanceIssue {
  type: 'late_delivery' | 'quality_issue' | 'price_increase' | 'communication' | 'other';
  severity: 'low' | 'medium' | 'high';
  description: string;
  occurrences: number;
  lastOccurrence: Date;
  resolutionStatus?: 'open' | 'in_progress' | 'resolved';
}

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
  uploadedBy: string;
  uploadedAt: Date;
}

export interface PurchaseOrderTemplate {
  id: string;
  name: string;
  supplierId: string;
  items: Partial<PurchaseOrderItem>[];
  paymentTerms?: PaymentTerms;
  deliveryTerms?: DeliveryTerms;
  notes?: string;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SupplierPriceList {
  id: string;
  supplierId: string;
  productId: string;
  sku: string;
  unitPrice: number;
  currency: string;
  minimumQuantity?: number;
  volumeDiscounts?: VolumeDiscount[];
  validFrom: Date;
  validTo?: Date;
  lastUpdated: Date;
}

export interface VolumeDiscount {
  minQuantity: number;
  maxQuantity?: number;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
}

export interface Contract {
  id: string;
  contractNumber: string;
  supplierId: string;
  type: 'purchase' | 'service' | 'framework';
  status: 'draft' | 'active' | 'expired' | 'terminated';
  startDate: Date;
  endDate: Date;
  value?: number;
  currency?: string;
  terms: string;
  renewalTerms?: string;
  attachments: Attachment[];
  signatories: Signatory[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Signatory {
  name: string;
  title: string;
  party: 'buyer' | 'supplier';
  signedAt?: Date;
  signature?: string;
}