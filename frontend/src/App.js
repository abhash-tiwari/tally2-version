import React, { useState, useRef } from 'react';
import axios from 'axios';
import ChatComponent from './ChatComponent';
import LoginComponent from './components/LoginComponent';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import './App.css';

function AppContent() {
  const { user, loading, logout, isAuthenticated, token } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [showChat, setShowChat] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState('');
  const [isPLUpload, setIsPLUpload] = useState(false);
  const fileInputRef = useRef();

  // Show loading spinner while checking authentication
  if (loading) {
    return (
      <div className="App">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  // Show login if not authenticated
  if (!isAuthenticated) {
    return <LoginComponent />;
  }

  // Handle file upload
  const handleFileUpload = async (e) => {
    e.preventDefault();
    setUploading(true);
    setUploadError('');
    const file = fileInputRef.current.files[0];
    if (!file) {
      setUploadError('Please select a file.');
      setUploading(false);
      return;
    }
    setUploadedFile(file);
    console.log('[FRONTEND] File selected:', file.name, 'size:', file.size, 'P&L mode:', isPLUpload);

    try {
      if (isPLUpload) {
        // P&L Upload - send as FormData like TallyData
        const formData = new FormData();
        formData.append('file', file);
        console.log('[FRONTEND] Uploading P&L file...');
        const res = await fetch('http://localhost:5000/api/pl/upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData,
        });
        const data = await res.json();
        if (res.ok) {
          setUploadSuccess(`P&L file uploaded successfully! Company: ${data.companyName}, Chunks: ${data.chunksUploaded}`);
          setShowChat(true);
          console.log('[FRONTEND] P&L Upload success:', data);
        } else {
          setUploadError(data.error || 'P&L upload failed.');
          console.log('[FRONTEND] P&L Upload failed:', data.error);
        }
      } else {
        // Regular Tally Data Upload
        const formData = new FormData();
        formData.append('file', file);
        console.log('[FRONTEND] Uploading Tally file...');
        const res = await fetch('http://localhost:5000/api/upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData,
        });
        const data = await res.json();
        if (res.ok) {
          setUploadSuccess(data.message || 'File uploaded successfully!');
          setShowChat(true);
          console.log('[FRONTEND] Upload success:', data.message);
          console.log('[FRONTEND] File added to user data collection:', data.fileName);
        } else {
          setUploadError(data.error || 'Upload failed.');
          console.log('[FRONTEND] Upload failed:', data.error);
        }
      }
    } catch (err) {
      setUploadError('Upload failed.');
      console.log('[FRONTEND] Upload failed:', err);
    }
    setUploading(false);
  };

  return (
    <div className="App">
      <header className="App-header">
        {/* Floating Chat Button */}
        <button 
          className="floating-chat-btn" 
          onClick={() => setShowChat(true)}
          title="Chat with AI about your Tally data"
        >
          AI
        </button>
        
        {/* User Profile & Logout */}
        <div className="user-profile">
          <img src={user.picture || '/default-avatar.png'} alt="Profile" className="profile-pic" />
          <span className="user-name">Welcome, {user.name}!</span>
          <button className="logout-btn" onClick={logout}>Logout</button>
        </div>
        
        <h1>Tally GPT</h1>
        <p className="subtitle">Upload your Tally data and chat with AI to get instant insights</p>
        
        <div className="upload-container">
          <div className="upload-section">
            <h2>📁 Upload Data</h2>
            
            {/* Upload Type Toggle */}
            <div className="upload-type-toggle">
              <label className="toggle-option">
                <input
                  type="radio"
                  name="uploadType"
                  checked={!isPLUpload}
                  onChange={() => setIsPLUpload(false)}
                  disabled={uploading}
                />
                <span className="toggle-label">📊 Tally Data</span>
              </label>
              <label className="toggle-option">
                <input
                  type="radio"
                  name="uploadType"
                  checked={isPLUpload}
                  onChange={() => setIsPLUpload(true)}
                  disabled={uploading}
                />
                <span className="toggle-label">📈 P&L Statement</span>
              </label>
            </div>

            <form className="upload-form" onSubmit={handleFileUpload}>
              <input
                type="file"
                accept={isPLUpload ? ".txt,.csv" : ".xml,.xlsx,.pdf,.zip,.txt"}
                ref={fileInputRef}
                disabled={uploading}
              />
              <button type="submit" disabled={uploading} className="primary-btn">
                {uploading ? 'Uploading...' : isPLUpload ? 'Upload P&L Data' : 'Upload Tally Data'}
              </button>
            </form>
            {uploadedFile && (
              <div className="upload-success">
                Uploaded file: <b>{uploadedFile.name}</b> ({uploadedFile.size} bytes)
              </div>
            )}
            {uploadSuccess && (
              <div className="upload-success">
                {uploadSuccess}
              </div>
            )}
            {uploadError && <div className="error">{uploadError}</div>}
            <p className="file-info">
              {isPLUpload 
                ? "Supported formats: .TXT, .CSV (P&L statements)" 
                : "Supported formats: .XML, .TXT, Excel (.xlsx), PDF, ZIP (Tally data)"
              }
            </p>
          </div>
        </div>
      </header>
      
      {showChat && (
        <ChatComponent 
          onClose={() => {
            setShowChat(false);
            // Reset upload state when closing chat
            setUploadedFile(null);
            setUploadSuccess('');
            setUploadError('');
          }} 
        />
      )}
    </div>
  );
}

// Wrapper App with AuthProvider
function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
