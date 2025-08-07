import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import './LoginComponent.css';

const LoginComponent = () => {
  const { login } = useAuth();

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h1>🔐 Welcome to Tally GPT</h1>
          <p>Sign in with Google to access your personalized Tally data analysis</p>
        </div>
        
        <div className="login-content">
          <div className="features-list">
            <div className="feature-item">
              <span className="feature-icon">📊</span>
              <span>Upload and analyze your Tally data</span>
            </div>
            <div className="feature-item">
              <span className="feature-icon">🤖</span>
              <span>Chat with AI about your financial data</span>
            </div>
            <div className="feature-item">
              <span className="feature-icon">🔒</span>
              <span>Secure, personalized data storage</span>
            </div>
            <div className="feature-item">
              <span className="feature-icon">📈</span>
              <span>Get instant insights and reports</span>
            </div>
          </div>
          
          <button 
            className="google-login-btn"
            onClick={login}
          >
            <img 
              src="https://developers.google.com/identity/images/g-logo.png" 
              alt="Google"
              className="google-icon"
            />
            Continue with Google
          </button>
          
          <p className="privacy-note">
            We only access your basic profile information to personalize your experience.
            Your Tally data remains private and secure.
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginComponent;
