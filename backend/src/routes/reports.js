const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, (req, res) => {
  res.json({ reports: [] });
});

router.get('/download/:reportId', authenticateToken, (req, res) => {
  res.json({ message: 'Report download endpoint - to be implemented' });
});

module.exports = router;