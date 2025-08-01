/**
 * JWT Service
 * Handles JWT token generation and validation
 */

import jwt from 'jsonwebtoken';

export interface JWTConfig {
  secret: string;
  expiresIn: string;
  refreshExpiresIn: string;
}

export interface TokenPayload {
  userId: string;
  email: string;
  storeId: string;
  role: string;
}

export class JWTService {
  constructor(private config: JWTConfig) {}

  async generateToken(payload: TokenPayload): Promise<string> {
    return jwt.sign(payload, this.config.secret, {
      expiresIn: this.config.expiresIn,
      issuer: 'fluxor-auth',
      audience: 'fluxor-api'
    });
  }

  async verifyToken(token: string): Promise<TokenPayload> {
    try {
      const decoded = jwt.verify(token, this.config.secret, {
        issuer: 'fluxor-auth',
        audience: 'fluxor-api'
      }) as TokenPayload;
      
      return decoded;
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid token');
      }
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Token expired');
      }
      throw error;
    }
  }

  decodeToken(token: string): TokenPayload | null {
    try {
      return jwt.decode(token) as TokenPayload;
    } catch {
      return null;
    }
  }

  isReady(): boolean {
    return !!this.config.secret;
  }
}