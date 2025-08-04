import React, { useState, useRef } from 'react';
import './App.css';

function App() {
  const [page, setPage] = useState('upload');
  const [sessionId, setSessionId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [question, setQuestion] = useState('');
  const [answering, setAnswering] = useState(false);
  const [chatError, setChatError] = useState('');
  const [uploadedFile, setUploadedFile] = useState(null);
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
      if (res.ok && data.sessionId) {
        setSessionId(data.sessionId);
        setPage('chat');
        console.log('[FRONTEND] Upload success. Session ID:', data.sessionId);
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

  // Handle chat submit
  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!question.trim()) return;
    setAnswering(true);
    setChatError('');
    setChatHistory((h) => [...h, { role: 'user', content: question }]);
    try {
      console.log('[FRONTEND] Sending question:', question, 'Session ID:', sessionId);
      const res = await fetch('http://localhost:5000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, question }),
      });
      const data = await res.json();
      if (res.ok && data.answer) {
        setChatHistory((h) => [...h, { role: 'assistant', content: data.answer }]);
        setQuestion('');
        console.log('[FRONTEND] Received answer:', data.answer);
      } else {
        setChatError(data.error || 'Failed to get answer.');
        console.log('[FRONTEND] Chat error:', data.error);
      }
    } catch (err) {
      setChatError('Failed to get answer.');
      console.log('[FRONTEND] Chat error:', err);
    }
    setAnswering(false);
  };

  // Landing page (file upload)
  if (page === 'upload') {
    return (
      <div className="App">
        <header className="App-header">
          <h1>Tally Q&A Bot</h1>
          <form className="upload-form" onSubmit={handleFileUpload}>
            <input
              type="file"
              accept=".xlsx,.pdf,.zip"
              ref={fileInputRef}
              disabled={uploading}
            />
            <button type="submit" disabled={uploading}>
              {uploading ? 'Uploading...' : 'Upload Tally Data'}
            </button>
          </form>
          {uploadedFile && (
            <div style={{ color: '#61dafb', marginTop: '1rem', fontSize: '1rem' }}>
              Uploaded file: <b>{uploadedFile.name}</b> ({uploadedFile.size} bytes)
            </div>
          )}
          {uploadError && <div className="error">{uploadError}</div>}
          <p style={{marginTop: '2rem', fontSize: '0.9rem', color: '#aaa'}}>Supported formats: Excel (.xlsx), PDF, ZIP</p>
        </header>
      </div>
    );
  }

  // Chat page
  return (
    <div className="App">
      <header className="App-header">
        <h1>Tally Q&A Chat</h1>
        <div className="chat-box">
          {chatHistory.length === 0 && <div className="chat-empty">Ask anything about your uploaded Tally data!</div>}
          {chatHistory.map((msg, idx) => (
            <div key={idx} className={msg.role === 'user' ? 'chat-user' : 'chat-assistant'}>
              <b>{msg.role === 'user' ? 'You' : 'AI'}:</b> {msg.content}
            </div>
          ))}
        </div>
        <form className="chat-form" onSubmit={handleChatSubmit}>
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="Type your question..."
            disabled={answering}
            className="chat-input"
          />
          <button type="submit" disabled={answering || !question.trim()}>
            {answering ? 'Thinking...' : 'Ask'}
          </button>
        </form>
        {chatError && <div className="error">{chatError}</div>}
        <button className="back-btn" onClick={() => { setPage('upload'); setChatHistory([]); setSessionId(''); setUploadedFile(null); }}>Upload New File</button>
      </header>
    </div>
  );
}

export default App;
