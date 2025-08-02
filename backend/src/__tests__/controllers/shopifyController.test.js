const { initiateOAuth, handleOAuthCallback } = require('../../controllers/shopifyController');
const shopifyAuthService = require('../../services/shopifyAuthService');
const { redisClient } = require('../../../config/redis');
const crypto = require('crypto');

// Mock dependencies
jest.mock('../../services/shopifyAuthService');
jest.mock('../../../config/redis', () => ({
  redisClient: {
    setEx: jest.fn(),
    get: jest.fn(),
    del: jest.fn()
  }
}));
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

// Mock crypto module
jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  let counter = 0;
  return {
    ...actual,
    randomBytes: jest.fn((size) => {
      // Return different buffers for each call to test uniqueness
      counter++;
      return Buffer.from(`test-random-bytes-${counter}`);
    })
  };
});

describe('ShopifyController', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      body: {},
      query: {},
      user: { id: 1 }
    };
    res = {
      json: jest.fn(),
      redirect: jest.fn()
    };
    next = jest.fn();
    jest.clearAllMocks();
  });

  describe('initiateOAuth', () => {
    it('should generate authorization URL with valid shop domain', async () => {
      req.body.shop = 'test-shop.myshopify.com';
      
      shopifyAuthService.isValidShopDomain.mockReturnValue(true);
      shopifyAuthService.generateAuthorizationUrl.mockReturnValue('https://test-shop.myshopify.com/admin/oauth/authorize?...');
      redisClient.setEx.mockResolvedValue('OK');

      await initiateOAuth(req, res, next);

      expect(shopifyAuthService.isValidShopDomain).toHaveBeenCalledWith('test-shop.myshopify.com');
      expect(redisClient.setEx).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        authorizationUrl: expect.stringContaining('https://test-shop.myshopify.com'),
        shop: 'test-shop.myshopify.com'
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject invalid shop domain format', async () => {
      req.body.shop = 'invalid-shop-domain';
      
      shopifyAuthService.isValidShopDomain.mockReturnValue(false);

      await initiateOAuth(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Invalid shop domain format. Must end with .myshopify.com',
          code: 'INVALID_SHOP_DOMAIN'
        })
      );
      expect(res.json).not.toHaveBeenCalled();
    });

    it('should generate unique state parameters', async () => {
      req.body.shop = 'test-shop.myshopify.com';
      
      shopifyAuthService.isValidShopDomain.mockReturnValue(true);
      shopifyAuthService.generateAuthorizationUrl.mockReturnValue('https://test-shop.myshopify.com/admin/oauth/authorize');
      
      const setexCalls = [];
      redisClient.setEx.mockImplementation((key, ttl, data) => {
        setexCalls.push(key);
        return Promise.resolve('OK');
      });

      // Call twice
      await initiateOAuth(req, res, next);
      await initiateOAuth(req, res, next);

      // Verify different state parameters were generated
      expect(setexCalls[0]).not.toBe(setexCalls[1]);
      expect(setexCalls[0]).toMatch(/^shopify:oauth:/);
      expect(setexCalls[1]).toMatch(/^shopify:oauth:/);
    });

    it('should store state with correct TTL', async () => {
      req.body.shop = 'test-shop.myshopify.com';
      
      shopifyAuthService.isValidShopDomain.mockReturnValue(true);
      shopifyAuthService.generateAuthorizationUrl.mockReturnValue('https://test-shop.myshopify.com/admin/oauth/authorize');
      redisClient.setEx.mockResolvedValue('OK');

      await initiateOAuth(req, res, next);

      expect(redisClient.setEx).toHaveBeenCalledWith(
        expect.stringMatching(/^shopify:oauth:/),
        600, // 10 minutes TTL
        expect.stringContaining('"shop":"test-shop.myshopify.com"')
      );
    });

    it('should handle Redis errors gracefully', async () => {
      req.body.shop = 'test-shop.myshopify.com';
      
      shopifyAuthService.isValidShopDomain.mockReturnValue(true);
      redisClient.setEx.mockRejectedValue(new Error('Redis connection failed'));

      await initiateOAuth(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Redis connection failed'
        })
      );
    });
  });

  describe('handleOAuthCallback', () => {
    it('should exchange code for token with valid parameters', async () => {
      req.query = {
        code: 'test-code',
        state: 'test-state',
        shop: 'test-shop.myshopify.com',
        hmac: 'test-hmac'
      };

      const storedData = JSON.stringify({
        shop: 'test-shop.myshopify.com',
        userId: 1,
        codeVerifier: 'test-verifier',
        timestamp: Date.now()
      });

      shopifyAuthService.verifyHmac.mockReturnValue(true);
      redisClient.get.mockResolvedValue(storedData);
      redisClient.del.mockResolvedValue(1);
      shopifyAuthService.exchangeCodeForToken.mockResolvedValue({
        access_token: 'test-token',
        scope: 'read_products,write_products'
      });
      shopifyAuthService.storeAccessToken.mockResolvedValue();

      process.env.FRONTEND_URL = 'http://localhost:3000';

      await handleOAuthCallback(req, res, next);

      expect(shopifyAuthService.verifyHmac).toHaveBeenCalledWith(req.query);
      expect(redisClient.get).toHaveBeenCalledWith('shopify:oauth:test-state');
      expect(redisClient.del).toHaveBeenCalledWith('shopify:oauth:test-state');
      expect(shopifyAuthService.exchangeCodeForToken).toHaveBeenCalledWith({
        shop: 'test-shop.myshopify.com',
        code: 'test-code',
        codeVerifier: 'test-verifier'
      });
      expect(res.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/integrations/shopify/success?shop=test-shop.myshopify.com'
      );
    });

    it('should reject invalid HMAC signature', async () => {
      req.query = {
        code: 'test-code',
        state: 'test-state',
        shop: 'test-shop.myshopify.com',
        hmac: 'invalid-hmac'
      };

      shopifyAuthService.verifyHmac.mockReturnValue(false);
      process.env.FRONTEND_URL = 'http://localhost:3000';

      await handleOAuthCallback(req, res, next);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/integrations/shopify/error?error=')
      );
      expect(redisClient.get).not.toHaveBeenCalled();
    });

    it('should reject invalid or expired state', async () => {
      req.query = {
        code: 'test-code',
        state: 'invalid-state',
        shop: 'test-shop.myshopify.com',
        hmac: 'test-hmac'
      };

      shopifyAuthService.verifyHmac.mockReturnValue(true);
      redisClient.get.mockResolvedValue(null);
      process.env.FRONTEND_URL = 'http://localhost:3000';

      await handleOAuthCallback(req, res, next);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/integrations/shopify/error?error=')
      );
    });

    it('should reject shop mismatch', async () => {
      req.query = {
        code: 'test-code',
        state: 'test-state',
        shop: 'different-shop.myshopify.com',
        hmac: 'test-hmac'
      };

      const storedData = JSON.stringify({
        shop: 'test-shop.myshopify.com',
        userId: 1,
        codeVerifier: 'test-verifier',
        timestamp: Date.now()
      });

      shopifyAuthService.verifyHmac.mockReturnValue(true);
      redisClient.get.mockResolvedValue(storedData);
      process.env.FRONTEND_URL = 'http://localhost:3000';

      await handleOAuthCallback(req, res, next);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/integrations/shopify/error?error=')
      );
      expect(shopifyAuthService.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it('should handle missing required parameters', async () => {
      req.query = {
        code: 'test-code',
        // missing state, shop, hmac
      };

      process.env.FRONTEND_URL = 'http://localhost:3000';

      await handleOAuthCallback(req, res, next);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('/integrations/shopify/error?error=')
      );
      expect(shopifyAuthService.verifyHmac).not.toHaveBeenCalled();
    });
  });
});