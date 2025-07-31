const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, (req, res) => {
  res.json({ inventory: [] });
});

router.post('/sync', authenticateToken, (req, res) => {
  res.json({ success: true, message: 'Sync queued' });
});

module.exports = router;