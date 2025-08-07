const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Google OAuth login
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Google OAuth callback
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    try {
      // Generate JWT token
      const token = jwt.sign(
        { 
          userId: req.user._id,
          googleId: req.user.googleId,
          email: req.user.email,
          name: req.user.name
        },
        process.env.JWT_SECRET || 'tally-gpt-secret-key',
        { expiresIn: '30d' }
      );

      console.log('[AUTH] JWT token generated for user:', req.user.email);

      // Redirect to frontend with token
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}?token=${token}`);
    } catch (error) {
      console.error('[AUTH] Error generating JWT:', error);
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}?error=auth_failed`);
    }
  }
);

// Logout
router.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('[AUTH] Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

// Get current user info
router.get('/me', authenticateToken, (req, res) => {
  res.json({
    user: {
      id: req.user.userId,
      email: req.user.email,
      name: req.user.name,
      googleId: req.user.googleId
    }
  });
});

// Middleware to authenticate JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'tally-gpt-secret-key', (err, user) => {
    if (err) {
      console.error('[AUTH] Token verification failed:', err);
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
}

module.exports = { router, authenticateToken };
