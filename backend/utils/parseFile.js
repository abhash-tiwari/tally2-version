// const xlsx = require('xlsx');
// const pdfParse = require('pdf-parse');
// const AdmZip = require('adm-zip');
// const path = require('path');
// const { XMLParser } = require('fast-xml-parser');

// async function parseExcel(buffer) {
//   const workbook = xlsx.read(buffer, { type: 'buffer' });
//   let result = [];
//   workbook.SheetNames.forEach(sheetName => {
//     const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
//     result.push({ sheetName, data: sheet });
//   });
//   return result;
// }

// async function parsePDF(buffer) {
//   const data = await pdfParse(buffer);
//   return data.text;
// }

// async function parseZIP(buffer) {
//   const zip = new AdmZip(buffer);
//   const entries = zip.getEntries();
//   let files = [];
//   for (let entry of entries) {
//     if (!entry.isDirectory) {
//       const ext = path.extname(entry.entryName).toLowerCase();
//       if (ext === '.xlsx') {
//         files.push(await parseExcel(entry.getData()));
//       } else if (ext === '.pdf') {
//         files.push(await parsePDF(entry.getData()));
//       } else if (ext === '.xml') {
//         files.push(await parseXML(entry.getData()));
//       }
//     }
//   }
//   return files;
// }

// async function parseXML(buffer) {
//   const xmlText = buffer.toString('utf16le').replace(/\u0000/g, '');
//   const parser = new XMLParser({
//     ignoreAttributes: false,
//     parseTagValue: true,
//     parseAttributeValue: false,
//     trimValues: true,
//   });
//   return parser.parse(xmlText);
// }

// async function parseTXT(buffer) {
//   // Convert buffer to string using utf8 encoding
//   return buffer.toString('utf8');
// }

// async function parseFile(file) {
//   const ext = path.extname(file.originalname).toLowerCase();
//   if (ext === '.xlsx') {
//     return await parseExcel(file.buffer);
//   } else if (ext === '.pdf') {
//     return await parsePDF(file.buffer);
//   } else if (ext === '.zip') {
//     return await parseZIP(file.buffer);
//   } else if (ext === '.xml') {
//     return await parseXML(file.buffer);
//   } else if (ext === '.txt') {
//     return await parseTXT(file.buffer);
//   } else {
//     throw new Error('Unsupported file type');
//   }
// }

// module.exports = { parseFile };

const xlsx = require('xlsx');
const pdfParse = require('pdf-parse');
const AdmZip = require('adm-zip');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

async function parseExcel(buffer) {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  let result = [];
  workbook.SheetNames.forEach(sheetName => {
    const sheet = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
    result.push({ sheetName, data: sheet });
  });
  return result;
}

async function parsePDF(buffer) {
  const data = await pdfParse(buffer);
  return data.text;
}

async function parseZIP(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  let files = [];
  for (let entry of entries) {
    if (!entry.isDirectory) {
      const ext = path.extname(entry.entryName).toLowerCase();
      if (ext === '.xlsx') {
        files.push(await parseExcel(entry.getData()));
      } else if (ext === '.pdf') {
        files.push(await parsePDF(entry.getData()));
      } else if (ext === '.xml') {
        files.push(await parseXML(entry.getData()));
      } else if (ext === '.txt') {
        files.push(await parseTXT(entry.getData()));
      }
    }
  }
  return files;
}

async function parseXML(buffer) {
  try {
    // Try UTF-8 first (most common)
    let xmlText = buffer.toString('utf8');
    
    // If it starts with BOM or has null bytes, try different encodings
    if (xmlText.includes('\u0000') || xmlText.startsWith('\uFEFF')) {
      // Remove BOM if present
      xmlText = xmlText.replace(/^\uFEFF/, '');
      
      // If still has null bytes, try utf16le
      if (xmlText.includes('\u0000')) {
        xmlText = buffer.toString('utf16le').replace(/\u0000/g, '');
      }
    }
    
    // Clean the XML text
    xmlText = xmlText.trim();
    
    const parser = new XMLParser({
      ignoreAttributes: false,
      parseTagValue: true,
      parseAttributeValue: false,
      trimValues: true,
      parseTrueNumberOnly: false,
    });
    
    return parser.parse(xmlText);
  } catch (error) {
    console.error('XML parsing error:', error);
    // Fallback: return raw text if XML parsing fails
    return buffer.toString('utf8');
  }
}

async function parseTXT(buffer) {
  try {
    // Try different encodings to find the best one
    let text;
    
    // First try UTF-8
    text = buffer.toString('utf8');
    
    // Check if we have strange characters that suggest wrong encoding
    if (text.includes('��') || text.includes('\uFFFD')) {
      // Try UTF-16LE
      text = buffer.toString('utf16le');
      
      // If still has issues, try latin1
      if (text.includes('��') || text.includes('\uFFFD')) {
        text = buffer.toString('latin1');
      }
    }
    
    // Clean the text
    const cleanedText = text
      .replace(/\u0000/g, '') // Remove null bytes
      .replace(/^\uFEFF/, '') // Remove BOM
      .trim(); // Remove leading/trailing whitespace
    
    // Return just the cleaned text string for embedding compatibility
    return cleanedText;
    
  } catch (error) {
    console.error('TXT parsing error:', error);
    // Fallback to basic UTF-8
    return buffer.toString('utf8');
  }
}

async function parseFile(file) {
  try {
    const ext = path.extname(file.originalname).toLowerCase();
    
    console.log(`Parsing file: ${file.originalname}, Extension: ${ext}, Size: ${file.buffer.length} bytes`);
    
    if (ext === '.xlsx') {
      return await parseExcel(file.buffer);
    } else if (ext === '.pdf') {
      return await parsePDF(file.buffer);
    } else if (ext === '.zip') {
      return await parseZIP(file.buffer);
    } else if (ext === '.xml') {
      return await parseXML(file.buffer);
    } else if (ext === '.txt') {
      return await parseTXT(file.buffer);
    } else {
      throw new Error(`Unsupported file type: ${ext}`);
    }
  } catch (error) {
    console.error(`Error parsing file ${file.originalname}:`, error);
    throw error;
  }
}

module.exports = { parseFile };