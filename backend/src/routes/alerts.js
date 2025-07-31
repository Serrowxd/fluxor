const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, (req, res) => {
  res.json({ alerts: [] });
});

router.post('/send', authenticateToken, (req, res) => {
  res.json({ success: true, message: 'Test alert sent' });
});

module.exports = router;