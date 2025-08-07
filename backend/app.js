require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const session = require('express-session');
const passport = require('./config/passport');
const fileUploadRoutes = require('./routes/fileUpload');
const chatRoutes = require('./routes/chat');
const { router: authRoutes } = require('./routes/auth');

const app = express();

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

app.use(express.json());

// Session configuration for Passport
app.use(session({
  secret: process.env.SESSION_SECRET || 'tally-gpt-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI).then(() => {
  console.log('MongoDB connected');
  console.log('[AUTH] Google OAuth configured');
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

// Routes
app.use('/auth', authRoutes);
app.use('/api/upload', fileUploadRoutes);
app.use('/api/chat', chatRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Google OAuth callback: http://localhost:${PORT}/auth/google/callback`);
});