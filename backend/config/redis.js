const { createClient } = require('redis');
const Queue = require('bull');
require('dotenv').config();

// Redis client for general caching
const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error', err);
});

redisClient.on('connect', () => {
  console.log('Redis connected successfully');
});

// Initialize Redis connection
(async () => {
  await redisClient.connect();
})();

// Bull queues for background jobs
const shopifySyncQueue = new Queue('shopify-sync', process.env.REDIS_URL);
const forecastQueue = new Queue('forecast', process.env.REDIS_URL);
const alertQueue = new Queue('alerts', process.env.REDIS_URL);

module.exports = {
  redisClient,
  shopifySyncQueue,
  forecastQueue,
  alertQueue,
};