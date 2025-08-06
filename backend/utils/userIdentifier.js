// User identification utility for persistent chat across sessions
// Since we don't have user authentication, we'll use IP-based identification

const crypto = require('crypto');

/**
 * Generate a consistent user identifier based on IP address
 * This allows users to access their data across sessions from the same IP
 * @param {string} ipAddress - User's IP address
 * @returns {string} - Consistent user identifier
 */
function generateUserId(ipAddress) {
  // Create a hash of the IP address for privacy and consistency
  const hash = crypto.createHash('sha256');
  hash.update(ipAddress + 'tally-gpt-salt'); // Add salt for security
  return hash.digest('hex').substring(0, 16); // Use first 16 characters
}

/**
 * Extract user identifier from request
 * @param {object} req - Express request object
 * @returns {string} - User identifier
 */
function getUserIdFromRequest(req) {
  // Get IP address from request
  const ipAddress = req.ip || 
                   req.connection.remoteAddress || 
                   req.socket.remoteAddress ||
                   (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
                   req.headers['x-forwarded-for']?.split(',')[0] ||
                   '127.0.0.1';
  
  return generateUserId(ipAddress);
}

module.exports = {
  generateUserId,
  getUserIdFromRequest
};
