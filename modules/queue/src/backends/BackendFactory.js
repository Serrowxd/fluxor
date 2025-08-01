const RedisBackend = require('./RedisBackend');
const RabbitMQBackend = require('./RabbitMQBackend');
const KafkaBackend = require('./KafkaBackend');

class BackendFactory {
  static async create(type, options) {
    switch (type.toLowerCase()) {
      case 'redis':
        return new RedisBackend(options);
      
      case 'rabbitmq':
      case 'amqp':
        return new RabbitMQBackend(options);
      
      case 'kafka':
        return new KafkaBackend(options);
      
      default:
        throw new Error(`Unknown queue backend type: ${type}`);
    }
  }
}

module.exports = BackendFactory;