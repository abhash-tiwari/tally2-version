import React, { useState, useRef } from 'react';
import './App.css';
import ChatComponent from './ChatComponent';

function App() {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
  const [showChat, setShowChat] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState('');
  const fileInputRef = useRef();

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
    console.log('[FRONTEND] File selected:', file.name, 'size:', file.size);
    const formData = new FormData();
    formData.append('file', file);
    try {
      console.log('[FRONTEND] Uploading file...');
      const res = await fetch('http://localhost:5000/api/upload', {
        method: 'POST',
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
        
        <h1>Tally GPT</h1>
        <p className="subtitle">Upload your Tally data and chat with AI to get instant insights</p>
        
        <div className="upload-container">
          <div className="upload-section">
            <h2>📁 Upload Tally Data</h2>
            <form className="upload-form" onSubmit={handleFileUpload}>
              <input
                type="file"
                accept=".xml,.xlsx,.pdf,.zip"
                ref={fileInputRef}
                disabled={uploading}
              />
              <button type="submit" disabled={uploading} className="primary-btn">
                {uploading ? 'Uploading...' : 'Upload Tally Data'}
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
            <p className="file-info">Supported formats: .XML, Excel (.xlsx), PDF, ZIP</p>
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

export default App;
