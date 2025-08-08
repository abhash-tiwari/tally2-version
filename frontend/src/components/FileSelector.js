import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './FileSelector.css';

const FileSelector = ({ selectedFiles, onFileSelectionChange }) => {
  const { token } = useAuth();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState('up'); // 'up' or 'down'

  // Fetch user files on component mount
  useEffect(() => {
    fetchUserFiles();
  }, []);

  const fetchUserFiles = async () => {
    setLoading(true);
    setError('');
    
    if (!token) {
      setError('Please log in to view your files');
      setLoading(false);
      return;
    }
    
    try {
      const response = await fetch('http://localhost:5000/api/upload', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setFiles(data.files || []);
        console.log('[FILE_SELECTOR] Loaded', data.files?.length, 'files');
      } else {
        setError(data.error || 'Failed to load files');
        console.error('[FILE_SELECTOR] Error loading files:', data.error);
      }
    } catch (err) {
      setError('Failed to load files');
      console.error('[FILE_SELECTOR] Network error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileToggle = (fileName) => {
    const newSelection = selectedFiles.includes(fileName)
      ? selectedFiles.filter(f => f !== fileName)
      : [...selectedFiles, fileName];
    
    onFileSelectionChange(newSelection);
  };

  const handleSelectAll = () => {
    const allFileNames = files.map(f => f.fileName);
    onFileSelectionChange(allFileNames);
  };

  const handleClearSelection = () => {
    onFileSelectionChange([]);
  };

  const handleToggleDropdown = () => {
    if (!isOpen) {
      // Calculate if there's enough space above
      const button = document.querySelector('.file-selector-toggle');
      if (button) {
        const rect = button.getBoundingClientRect();
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;
        
        // If there's more space below than above, use downward dropdown
        if (spaceBelow > spaceAbove) {
          setDropdownPosition('down');
        } else {
          setDropdownPosition('up');
        }
      }
    }
    setIsOpen(!isOpen);
  };

  const formatFileSize = (tokens) => {
    if (tokens < 1000) return `${tokens} chars`;
    if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K chars`;
    return `${(tokens / 1000000).toFixed(1)}M chars`;
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="file-selector">
      <div className="file-selector-header">
        <button 
          className="file-selector-toggle"
          onClick={handleToggleDropdown}
          disabled={loading}
        >
          <span className="file-selector-icon">📁</span>
          <span className="file-selector-text">
            {selectedFiles.length === 0 
              ? 'All Files' 
              : `${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'} selected`
            }
          </span>
          <span className={`file-selector-arrow ${isOpen ? 'open' : ''}`}>▼</span>
        </button>
        
        {selectedFiles.length > 0 && (
          <button 
            className="file-selector-clear"
            onClick={handleClearSelection}
            title="Clear selection"
          >
            ✕
          </button>
        )}
      </div>

             {isOpen && (
         <div className={`file-selector-dropdown ${dropdownPosition === 'down' ? 'dropdown-down' : 'dropdown-up'}`}>
          {loading ? (
            <div className="file-selector-loading">
              <div className="loading-spinner"></div>
              <span>Loading files...</span>
            </div>
          ) : error ? (
            <div className="file-selector-error">
              <span>⚠️</span>
              {error}
            </div>
          ) : files.length === 0 ? (
            <div className="file-selector-empty">
              <span>📄</span>
              <p>No files uploaded yet</p>
              <small>Upload some Tally files to get started</small>
            </div>
          ) : (
            <>
              <div className="file-selector-actions">
                <button 
                  className="file-selector-action-btn"
                  onClick={handleSelectAll}
                >
                  Select All
                </button>
                <button 
                  className="file-selector-action-btn"
                  onClick={handleClearSelection}
                >
                  Clear
                </button>
              </div>
              
              <div className="file-selector-list">
                {files.map((file) => (
                  <label key={file.fileId} className="file-selector-item">
                    <input
                      type="checkbox"
                      checked={selectedFiles.includes(file.fileName)}
                      onChange={() => handleFileToggle(file.fileName)}
                    />
                    <div className="file-selector-item-content">
                      <div className="file-selector-item-name">
                        {file.fileName}
                      </div>
                      <div className="file-selector-item-details">
                        <span>{file.totalChunks} chunks</span>
                        <span>{formatFileSize(file.totalTokens)}</span>
                        <span>{formatDate(file.uploadedAt)}</span>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default FileSelector;
