const EventEmitter = require('events');
const BackendFactory = require('./backends/BackendFactory');

class QueueModule extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      backend: options.backend || 'redis',
      prefix: options.prefix || 'fluxor:queue:',
      defaultQueue: options.defaultQueue || 'default',
      defaultRetries: options.defaultRetries || 3,
      defaultTimeout: options.defaultTimeout || 30000,
      defaultDelay: options.defaultDelay || 0,
      retryStrategy: options.retryStrategy || this._defaultRetryStrategy,
      ...options
    };

    this.backend = null;
    this.queues = new Map();
    this.processors = new Map();
    this.isInitialized = false;
    this.metrics = {
      processed: 0,
      failed: 0,
      delayed: 0,
      active: 0
    };
  }

  async initialize() {
    try {
      this.backend = await BackendFactory.create(this.options.backend, this.options);
      await this.backend.connect();
      
      this.isInitialized = true;
      this.emit('ready');
      
      this._startMetricsCollection();
      
      return this;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  async createQueue(name, options = {}) {
    if (!this.isInitialized) {
      throw new Error('Queue module not initialized');
    }

    const queueOptions = {
      ...this.options,
      ...options,
      name
    };

    const queue = await this.backend.createQueue(name, queueOptions);
    this.queues.set(name, queue);
    
    return queue;
  }

  async getQueue(name) {
    if (!this.queues.has(name)) {
      await this.createQueue(name);
    }
    return this.queues.get(name);
  }

  async enqueue(queueName, jobData, options = {}) {
    const queue = await this.getQueue(queueName);
    
    const job = {
      id: options.id || this._generateJobId(),
      data: jobData,
      attempts: 0,
      maxRetries: options.retries || this.options.defaultRetries,
      timeout: options.timeout || this.options.defaultTimeout,
      delay: options.delay || this.options.defaultDelay,
      priority: options.priority || 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'pending',
      progress: 0,
      metadata: options.metadata || {}
    };

    if (options.delay > 0) {
      job.status = 'delayed';
      job.processAfter = new Date(Date.now() + options.delay);
      this.metrics.delayed++;
    }

    await this.backend.addJob(queue, job);
    
    this.emit('job:enqueued', { queue: queueName, job });
    
    return job;
  }

  async enqueueMany(queueName, jobs, options = {}) {
    const queue = await this.getQueue(queueName);
    const processedJobs = [];

    for (const jobData of jobs) {
      const job = {
        id: jobData.id || this._generateJobId(),
        data: jobData.data || jobData,
        attempts: 0,
        maxRetries: jobData.retries || options.retries || this.options.defaultRetries,
        timeout: jobData.timeout || options.timeout || this.options.defaultTimeout,
        delay: jobData.delay || options.delay || this.options.defaultDelay,
        priority: jobData.priority || options.priority || 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'pending',
        progress: 0,
        metadata: jobData.metadata || options.metadata || {}
      };

      if (job.delay > 0) {
        job.status = 'delayed';
        job.processAfter = new Date(Date.now() + job.delay);
        this.metrics.delayed++;
      }

      processedJobs.push(job);
    }

    await this.backend.addJobs(queue, processedJobs);
    
    this.emit('jobs:enqueued', { queue: queueName, count: processedJobs.length });
    
    return processedJobs;
  }

  process(queueName, concurrency, processor) {
    if (typeof concurrency === 'function') {
      processor = concurrency;
      concurrency = 1;
    }

    const processorInfo = {
      processor,
      concurrency,
      active: 0,
      running: true
    };

    this.processors.set(queueName, processorInfo);
    
    for (let i = 0; i < concurrency; i++) {
      this._startWorker(queueName, processorInfo);
    }
  }

  async _startWorker(queueName, processorInfo) {
    while (processorInfo.running) {
      try {
        const queue = await this.getQueue(queueName);
        const job = await this.backend.fetchJob(queue);

        if (!job) {
          await this._sleep(1000);
          continue;
        }

        processorInfo.active++;
        this.metrics.active++;
        
        await this._processJob(queueName, job, processorInfo.processor);
        
        processorInfo.active--;
        this.metrics.active--;
      } catch (error) {
        this.emit('error', error);
        await this._sleep(5000);
      }
    }
  }

  async _processJob(queueName, job, processor) {
    const startTime = Date.now();
    
    try {
      job.status = 'active';
      job.startedAt = new Date();
      await this.backend.updateJob(await this.getQueue(queueName), job);
      
      this.emit('job:active', { queue: queueName, job });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Job timeout')), job.timeout);
      });

      const jobWrapper = {
        ...job,
        progress: (value) => this._updateProgress(queueName, job.id, value),
        log: (message) => this._addLog(queueName, job.id, message)
      };

      const result = await Promise.race([
        processor(jobWrapper),
        timeoutPromise
      ]);

      job.status = 'completed';
      job.result = result;
      job.completedAt = new Date();
      job.duration = Date.now() - startTime;
      
      await this.backend.completeJob(await this.getQueue(queueName), job);
      
      this.metrics.processed++;
      this.emit('job:completed', { queue: queueName, job });
      
    } catch (error) {
      job.attempts++;
      job.lastError = {
        message: error.message,
        stack: error.stack,
        timestamp: new Date()
      };

      if (job.attempts >= job.maxRetries) {
        job.status = 'failed';
        job.failedAt = new Date();
        job.duration = Date.now() - startTime;
        
        await this.backend.failJob(await this.getQueue(queueName), job);
        await this._moveToDeadLetter(queueName, job);
        
        this.metrics.failed++;
        this.emit('job:failed', { queue: queueName, job, error });
        
      } else {
        const retryDelay = this.options.retryStrategy(job.attempts);
        job.status = 'retrying';
        job.nextRetryAt = new Date(Date.now() + retryDelay);
        
        await this.backend.retryJob(await this.getQueue(queueName), job, retryDelay);
        
        this.emit('job:retry', { queue: queueName, job, delay: retryDelay });
      }
    }
  }

  async _updateProgress(queueName, jobId, progress) {
    const queue = await this.getQueue(queueName);
    await this.backend.updateProgress(queue, jobId, progress);
    this.emit('job:progress', { queue: queueName, jobId, progress });
  }

  async _addLog(queueName, jobId, message) {
    const queue = await this.getQueue(queueName);
    const logEntry = {
      timestamp: new Date(),
      message
    };
    await this.backend.addLog(queue, jobId, logEntry);
  }

  async _moveToDeadLetter(queueName, job) {
    const deadLetterQueue = `${queueName}:dead`;
    await this.enqueue(deadLetterQueue, job, {
      metadata: {
        originalQueue: queueName,
        failedAt: job.failedAt,
        lastError: job.lastError
      }
    });
  }

  async getJob(queueName, jobId) {
    const queue = await this.getQueue(queueName);
    return await this.backend.getJob(queue, jobId);
  }

  async getJobs(queueName, status = 'pending', limit = 100) {
    const queue = await this.getQueue(queueName);
    return await this.backend.getJobs(queue, status, limit);
  }

  async removeJob(queueName, jobId) {
    const queue = await this.getQueue(queueName);
    const removed = await this.backend.removeJob(queue, jobId);
    
    if (removed) {
      this.emit('job:removed', { queue: queueName, jobId });
    }
    
    return removed;
  }

  async pauseQueue(queueName) {
    const queue = await this.getQueue(queueName);
    await this.backend.pauseQueue(queue);
    
    if (this.processors.has(queueName)) {
      this.processors.get(queueName).running = false;
    }
    
    this.emit('queue:paused', { queue: queueName });
  }

  async resumeQueue(queueName) {
    const queue = await this.getQueue(queueName);
    await this.backend.resumeQueue(queue);
    
    if (this.processors.has(queueName)) {
      const processorInfo = this.processors.get(queueName);
      processorInfo.running = true;
      
      for (let i = processorInfo.active; i < processorInfo.concurrency; i++) {
        this._startWorker(queueName, processorInfo);
      }
    }
    
    this.emit('queue:resumed', { queue: queueName });
  }

  async emptyQueue(queueName) {
    const queue = await this.getQueue(queueName);
    const count = await this.backend.emptyQueue(queue);
    
    this.emit('queue:emptied', { queue: queueName, count });
    
    return count;
  }

  async getQueueStats(queueName) {
    const queue = await this.getQueue(queueName);
    return await this.backend.getQueueStats(queue);
  }

  async getMetrics() {
    const queueStats = {};
    
    for (const [name, queue] of this.queues) {
      queueStats[name] = await this.getQueueStats(name);
    }
    
    return {
      global: this.metrics,
      queues: queueStats,
      workers: Object.fromEntries(
        Array.from(this.processors.entries()).map(([name, info]) => [
          name,
          {
            concurrency: info.concurrency,
            active: info.active,
            running: info.running
          }
        ])
      )
    };
  }

  schedule(queueName, cronExpression, jobData, options = {}) {
    const CronJob = require('cron').CronJob;
    
    const job = new CronJob(cronExpression, async () => {
      await this.enqueue(queueName, jobData, options);
    });
    
    job.start();
    
    return {
      stop: () => job.stop(),
      nextDates: (count = 5) => job.nextDates(count)
    };
  }

  async retryFailed(queueName, filter = {}) {
    const failedJobs = await this.getJobs(queueName, 'failed', filter.limit || 100);
    const retried = [];

    for (const job of failedJobs) {
      if (filter.before && job.failedAt > filter.before) continue;
      if (filter.after && job.failedAt < filter.after) continue;
      
      job.attempts = 0;
      job.status = 'pending';
      delete job.failedAt;
      delete job.lastError;
      
      await this.enqueue(queueName, job.data, {
        id: job.id,
        ...job
      });
      
      retried.push(job.id);
    }

    return retried;
  }

  _defaultRetryStrategy(attemptNumber) {
    return Math.min(1000 * Math.pow(2, attemptNumber), 30000);
  }

  _generateJobId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _startMetricsCollection() {
    setInterval(() => {
      this.emit('metrics', this.getMetrics());
    }, 60000);
  }

  async shutdown() {
    for (const [name, processorInfo] of this.processors) {
      processorInfo.running = false;
    }

    await this._sleep(5000);

    if (this.backend) {
      await this.backend.disconnect();
    }

    this.removeAllListeners();
  }
}

module.exports = QueueModule;