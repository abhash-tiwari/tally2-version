const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  try {
    console.log('[AUTH] Google OAuth callback for user:', profile.displayName);
    
    // Check if user already exists
    let user = await User.findOne({ googleId: profile.id });
    
    if (user) {
      // Update last login time
      user.lastLoginAt = new Date();
      await user.save();
      console.log('[AUTH] Existing user logged in:', user.email);
      return done(null, user);
    }
    
    // Create new user
    user = new User({
      googleId: profile.id,
      email: profile.emails[0].value,
      name: profile.displayName,
      picture: profile.photos[0].value
    });
    
    await user.save();
    console.log('[AUTH] New user created:', user.email);
    return done(null, user);
    
  } catch (error) {
    console.error('[AUTH] Error in Google OAuth:', error);
    return done(error, null);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;
