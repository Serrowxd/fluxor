const shopifyAuthService = require('../../services/shopifyAuthService');
const shopifyTokenModel = require('../../models/shopifyTokenModel');
const axios = require('axios');

// Mock dependencies
jest.mock('../../models/shopifyTokenModel');
jest.mock('axios');
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

// Need real crypto for these tests
const crypto = require('crypto');

// Mock environment variables
process.env.SHOPIFY_CLIENT_ID = 'test-client-id';
process.env.SHOPIFY_CLIENT_SECRET = 'test-client-secret';
process.env.APP_URL = 'https://app.fluxor.com';
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

describe('ShopifyAuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isValidShopDomain', () => {
    it('should validate correct shop domains', () => {
      expect(shopifyAuthService.isValidShopDomain('test-shop.myshopify.com')).toBe(true);
      expect(shopifyAuthService.isValidShopDomain('my-store-123.myshopify.com')).toBe(true);
      expect(shopifyAuthService.isValidShopDomain('a.myshopify.com')).toBe(true);
    });

    it('should reject invalid shop domains', () => {
      expect(shopifyAuthService.isValidShopDomain('test-shop.com')).toBe(false);
      expect(shopifyAuthService.isValidShopDomain('myshopify.com')).toBe(false);
      expect(shopifyAuthService.isValidShopDomain('test-shop.myshopify.com.evil.com')).toBe(false);
      expect(shopifyAuthService.isValidShopDomain('')).toBe(false);
      expect(shopifyAuthService.isValidShopDomain('https://test-shop.myshopify.com')).toBe(false);
    });
  });

  describe('generateAuthorizationUrl', () => {
    it('should generate correct authorization URL', () => {
      const params = {
        shop: 'test-shop.myshopify.com',
        state: 'test-state-123',
        codeChallenge: 'test-challenge-abc'
      };

      const url = shopifyAuthService.generateAuthorizationUrl(params);

      expect(url).toContain('https://test-shop.myshopify.com/admin/oauth/authorize');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('state=test-state-123');
      expect(url).toContain('code_challenge=test-challenge-abc');
      expect(url).toContain('code_challenge_method=S256');
      expect(url).toContain('scope=');
      expect(url).toContain('redirect_uri=');
    });
  });

  describe('verifyHmac', () => {
    it('should verify valid HMAC signature', () => {
      const secret = 'test-client-secret';
      process.env.SHOPIFY_CLIENT_SECRET = secret;

      const params = {
        code: 'test-code',
        shop: 'test-shop.myshopify.com',
        state: 'test-state',
        timestamp: '1234567890'
      };

      // Generate valid HMAC
      const queryString = Object.keys(params)
        .sort()
        .map(key => `${key}=${params[key]}`)
        .join('&');
      
      const validHmac = crypto
        .createHmac('sha256', secret)
        .update(queryString)
        .digest('hex');

      const query = { ...params, hmac: validHmac };

      expect(shopifyAuthService.verifyHmac(query)).toBe(true);
    });

    it('should reject invalid HMAC signature', () => {
      const query = {
        code: 'test-code',
        shop: 'test-shop.myshopify.com',
        state: 'test-state',
        timestamp: '1234567890',
        hmac: 'invalid-hmac-signature'
      };

      expect(shopifyAuthService.verifyHmac(query)).toBe(false);
    });
  });

  describe('exchangeCodeForToken', () => {
    it('should successfully exchange code for token', async () => {
      const mockResponse = {
        data: {
          access_token: 'test-access-token',
          scope: 'read_products,write_products'
        }
      };

      axios.post.mockResolvedValue(mockResponse);

      const result = await shopifyAuthService.exchangeCodeForToken({
        shop: 'test-shop.myshopify.com',
        code: 'test-code',
        codeVerifier: 'test-verifier'
      });

      expect(axios.post).toHaveBeenCalledWith(
        'https://test-shop.myshopify.com/admin/oauth/access_token',
        {
          client_id: 'test-client-id',
          client_secret: 'test-client-secret',
          code: 'test-code',
          code_verifier: 'test-verifier'
        },
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000
        })
      );

      expect(result).toEqual(mockResponse.data);
    });

    it('should throw error when no access token received', async () => {
      axios.post.mockResolvedValue({ data: {} });

      await expect(
        shopifyAuthService.exchangeCodeForToken({
          shop: 'test-shop.myshopify.com',
          code: 'test-code',
          codeVerifier: 'test-verifier'
        })
      ).rejects.toThrow('No access token received from Shopify');
    });

    it('should handle API errors', async () => {
      const errorResponse = {
        response: {
          status: 400,
          data: {
            error: 'invalid_request',
            error_description: 'Invalid authorization code'
          }
        }
      };

      axios.post.mockRejectedValue(errorResponse);

      await expect(
        shopifyAuthService.exchangeCodeForToken({
          shop: 'test-shop.myshopify.com',
          code: 'invalid-code',
          codeVerifier: 'test-verifier'
        })
      ).rejects.toThrow('Token exchange failed: Invalid authorization code');
    });
  });

  describe('storeAccessToken', () => {
    it('should encrypt and store access token', async () => {
      shopifyTokenModel.upsertToken.mockResolvedValue({
        id: 1,
        shop_domain: 'test-shop.myshopify.com'
      });

      await shopifyAuthService.storeAccessToken({
        shop: 'test-shop.myshopify.com',
        accessToken: 'test-access-token',
        scope: 'read_products',
        userId: 123
      });

      expect(shopifyTokenModel.upsertToken).toHaveBeenCalledWith({
        shopDomain: 'test-shop.myshopify.com',
        encryptedAccessToken: expect.any(String),
        encryptionIv: expect.any(String),
        scope: 'read_products',
        userId: 123
      });

      // Verify the token was encrypted (not plaintext)
      const callArgs = shopifyTokenModel.upsertToken.mock.calls[0][0];
      expect(callArgs.encryptedAccessToken).not.toBe('test-access-token');
      expect(callArgs.encryptedAccessToken.length).toBeGreaterThan(32); // Encrypted + auth tag
    });
  });

  describe('getAccessToken', () => {
    it('should retrieve and decrypt access token', async () => {
      // First store a token to get encrypted data
      const testToken = 'test-access-token';
      const encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
      const iv = crypto.randomBytes(16);
      
      // Encrypt the token
      const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
      let encrypted = cipher.update(testToken, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag();
      const encryptedData = encrypted + authTag.toString('hex');

      shopifyTokenModel.getTokenByShop.mockResolvedValue({
        shop_domain: 'test-shop.myshopify.com',
        encrypted_access_token: encryptedData,
        encryption_iv: iv.toString('hex'),
        scope: 'read_products'
      });

      const result = await shopifyAuthService.getAccessToken('test-shop.myshopify.com');

      expect(result).toEqual({
        accessToken: testToken,
        scope: 'read_products',
        shopDomain: 'test-shop.myshopify.com'
      });
    });

    it('should throw error when token not found', async () => {
      shopifyTokenModel.getTokenByShop.mockResolvedValue(null);

      await expect(
        shopifyAuthService.getAccessToken('nonexistent-shop.myshopify.com')
      ).rejects.toThrow('No access token found for shop');
    });
  });

  describe('validateToken', () => {
    it('should return true for valid token', async () => {
      // Mock getAccessToken
      jest.spyOn(shopifyAuthService, 'getAccessToken').mockResolvedValue({
        accessToken: 'valid-token',
        scope: 'read_products',
        shopDomain: 'test-shop.myshopify.com'
      });

      axios.get.mockResolvedValue({ status: 200 });

      const isValid = await shopifyAuthService.validateToken('test-shop.myshopify.com');

      expect(isValid).toBe(true);
      expect(axios.get).toHaveBeenCalledWith(
        'https://test-shop.myshopify.com/admin/api/2024-01/shop.json',
        expect.objectContaining({
          headers: { 'X-Shopify-Access-Token': 'valid-token' }
        })
      );
    });

    it('should return false for invalid token', async () => {
      jest.spyOn(shopifyAuthService, 'getAccessToken').mockResolvedValue({
        accessToken: 'invalid-token',
        scope: 'read_products',
        shopDomain: 'test-shop.myshopify.com'
      });

      axios.get.mockRejectedValue({
        response: { status: 401 }
      });

      const isValid = await shopifyAuthService.validateToken('test-shop.myshopify.com');

      expect(isValid).toBe(false);
    });
  });

  describe('revokeToken', () => {
    it('should delete token from database', async () => {
      shopifyTokenModel.deleteToken.mockResolvedValue({ id: 1 });

      await shopifyAuthService.revokeToken('test-shop.myshopify.com', 123);

      expect(shopifyTokenModel.deleteToken).toHaveBeenCalledWith(
        'test-shop.myshopify.com',
        123
      );
    });

    it('should handle deletion errors', async () => {
      shopifyTokenModel.deleteToken.mockRejectedValue(new Error('Database error'));

      await expect(
        shopifyAuthService.revokeToken('test-shop.myshopify.com', 123)
      ).rejects.toThrow('Failed to revoke token');
    });
  });
});