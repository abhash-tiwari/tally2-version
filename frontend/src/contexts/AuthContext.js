import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('tallyToken'));
  const [loading, setLoading] = useState(true);

  // Configure axios defaults
  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [token]);

  // Check for token in URL (from Google OAuth callback)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('token');
    const errorFromUrl = urlParams.get('error');

    if (tokenFromUrl) {
      localStorage.setItem('tallyToken', tokenFromUrl);
      setToken(tokenFromUrl);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (errorFromUrl) {
      console.error('Authentication error:', errorFromUrl);
      alert('Authentication failed. Please try again.');
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Fetch user info when token is available
  useEffect(() => {
    const fetchUser = async () => {
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const response = await axios.get(`${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/auth/me`);
        setUser(response.data.user);
      } catch (error) {
        console.error('Failed to fetch user:', error);
        // Token might be invalid, remove it
        localStorage.removeItem('tallyToken');
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, [token]);

  const login = () => {
    window.location.href = `${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/auth/google`;
  };

  const logout = async () => {
    try {
      await axios.post(`${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/auth/logout`);
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      localStorage.removeItem('tallyToken');
      setToken(null);
      setUser(null);
      delete axios.defaults.headers.common['Authorization'];
    }
  };

  const value = {
    user,
    token,
    loading,
    login,
    logout,
    isAuthenticated: !!user
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
