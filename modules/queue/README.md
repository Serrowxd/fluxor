# Queue Module

Multi-backend message queue module for Fluxor with advanced job processing capabilities.

## Features

- Multiple backend support (Redis, RabbitMQ, Kafka)
- Job scheduling and delayed execution
- Priority queues
- Job retries with exponential backoff
- Dead letter queue handling
- Progress tracking
- Distributed job processing
- Cron-based scheduling
- Metrics and monitoring

## Installation

```bash
npm install @fluxor/queue-module
```

## Usage

```javascript
const QueueModule = require('@fluxor/queue-module');

// Initialize with Redis backend
const queue = new QueueModule({
  backend: 'redis',
  host: 'localhost',
  port: 6379,
  defaultRetries: 3,
  defaultTimeout: 30000
});

await queue.initialize();

// Enqueue a job
const job = await queue.enqueue('email', {
  to: 'user@example.com',
  subject: 'Welcome',
  template: 'welcome'
});

// Process jobs
queue.process('email', async (job) => {
  console.log('Processing email:', job.data);
  
  // Update progress
  await job.progress(50);
  
  // Send email
  await sendEmail(job.data);
  
  await job.progress(100);
  return { sent: true };
});

// Process with concurrency
queue.process('image-resize', 5, async (job) => {
  const { input, output, size } = job.data;
  await resizeImage(input, output, size);
});

// Schedule jobs
await queue.enqueue('report', { type: 'daily' }, {
  delay: 60000 // 1 minute delay
});

// Priority jobs
await queue.enqueue('critical-task', data, {
  priority: 10 // Higher priority
});

// Cron scheduling
queue.schedule('cleanup', '0 0 * * *', {
  type: 'daily-cleanup'
});
```

## Backend Configuration

### Redis Backend

```javascript
const queue = new QueueModule({
  backend: 'redis',
  host: 'localhost',
  port: 6379,
  password: 'secret',
  db: 0,
  prefix: 'queue:'
});
```

### RabbitMQ Backend

```javascript
const queue = new QueueModule({
  backend: 'rabbitmq',
  url: 'amqp://localhost',
  username: 'guest',
  password: 'guest',
  vhost: '/',
  prefetch: 1,
  durable: true
});
```

### Kafka Backend

```javascript
const queue = new QueueModule({
  backend: 'kafka',
  brokers: ['localhost:9092'],
  clientId: 'fluxor-queue',
  consumerGroupId: 'fluxor-workers',
  ssl: true,
  sasl: {
    mechanism: 'plain',
    username: 'user',
    password: 'pass'
  }
});
```

## Job Options

```javascript
await queue.enqueue('task', data, {
  // Unique job ID
  id: 'unique-id',
  
  // Number of retry attempts
  retries: 5,
  
  // Job timeout in milliseconds
  timeout: 60000,
  
  // Delay before processing (ms)
  delay: 5000,
  
  // Job priority (higher = more important)
  priority: 5,
  
  // Custom metadata
  metadata: {
    userId: '123',
    source: 'api'
  }
});
```

## Processing Jobs

```javascript
// Simple processor
queue.process('simple', async (job) => {
  console.log('Processing:', job.data);
  return { result: 'done' };
});

// With error handling
queue.process('with-errors', async (job) => {
  try {
    const result = await riskyOperation(job.data);
    return result;
  } catch (error) {
    // Job will be retried based on retry settings
    throw error;
  }
});

// Progress tracking
queue.process('long-task', async (job) => {
  const items = job.data.items;
  
  for (let i = 0; i < items.length; i++) {
    await processItem(items[i]);
    await job.progress((i + 1) / items.length * 100);
  }
  
  return { processed: items.length };
});

// Logging
queue.process('with-logs', async (job) => {
  await job.log('Starting processing');
  
  const result = await process(job.data);
  
  await job.log(`Completed with result: ${result}`);
  return result;
});
```

## Queue Management

```javascript
// Get job by ID
const job = await queue.getJob('email', 'job-123');

// Get jobs by status
const pendingJobs = await queue.getJobs('email', 'pending', 100);
const failedJobs = await queue.getJobs('email', 'failed', 50);

// Remove a job
await queue.removeJob('email', 'job-123');

// Pause/resume queue
await queue.pauseQueue('email');
await queue.resumeQueue('email');

// Empty queue
const removedCount = await queue.emptyQueue('email');

// Get queue statistics
const stats = await queue.getQueueStats('email');
console.log(stats);
// {
//   pending: 10,
//   active: 2,
//   completed: 100,
//   failed: 5,
//   delayed: 3,
//   paused: false
// }

// Get global metrics
const metrics = await queue.getMetrics();
```

## Retry Strategies

```javascript
// Custom retry strategy
const queue = new QueueModule({
  retryStrategy: (attemptNumber) => {
    // Exponential backoff with jitter
    const baseDelay = 1000;
    const maxDelay = 60000;
    const exponentialDelay = Math.min(
      baseDelay * Math.pow(2, attemptNumber - 1),
      maxDelay
    );
    const jitter = Math.random() * 1000;
    return exponentialDelay + jitter;
  }
});

// Linear backoff
const linearBackoff = (attempt) => attempt * 5000;

// Fixed delay
const fixedDelay = () => 10000;
```

## Event Handling

```javascript
queue.on('ready', () => {
  console.log('Queue module ready');
});

queue.on('error', (error) => {
  console.error('Queue error:', error);
});

queue.on('job:enqueued', ({ queue, job }) => {
  console.log(`Job ${job.id} enqueued to ${queue}`);
});

queue.on('job:active', ({ queue, job }) => {
  console.log(`Job ${job.id} started in ${queue}`);
});

queue.on('job:completed', ({ queue, job }) => {
  console.log(`Job ${job.id} completed in ${queue}`);
});

queue.on('job:failed', ({ queue, job, error }) => {
  console.error(`Job ${job.id} failed in ${queue}:`, error);
});

queue.on('job:progress', ({ queue, jobId, progress }) => {
  console.log(`Job ${jobId} progress: ${progress}%`);
});
```

## Advanced Features

### Batch Processing

```javascript
// Enqueue multiple jobs
const jobs = await queue.enqueueMany('batch-task', [
  { data: { id: 1 } },
  { data: { id: 2 } },
  { data: { id: 3 } }
], {
  priority: 5
});
```

### Dead Letter Queue

```javascript
// Failed jobs automatically moved to DLQ
// Process dead letter queue
queue.process('email:dead', async (job) => {
  // Handle permanently failed jobs
  await notifyAdmin(job.metadata.originalQueue, job.lastError);
});
```

### Retry Failed Jobs

```javascript
// Retry all failed jobs
const retriedJobIds = await queue.retryFailed('email');

// Retry with filter
const retriedJobIds = await queue.retryFailed('email', {
  before: new Date('2024-01-01'),
  limit: 50
});
```

## Graceful Shutdown

```javascript
process.on('SIGTERM', async () => {
  console.log('Shutting down queue module...');
  await queue.shutdown();
  process.exit(0);
});
```