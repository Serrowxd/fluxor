const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

// Shopify OAuth routes
router.get('/authorize', authenticateToken, (req, res) => {
  res.json({ message: 'Shopify authorize endpoint - to be implemented' });
});

router.get('/callback', (req, res) => {
  res.json({ message: 'Shopify callback endpoint - to be implemented' });
});

router.get('/stores', authenticateToken, (req, res) => {
  res.json({ stores: [] });
});

module.exports = router;