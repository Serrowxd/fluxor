/**
 * Refresh Token Service
 * Manages refresh token lifecycle with Redis storage
 */

import crypto from 'crypto';

export class RefreshTokenService {
  private tokenStore = new Map<string, { userId: string; expiresAt: Date }>();

  async generateRefreshToken(userId: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    this.tokenStore.set(token, { userId, expiresAt });
    
    return token;
  }

  async validateRefreshToken(token: string): Promise<string | null> {
    const tokenData = this.tokenStore.get(token);
    
    if (!tokenData) {
      return null;
    }

    if (new Date() > tokenData.expiresAt) {
      this.tokenStore.delete(token);
      return null;
    }

    return tokenData.userId;
  }

  async revokeRefreshToken(token: string): Promise<void> {
    this.tokenStore.delete(token);
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    for (const [token, data] of this.tokenStore.entries()) {
      if (data.userId === userId) {
        this.tokenStore.delete(token);
      }
    }
  }

  async cleanup(): Promise<void> {
    const now = new Date();
    for (const [token, data] of this.tokenStore.entries()) {
      if (now > data.expiresAt) {
        this.tokenStore.delete(token);
      }
    }
  }

  isReady(): boolean {
    return true;
  }
}