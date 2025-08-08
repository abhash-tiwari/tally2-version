import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from './contexts/AuthContext';
import FileSelector from './components/FileSelector';
import './ChatComponent.css';

const ChatComponent = ({ onClose }) => {
  const { token } = useAuth();
  const [chatHistory, setChatHistory] = useState([]);
  const [userInput, setUserInput] = useState('');
  const [answering, setAnswering] = useState(false);
  const [chatError, setChatError] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const chatContainerRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory]);

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  // Handle chat submit
  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!userInput.trim()) return;

    const userMessage = userInput.trim();
    setUserInput('');
    setAnswering(true);
    setChatError('');
    
    // Add user message immediately
    setChatHistory(prev => [...prev, { role: 'user', content: userMessage }]);

    try {
      console.log('[FRONTEND] Sending question:', userMessage);
      const res = await fetch('http://localhost:5000/api/chat', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          question: userMessage,
          selectedFiles: selectedFiles
        }),
      });
      const data = await res.json();
      
      if (res.ok && data.answer) {
        setChatHistory(prev => [...prev, { role: 'assistant', content: data.answer }]);
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

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSubmit(e);
    }
  };

  return (
    <div className="chat-overlay">
      <div className="chat-container">
        {/* Header */}
        <div className="chat-header">
          <div className="chat-title">
            <div className="chat-avatar">
              <span>AI</span>
            </div>
            <div>
              <h3>Tally AI Assistant</h3>
              <p>Ask me anything about your Tally data</p>
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>
            <span>×</span>
          </button>
        </div>

        {/* Chat Messages */}
        <div className="chat-messages" ref={chatContainerRef}>
          {chatHistory.length === 0 && (
            <div className="welcome-message">
              <div className="welcome-avatar">AI</div>
              <div className="welcome-text">
                <h4>Welcome to Tally AI!</h4>
                <p>I can help you analyze data from your uploaded Tally files. Use the file selector above to choose specific files, or leave it as "All Files" to search everything. Try asking me:</p>
                <ul>
                  <li>"What's my total profit this month?"</li>
                  <li>"Show me all cash vouchers"</li>
                  <li>"What are my outstanding receivables?"</li>
                  <li>"Which ledger has the highest balance?"</li>
                  <li>"How many files have I uploaded?"</li>
                </ul>
              </div>
            </div>
          )}
          
          {chatHistory.map((msg, idx) => (
            <div key={idx} className={`message ${msg.role}`}>
              <div className="message-avatar">
                {msg.role === 'user' ? '👤' : 'AI'}
              </div>
              <div className="message-content">
                <div className="message-text">{msg.content}</div>
                <div className="message-time">
                  {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}
          
          {answering && (
            <div className="message assistant">
              <div className="message-avatar">🤖</div>
              <div className="message-content">
                <div className="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Error Message */}
        {chatError && (
          <div className="chat-error">
            <span>⚠️</span>
            {chatError}
          </div>
        )}

        {/* Input Area */}
        <div className="chat-input-container">
          {/* File Selector */}
          <FileSelector 
            selectedFiles={selectedFiles}
            onFileSelectionChange={setSelectedFiles}
          />
          
          <form onSubmit={handleChatSubmit} className="chat-form">
            <div className="input-wrapper">
              <textarea
                ref={inputRef}
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Message Tally AI..."
                disabled={answering}
                rows="1"
                className="chat-textarea"
              />
              <button 
                type="submit" 
                disabled={answering || !userInput.trim()}
                className="send-btn"
              >
                {answering ? (
                  <div className="loading-spinner"></div>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M7 11L12 6L17 11M12 18V7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
            </div>
          </form>
          <div className="chat-footer">
            <p>Tally AI can make mistakes. Consider checking important information.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatComponent;
