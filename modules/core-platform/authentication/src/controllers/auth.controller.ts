/**
 * Authentication Controller
 * HTTP endpoint handlers for authentication
 */

import { Request, Response } from 'express';
import { AuthenticationService } from '../services/authentication.service';

export class AuthController {
  constructor(private authService: AuthenticationService) {}

  login = async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const tokens = await this.authService.authenticate({ email, password });
      
      // Set refresh token as httpOnly cookie
      res.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });

      res.json({
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn
      });
    } catch (error) {
      res.status(401).json({ error: error.message });
    }
  };

  refresh = async (req: Request, res: Response) => {
    try {
      const refreshToken = req.cookies.refreshToken;
      
      if (!refreshToken) {
        return res.status(401).json({ error: 'No refresh token provided' });
      }

      const tokens = await this.authService.refreshTokens(refreshToken);
      
      // Set new refresh token
      res.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      res.json({
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn
      });
    } catch (error) {
      res.status(401).json({ error: error.message });
    }
  };

  logout = async (req: Request, res: Response) => {
    try {
      const refreshToken = req.cookies.refreshToken;
      
      if (refreshToken) {
        await this.authService.logout(refreshToken);
      }

      res.clearCookie('refreshToken');
      res.json({ message: 'Logged out successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
}