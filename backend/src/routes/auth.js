const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { validate, schemas } = require('../middleware/validation');
const { authenticateToken } = require('../middleware/auth');

// Public routes
router.post('/signup', validate(schemas.signup), authController.signup);
router.post('/login', validate(schemas.login), authController.login);
router.post('/logout', authController.logout);

// Protected routes
router.get('/me', authenticateToken, authController.getCurrentUser);

module.exports = router;