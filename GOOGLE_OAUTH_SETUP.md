# Google OAuth Setup Guide for Tally-GPT

## 🚀 Quick Setup Steps

### 1. **Google Cloud Console Setup**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing project
3. Enable the **Google+ API** and **Google OAuth2 API**
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client IDs**
5. Configure OAuth consent screen:
   - Application name: `Tally GPT`
   - Authorized domains: `localhost` (for development)
6. Create OAuth 2.0 Client ID:
   - Application type: **Web application**
   - Authorized redirect URIs: `http://localhost:5000/auth/google/callback`

### 2. **Environment Configuration**

1. Copy `.env.example` to `.env` in the backend folder
2. Fill in your Google OAuth credentials:

```bash
# Copy the example file
cp .env.example .env

# Edit the .env file with your credentials
GOOGLE_CLIENT_ID=your_actual_google_client_id_here
GOOGLE_CLIENT_SECRET=your_actual_google_client_secret_here
```

### 3. **Install Dependencies**

Backend dependencies should already be installed, but if needed:

```bash
cd backend
npm install passport passport-google-oauth20 jsonwebtoken express-session
```

### 4. **Start the Application**

```bash
# Terminal 1: Start Backend
cd backend
npm start

# Terminal 2: Start Frontend  
cd frontend
npm start
```

### 5. **Test Google OAuth**

1. Open `http://localhost:3000`
2. Click "Continue with Google"
3. Complete Google OAuth flow
4. You should be redirected back with authentication

## 🔧 **Configuration Details**

### **OAuth Redirect URI**
- Development: `http://localhost:5000/auth/google/callback`
- Production: `https://yourdomain.com/auth/google/callback`

### **Required Environment Variables**
```bash
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
JWT_SECRET=your_jwt_secret_key
SESSION_SECRET=your_session_secret_key
FRONTEND_URL=http://localhost:3000
```

## 🛡️ **Security Notes**

- JWT tokens expire in 30 days
- User sessions are secure with httpOnly cookies
- Google OAuth scopes: `profile` and `email` only
- User data is stored securely in MongoDB with Google ID indexing

## 🔍 **Troubleshooting**

### **Common Issues:**

1. **"Unauthorized" error**: Check redirect URI matches exactly
2. **"Invalid client" error**: Verify CLIENT_ID and CLIENT_SECRET
3. **CORS errors**: Ensure FRONTEND_URL is set correctly
4. **Token errors**: Check JWT_SECRET is set and consistent

### **Debug Logs:**
The backend logs authentication steps. Check console for:
- `[AUTH] Google OAuth callback for user: [name]`
- `[AUTH] JWT token generated for user: [email]`
- `[UPLOAD] Authenticated user: [email] uploading file: [filename]`

## 🎯 **What's New with Google Auth**

- ✅ **Secure user identification** (no more IP-based)
- ✅ **Cross-device access** with Google account
- ✅ **Persistent user data** across sessions
- ✅ **User profile display** with Google avatar
- ✅ **Protected API endpoints** with JWT authentication
- ✅ **Seamless login/logout** experience

Your Tally-GPT is now ready for production with secure Google OAuth! 🚀
