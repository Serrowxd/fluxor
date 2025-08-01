const { Kafka, logLevel } = require('kafkajs');

class KafkaBackend {
  constructor(options) {
    this.options = {
      clientId: options.clientId || 'fluxor-queue',
      brokers: options.brokers || ['localhost:9092'],
      prefix: options.prefix || 'fluxor.',
      consumerGroupId: options.consumerGroupId || 'fluxor-workers',
      logLevel: options.logLevel || logLevel.ERROR,
      ...options
    };

    this.kafka = null;
    this.producer = null;
    this.consumers = new Map();
    this.admin = null;
  }

  async connect() {
    this.kafka = new Kafka({
      clientId: this.options.clientId,
      brokers: this.options.brokers,
      logLevel: this.options.logLevel,
      ssl: this.options.ssl,
      sasl: this.options.sasl,
      connectionTimeout: this.options.connectionTimeout || 3000,
      retry: {
        initialRetryTime: 100,
        retries: 8
      }
    });

    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30000
    });

    this.admin = this.kafka.admin();

    await this.producer.connect();
    await this.admin.connect();
  }

  async createQueue(name, options) {
    const topicName = this._getTopicName(name);
    
    try {
      await this.admin.createTopics({
        topics: [{
          topic: topicName,
          numPartitions: options.partitions || 3,
          replicationFactor: options.replicationFactor || 1,
          configEntries: [
            { name: 'retention.ms', value: String(options.retentionMs || 86400000) },
            { name: 'compression.type', value: options.compression || 'gzip' }
          ]
        }]
      });
    } catch (error) {
      if (!error.message.includes('already exists')) {
        throw error;
      }
    }

    if (options.dlq !== false) {
      const dlqTopicName = `${topicName}.dlq`;
      try {
        await this.admin.createTopics({
          topics: [{
            topic: dlqTopicName,
            numPartitions: 1,
            replicationFactor: options.replicationFactor || 1,
            configEntries: [
              { name: 'retention.ms', value: String(options.dlqRetentionMs || 604800000) }
            ]
          }]
        });
      } catch (error) {
        if (!error.message.includes('already exists')) {
          throw error;
        }
      }
    }

    return { name, topicName };
  }

  async addJob(queue, job) {
    const topicName = queue.topicName || this._getTopicName(queue.name);
    
    const headers = {
      jobId: job.id,
      priority: String(job.priority || 0),
      createdAt: new Date().toISOString()
    };

    if (job.delay > 0) {
      headers.processAfter = new Date(Date.now() + job.delay).toISOString();
    }

    await this.producer.send({
      topic: topicName,
      messages: [{
        key: job.id,
        value: JSON.stringify(job),
        headers,
        partition: job.partition
      }]
    });
  }

  async addJobs(queue, jobs) {
    const topicName = queue.topicName || this._getTopicName(queue.name);
    
    const messages = jobs.map(job => {
      const headers = {
        jobId: job.id,
        priority: String(job.priority || 0),
        createdAt: new Date().toISOString()
      };

      if (job.delay > 0) {
        headers.processAfter = new Date(Date.now() + job.delay).toISOString();
      }

      return {
        key: job.id,
        value: JSON.stringify(job),
        headers,
        partition: job.partition
      };
    });

    await this.producer.send({
      topic: topicName,
      messages
    });
  }

  async fetchJob(queue) {
    const topicName = queue.topicName || this._getTopicName(queue.name);
    
    if (!this.consumers.has(topicName)) {
      const consumer = this.kafka.consumer({
        groupId: `${this.options.consumerGroupId}-${queue.name}`,
        sessionTimeout: 30000,
        heartbeatInterval: 3000,
        maxWaitTimeInMs: 100
      });

      await consumer.connect();
      await consumer.subscribe({ 
        topic: topicName, 
        fromBeginning: false 
      });

      this.consumers.set(topicName, consumer);
    }

    const consumer = this.consumers.get(topicName);
    let resolvedJob = null;

    await consumer.run({
      autoCommit: false,
      eachMessage: async ({ topic, partition, message }) => {
        const headers = {};
        for (const [key, value] of Object.entries(message.headers || {})) {
          headers[key] = value.toString();
        }

        if (headers.processAfter) {
          const processAfter = new Date(headers.processAfter);
          if (processAfter > new Date()) {
            return;
          }
        }

        const job = JSON.parse(message.value.toString());
        job._message = { topic, partition, offset: message.offset };
        
        resolvedJob = job;
        consumer.pause([{ topic }]);
      }
    });

    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (resolvedJob) {
      consumer.resume([{ topic: topicName }]);
    }

    return resolvedJob;
  }

  async updateJob(queue, job) {
    // Kafka is append-only, updates require external storage
  }

  async completeJob(queue, job) {
    if (job._message) {
      const consumer = this.consumers.get(job._message.topic);
      if (consumer) {
        await consumer.commitOffsets([{
          topic: job._message.topic,
          partition: job._message.partition,
          offset: String(Number(job._message.offset) + 1)
        }]);
      }
    }
  }

  async failJob(queue, job) {
    const dlqTopicName = `${queue.topicName || this._getTopicName(queue.name)}.dlq`;
    
    await this.producer.send({
      topic: dlqTopicName,
      messages: [{
        key: job.id,
        value: JSON.stringify({
          ...job,
          failedAt: new Date(),
          originalTopic: queue.topicName || this._getTopicName(queue.name)
        }),
        headers: {
          jobId: job.id,
          failedAt: new Date().toISOString(),
          error: job.lastError?.message || 'Unknown error'
        }
      }]
    });

    await this.completeJob(queue, job);
  }

  async retryJob(queue, job, delay) {
    delete job._message;
    job.delay = delay;
    await this.addJob(queue, job);
  }

  async getJob(queue, jobId) {
    throw new Error('getJob not supported with Kafka backend');
  }

  async getJobs(queue, status, limit) {
    throw new Error('getJobs not supported with Kafka backend');
  }

  async removeJob(queue, jobId) {
    throw new Error('removeJob not supported with Kafka backend');
  }

  async updateProgress(queue, jobId, progress) {
    // Progress tracking requires external storage
  }

  async addLog(queue, jobId, logEntry) {
    // Log storage requires external storage
  }

  async pauseQueue(queue) {
    const topicName = queue.topicName || this._getTopicName(queue.name);
    const consumer = this.consumers.get(topicName);
    if (consumer) {
      consumer.pause([{ topic: topicName }]);
    }
  }

  async resumeQueue(queue) {
    const topicName = queue.topicName || this._getTopicName(queue.name);
    const consumer = this.consumers.get(topicName);
    if (consumer) {
      consumer.resume([{ topic: topicName }]);
    }
  }

  async emptyQueue(queue) {
    const topicName = queue.topicName || this._getTopicName(queue.name);
    
    await this.admin.deleteTopics({
      topics: [topicName]
    });
    
    await this.createQueue(queue.name, {});
    
    return 0;
  }

  async getQueueStats(queue) {
    const topicName = queue.topicName || this._getTopicName(queue.name);
    
    const metadata = await this.admin.fetchTopicMetadata({
      topics: [topicName]
    });

    const offsets = await this.admin.fetchTopicOffsets(topicName);
    
    let totalMessages = 0;
    offsets.forEach(partition => {
      totalMessages += parseInt(partition.high) - parseInt(partition.low);
    });

    return {
      pending: totalMessages,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: false,
      partitions: metadata.topics[0].partitions.length
    };
  }

  _getTopicName(name) {
    return `${this.options.prefix}${name}`;
  }

  async disconnect() {
    for (const [topic, consumer] of this.consumers) {
      await consumer.disconnect();
    }
    
    if (this.producer) {
      await this.producer.disconnect();
    }
    
    if (this.admin) {
      await this.admin.disconnect();
    }
  }
}

module.exports = KafkaBackend;