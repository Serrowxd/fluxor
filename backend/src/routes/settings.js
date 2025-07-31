const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');

router.get('/', authenticateToken, (req, res) => {
  res.json({ settings: {} });
});

router.put('/', authenticateToken, validate(schemas.updateSettings), (req, res) => {
  res.json({ success: true, message: 'Settings updated' });
});

module.exports = router;