const bcrypt = require('bcrypt');
const db = require('../../config/database');
const { generateToken } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

const authController = {
  // Sign up new user
  signup: async (req, res, next) => {
    try {
      const { email, password } = req.body;

      // Check if user already exists
      const existingUser = await db.query(
        'SELECT user_id FROM users WHERE email = $1',
        [email]
      );

      if (existingUser.rows.length > 0) {
        throw new ApiError(409, 'User already exists');
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const result = await db.query(
        `INSERT INTO users (email, password) 
         VALUES ($1, $2) 
         RETURNING user_id, email, created_at`,
        [email, hashedPassword]
      );

      const user = result.rows[0];

      // Create default settings for user
      await db.query(
        `INSERT INTO user_settings (user_id) VALUES ($1)`,
        [user.user_id]
      );

      res.status(201).json({
        message: 'User created successfully',
        user: {
          user_id: user.user_id,
          email: user.email,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // Login user
  login: async (req, res, next) => {
    try {
      const { email, password } = req.body;

      // Find user
      const result = await db.query(
        'SELECT user_id, email, password FROM users WHERE email = $1',
        [email]
      );

      if (result.rows.length === 0) {
        throw new ApiError(401, 'Invalid credentials');
      }

      const user = result.rows[0];

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        throw new ApiError(401, 'Invalid credentials');
      }

      // Generate JWT token
      const token = generateToken({
        user_id: user.user_id,
        email: user.email,
      });

      // Set cookie
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });

      res.json({
        message: 'Login successful',
        token,
        user: {
          user_id: user.user_id,
          email: user.email,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  // Logout user
  logout: async (req, res, next) => {
    try {
      res.clearCookie('token');
      res.json({ message: 'Logout successful' });
    } catch (error) {
      next(error);
    }
  },

  // Get current user
  getCurrentUser: async (req, res, next) => {
    try {
      const userId = req.user.user_id;

      const result = await db.query(
        `SELECT u.user_id, u.email, u.created_at,
                s.low_stock_threshold, s.alert_email_enabled, s.time_zone
         FROM users u
         LEFT JOIN user_settings s ON u.user_id = s.user_id
         WHERE u.user_id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        throw new ApiError(404, 'User not found');
      }

      const user = result.rows[0];

      res.json({
        user: {
          user_id: user.user_id,
          email: user.email,
          created_at: user.created_at,
          settings: {
            low_stock_threshold: user.low_stock_threshold,
            alert_email_enabled: user.alert_email_enabled,
            time_zone: user.time_zone,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  },
};

module.exports = authController;