const express = require('express');
const { StreamClient } = require('@stream-io/node-sdk');
const eduAuthMiddleware = require('../middleware/eduAuthMiddleware');

const router = express.Router();

const apiKey = process.env.STREAM_API_KEY;
const apiSecret = process.env.STREAM_API_SECRET;

if (!apiKey || !apiSecret) {
  console.warn('STREAM_API_KEY or STREAM_API_SECRET is not configured in .env');
}

const client = new StreamClient(apiKey, apiSecret);

/**
 * @route GET /api/stream/token
 * @desc Generate an access token for Stream Video SDK
 * @access Private
 */
router.get('/token', eduAuthMiddleware, (req, res) => {
  try {
    // 1. Get the current user ID from auth middleware
    // Note: eduAuthMiddleware sets req.user.id as a Number
    const userId = req.user.id.toString(); 

    // 2. Set token expiration (e.g., 1 hour)
    const expiration = Math.floor(Date.now() / 1000) + 3600;
    
    // 3. Create the token
    const token = client.createToken(userId, expiration);

    // 4. Return to frontend
    res.json({ 
      success: true, 
      data: {
        token,
        apiKey
      }
    });
  } catch (error) {
    console.error('Stream Token Error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate video token' });
  }
});

module.exports = router;
