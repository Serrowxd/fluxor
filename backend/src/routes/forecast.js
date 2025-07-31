const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, (req, res) => {
  res.json({ forecasts: [] });
});

router.post('/run', authenticateToken, (req, res) => {
  res.json({ success: true, message: 'Forecast job queued' });
});

module.exports = router;