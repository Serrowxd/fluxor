# Order Management Module

Complete order lifecycle management module for Fluxor with fulfillment, returns, and payment/shipping integrations.

## Features

- Complete order lifecycle management
- Order saga orchestration
- Fulfillment workflow (pick, pack, ship)
- Returns management (RMA)
- Payment integration abstraction
- Shipping integration abstraction
- Inventory allocation
- Multi-warehouse support
- Real-time status tracking

## Installation

```bash
npm install @fluxor/order-management-module
```

## Usage

```javascript
const OrderManagementModule = require('@fluxor/order-management-module');

// Initialize with dependencies
const orderManagement = new OrderManagementModule({
  orderPrefix: 'ORD',
  returnPrefix: 'RMA',
  autoAllocateInventory: true,
  autoCalculateTaxes: true,
  requirePaymentBeforeFulfillment: true,
  enablePartialFulfillment: false,
  returnWindow: 30 // days
});

await orderManagement.initialize({
  eventBus: eventBusInstance,
  database: databaseInstance,
  inventory: inventoryInstance,
  cache: cacheInstance,
  queue: queueInstance
});

// Create an order
const order = await orderManagement.createOrder({
  customerId: 'cust_123',
  items: [
    {
      productId: 'prod_456',
      variantId: 'var_789',
      quantity: 2,
      price: 29.99
    }
  ],
  shippingAddress: {
    name: 'John Doe',
    street1: '123 Main St',
    city: 'New York',
    state: 'NY',
    postalCode: '10001',
    country: 'US'
  },
  billingAddress: { /* ... */ },
  paymentMethod: 'credit_card',
  shippingMethod: 'standard'
});

// Process payment
const payment = await orderManagement.processPayment(order.id, {
  token: 'tok_visa',
  saveMethod: true
});

// Start fulfillment
const fulfillment = await orderManagement.startFulfillment(order.id);

// Pick items
await orderManagement.pickItems(fulfillment.id, [
  {
    productId: 'prod_456',
    quantity: 2,
    binLocation: 'A-12-3',
    pickedBy: 'user_123'
  }
]);

// Pack order
const { shippingLabel } = await orderManagement.packOrder(fulfillment.id, {
  packedBy: 'user_456',
  boxes: [
    {
      type: 'medium_box',
      weight: 2.5,
      items: ['prod_456']
    }
  ]
});

// Ship order
await orderManagement.shipOrder(fulfillment.id);
```

## Order Lifecycle

### Order States

- `pending`: Order created, awaiting confirmation
- `confirmed`: Payment authorized/received
- `processing`: Order being prepared
- `fulfilling`: In fulfillment process
- `shipped`: Order shipped
- `delivered`: Order delivered
- `completed`: Order completed
- `cancelled`: Order cancelled
- `refunded`: Order refunded

### Status Transitions

```
pending → confirmed → processing → fulfilling → shipped → delivered → completed
   ↓         ↓           ↓            ↓           ↓
cancelled  cancelled  cancelled   cancelled   returned → refunded
```

## Fulfillment Workflow

### Fulfillment States

- `pending`: Awaiting assignment
- `assigned`: Assigned to picker
- `picking`: Items being picked
- `ready_to_pack`: All items picked
- `packed`: Order packed
- `ready_to_ship`: Label created
- `shipped`: Shipped
- `delivered`: Delivered

### Fulfillment Process

```javascript
// 1. Create fulfillment
const fulfillment = await orderManagement.startFulfillment(orderId, {
  warehouseId: 'wh_123', // Optional, auto-selected if not provided
  priority: 2 // 1-5, affects picking queue
});

// 2. Assign picker (usually automated)
await orderManagement.services.fulfillment.assignPicker(
  fulfillment.id,
  'picker_123'
);

// 3. Pick items
await orderManagement.pickItems(fulfillment.id, [
  {
    productId: 'prod_123',
    quantity: 1,
    binLocation: 'A-15-2',
    pickedBy: 'picker_123',
    serialNumbers: ['SN12345'] // For serialized items
  }
]);

// 4. Pack order
const packResult = await orderManagement.packOrder(fulfillment.id, {
  packedBy: 'packer_456',
  photos: [
    { url: 'https://...', type: 'before_packing' },
    { url: 'https://...', type: 'after_packing' }
  ]
});

// 5. Ship order
await orderManagement.shipOrder(fulfillment.id);
```

## Returns Management

### Return Process

```javascript
// 1. Initiate return
const rma = await orderManagement.initiateReturn(orderId, {
  reason: 'defective',
  reasonDetails: 'Product not working as expected',
  items: [
    {
      productId: 'prod_123',
      quantity: 1,
      reason: 'defective'
    }
  ],
  images: [
    { url: 'https://...', type: 'damage' }
  ],
  shippingMethod: 'prepaid_label' // or 'customer_ship'
});

// 2. Process return (after approval)
await orderManagement.processReturn(rma.id, {
  type: 'approve',
  approvedBy: 'admin_123',
  notes: 'Return approved'
});

// 3. Receive returned items
await orderManagement.processReturn(rma.id, {
  type: 'receive',
  receivedBy: 'warehouse_user',
  trackingNumber: 'RET123456',
  receivedItems: [
    {
      productId: 'prod_123',
      quantity: 1,
      condition: 'damaged'
    }
  ]
});

// 4. Inspect items
await orderManagement.processReturn(rma.id, {
  type: 'inspect',
  inspectedBy: 'qa_user',
  passed: true,
  results: [
    {
      productId: 'prod_123',
      quantity: 1,
      condition: 'defective',
      restockable: false,
      refundPercentage: 100,
      notes: 'Confirmed defective'
    }
  ]
});

// 5. Complete return
await orderManagement.processReturn(rma.id, {
  type: 'complete',
  completedBy: 'admin_123',
  resolutionType: 'refund',
  refundAmount: 29.99
});
```

### Return Reasons

- `defective`: Product defect
- `damaged`: Damaged in shipping
- `wrong_item`: Wrong item sent
- `not_as_described`: Not as described
- `changed_mind`: Customer changed mind
- `found_better_price`: Found better price
- `no_longer_needed`: No longer needed

## Payment Integration

### Supported Providers

- Stripe
- PayPal
- Manual (Bank Transfer, Invoice)

### Payment Flow

```javascript
// Process payment
const payment = await orderManagement.processPayment(orderId, {
  method: 'credit_card',
  token: 'tok_visa', // From Stripe.js
  saveMethod: true
});

// Handle 3D Secure or other actions
if (payment.requiresAction) {
  // Redirect customer to complete action
  // Then confirm payment after action completed
}

// Refund payment
const refund = await orderManagement.integrations.payment.refund(
  payment.transactionId,
  15.00, // Partial refund
  'Customer request'
);
```

### Webhook Handling

```javascript
// Handle payment webhooks
app.post('/webhooks/stripe', async (req, res) => {
  const result = await orderManagement.integrations.payment.handleWebhook(
    'stripe',
    req.body,
    req.headers['stripe-signature']
  );
  res.json(result);
});
```

## Shipping Integration

### Supported Carriers

- UPS
- FedEx
- USPS
- DHL

### Shipping Features

```javascript
// Calculate shipping rates
const rates = await orderManagement.integrations.shipping.calculateRates({
  origin: warehouseAddress,
  destination: customerAddress,
  packages: [
    { weight: 2.5, dimensions: { length: 12, width: 10, height: 5 } }
  ]
});

// Create shipping label
const label = await orderManagement.integrations.shipping.createLabel(fulfillment);

// Track shipment
const tracking = await orderManagement.integrations.shipping.getTracking(
  'track123',
  'ups'
);

// Schedule pickup
const pickup = await orderManagement.integrations.shipping.schedulePickup({
  carrier: 'ups',
  date: '2024-01-20',
  timeWindow: '10:00-14:00',
  address: warehouseAddress,
  packages: [{ trackingNumber: 'track123' }]
});

// Validate address
const validation = await orderManagement.integrations.shipping.validateAddress({
  street1: '123 Main St',
  city: 'New York',
  state: 'NY',
  postalCode: '10001',
  country: 'US'
});
```

## Order Saga

The order saga orchestrates the complete order flow with automatic compensation on failure:

```javascript
// Saga steps:
1. Validate order
2. Reserve inventory
3. Calculate final pricing
4. Process payment
5. Confirm order
6. Send notifications
7. Initiate fulfillment

// Automatic compensation on failure:
- Release inventory reservations
- Refund payments
- Cancel fulfillment
- Send failure notifications
```

## Events

```javascript
// Order events
orderManagement.on('order:created', ({ orderId, order }) => {});
orderManagement.on('order:updated', ({ orderId, updates }) => {});
orderManagement.on('order:cancelled', ({ orderId, reason }) => {});
orderManagement.on('order:payment:completed', ({ orderId, payment }) => {});
orderManagement.on('order:shipped', ({ orderId, tracking }) => {});

// Fulfillment events
orderManagement.on('fulfillment:created', ({ fulfillmentId, orderId }) => {});
orderManagement.on('fulfillment:items:picked', ({ fulfillmentId, items }) => {});
orderManagement.on('fulfillment:packed', ({ fulfillmentId, packages }) => {});
orderManagement.on('fulfillment:shipped', ({ fulfillmentId, tracking }) => {});

// Return events
orderManagement.on('return:created', ({ rmaId, orderId }) => {});
orderManagement.on('return:approved', ({ rmaId }) => {});
orderManagement.on('return:completed', ({ rmaId, resolution }) => {});
```

## Metrics and Reporting

```javascript
// Get order metrics
const metrics = await orderManagement.getOrderMetrics('30d');
console.log(metrics);
// {
//   orders: {
//     totalOrders: 1250,
//     completedOrders: 1180,
//     cancelledOrders: 45,
//     averageOrderValue: 85.50,
//     conversionRate: 94.4
//   },
//   fulfillment: {
//     averageTime: 28.5, // hours
//     completionRate: 98.2
//   },
//   returns: {
//     returnRate: 3.2,
//     averageRefund: 45.00
//   }
// }

// Search orders
const orders = await orderManagement.searchOrders({
  status: ['pending', 'processing'],
  dateFrom: '2024-01-01',
  customerId: 'cust_123',
  search: 'blue widget'
});
```

## Configuration

```javascript
const orderManagement = new OrderManagementModule({
  // Order settings
  orderPrefix: 'ORD',              // Order number prefix
  autoAllocateInventory: true,     // Auto-allocate on order creation
  autoCalculateTaxes: true,        // Calculate taxes automatically
  
  // Fulfillment settings
  requirePaymentBeforeFulfillment: true,
  enablePartialFulfillment: false,
  autoStartFulfillment: true,
  
  // Return settings
  returnPrefix: 'RMA',
  returnWindow: 30,                // Days
  
  // Shipping settings
  defaultWarehouseId: 'wh_main',
  requireSignature: false,
  
  // Payment settings
  capturePaymentOnShipment: false
});
```