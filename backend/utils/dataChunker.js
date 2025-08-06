// Data chunking utility for handling large Tally files
// Splits large data into smaller chunks to fit OpenAI API token limits

/**
 * Estimates token count for text (rough approximation: 1 token ≈ 4 characters)
 * @param {string} text - Text to estimate tokens for
 * @returns {number} - Estimated token count
 */
function estimateTokenCount(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Counts words in text
 * @param {string} text - Text to count words in
 * @returns {number} - Word count
 */
function countWords(text) {
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * Splits text into chunks based on token/word limits
 * @param {string} text - Text to chunk
 * @param {number} maxTokens - Maximum tokens per chunk (default: 8000)
 * @param {number} maxWords - Maximum words per chunk (default: 6000)
 * @returns {Array<string>} - Array of text chunks
 */
function chunkText(text, maxTokens = 8000, maxWords = 6000) {
  const chunks = [];
  const lines = text.split('\n');
  let currentChunk = '';
  let currentTokens = 0;
  let currentWords = 0;

  for (const line of lines) {
    const lineTokens = estimateTokenCount(line);
    const lineWords = countWords(line);
    
    // Check if adding this line would exceed limits
    if (currentTokens + lineTokens > maxTokens || currentWords + lineWords > maxWords) {
      // If current chunk has content, save it and start new chunk
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
        currentTokens = 0;
        currentWords = 0;
      }
    }
    
    // Add line to current chunk
    currentChunk += line + '\n';
    currentTokens += lineTokens;
    currentWords += lineWords;
  }
  
  // Add the last chunk if it has content
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

/**
 * Intelligently chunks Tally data with overlapping to maintain context continuity
 * @param {string} tallyData - Raw Tally data string
 * @param {number} maxTokens - Maximum tokens per chunk (default: 8000)
 * @param {number} maxWords - Maximum words per chunk (default: 6000)
 * @param {number} overlapTokens - Tokens to overlap between chunks (default: 500)
 * @param {number} overlapWords - Words to overlap between chunks (default: 400)
 * @returns {Array<string>} - Array of intelligently chunked data with overlaps
 */
function chunkTallyData(tallyData, maxTokens = 8000, maxWords = 6000, overlapTokens = 500, overlapWords = 400) {
  console.log('[CHUNKER] Input data size:', tallyData.length, 'characters');
  console.log('[CHUNKER] Estimated tokens:', estimateTokenCount(tallyData));
  console.log('[CHUNKER] Word count:', countWords(tallyData));
  console.log('[CHUNKER] Overlap settings: tokens =', overlapTokens, ', words =', overlapWords);
  
  // If data is small enough, return as single chunk
  if (estimateTokenCount(tallyData) <= maxTokens && countWords(tallyData) <= maxWords) {
    console.log('[CHUNKER] Data fits in single chunk');
    return [tallyData];
  }
  
  const chunks = [];
  const lines = tallyData.split('\n').filter(line => line.trim());
  let startIndex = 0;
  
  while (startIndex < lines.length) {
    let currentChunk = '';
    let currentTokens = 0;
    let currentWords = 0;
    let endIndex = startIndex;
    
    // Build chunk from startIndex
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      const lineTokens = estimateTokenCount(line);
      const lineWords = countWords(line);
      
      // Check if adding this line would exceed limits
      if (currentTokens + lineTokens > maxTokens || currentWords + lineWords > maxWords) {
        break;
      }
      
      currentChunk += line + '\n';
      currentTokens += lineTokens;
      currentWords += lineWords;
      endIndex = i;
    }
    
    // Add chunk if it has content
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
      console.log(`[CHUNKER] Created chunk ${chunks.length}: ${currentTokens} tokens, ${currentWords} words (lines ${startIndex + 1}-${endIndex + 1})`);
    }
    
    // Calculate overlap for next chunk
    if (endIndex >= lines.length - 1) {
      // This was the last chunk
      break;
    }
    
    // Find overlap starting point
    let overlapStart = endIndex;
    let overlapTokenCount = 0;
    let overlapWordCount = 0;
    
    // Go backwards from endIndex to find overlap boundary
    for (let i = endIndex; i >= startIndex; i--) {
      const line = lines[i];
      const lineTokens = estimateTokenCount(line);
      const lineWords = countWords(line);
      
      if (overlapTokenCount + lineTokens > overlapTokens || overlapWordCount + lineWords > overlapWords) {
        break;
      }
      
      overlapTokenCount += lineTokens;
      overlapWordCount += lineWords;
      overlapStart = i;
    }
    
    // Set next chunk start to overlap point
    startIndex = Math.max(overlapStart, startIndex + 1); // Ensure progress
    
    console.log(`[CHUNKER] Next chunk will start at line ${startIndex + 1} with ${overlapTokenCount} overlap tokens, ${overlapWordCount} overlap words`);
  }
  
  console.log(`[CHUNKER] Total chunks created: ${chunks.length} with overlapping`);
  return chunks;
}

/**
 * Creates a summary of chunked data for logging/debugging
 * @param {Array<string>} chunks - Array of data chunks
 * @param {boolean} hasOverlap - Whether chunks have overlapping content
 * @returns {object} - Summary statistics
 */
function getChunkingSummary(chunks, hasOverlap = true) {
  const summary = {
    totalChunks: chunks.length,
    totalTokens: 0,
    totalWords: 0,
    totalCharacters: 0,
    averageTokensPerChunk: 0,
    averageWordsPerChunk: 0,
    hasOverlap,
    chunkSizes: [],
    overlapAnalysis: null
  };
  
  chunks.forEach((chunk, index) => {
    const tokens = estimateTokenCount(chunk);
    const words = countWords(chunk);
    const characters = chunk.length;
    
    summary.totalTokens += tokens;
    summary.totalWords += words;
    summary.totalCharacters += characters;
    
    summary.chunkSizes.push({
      chunkIndex: index + 1,
      tokens,
      words,
      characters
    });
  });
  
  summary.averageTokensPerChunk = Math.round(summary.totalTokens / chunks.length);
  summary.averageWordsPerChunk = Math.round(summary.totalWords / chunks.length);
  
  // Analyze overlap if applicable
  if (hasOverlap && chunks.length > 1) {
    summary.overlapAnalysis = analyzeChunkOverlap(chunks);
  }
  
  return summary;
}

/**
 * Analyzes overlap between consecutive chunks
 * @param {Array<string>} chunks - Array of data chunks
 * @returns {object} - Overlap analysis
 */
function analyzeChunkOverlap(chunks) {
  const overlaps = [];
  let totalOverlapTokens = 0;
  let totalOverlapWords = 0;
  
  for (let i = 0; i < chunks.length - 1; i++) {
    const currentChunk = chunks[i];
    const nextChunk = chunks[i + 1];
    
    // Find common content at the end of current chunk and start of next chunk
    const currentLines = currentChunk.split('\n');
    const nextLines = nextChunk.split('\n');
    
    let overlapLines = 0;
    let overlapContent = '';
    
    // Find overlapping lines from the end of current chunk
    for (let j = 1; j <= Math.min(currentLines.length, nextLines.length); j++) {
      const currentLine = currentLines[currentLines.length - j];
      const nextLine = nextLines[j - 1];
      
      if (currentLine === nextLine) {
        overlapLines++;
        overlapContent = nextLine + '\n' + overlapContent;
      } else {
        break;
      }
    }
    
    const overlapTokens = estimateTokenCount(overlapContent);
    const overlapWords = countWords(overlapContent);
    
    totalOverlapTokens += overlapTokens;
    totalOverlapWords += overlapWords;
    
    overlaps.push({
      chunkPair: `${i + 1}-${i + 2}`,
      overlapLines,
      overlapTokens,
      overlapWords,
      overlapPercentage: Math.round((overlapTokens / estimateTokenCount(currentChunk)) * 100)
    });
  }
  
  return {
    totalOverlaps: overlaps.length,
    averageOverlapTokens: Math.round(totalOverlapTokens / overlaps.length),
    averageOverlapWords: Math.round(totalOverlapWords / overlaps.length),
    overlaps: overlaps.slice(0, 3) // Show first 3 overlaps for brevity
  };
}

module.exports = {
  estimateTokenCount,
  countWords,
  chunkText,
  chunkTallyData,
  getChunkingSummary
};
