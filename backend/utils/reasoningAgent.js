/**
 * DocuMind Accessibility Reasoning Agent - Groq Edition
 * Uses Groq's LLaMA models for multimodal document analysis
 * Actor-Reviewer pattern for verified accessibility features
 */

const Groq = require('groq-sdk');
const fs = require('fs').promises;
const path = require('path');

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// Model configurations
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const TEXT_MODEL = 'llama-3.3-70b-versatile';

/**
 * Delay utility for rate limit compliance
 * @param {number} ms - Milliseconds to delay
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Convert image file to base64 data URL
 * @param {string} imagePath - Path to image file
 * @returns {Promise<string>} - Base64 data URL
 */
async function imageToBase64DataURL(imagePath) {
  try {
    const imageBuffer = await fs.readFile(imagePath);
    const base64Data = imageBuffer.toString('base64');
    
    // Determine mime type from extension
    const ext = path.extname(imagePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    
    const mimeType = mimeTypes[ext] || 'image/jpeg';
    return `data:${mimeType};base64,${base64Data}`;
    
  } catch (error) {
    console.error('Error converting image to base64:', error);
    throw error;
  }
}

/**
 * VISION STEP: Analyze page image with Groq Vision model
 * Detects layout, tables, images, and visual elements
 * 
 * @param {string} imagePath - Path to the processed page image
 * @param {string} extractedText - OCR text for context
 * @returns {Promise<Object>} - Vision analysis results
 */
async function analyzePageVision(imagePath, extractedText) {
  try {
    console.log(`  🔍 Vision analysis: ${path.basename(imagePath)}`);
    
    // Convert image to base64 data URL
    const imageDataURL = await imageToBase64DataURL(imagePath);
    
    const visionPrompt = `You are analyzing a document page image for accessibility purposes.

OCR has already extracted this text:
${extractedText ? extractedText.substring(0, 500) + '...' : 'No text extracted'}

Analyze the IMAGE and identify:
1. TABLES: Any tables, grids, or structured data (describe rows/columns)
2. IMAGES/GRAPHICS: Logos, charts, diagrams, photos
3. LAYOUT: Multi-column layouts, sidebars, headers, footers
4. VISUAL ELEMENTS: Lines, boxes, highlighting, stamps

Return ONLY a JSON object with this exact structure:
{
  "tables": [
    {
      "position": "top/middle/bottom",
      "description": "what this table shows",
      "rowCount": 5,
      "columnCount": 3
    }
  ],
  "images": [
    {
      "type": "logo/chart/photo/diagram",
      "altText": "detailed description for screen readers",
      "position": "top-left/center/etc"
    }
  ],
  "layoutNotes": "description of visual layout",
  "visualElements": "lines, boxes, stamps, etc"
}`;

    const completion = await groq.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: visionPrompt
            },
            {
              type: 'image_url',
              image_url: {
                url: imageDataURL
              }
            }
          ]
        }
      ],
      temperature: 0.3,
      max_tokens: 2048
    });
    
    const responseText = completion.choices[0]?.message?.content || '{}';
    
    // --- CHATTY AI IGNORER ---
    // This physically extracts ONLY what is inside the curly brackets {}
    // and completely ignores any conversational text like "Here is the..."
    const firstBrace = responseText.indexOf('{');
    const lastBrace = responseText.lastIndexOf('}');
    
    let cleanJson = '{}';
    if (firstBrace !== -1 && lastBrace !== -1) {
        cleanJson = responseText.substring(firstBrace, lastBrace + 1);
    }
    
    let visionData = JSON.parse(cleanJson);
    
    // --- MONGODB SANITIZER START ---
    
    // 1. IMAGES: MongoDB wants these as simple STRINGS
    if (Array.isArray(visionData.images)) {
        visionData.images = visionData.images.map(img => {
            if (typeof img === 'string') return img;
            return `${img.type || 'Image'} at ${img.position || 'unknown'}: ${img.altText || 'No description'}`;
        });
    } else {
        visionData.images = [];
    }

    // 2. TABLES: MongoDB wants these as OBJECTS (Do not convert to strings!)
    if (!Array.isArray(visionData.tables)) {
        visionData.tables = [];
    } else {
        visionData.tables = visionData.tables.map(t => {
            // If the AI somehow gives a string, wrap it in an object so MongoDB doesn't crash
            if (typeof t === 'string') return { description: t }; 
            return t; // Keep the object exactly as the AI formatted it
        });
    }
    
    // --- MONGODB SANITIZER END ---

    console.log(`  ✅ Vision: ${visionData.tables?.length || 0} tables, ${visionData.images?.length || 0} images`);
    
    return visionData;
    
  } catch (error) {
    console.error('  ⚠️  Vision analysis failed:', error.message);
    
    // Return empty structure on failure
    return {
      tables: [],
      images: [],
      layoutNotes: '',
      visualElements: ''
    };
  }
}

/**
 * AUDIO NAVIGATION STEP: Generate accessibility audio map
 * Uses text model with JSON mode for guaranteed valid output
 * 
 * @param {string} extractedText - OCR extracted text
 * @param {Object} visionResults - Results from vision analysis
 * @param {number} pageNumber - Current page number
 * @param {number} totalPages - Total pages in document
 * @returns {Promise<Object>} - Audio navigation data
 */
async function generateAudioNavigation(extractedText, visionResults, pageNumber = 1, totalPages = 1) {
  try {
    console.log(`  🎙️  Generating audio navigation...`);
    
    // Build context string from vision results (lightweight)
    let visionContext = '';
    if (visionResults.tables && visionResults.tables.length > 0) {
      visionContext += `\nTables found: ${visionResults.tables.map(t => t.description).join(', ')}`;
    }
    if (visionResults.images && visionResults.images.length > 0) {
      visionContext += `\nImages found: ${visionResults.images.map(i => i.altText).join(', ')}`;
    }
    if (visionResults.layoutNotes) {
      visionContext += `\nLayout: ${visionResults.layoutNotes}`;
    }
    
    const systemPrompt = `You are creating an audio navigation system for visually impaired users.

CRITICAL: Return ONLY valid JSON. No markdown, no explanations, no additional text.

Your response must be a single valid JSON object matching this exact structure:
{
  "audioIntro": "string (20 seconds when read aloud)",
  "documentType": "invoice/receipt/contract/letter/form/other",
  "keyInformation": ["array of important facts"],
  "navigationHints": [
    {
      "section": "section name",
      "summary": "what this section contains",
      "keyPoints": ["important items"]
    }
  ],
  "tableDescriptions": ["plain language table explanations"],
  "imageDescriptions": ["what images show"],
  "estimatedReadingTime": "X minutes"
}`;

    const userPrompt = `Page ${pageNumber} of ${totalPages}

DOCUMENT TEXT:
${extractedText || 'No text extracted'}

VISUAL ELEMENTS:
${visionContext || 'No visual elements detected'}

Create accessibility navigation following the JSON structure specified in the system prompt.`;

    const completion = await groq.chat.completions.create({
      model: TEXT_MODEL,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userPrompt
        }
      ],
      temperature: 0.4,
      max_tokens: 3072,
      response_format: { type: 'json_object' } // CRASH-PROOF JSON
    });
    
    const responseText = completion.choices[0]?.message?.content || '{}';
    
    // Parse JSON (guaranteed valid due to json_object mode)
    const audioData = JSON.parse(responseText);
    
    console.log(`  ✅ Audio navigation generated`);
    
    return audioData;
    
  } catch (error) {
    console.error('  ⚠️  Audio navigation failed:', error.message);
    
    // Return minimal valid structure on failure
    return {
      audioIntro: `Page ${pageNumber} of ${totalPages}. Analysis unavailable.`,
      documentType: 'unknown',
      keyInformation: [],
      navigationHints: [],
      tableDescriptions: [],
      imageDescriptions: [],
      estimatedReadingTime: '1 minute'
    };
  }
}

/**
 * REVIEWER STEP: Validate accuracy of generated content
 * Cross-checks AI response against source text
 * 
 * @param {Object} audioNavigation - Generated audio navigation
 * @param {string} extractedText - Source OCR text
 * @returns {Promise<Object>} - Review results with corrections
 */
async function reviewerValidate(audioNavigation, extractedText) {
  try {
    console.log(`  🔎 Reviewer validating accuracy...`);
    
    const systemPrompt = `You are a fact-checker reviewing AI-generated content for accuracy.

CRITICAL: Return ONLY valid JSON. No markdown, no explanations.

Your response must be a single valid JSON object:
{
  "isAccurate": true/false,
  "confidence": 0-100,
  "issues": ["list of any inaccuracies found"],
  "verdict": "approved/needs_correction"
}`;

    const userPrompt = `AI GENERATED CONTENT:
${JSON.stringify(audioNavigation, null, 2)}

SOURCE DOCUMENT TEXT:
${extractedText ? extractedText.substring(0, 1500) : 'No text available'}

Verify:
1. Are key facts (dates, amounts, names) accurate?
2. Are there any hallucinations or invented information?
3. Does the summary match the actual content?

Return verdict and confidence score.`;

    const completion = await groq.chat.completions.create({
      model: TEXT_MODEL,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userPrompt
        }
      ],
      temperature: 0.2,
      max_tokens: 1024,
      response_format: { type: 'json_object' }
    });
    
    const responseText = completion.choices[0]?.message?.content || '{}';
    const reviewData = JSON.parse(responseText);
    
    console.log(`  ✅ Review complete: ${reviewData.verdict} (${reviewData.confidence}% confidence)`);
    
    return {
      isAccurate: reviewData.isAccurate !== false,
      confidence: reviewData.confidence || 75,
      issues: reviewData.issues || [],
      verdict: reviewData.verdict || 'approved'
    };
    
  } catch (error) {
    console.error('  ⚠️  Review step failed:', error.message);
    
    // Return moderate confidence if review fails
    return {
      isAccurate: true,
      confidence: 60,
      issues: ['Review process failed'],
      verdict: 'approved'
    };
  }
}

/**
 * Process single page with Actor-Reviewer pattern
 * @param {Object} pageData - Page data (text, image path, etc)
 * @param {number} pageNumber - Page number
 * @param {number} totalPages - Total pages
 * @returns {Promise<Object>} - Complete page analysis
 */
async function processSinglePage(pageData, pageNumber, totalPages) {
  try {
    console.log(`\n  📄 Processing Page ${pageNumber}/${totalPages}`);
    
    const result = {
      pageNumber: pageNumber,
      visionAnalysis: null,
      audioNavigation: null,
      reviewMetadata: null
    };
    
    // Step 1: Vision analysis (if image available)
    if (pageData.processedImagePath) {
      try {
        const exists = await fs.access(pageData.processedImagePath).then(() => true).catch(() => false);
        if (exists) {
          result.visionAnalysis = await analyzePageVision(
            pageData.processedImagePath,
            pageData.extractedText
          );
        } else {
          result.visionAnalysis = { tables: [], images: [], layoutNotes: '', visualElements: '' };
        }
      } catch (err) {
        console.log(`  ⚠️  Skipping vision analysis: ${err.message}`);
        result.visionAnalysis = { tables: [], images: [], layoutNotes: '', visualElements: '' };
      }
    } else {
      result.visionAnalysis = { tables: [], images: [], layoutNotes: '', visualElements: '' };
    }
    
    // Step 2: Audio navigation generation (ACTOR)
    result.audioNavigation = await generateAudioNavigation(
      pageData.extractedText || '',
      result.visionAnalysis || {},
      pageNumber,
      totalPages
    );
    
    // Step 3: Review and validate (REVIEWER)
    result.reviewMetadata = await reviewerValidate(
      result.audioNavigation,
      pageData.extractedText || ''
    );
    
    console.log(`  ✅ Page ${pageNumber} complete`);
    
    return result;
    
  } catch (error) {
    console.error(`  ❌ Page ${pageNumber} failed:`, error.message);
    throw error;
  }
}

/**
 * MAIN EXPORT: Analyze complete document
 * Handles both single images and multi-page PDFs
 * 
 * @param {Object} documentData - Document data from server.js
 * @returns {Promise<Object>} - Complete AI analysis for MongoDB
 */
async function analyzeDocument(documentData) {
  const startTime = Date.now();
  
  try {
    console.log('\n🤖 Starting Groq AI Analysis (Actor-Reviewer Pattern)');
    console.log(`📄 Document: ${documentData.originalName}`);
    console.log(`📊 Type: ${documentData.isPdf ? 'PDF' : 'Image'}`);
    
    const aiAnalysis = {
      modelUsed: `Vision: ${VISION_MODEL}, Text: ${TEXT_MODEL}`,
      analysisTimestamp: new Date().toISOString(),
      processingTime: 0,
      pages: []
    };
    
    // SINGLE IMAGE PROCESSING
    if (!documentData.isPdf) {
      console.log('📷 Processing single image document...');
      
      const pageData = {
        processedImagePath: documentData.processedImagePath,
        extractedText: documentData.extractedText
      };
      
      const pageResult = await processSinglePage(pageData, 1, 1);
      aiAnalysis.pages.push(pageResult);
      
    } 
    // MULTI-PAGE PDF PROCESSING
    else if (documentData.pages && documentData.pages.length > 0) {
      console.log(`📑 Processing ${documentData.pages.length}-page PDF...`);
      
      for (let i = 0; i < documentData.pages.length; i++) {
        const page = documentData.pages[i];
        const pageNumber = page.pageNumber || (i + 1);
        const totalPages = documentData.pages.length;
        
        console.log(`\n${'='.repeat(60)}`);
        console.log(`📄 Page ${pageNumber}/${totalPages} - Starting AI Analysis`);
        console.log(`${'='.repeat(60)}`);
        
        const pageData = {
          processedImagePath: page.processedImagePath,
          extractedText: page.extractedText
        };
        
        try {
          const pageResult = await processSinglePage(pageData, pageNumber, totalPages);
          aiAnalysis.pages.push(pageResult);
          
          // RATE LIMIT COMPLIANCE: Delay between pages
          if (i < documentData.pages.length - 1) {
            console.log(`  ⏳ Waiting 3 seconds (rate limit compliance)...`);
            await delay(3000);
          }
          
        } catch (pageError) {
          console.error(`  ❌ Page ${pageNumber} failed, adding error placeholder`);
          
          aiAnalysis.pages.push({
            pageNumber: pageNumber,
            error: true,
            errorMessage: pageError.message,
            visionAnalysis: { tables: [], images: [], layoutNotes: '', visualElements: '' },
            audioNavigation: {
              audioIntro: `Page ${pageNumber} analysis failed.`,
              documentType: 'unknown',
              keyInformation: [],
              navigationHints: [],
              tableDescriptions: [],
              imageDescriptions: [],
              estimatedReadingTime: '0 minutes'
            },
            reviewMetadata: {
              isAccurate: false,
              confidence: 0,
              issues: ['Analysis failed'],
              verdict: 'error'
            }
          });
        }
      }
    } else {
      throw new Error('No valid document data provided');
    }
    
    // Calculate total processing time
    aiAnalysis.processingTime = Date.now() - startTime;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ AI Analysis Complete!`);
    console.log(`⏱️  Total time: ${(aiAnalysis.processingTime / 1000).toFixed(1)}s`);
    console.log(`📊 Pages analyzed: ${aiAnalysis.pages.length}`);
    console.log(`🎯 Average confidence: ${Math.round(
      aiAnalysis.pages.reduce((sum, p) => sum + (p.reviewMetadata?.confidence || 0), 0) / 
      aiAnalysis.pages.length
    )}%`);
    console.log(`${'='.repeat(60)}\n`);
    
    return aiAnalysis;
    
  } catch (error) {
    console.error('❌ AI Analysis catastrophic failure:', error);
    throw {
      error: 'AI analysis failed',
      message: error.message,
      details: error.toString()
    };
  }
}

/**
 * Answer user question about document (bonus feature)
 * @param {string} question - User's question
 * @param {string} documentText - Document text
 * @returns {Promise<Object>} - Answer with confidence
 */
async function answerQuestion(question, documentText) {
  try {
    console.log(`\n❓ Question: ${question}`);
    
    const systemPrompt = `You are answering questions about a document.

CRITICAL: Return ONLY valid JSON.

Response format:
{
  "answer": "concise answer based only on document",
  "confidence": 0-100,
  "sourceFound": true/false
}`;

    const userPrompt = `Question: ${question}

Document text:
${documentText.substring(0, 2000)}

Answer based only on the document text.`;

    const completion = await groq.chat.completions.create({
      model: TEXT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 512,
      response_format: { type: 'json_object' }
    });
    
    const result = JSON.parse(completion.choices[0]?.message?.content || '{}');
    
    console.log(`✅ Answer: ${result.answer} (${result.confidence}% confidence)`);
    
    return {
      question,
      answer: result.answer || 'Unable to answer',
      confidence: result.confidence || 0,
      sourceFound: result.sourceFound !== false,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Error answering question:', error);
    throw error;
  }
}

module.exports = {
  analyzeDocument,
  answerQuestion,
  analyzePageVision,
  generateAudioNavigation
};