/**
 * Authentication Service
 * Core authentication logic with secure practices
 */

import bcrypt from 'bcryptjs';
import { JWTService } from './jwt.service';
import { RefreshTokenService } from './refresh-token.service';

export interface Credentials {
  email: string;
  password: string;
}

export interface AuthToken {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface User {
  id: string;
  email: string;
  storeId: string;
  role: string;
}

export class AuthenticationService {
  constructor(
    private jwtService: JWTService,
    private refreshTokenService: RefreshTokenService
  ) {}

  async authenticate(credentials: Credentials): Promise<AuthToken> {
    // In a real implementation, this would query the database
    // For now, we'll use the existing user model structure
    const user = await this.validateCredentials(credentials);
    
    if (!user) {
      throw new Error('Invalid credentials');
    }

    // Generate tokens
    const accessToken = await this.jwtService.generateToken({
      userId: user.id,
      email: user.email,
      storeId: user.storeId,
      role: user.role
    });

    const refreshToken = await this.refreshTokenService.generateRefreshToken(user.id);

    return {
      accessToken,
      refreshToken,
      expiresIn: 900 // 15 minutes
    };
  }

  async refreshTokens(refreshToken: string): Promise<AuthToken> {
    const userId = await this.refreshTokenService.validateRefreshToken(refreshToken);
    
    if (!userId) {
      throw new Error('Invalid refresh token');
    }

    // Get user data (would query database in real implementation)
    const user = await this.getUserById(userId);
    
    if (!user) {
      throw new Error('User not found');
    }

    // Rotate refresh token
    await this.refreshTokenService.revokeRefreshToken(refreshToken);
    const newRefreshToken = await this.refreshTokenService.generateRefreshToken(user.id);

    // Generate new access token
    const accessToken = await this.jwtService.generateToken({
      userId: user.id,
      email: user.email,
      storeId: user.storeId,
      role: user.role
    });

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: 900
    };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.refreshTokenService.revokeRefreshToken(refreshToken);
  }

  private async validateCredentials(credentials: Credentials): Promise<User | null> {
    // This would normally query the database
    // For demonstration, using a mock validation
    const mockUser: User = {
      id: '123',
      email: credentials.email,
      storeId: '456',
      role: 'admin'
    };

    // In real implementation, compare with hashed password from database
    const validPassword = await bcrypt.compare(credentials.password, await bcrypt.hash('password', 10));
    
    if (credentials.email && validPassword) {
      return mockUser;
    }

    return null;
  }

  private async getUserById(userId: string): Promise<User | null> {
    // Mock implementation - would query database
    return {
      id: userId,
      email: 'user@example.com',
      storeId: '456',
      role: 'admin'
    };
  }
}