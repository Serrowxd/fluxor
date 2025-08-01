/**
 * Authentication Middleware
 * Validates JWT tokens and adds user context to requests
 */

import { Request, Response, NextFunction } from 'express';
import { JWTService } from '../services/jwt.service';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        storeId: string;
        role: string;
      };
    }
  }
}

export const authMiddleware = (jwtService: JWTService) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
      }

      const token = authHeader.split(' ')[1];
      const payload = await jwtService.verifyToken(token);
      
      req.user = payload;
      next();
    } catch (error) {
      if (error.message === 'Token expired') {
        return res.status(401).json({ error: 'Token expired' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
};