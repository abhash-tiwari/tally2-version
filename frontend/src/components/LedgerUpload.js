import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './LedgerUpload.css';

const LedgerUpload = ({ onUploadComplete }) => {
  const { token } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [error, setError] = useState('');

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setUploading(true);
    setError('');
    setUploadResult(null);

    const formData = new FormData();
    formData.append('ledgerFile', file);

    try {
      const response = await fetch('http://localhost:5000/api/ledger/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      const result = await response.json();

      if (response.ok) {
        setUploadResult(result);
        console.log('[LEDGER] Upload successful:', result);
        if (onUploadComplete) {
          onUploadComplete(result);
        }
      } else {
        setError(result.error || 'Upload failed');
      }
    } catch (err) {
      console.error('[LEDGER] Upload error:', err);
      setError('Failed to upload ledger file');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="ledger-upload">
      <div className="upload-section">
        <h3>📊 Upload Ledger List</h3>
        <p>Upload your Tally ledger list to enable dynamic expense detection</p>
        
        <div className="file-input-wrapper">
          <input
            type="file"
            id="ledger-file"
            accept=".txt,.pdf"
            onChange={handleFileUpload}
            disabled={uploading}
            className="file-input"
          />
          <label htmlFor="ledger-file" className={`file-label ${uploading ? 'disabled' : ''}`}>
            {uploading ? (
              <>
                <div className="spinner"></div>
                Processing...
              </>
            ) : (
              <>
                📁 Choose Ledger File
              </>
            )}
          </label>
        </div>

        <div className="file-info">
          <small>Supported formats: .txt, .pdf (Max 10MB)</small>
        </div>
      </div>

      {error && (
        <div className="error-message">
          <span>⚠️</span>
          {error}
        </div>
      )}

      {uploadResult && (
        <div className="upload-success">
          <div className="success-header">
            <span>✅</span>
            <h4>Ledgers Extracted Successfully!</h4>
          </div>
          
          <div className="result-stats">
            <div className="stat">
              <strong>{uploadResult.ledgersExtracted}</strong>
              <span>Ledgers Found</span>
            </div>
            <div className="stat">
              <strong>{uploadResult.categories?.length || 0}</strong>
              <span>Categories</span>
            </div>
          </div>

          {uploadResult.categories && uploadResult.categories.length > 0 && (
            <div className="categories-list">
              <h5>Categories Found:</h5>
              <div className="categories">
                {uploadResult.categories.map((category, index) => (
                  <span key={index} className="category-tag">{category}</span>
                ))}
              </div>
            </div>
          )}

          {uploadResult.sampleLedgers && uploadResult.sampleLedgers.length > 0 && (
            <div className="sample-ledgers">
              <h5>Sample Ledgers:</h5>
              <ul>
                {uploadResult.sampleLedgers.slice(0, 5).map((ledger, index) => (
                  <li key={index}>
                    <strong>{ledger.name}</strong>
                    {ledger.category && <span className="ledger-category">({ledger.category})</span>}
                  </li>
                ))}
              </ul>
              {uploadResult.sampleLedgers.length > 5 && (
                <p className="more-info">...and {uploadResult.sampleLedgers.length - 5} more</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LedgerUpload;
