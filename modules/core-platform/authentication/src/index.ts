/**
 * Authentication Module
 * Handles user authentication, JWT management, and token refresh
 */

import { Module, ModuleConfig, ModuleExports, HealthCheckResult } from '../../../shared/interfaces/module.interface';
import { AuthenticationService } from './services/authentication.service';
import { JWTService } from './services/jwt.service';
import { RefreshTokenService } from './services/refresh-token.service';
import { authMiddleware } from './middleware/auth.middleware';
import { AuthController } from './controllers/auth.controller';

export class AuthenticationModule implements Module {
  name = 'authentication';
  version = '1.0.0';
  config: ModuleConfig;
  
  private authService: AuthenticationService;
  private jwtService: JWTService;
  private refreshTokenService: RefreshTokenService;
  private authController: AuthController;
  private isInitialized = false;

  async initialize(config: ModuleConfig): Promise<void> {
    this.config = config;
    
    // Initialize services
    this.jwtService = new JWTService({
      secret: config.environment?.JWT_SECRET || 'default-secret',
      expiresIn: config.environment?.JWT_EXPIRES_IN || '15m',
      refreshExpiresIn: config.environment?.REFRESH_EXPIRES_IN || '7d'
    });
    
    this.refreshTokenService = new RefreshTokenService();
    
    this.authService = new AuthenticationService(
      this.jwtService,
      this.refreshTokenService
    );
    
    this.authController = new AuthController(this.authService);
    
    this.isInitialized = true;
    console.log(`${this.name} module initialized`);
  }

  getExports(): ModuleExports {
    if (!this.isInitialized) {
      throw new Error('Module not initialized');
    }
    
    return {
      services: {
        authenticationService: this.authService,
        jwtService: this.jwtService,
        refreshTokenService: this.refreshTokenService
      },
      controllers: {
        authController: this.authController
      },
      middleware: {
        authMiddleware: authMiddleware(this.jwtService)
      }
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const checks = {
      initialized: this.isInitialized,
      jwtServiceReady: this.jwtService?.isReady() || false,
      refreshTokenServiceReady: this.refreshTokenService?.isReady() || false
    };
    
    const isHealthy = Object.values(checks).every(check => check === true);
    
    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date(),
      details: checks
    };
  }

  async shutdown(): Promise<void> {
    // Cleanup resources
    await this.refreshTokenService?.cleanup();
    this.isInitialized = false;
    console.log(`${this.name} module shut down`);
  }

  isReady(): boolean {
    return this.isInitialized;
  }
}