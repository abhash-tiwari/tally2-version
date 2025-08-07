function cosineSimilarity(vecA, vecB) {
  let dot = 0.0, normA = 0.0, normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Enhanced similarity scoring that considers both vector similarity and content relevance
 * @param {Array} queryEmbedding - Query embedding vector
 * @param {Object} chunk - Data chunk with content and embedding
 * @param {string} query - Original user query
 * @returns {number} - Combined relevance score
 */
function calculateRelevanceScore(queryEmbedding, chunk, query) {
  const vectorScore = cosineSimilarity(queryEmbedding, chunk.embedding);
  
  // Content-based scoring
  const content = (chunk.content || '').toLowerCase();
  const queryLower = query.toLowerCase();
  
  let contentScore = 0;
  
  // Boost score for exact keyword matches
  const keywords = queryLower.split(/\s+/).filter(word => word.length > 2);
  keywords.forEach(keyword => {
    if (content.includes(keyword)) {
      contentScore += 0.1;
    }
  });
  
  // Boost score for voucher-related content if query is about vouchers
  if (/voucher|transaction|entry/i.test(queryLower) && /voucher:/i.test(content)) {
    contentScore += 0.2;
  }
  
  // Boost score for date-related content if query mentions dates
  if (/date|month|year|july|august|september|october|november|december|january|february|march|april|may|june/i.test(queryLower) && /\d{1,2}-[A-Za-z]{3}-\d{2}/.test(content)) {
    contentScore += 0.15;
  }
  
  // Boost score for financial terms if query is about financial data
  if (/amount|balance|debit|credit|dr|cr|total|sum/i.test(queryLower) && /(dr|cr|amount|balance)/i.test(content)) {
    contentScore += 0.1;
  }
  
  // Combine vector and content scores (70% vector, 30% content)
  return (vectorScore * 0.7) + (contentScore * 0.3);
}

/**
 * Find most similar chunks with enhanced relevance scoring
 * @param {Array} queryEmbedding - Query embedding vector
 * @param {Array} dataChunks - Array of data chunks
 * @param {string} query - Original user query
 * @param {number} topK - Number of top chunks to return
 * @returns {Array} - Top K most relevant chunks
 */
function findMostSimilarChunks(queryEmbedding, dataChunks, query, topK = 10) {
  const scored = dataChunks.map(chunk => ({
    ...chunk,
    score: calculateRelevanceScore(queryEmbedding, chunk, query)
  }));
  
  // Sort by combined relevance score
  scored.sort((a, b) => b.score - a.score);
  
  // Filter out very low relevance chunks (score < 0.1)
  const relevantChunks = scored.filter(chunk => chunk.score >= 0.1);
  
  console.log(`[VECTOR_SEARCH] Found ${relevantChunks.length} relevant chunks out of ${dataChunks.length} total`);
  console.log(`[VECTOR_SEARCH] Top 3 scores:`, relevantChunks.slice(0, 3).map(c => c.score.toFixed(3)));
  
  return relevantChunks.slice(0, topK);
}

/**
 * Find chunks that contain specific keywords or patterns
 * @param {Array} dataChunks - Array of data chunks
 * @param {string} query - User query
 * @returns {Array} - Chunks containing relevant keywords
 */
function findKeywordMatches(dataChunks, query) {
  const queryLower = query.toLowerCase();
  const keywords = queryLower.split(/\s+/).filter(word => word.length > 2);
  
  return dataChunks.filter(chunk => {
    const content = (chunk.content || '').toLowerCase();
    return keywords.some(keyword => content.includes(keyword));
  });
}

module.exports = { 
  findMostSimilarChunks,
  findKeywordMatches,
  calculateRelevanceScore
};