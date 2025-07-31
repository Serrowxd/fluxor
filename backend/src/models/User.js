const db = require('../../config/database');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

class User {
  static async create({ email, password }) {
    const userId = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await db.query(
      `INSERT INTO users (user_id, email, password) 
       VALUES ($1, $2, $3) 
       RETURNING user_id, email, created_at`,
      [userId, email, hashedPassword]
    );
    
    return result.rows[0];
  }

  static async findByEmail(email) {
    const result = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    
    return result.rows[0] || null;
  }

  static async findById(userId) {
    const result = await db.query(
      'SELECT user_id, email, created_at FROM users WHERE user_id = $1',
      [userId]
    );
    
    return result.rows[0] || null;
  }

  static async verifyPassword(plainPassword, hashedPassword) {
    return bcrypt.compare(plainPassword, hashedPassword);
  }

  static async updatePassword(userId, newPassword) {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    const result = await db.query(
      `UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE user_id = $2 
       RETURNING user_id, email`,
      [hashedPassword, userId]
    );
    
    return result.rows[0];
  }
}

module.exports = User;