const amqp = require('amqplib');

class RabbitMQBackend {
  constructor(options) {
    this.options = {
      url: options.url || `amqp://${options.host || 'localhost'}:${options.port || 5672}`,
      username: options.username || 'guest',
      password: options.password || 'guest',
      vhost: options.vhost || '/',
      prefix: options.prefix || 'fluxor.',
      prefetch: options.prefetch || 1,
      durable: options.durable !== false,
      ...options
    };

    this.connection = null;
    this.channel = null;
    this.queues = new Map();
  }

  async connect() {
    const url = this.options.url.includes('@') 
      ? this.options.url 
      : this.options.url.replace('amqp://', `amqp://${this.options.username}:${this.options.password}@`);

    this.connection = await amqp.connect(url + this.options.vhost);
    this.channel = await this.connection.createChannel();
    
    await this.channel.prefetch(this.options.prefetch);
    
    this.connection.on('error', (err) => {
      console.error('RabbitMQ connection error:', err);
    });

    this.connection.on('close', () => {
      console.log('RabbitMQ connection closed');
    });
  }

  async createQueue(name, options) {
    const queueName = this._getQueueName(name);
    
    await this.channel.assertQueue(queueName, {
      durable: options.durable !== false,
      arguments: {
        'x-max-priority': options.maxPriority || 10,
        ...options.queueArguments
      }
    });

    if (options.dlx !== false) {
      const dlxName = `${queueName}.dlx`;
      const dlqName = `${queueName}.dlq`;
      
      await this.channel.assertExchange(dlxName, 'direct', { durable: true });
      await this.channel.assertQueue(dlqName, {
        durable: true,
        arguments: {
          'x-message-ttl': options.dlqTTL || 86400000
        }
      });
      await this.channel.bindQueue(dlqName, dlxName, '');
      
      await this.channel.assertQueue(queueName, {
        durable: options.durable !== false,
        arguments: {
          'x-dead-letter-exchange': dlxName,
          'x-max-priority': options.maxPriority || 10,
          ...options.queueArguments
        }
      });
    }

    const queueInfo = { name, queueName };
    this.queues.set(name, queueInfo);
    
    return queueInfo;
  }

  async addJob(queue, job) {
    const queueName = queue.queueName || this._getQueueName(queue.name);
    const message = Buffer.from(JSON.stringify(job));
    
    const options = {
      persistent: true,
      messageId: job.id,
      timestamp: Date.now(),
      priority: Math.max(0, Math.min(10, job.priority || 0))
    };

    if (job.delay > 0) {
      const delayedQueueName = `${queueName}.delayed`;
      await this.channel.assertQueue(delayedQueueName, {
        durable: true,
        arguments: {
          'x-message-ttl': job.delay,
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': queueName
        }
      });
      
      await this.channel.sendToQueue(delayedQueueName, message, options);
    } else {
      await this.channel.sendToQueue(queueName, message, options);
    }
  }

  async addJobs(queue, jobs) {
    for (const job of jobs) {
      await this.addJob(queue, job);
    }
  }

  async fetchJob(queue) {
    const queueName = queue.queueName || this._getQueueName(queue.name);
    
    const message = await this.channel.get(queueName, { noAck: false });
    
    if (!message) return null;
    
    const job = JSON.parse(message.content.toString());
    job._message = message;
    
    return job;
  }

  async updateJob(queue, job) {
    // RabbitMQ doesn't support in-place updates
    // Job updates are handled in memory or external storage
  }

  async completeJob(queue, job) {
    if (job._message) {
      await this.channel.ack(job._message);
    }
  }

  async failJob(queue, job) {
    if (job._message) {
      await this.channel.nack(job._message, false, false);
    }
  }

  async retryJob(queue, job, delay) {
    if (job._message) {
      await this.channel.nack(job._message, false, true);
    }
    
    if (delay > 0) {
      delete job._message;
      job.delay = delay;
      await this.addJob(queue, job);
    }
  }

  async getJob(queue, jobId) {
    // RabbitMQ doesn't support fetching specific messages
    // This would require external storage
    throw new Error('getJob not supported with RabbitMQ backend');
  }

  async getJobs(queue, status, limit) {
    // RabbitMQ doesn't support browsing queue contents
    throw new Error('getJobs not supported with RabbitMQ backend');
  }

  async removeJob(queue, jobId) {
    // RabbitMQ doesn't support removing specific messages
    throw new Error('removeJob not supported with RabbitMQ backend');
  }

  async updateProgress(queue, jobId, progress) {
    // Progress tracking requires external storage
  }

  async addLog(queue, jobId, logEntry) {
    // Log storage requires external storage
  }

  async pauseQueue(queue) {
    // Pausing is handled at the consumer level
  }

  async resumeQueue(queue) {
    // Resuming is handled at the consumer level
  }

  async emptyQueue(queue) {
    const queueName = queue.queueName || this._getQueueName(queue.name);
    const { messageCount } = await this.channel.purgeQueue(queueName);
    return messageCount;
  }

  async getQueueStats(queue) {
    const queueName = queue.queueName || this._getQueueName(queue.name);
    const { messageCount, consumerCount } = await this.channel.checkQueue(queueName);
    
    return {
      pending: messageCount,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: false,
      consumers: consumerCount
    };
  }

  _getQueueName(name) {
    return `${this.options.prefix}${name}`;
  }

  async disconnect() {
    if (this.channel) {
      await this.channel.close();
    }
    if (this.connection) {
      await this.connection.close();
    }
  }
}

module.exports = RabbitMQBackend;