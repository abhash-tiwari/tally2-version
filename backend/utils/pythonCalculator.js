/**
 * Python microservice integration for accurate financial calculations
 * Uses HTTP requests to communicate with Python Flask service
 */

const axios = require('axios');

// Python service configuration
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:5001';

/**
 * Make HTTP request to Python microservice
 * @param {string} endpoint - API endpoint path
 * @param {object} data - Data to send to Python service
 * @returns {Promise<object>} - Calculation results from Python service
 */
async function callPythonService(endpoint, data) {
  try {
    console.log(`[PYTHON_CALC] Calling Python service: ${PYTHON_SERVICE_URL}${endpoint}`);
    
    const response = await axios.post(`${PYTHON_SERVICE_URL}${endpoint}`, data, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 second timeout
    });
    
    return response.data;
  } catch (error) {
    if (error.response) {
      // Python service returned an error
      console.error('[PYTHON_CALC] Service error:', error.response.data);
      throw new Error(`Python service error: ${error.response.data.error || error.response.statusText}`);
    } else if (error.request) {
      // No response from Python service
      console.error('[PYTHON_CALC] No response from Python service');
      throw new Error('Python service is not responding. Please ensure it is running on ' + PYTHON_SERVICE_URL);
    } else {
      // Request setup error
      console.error('[PYTHON_CALC] Request error:', error.message);
      throw error;
    }
  }
}

/**
 * Calculate sales totals using Python microservice
 * @param {Array} salesData - Array of sales entries with date, account, amount
 * @param {object} dateContext - Date filtering context
 * @returns {Promise<object>} - Accurate sales calculations
 */
async function calculateSalesTotals(salesData, dateContext = {}) {
  try {
    console.log('[PYTHON_CALC] Sending sales data to Python microservice');
    console.log('[PYTHON_CALC] Sales entries count:', salesData.length);
    
    const inputData = {
      sales_data: salesData,
      date_context: dateContext
    };
    
    const result = await callPythonService('/calculate/sales', inputData);
    
    console.log('[PYTHON_CALC] Python calculation completed:', {
      total_amount: result.total_amount,
      voucher_count: result.voucher_count,
      date_range: result.date_range
    });
    
    return result;
  } catch (error) {
    console.error('[PYTHON_CALC] Sales calculation failed:', error);
    throw error;
  }
}

/**
 * Calculate profit/loss using Python microservice
 * @param {Array} revenueData - Revenue entries
 * @param {Array} expenseData - Expense entries
 * @param {object} dateContext - Date filtering context
 * @returns {Promise<object>} - Accurate profit calculations
 */
async function calculateProfitLoss(revenueData, expenseData, dateContext = {}) {
  try {
    console.log('[PYTHON_CALC] Sending P&L data to Python microservice');
    
    const inputData = {
      revenue_data: revenueData,
      expense_data: expenseData,
      date_context: dateContext
    };
    
    const result = await callPythonService('/calculate/profit', inputData);
    
    console.log('[PYTHON_CALC] Python P&L calculation completed:', {
      total_revenue: result.total_revenue,
      total_expenses: result.total_expenses,
      net_profit: result.net_profit
    });
    
    return result;
  } catch (error) {
    console.error('[PYTHON_CALC] P&L calculation failed:', error);
    throw error;
  }
}

/**
 * Check if Python microservice is healthy
 * @returns {Promise<object>} - Health status
 */
async function checkPythonServiceHealth() {
  try {
    const response = await axios.get(`${PYTHON_SERVICE_URL}/health`, {
      timeout: 5000
    });
    return response.data;
  } catch (error) {
    throw new Error('Python service health check failed: ' + error.message);
  }
}

module.exports = {
  calculateSalesTotals,
  calculateProfitLoss,
  checkPythonServiceHealth,
  callPythonService
};
