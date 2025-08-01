const redis = require('redis');
const { promisify } = require('util');

class RedisBackend {
  constructor(options) {
    this.options = {
      host: options.host || 'localhost',
      port: options.port || 6379,
      password: options.password,
      db: options.db || 0,
      prefix: options.prefix || 'queue:',
      ...options
    };

    this.client = null;
    this.subscriber = null;
    this.scripts = new Map();
  }

  async connect() {
    this.client = redis.createClient({
      host: this.options.host,
      port: this.options.port,
      password: this.options.password,
      db: this.options.db
    });

    this.subscriber = redis.createClient({
      host: this.options.host,
      port: this.options.port,
      password: this.options.password,
      db: this.options.db
    });

    await new Promise((resolve, reject) => {
      this.client.on('ready', resolve);
      this.client.on('error', reject);
    });

    await new Promise((resolve, reject) => {
      this.subscriber.on('ready', resolve);
      this.subscriber.on('error', reject);
    });

    this._setupCommands();
    this._loadScripts();
  }

  _setupCommands() {
    const commands = [
      'get', 'set', 'del', 'exists', 'expire', 'ttl',
      'lpush', 'rpush', 'lpop', 'rpop', 'llen', 'lrange',
      'sadd', 'srem', 'smembers', 'sismember',
      'zadd', 'zrem', 'zrange', 'zrangebyscore', 'zcard',
      'hset', 'hget', 'hgetall', 'hdel', 'hexists',
      'publish', 'eval'
    ];

    commands.forEach(cmd => {
      this[`${cmd}Async`] = promisify(this.client[cmd]).bind(this.client);
    });
  }

  _loadScripts() {
    this.scripts.set('moveJob', `
      local from = KEYS[1]
      local to = KEYS[2]
      local job = redis.call('rpop', from)
      if job then
        redis.call('lpush', to, job)
        return job
      end
      return nil
    `);

    this.scripts.set('rateLimit', `
      local key = KEYS[1]
      local limit = tonumber(ARGV[1])
      local window = tonumber(ARGV[2])
      local current = redis.call('incr', key)
      if current == 1 then
        redis.call('expire', key, window)
      end
      if current > limit then
        return 0
      end
      return 1
    `);
  }

  async createQueue(name, options) {
    const queueKey = this._getQueueKey(name);
    await this.hsetAsync(`${queueKey}:meta`, 'created', Date.now());
    await this.hsetAsync(`${queueKey}:meta`, 'name', name);
    return { name, key: queueKey };
  }

  async addJob(queue, job) {
    const jobKey = this._getJobKey(queue.name, job.id);
    const queueKey = this._getQueueKey(queue.name);

    await this.hsetAsync(jobKey, 'data', JSON.stringify(job));
    
    if (job.delay > 0) {
      const score = Date.now() + job.delay;
      await this.zaddAsync(`${queueKey}:delayed`, score, job.id);
    } else if (job.priority !== 0) {
      await this.zaddAsync(`${queueKey}:priority`, -job.priority, job.id);
    } else {
      await this.lpushAsync(`${queueKey}:pending`, job.id);
    }

    await this.publishAsync(`${queueKey}:events`, JSON.stringify({
      type: 'job:added',
      jobId: job.id
    }));
  }

  async addJobs(queue, jobs) {
    const multi = this.client.multi();
    const queueKey = this._getQueueKey(queue.name);

    for (const job of jobs) {
      const jobKey = this._getJobKey(queue.name, job.id);
      multi.hset(jobKey, 'data', JSON.stringify(job));
      
      if (job.delay > 0) {
        const score = Date.now() + job.delay;
        multi.zadd(`${queueKey}:delayed`, score, job.id);
      } else if (job.priority !== 0) {
        multi.zadd(`${queueKey}:priority`, -job.priority, job.id);
      } else {
        multi.lpush(`${queueKey}:pending`, job.id);
      }
    }

    await promisify(multi.exec).bind(multi)();
  }

  async fetchJob(queue) {
    const queueKey = this._getQueueKey(queue.name);
    
    await this._promoteDelayedJobs(queueKey);
    
    let jobId = await this.zrangeAsync(`${queueKey}:priority`, 0, 0);
    if (jobId && jobId.length > 0) {
      await this.zremAsync(`${queueKey}:priority`, jobId[0]);
      jobId = jobId[0];
    } else {
      jobId = await this.rpopAsync(`${queueKey}:pending`);
    }

    if (!jobId) return null;

    const jobKey = this._getJobKey(queue.name, jobId);
    const jobData = await this.hgetAsync(jobKey, 'data');
    
    if (!jobData) return null;

    const job = JSON.parse(jobData);
    
    await this.saddAsync(`${queueKey}:active`, jobId);
    
    return job;
  }

  async _promoteDelayedJobs(queueKey) {
    const now = Date.now();
    const jobIds = await this.zrangebyscoreAsync(
      `${queueKey}:delayed`,
      '-inf',
      now
    );

    if (jobIds.length > 0) {
      const multi = this.client.multi();
      
      for (const jobId of jobIds) {
        multi.zrem(`${queueKey}:delayed`, jobId);
        multi.lpush(`${queueKey}:pending`, jobId);
      }
      
      await promisify(multi.exec).bind(multi)();
    }
  }

  async updateJob(queue, job) {
    const jobKey = this._getJobKey(queue.name, job.id);
    await this.hsetAsync(jobKey, 'data', JSON.stringify(job));
  }

  async completeJob(queue, job) {
    const queueKey = this._getQueueKey(queue.name);
    const jobKey = this._getJobKey(queue.name, job.id);
    
    await this.sremAsync(`${queueKey}:active`, job.id);
    await this.saddAsync(`${queueKey}:completed`, job.id);
    await this.hsetAsync(jobKey, 'data', JSON.stringify(job));
    
    await this.expireAsync(jobKey, 86400);
  }

  async failJob(queue, job) {
    const queueKey = this._getQueueKey(queue.name);
    const jobKey = this._getJobKey(queue.name, job.id);
    
    await this.sremAsync(`${queueKey}:active`, job.id);
    await this.saddAsync(`${queueKey}:failed`, job.id);
    await this.hsetAsync(jobKey, 'data', JSON.stringify(job));
  }

  async retryJob(queue, job, delay) {
    const queueKey = this._getQueueKey(queue.name);
    const jobKey = this._getJobKey(queue.name, job.id);
    
    await this.sremAsync(`${queueKey}:active`, job.id);
    await this.hsetAsync(jobKey, 'data', JSON.stringify(job));
    
    if (delay > 0) {
      const score = Date.now() + delay;
      await this.zaddAsync(`${queueKey}:delayed`, score, job.id);
    } else {
      await this.lpushAsync(`${queueKey}:pending`, job.id);
    }
  }

  async getJob(queue, jobId) {
    const jobKey = this._getJobKey(queue.name, jobId);
    const jobData = await this.hgetAsync(jobKey, 'data');
    return jobData ? JSON.parse(jobData) : null;
  }

  async getJobs(queue, status, limit) {
    const queueKey = this._getQueueKey(queue.name);
    let jobIds = [];

    switch (status) {
      case 'pending':
        jobIds = await this.lrangeAsync(`${queueKey}:pending`, 0, limit - 1);
        break;
      case 'active':
        jobIds = Array.from(await this.smembersAsync(`${queueKey}:active`)).slice(0, limit);
        break;
      case 'completed':
        jobIds = Array.from(await this.smembersAsync(`${queueKey}:completed`)).slice(0, limit);
        break;
      case 'failed':
        jobIds = Array.from(await this.smembersAsync(`${queueKey}:failed`)).slice(0, limit);
        break;
      case 'delayed':
        jobIds = await this.zrangeAsync(`${queueKey}:delayed`, 0, limit - 1);
        break;
    }

    const jobs = [];
    for (const jobId of jobIds) {
      const job = await this.getJob(queue, jobId);
      if (job) jobs.push(job);
    }

    return jobs;
  }

  async removeJob(queue, jobId) {
    const queueKey = this._getQueueKey(queue.name);
    const jobKey = this._getJobKey(queue.name, jobId);
    
    const multi = this.client.multi();
    multi.lrem(`${queueKey}:pending`, 0, jobId);
    multi.srem(`${queueKey}:active`, jobId);
    multi.srem(`${queueKey}:completed`, jobId);
    multi.srem(`${queueKey}:failed`, jobId);
    multi.zrem(`${queueKey}:delayed`, jobId);
    multi.zrem(`${queueKey}:priority`, jobId);
    multi.del(jobKey);
    
    const results = await promisify(multi.exec).bind(multi)();
    
    return results.some(result => result > 0);
  }

  async updateProgress(queue, jobId, progress) {
    const jobKey = this._getJobKey(queue.name, jobId);
    await this.hsetAsync(jobKey, 'progress', progress);
  }

  async addLog(queue, jobId, logEntry) {
    const logKey = `${this._getJobKey(queue.name, jobId)}:logs`;
    await this.lpushAsync(logKey, JSON.stringify(logEntry));
  }

  async pauseQueue(queue) {
    const queueKey = this._getQueueKey(queue.name);
    await this.hsetAsync(`${queueKey}:meta`, 'paused', 'true');
  }

  async resumeQueue(queue) {
    const queueKey = this._getQueueKey(queue.name);
    await this.hdelAsync(`${queueKey}:meta`, 'paused');
  }

  async emptyQueue(queue) {
    const queueKey = this._getQueueKey(queue.name);
    
    const pendingCount = await this.llenAsync(`${queueKey}:pending`);
    const delayedCount = await this.zcardAsync(`${queueKey}:delayed`);
    const priorityCount = await this.zcardAsync(`${queueKey}:priority`);
    
    const multi = this.client.multi();
    multi.del(`${queueKey}:pending`);
    multi.del(`${queueKey}:delayed`);
    multi.del(`${queueKey}:priority`);
    
    await promisify(multi.exec).bind(multi)();
    
    return pendingCount + delayedCount + priorityCount;
  }

  async getQueueStats(queue) {
    const queueKey = this._getQueueKey(queue.name);
    
    const [
      pending,
      active,
      completed,
      failed,
      delayed,
      paused
    ] = await Promise.all([
      this.llenAsync(`${queueKey}:pending`),
      this.scardAsync(`${queueKey}:active`),
      this.scardAsync(`${queueKey}:completed`),
      this.scardAsync(`${queueKey}:failed`),
      this.zcardAsync(`${queueKey}:delayed`),
      this.hgetAsync(`${queueKey}:meta`, 'paused')
    ]);

    return {
      pending,
      active,
      completed,
      failed,
      delayed,
      paused: paused === 'true'
    };
  }

  _getQueueKey(name) {
    return `${this.options.prefix}${name}`;
  }

  _getJobKey(queueName, jobId) {
    return `${this._getQueueKey(queueName)}:job:${jobId}`;
  }

  async disconnect() {
    if (this.client) {
      this.client.quit();
    }
    if (this.subscriber) {
      this.subscriber.quit();
    }
  }
}

module.exports = RedisBackend;