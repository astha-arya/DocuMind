const dotenv = require('dotenv');
dotenv.config();

const Document = require('./models/Document');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { buildDocumentTree, getNavigationMap, getDocumentStats } = require('./utils/structureParser');
const { splitPdfToImages, cleanupPageImages, getPdfInfo } = require('./utils/pdfProcessor');
const { analyzeDocument } = require('./utils/reasoningAgent');

// Initialize Express app
const app = express();

// IMPORTANT: Virtual environment configuration
// The server uses ./venv/bin/python3 to ensure all Python dependencies
// (opencv-python, pytesseract) are available in the isolated environment.
// Make sure you've created the venv and installed requirements:
// python3 -m venv venv
// source venv/bin/activate  
// pip3 install -r requirements.txt

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//RATE LIMITER CONFIGURATION (Bouncer)
const chatLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 15, // Limit each IP to 15 requests per windowMs
  message: {
    success: false,
    error: "Whoa there! You are asking questions too fast. Please wait a minute."
  },
  standardHeaders: true, 
  legacyHeaders: false,
});

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('📁 Uploads directory created');
}

// Configure Multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const fileExt = path.extname(file.originalname);
    const fileName = file.fieldname + '-' + uniqueSuffix + fileExt;
    cb(null, fileName);
  }
});

// File filter to accept only PDFs and images
const fileFilter = (req, file, cb) => {
  const allowedTypes = /pdf|jpeg|jpg|png|gif/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF and image files (JPEG, JPG, PNG, GIF) are allowed!'), false);
  }
};

// Initialize Multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB file size limit
  }
});

// MongoDB Connection
const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGO_URI;
    
    if (!mongoURI) {
      throw new Error('MONGO_URI is not defined in environment variables');
    }

    await mongoose.connect(mongoURI);
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
};

// Connect to database
connectDB();

// Helper function to run Python preprocessing
const runPreprocessing = (imagePath) => {
  return new Promise((resolve, reject) => {
    // Get absolute path to the Python script in utils folder
    const scriptPath = path.join(__dirname, 'utils', 'preprocess.py');
    
    // Convert image path to absolute path
    const absoluteImagePath = path.resolve(imagePath);
    
    // Use virtual environment Python (relative to project root)
    const pythonPath = path.join(__dirname, 'venv', 'bin', 'python3');
    
    console.log(`📍 Python Path: ${pythonPath}`);
    console.log(`📍 Script Path: ${scriptPath}`);
    console.log(`📍 Image Path: ${absoluteImagePath}`);
    
    // Spawn Python process with venv Python
    const pythonProcess = spawn(pythonPath, [scriptPath, absoluteImagePath]);
    
    let outputData = '';
    let errorData = '';
    
    // Capture stdout (JSON output from Python)
    pythonProcess.stdout.on('data', (data) => {
      outputData += data.toString();
    });
    
    // Capture stderr (error messages and Python warnings)
    pythonProcess.stderr.on('data', (data) => {
      errorData += data.toString();
    });
    
    // Handle process completion
    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        console.error('❌ Python preprocessing error:', errorData);
        return reject({
          error: 'Preprocessing failed',
          details: errorData,
          exitCode: code
        });
      }
      
      try {
        // Parse JSON output from Python script
        const result = JSON.parse(outputData.trim());
        console.log('✅ Preprocessing completed successfully');
        resolve(result);
      } catch (parseError) {
        reject({
          error: 'Failed to parse Python output',
          output: outputData,
          parseError: parseError.message
        });
      }
    });
    
    // Handle spawn errors
    pythonProcess.on('error', (error) => {
      reject({
        error: 'Failed to start Python process',
        details: error.message,
        hint: 'Make sure virtual environment exists at ./venv/'
      });
    });
  });
};

// Helper function to run OCR on processed image
const runOCR = (imagePath, language = 'eng') => {
  return new Promise((resolve, reject) => {
    // Get absolute path to the OCR script in utils folder
    const scriptPath = path.join(__dirname, 'utils', 'ocr.py');
    
    // Convert image path to absolute path
    const absoluteImagePath = path.resolve(imagePath);
    
    // Use virtual environment Python (relative to project root)
    const pythonPath = path.join(__dirname, 'venv', 'bin', 'python3');
    
    console.log(`📍 Running OCR on: ${absoluteImagePath}`);
    console.log(`📍 Language: ${language}`);
    
    // Spawn Python process with venv Python
    const pythonProcess = spawn(pythonPath, [scriptPath, absoluteImagePath, language]);
    
    let outputData = '';
    let errorData = '';
    
    // Capture stdout (JSON output from Python)
    pythonProcess.stdout.on('data', (data) => {
      outputData += data.toString();
    });
    
    // Capture stderr (error messages and warnings)
    pythonProcess.stderr.on('data', (data) => {
      errorData += data.toString();
    });
    
    // Handle process completion
    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        console.error('❌ OCR error:', errorData);
        return reject({
          error: 'OCR failed',
          details: errorData,
          exitCode: code
        });
      }
      
      try {
        // Parse JSON output from Python script
        const result = JSON.parse(outputData.trim());
        console.log('✅ OCR completed successfully');
        console.log(`📊 Extracted ${result.metadata?.word_count || 0} words`);
        resolve(result);
      } catch (parseError) {
        reject({
          error: 'Failed to parse OCR output',
          output: outputData,
          parseError: parseError.message
        });
      }
    });
    
    // Handle spawn errors
    pythonProcess.on('error', (error) => {
      reject({
        error: 'Failed to start OCR process',
        details: error.message,
        hint: 'Make sure virtual environment exists at ./venv/ and pytesseract is installed'
      });
    });
  });
};

// Routes
// Health check route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'DocuMind API is running',
    timestamp: new Date().toISOString()
  });
});

// TABLE PROCESSING HELPER FUNCTIONS

/**
 * Fallback vision API for low-confidence table OCR
 * Uses Llama Vision to extract table data as structured JSON
 */
async function callVisionAPI(imagePath) {
  try {
    console.log(`  📸 Calling Vision API for table: ${path.basename(imagePath)}`);
    
    // Convert image to base64
    const imageBuffer = await fs.promises.readFile(imagePath);
    const base64Data = imageBuffer.toString('base64');
    const ext = path.extname(imagePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif'
    };
    const mimeType = mimeTypes[ext] || 'image/jpeg';
    const dataURL = `data:${mimeType};base64,${base64Data}`;
    
    // Prepare vision prompt
    const visionPrompt = `Analyze this table image and extract all data as structured JSON.

Return ONLY a JSON object with this structure:
{
  "rows": [
    ["Header1", "Header2", "Header3"],
    ["Cell1", "Cell2", "Cell3"],
    ["Cell4", "Cell5", "Cell6"]
  ],
  "columnCount": 3,
  "rowCount": 3,
  "hasHeaders": true
}

Extract all visible text from the table cells. Preserve the exact order and structure.`;

    // Call Groq Vision API
    const completion = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
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
                url: dataURL
              }
            }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 2048
    });
    
    const responseText = completion.choices[0]?.message?.content || '{}';
    
    // Clean and parse JSON
    const cleanJson = responseText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    const tableData = JSON.parse(cleanJson);
    
    console.log(`  ✅ Vision API extracted ${tableData.rowCount || 0} rows`);
    
    return {
      success: true,
      method: 'vision_api',
      data: tableData
    };
    
  } catch (error) {
    console.error(`  ❌ Vision API failed:`, error.message);
    return {
      success: false,
      method: 'vision_api',
      error: error.message,
      data: null
    };
  }
}

/**
 * Process extracted tables: Run OCR with confidence check and Vision API fallback
 */
async function processExtractedTables(tables, pageNumber = 1) {
  const extractedTables = [];
  
  if (!tables || tables.length === 0) {
    return extractedTables;
  }
  
  console.log(`\n📊 Processing ${tables.length} extracted table(s) for page ${pageNumber}...`);
  
  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    const tableNum = table.table_number || (i + 1);
    
    console.log(`\n  Table ${tableNum}/${tables.length}:`);
    console.log(`  📍 Location: (${table.bounding_box.x}, ${table.bounding_box.y})`);
    console.log(`  📐 Size: ${table.bounding_box.width}x${table.bounding_box.height}`);
    
    try {
      // Step 1: Run OCR on clean table image
      console.log(`  🔍 Running OCR on clean table image...`);
      const tableOcrResult = await runOCR(table.clean_path);
      
      if (!tableOcrResult || !tableOcrResult.success) {
        throw new Error('OCR failed for table');
      }
      
      const confidence = tableOcrResult.metadata.average_confidence;
      console.log(`  📊 OCR Confidence: ${confidence}%`);
      
      let extractedData = {
        tableNumber: tableNum,
        boundingBox: table.bounding_box,
        originalPath: table.original_path,
        cleanPath: table.clean_path,
        area: table.area,
        extractionMethod: null,
        confidence: confidence,
        text: null,
        structuredData: null
      };
      
      // Step 2: Check confidence threshold
      if (confidence >= 75) {
        // High confidence - use OCR result
        console.log(`  ✅ High confidence (>= 75%) - Using OCR result`);
        extractedData.extractionMethod = 'tesseract_ocr';
        extractedData.text = tableOcrResult.text || '';
        extractedData.wordCount = tableOcrResult.metadata.word_count;
        
      } else {
        // Low confidence - fallback to Vision API
        console.log(`  ⚠️  Low confidence (< 75%) - Falling back to Vision API`);
        
        const visionResult = await callVisionAPI(table.original_path);
        
        if (visionResult.success && visionResult.data) {
          extractedData.extractionMethod = 'vision_api_fallback';
          extractedData.structuredData = visionResult.data;
          
          // Convert structured data to text for backward compatibility
          if (visionResult.data.rows && Array.isArray(visionResult.data.rows)) {
            extractedData.text = visionResult.data.rows
              .map(row => row.join(' | '))
              .join('\n');
            extractedData.wordCount = extractedData.text.split(/\s+/).length;
          }
          
          console.log(`  ✅ Vision API extracted structured table data`);
        } else {
          // Vision API also failed - use low-confidence OCR as last resort
          console.log(`  ⚠️  Vision API failed - Using low-confidence OCR as fallback`);
          extractedData.extractionMethod = 'tesseract_ocr_low_confidence';
          extractedData.text = tableOcrResult.text || '';
          extractedData.wordCount = tableOcrResult.metadata.word_count;
        }
      }
      
      extractedTables.push(extractedData);
      console.log(`  ✅ Table ${tableNum} processing complete`);
      
    } catch (tableError) {
      console.error(`  ❌ Table ${tableNum} processing failed:`, tableError.message);
      
      // Add error placeholder
      extractedTables.push({
        tableNumber: tableNum,
        boundingBox: table.bounding_box,
        originalPath: table.original_path,
        cleanPath: table.clean_path,
        error: true,
        errorMessage: tableError.message,
        extractionMethod: 'failed'
      });
    }
  }
  
  console.log(`\n✅ Completed processing ${extractedTables.length} tables`);
  return extractedTables;
}

// ============================================
// UPDATED FILE UPLOAD ROUTE
// ============================================

// File upload route with automated preprocessing, OCR pipeline, and multi-page PDF support
app.post('/api/upload', upload.single('document'), async (req, res) => {
  let tempPagesDir = null; // Track temporary directory for cleanup
  
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Please select a file.'
      });
    }

    // Construct file information
    const fileInfo = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      path: req.file.path,
      absolutePath: path.resolve(req.file.path),
      size: req.file.size,
      mimetype: req.file.mimetype,
      uploadedAt: new Date().toISOString()
    };
    
    const existingDoc = await Document.findOne({ 
      originalName: fileInfo.originalName,
      size: fileInfo.size 
    });

    if (existingDoc) {
      console.log(`♻️  "${fileInfo.originalName}" already exists. Fetching from DB...`);
      
      // Cleanup the newly uploaded file to save disk space
      if (fs.existsSync(fileInfo.path)) {
        await fs.promises.unlink(fileInfo.path);
      }

      return res.status(200).json({
        success: true,
        message: 'Retrieved from database',
        file: existingDoc,
        isExisting: true
      });
    }
    
    console.log('\n🔄 Starting automated pipeline...');

    // Check file type
    const isImage = /image\/(jpeg|jpg|png|gif)/.test(req.file.mimetype);
    const isPdf = req.file.mimetype === 'application/pdf';
    
    // Handle PDF files (multi-page support)
    if (isPdf) {
      try {
        console.log('\n📄 PDF Upload Detected - Starting Multi-Page Processing');
        console.log(`📁 PDF: ${fileInfo.originalName}`);
        
        // Step 1: Split PDF into page images
        console.log('\n🔪 Step 1: Splitting PDF into pages...');
        const pdfResult = await splitPdfToImages(fileInfo.absolutePath, path.dirname(fileInfo.absolutePath));
        
        if (!pdfResult.success) {
          throw pdfResult;
        }
        
        tempPagesDir = pdfResult.outputDir; // Store for cleanup
        console.log(`✅ PDF split complete: ${pdfResult.pageCount} pages`);
        
        fileInfo.isPdf = true;
        fileInfo.pageCount = pdfResult.pageCount;
        fileInfo.pages = [];
        
        // Step 2: Process each page through the pipeline
        console.log('\n🔄 Step 2: Processing each page through OCR pipeline...\n');
        
        for (let i = 0; i < pdfResult.pages.length; i++) {
          const pageImagePath = pdfResult.pages[i];
          const pageNumber = i + 1;
          const totalPages = pdfResult.pageCount;

          console.log(`${'='.repeat(60)}`);
          console.log(`📄 STARTING: Page ${pageNumber} of ${totalPages}`);
          console.log(`⏳ Progress: ${Math.round((pageNumber / totalPages) * 100)}%`);
          console.log(`${'='.repeat(60)}`);
          
          const pageData = {
            pageNumber: pageNumber,
            imagePath: pageImagePath,
            preprocessed: false,
            ocrCompleted: false,
            extractedTables: [] // NEW: Store extracted table data
          };
          
          try {
            // Step 2a: Preprocess the page image (includes table detection)
            console.log(`\n🔄 Step 2a: Preprocessing page ${pageNumber}...`);
            const preprocessResult = await runPreprocessing(path.resolve(pageImagePath));
            
            if (!preprocessResult || !preprocessResult.success) {
              throw {
                stage: 'preprocessing',
                error: preprocessResult?.error || 'Preprocessing failed',
                page: pageNumber
              };
            }
            
            console.log(`✅ Page ${pageNumber} preprocessing completed`);
            
            pageData.preprocessed = true;
            pageData.processedImagePath = preprocessResult.processed_image;
            pageData.preprocessingSteps = preprocessResult.preprocessing_steps;
            
            // NEW: Process extracted tables
            if (preprocessResult.tables_detected && preprocessResult.tables_detected.length > 0) {
              console.log(`\n📊 Found ${preprocessResult.tables_detected.length} table(s) on page ${pageNumber}`);
              pageData.extractedTables = await processExtractedTables(
                preprocessResult.tables_detected,
                pageNumber
              );
            }
            
            // Step 2b: Run OCR on the processed page
            console.log(`\n🔍 Step 2b: Running OCR on page ${pageNumber}...`);
            const ocrResult = await runOCR(preprocessResult.processed_image);
            
            if (!ocrResult || !ocrResult.success) {
              throw {
                stage: 'ocr',
                error: ocrResult?.error || 'OCR failed',
                page: pageNumber
              };
            }
            
            console.log(`✅ Page ${pageNumber} OCR completed`);
            console.log(`📊 Extracted ${ocrResult.metadata.word_count} words with ${ocrResult.metadata.average_confidence}% confidence`);
            
            pageData.ocrCompleted = true;
            pageData.extractedText = ocrResult.text || '';
            pageData.ocrMetadata = {
              wordCount: ocrResult.metadata.word_count,
              averageConfidence: ocrResult.metadata.average_confidence,
              language: ocrResult.metadata.language
            };
            
            // Step 2c: Build structure for this page (including table data)
            console.log(`\n🌳 Step 2c: Building structure for page ${pageNumber}...`);
            try {
              // Combine main text with table text for structure building
              const structuralData = buildDocumentTree(
                  pageData.extractedText, 
                  pageData.extractedTables || []
              );

              const navigationMap = getNavigationMap(structuralData.tree);
              const documentStats = getDocumentStats(structuralData.tree);
              
              pageData.structuredTree = structuralData.tree;
              pageData.structureMetadata = structuralData.metadata;
              pageData.navigationMap = navigationMap;
              pageData.documentStats = documentStats;
              
              console.log(`✅ Page ${pageNumber} structure built: ${documentStats.headings} headings, ${documentStats.contentNodes} content nodes`);
              
              if (pageData.extractedTables.length > 0) {
                console.log(`📊 Included ${pageData.extractedTables.length} table(s) in structure`);
              }
              
            } catch (structureError) {
              console.error(`⚠️  Structure parsing warning for page ${pageNumber}:`, structureError);
              pageData.structuredTree = [];
              pageData.structureMetadata = { error: 'Structure parsing failed' };
            }
            
            // Step 2d: Cleanup temporary page images (original and processed)
            console.log(`\n🗑️  Step 2d: Cleaning up temporary images for page ${pageNumber}...`);
            try {
              // Delete processed main image
              if (preprocessResult.processed_image && fs.existsSync(preprocessResult.processed_image)) {
                await fs.promises.unlink(preprocessResult.processed_image);
                console.log(`✅ Deleted processed image: ${path.basename(preprocessResult.processed_image)}`);
              }
              
              // Delete extracted table images (keep them if you want to serve them later)
              // Uncomment if you want to delete table images:
              /*
              if (pageData.extractedTables.length > 0) {
                for (const table of pageData.extractedTables) {
                  if (table.originalPath && fs.existsSync(table.originalPath)) {
                    await fs.promises.unlink(table.originalPath);
                  }
                  if (table.cleanPath && fs.existsSync(table.cleanPath)) {
                    await fs.promises.unlink(table.cleanPath);
                  }
                }
              }
              */
              
            } catch (cleanupError) {
              console.warn(`⚠️  Cleanup warning for page ${pageNumber}:`, cleanupError.message);
            }
            
            console.log(`\n✅ Page ${pageNumber} processing complete!\n`);
            
          } catch (pageError) {
            console.error(`\n❌ Error processing page ${pageNumber}:`, pageError);
            
            pageData.error = true;
            pageData.errorMessage = pageError.error || pageError.message || 'Page processing failed';
            pageData.errorStage = pageError.stage || 'unknown';
          }
          
          // Add page data to results
          fileInfo.pages.push(pageData);
        }
        
        // Calculate aggregate statistics
        const successfulPages = fileInfo.pages.filter(p => p.ocrCompleted);
        const totalWords = successfulPages.reduce((sum, p) => sum + (p.ocrMetadata?.wordCount || 0), 0);
        const avgConfidence = successfulPages.length > 0
          ? successfulPages.reduce((sum, p) => sum + (p.ocrMetadata?.averageConfidence || 0), 0) / successfulPages.length
          : 0;
        
        // NEW: Calculate table statistics
        const totalTables = fileInfo.pages.reduce((sum, p) => sum + (p.extractedTables?.length || 0), 0);
        
        fileInfo.aggregateStats = {
          totalPages: pdfResult.pageCount,
          successfulPages: successfulPages.length,
          failedPages: pdfResult.pageCount - successfulPages.length,
          totalWords: totalWords,
          averageConfidence: Math.round(avgConfidence * 100) / 100,
          totalTables: totalTables // NEW
        };
        
        // Cleanup: Remove temporary pages directory
        console.log(`\n🗑️  Final Cleanup: Removing temporary pages directory...`);
        await cleanupPageImages(tempPagesDir);
        tempPagesDir = null; // Mark as cleaned
        
        console.log(`\n${'='.repeat(60)}`);
        console.log(`✅ PDF Processing Complete!`);
        console.log(`📊 Successfully processed ${successfulPages.length}/${pdfResult.pageCount} pages`);
        console.log(`📝 Total words extracted: ${totalWords}`);
        console.log(`🎯 Average confidence: ${avgConfidence.toFixed(2)}%`);
        console.log(`📊 Total tables extracted: ${totalTables}`);
        console.log(`${'='.repeat(60)}\n`);
        
      } catch (pdfError) {
        console.error('\n❌ PDF processing error:', pdfError);
        
        fileInfo.isPdf = true;
        fileInfo.error = true;
        fileInfo.errorMessage = pdfError.error || pdfError.message || 'PDF processing failed';
        fileInfo.errorDetails = pdfError.details || pdfError.toString();
        
        // Cleanup on error
        if (tempPagesDir) {
          try {
            await cleanupPageImages(tempPagesDir);
          } catch (cleanupErr) {
            console.error('Cleanup error:', cleanupErr);
          }
        }
      }
      
    } else if (isImage) {
      // Handle single image files (existing pipeline)
      let preprocessResult = null;
      let ocrResult = null;
      
      try {
        console.log('\n🔄 Starting automated pipeline...');
        console.log('📸 Step 1/3: Image Preprocessing');
        
        // Step 1: Preprocess the image (includes table detection)
        preprocessResult = await runPreprocessing(fileInfo.absolutePath);
        
        console.log('🔍 DEBUG - Preprocessing result:', JSON.stringify(preprocessResult, null, 2));
        
        if (!preprocessResult || !preprocessResult.success) {
          const errorMsg = preprocessResult?.error || 'Unknown preprocessing error';
          throw {
            stage: 'preprocessing',
            error: errorMsg,
            details: preprocessResult?.message || 'Preprocessing returned unsuccessful result'
          };
        }
        
        console.log('✅ Preprocessing completed');
        console.log(`📁 Processed image: ${preprocessResult.processed_image}`);
        
        // Add preprocessing info to response
        fileInfo.preprocessed = true;
        fileInfo.processedImagePath = preprocessResult.processed_image;
        fileInfo.preprocessingSteps = preprocessResult.preprocessing_steps;
        fileInfo.originalDimensions = preprocessResult.original_dimensions;
        fileInfo.extractedTables = []; // NEW: Initialize tables array
        
        // NEW: Process extracted tables
        if (preprocessResult.tables_detected && preprocessResult.tables_detected.length > 0) {
          console.log(`\n📊 Found ${preprocessResult.tables_detected.length} table(s) in image`);
          fileInfo.extractedTables = await processExtractedTables(
            preprocessResult.tables_detected,
            1
          );
        }
        
        // Step 2: Run OCR on the processed image
        console.log('\n🔍 Step 2/3: Running OCR');
        console.log(`📍 OCR input path: ${preprocessResult.processed_image}`);
        
        ocrResult = await runOCR(preprocessResult.processed_image);
        
        console.log('🔍 DEBUG - OCR result:', JSON.stringify(ocrResult, null, 2));
        
        if (!ocrResult || !ocrResult.success) {
          const errorMsg = ocrResult?.error || 'Unknown OCR error';
          throw {
            stage: 'ocr',
            error: errorMsg,
            details: ocrResult?.message || 'OCR returned unsuccessful result',
            preprocessingSucceeded: true
          };
        }
        
        console.log('✅ OCR completed');
        console.log(`📊 Extracted ${ocrResult.metadata.word_count} words with ${ocrResult.metadata.average_confidence}% confidence`);
        
        // Add OCR results to response - CRITICAL: Ensure text is included
        fileInfo.ocrCompleted = true;
        fileInfo.extractedText = ocrResult.text || '';  // Fallback to empty string
        fileInfo.ocrMetadata = {
          wordCount: ocrResult.metadata.word_count,
          averageConfidence: ocrResult.metadata.average_confidence,
          language: ocrResult.metadata.language,
          tesseractVersion: ocrResult.metadata.tesseract_version
        };
        
        // Step 3: Build structural tree from extracted text (including table data)
        console.log('\n🌳 Step 3/3: Building Document Structure');
        
        try {
          // Combine main text with table text for structure building
          let combinedText = fileInfo.extractedText;
          
          if (fileInfo.extractedTables.length > 0) {
            const tableTexts = fileInfo.extractedTables
              .filter(t => t.text)
              .map(t => `\n[TABLE ${t.tableNumber}]\n${t.text}\n[/TABLE]\n`)
              .join('\n');
            
            combinedText += '\n' + tableTexts;
          }
          
          const structuralData = buildDocumentTree(combinedText);
          const navigationMap = getNavigationMap(structuralData.tree);
          const documentStats = getDocumentStats(structuralData.tree);
          
          // Add structural analysis to response
          fileInfo.structuredTree = structuralData.tree;
          fileInfo.structureMetadata = structuralData.metadata;
          fileInfo.navigationMap = navigationMap;
          fileInfo.documentStats = documentStats;
          
          console.log('✅ Document structure built');
          console.log(`📋 Found ${documentStats.headings} headings and ${documentStats.contentNodes} content nodes`);
          console.log(`🗺️  Navigation map: ${navigationMap.length} sections`);
          
          if (fileInfo.extractedTables.length > 0) {
            console.log(`📊 Included ${fileInfo.extractedTables.length} table(s) in structure`);
          }
          
        } catch (structureError) {
          console.error('⚠️  Structure parsing warning:', structureError);
          fileInfo.structuredTree = [];
          fileInfo.structureMetadata = { error: 'Structure parsing failed' };
        }
        
        console.log('\n✅ Pipeline completed successfully!');
        console.log(`📝 Extracted text length: ${fileInfo.extractedText.length} characters`);
        if (fileInfo.extractedTables.length > 0) {
          console.log(`📊 Extracted ${fileInfo.extractedTables.length} table(s)\n`);
        }
        
      } catch (pipelineError) {
        // Log detailed error information
        console.error('\n❌ Pipeline error occurred:');
        console.error('Stage:', pipelineError.stage || 'unknown');
        console.error('Error:', pipelineError.error || pipelineError.message || pipelineError);
        console.error('Details:', pipelineError.details || 'No additional details');
        console.error('Full error object:', pipelineError);
        
        // Determine which stage failed and set flags accordingly
        if (pipelineError.stage === 'preprocessing') {
          fileInfo.preprocessed = false;
          fileInfo.ocrCompleted = false;
          fileInfo.pipelineError = `Preprocessing failed: ${pipelineError.error}`;
        } else if (pipelineError.stage === 'ocr') {
          // Preprocessing succeeded but OCR failed
          fileInfo.preprocessed = true;
          fileInfo.processedImagePath = preprocessResult?.processed_image || null;
          fileInfo.ocrCompleted = false;
          fileInfo.pipelineError = `OCR failed: ${pipelineError.error}`;
        } else {
          // Unknown error
          fileInfo.preprocessed = false;
          fileInfo.ocrCompleted = false;
          fileInfo.pipelineError = pipelineError.error || pipelineError.message || 'Pipeline failed';
        }
        
        // Include additional error details
        if (pipelineError.details) {
          fileInfo.errorDetails = pipelineError.details;
        }
        if (pipelineError.hint) {
          fileInfo.hint = pipelineError.hint;
        }
        if (pipelineError.exitCode !== undefined) {
          fileInfo.exitCode = pipelineError.exitCode;
        }
      }
    } else {
      // Unknown file type
      fileInfo.error = true;
      fileInfo.errorMessage = 'Unsupported file type';
      console.log('⚠️  Unsupported file type uploaded');
    }

    if (!fileInfo.error && (fileInfo.extractedText || fileInfo.pages)) {
      try {
        console.log('🤖 Starting Accessibility Analysis...');
        
        // Prepare data for the agent
        // If it's a PDF, we use the pages array. If it's an image, we mock a single page.
        const isPdf = fileInfo.mimetype === 'application/pdf';
        const pagesData = isPdf && fileInfo.pages ? fileInfo.pages : [{
            pageNumber: 1,
            extractedText: fileInfo.extractedText,
            processedImagePath: fileInfo.processedImagePath,
            structuredTree: fileInfo.structuredTree,
            extractedTables: fileInfo.extractedTables || [] // NEW: Include tables
        }];

        const aiAnalysis = await analyzeDocument({
          originalName: fileInfo.originalName,
          documentType: isPdf ? 'document' : 'image',
          isPdf: isPdf,
          pageCount: pagesData.length,
          pages: pagesData,
          // Fallbacks if single page image
          extractedText: fileInfo.extractedText,
          structuredTree: fileInfo.structuredTree,
          processedImagePath: fileInfo.processedImagePath
        });

        // Attach the AI results to fileInfo so they get saved to MongoDB
        fileInfo.aiAnalysis = aiAnalysis;
        fileInfo.aiEnabled = true;
        console.log('✅ Accessibility Analysis Attached to File Info');

      } catch (aiError) {
        console.error('⚠️ AI Agent skipped:', aiError.message);
        fileInfo.aiEnabled = false; 
        // We continue saving even if AI fails
      }
    }

    try {
      console.log('\n💾 Saving complete processing results to MongoDB...');
      const document = new Document(fileInfo);
      const savedDoc = await document.save();
      console.log(`✅ Document saved! ID: ${savedDoc._id}`);
      
      // Add the ID to the response so you can find it later
      fileInfo._id = savedDoc._id; 
    } catch (dbError) {
      console.error('❌ MongoDB save error:', dbError.message);
    }
    
    // FINAL CLEANUP: Delete Original Upload AND Python Temporary Images
    try {
      const fs = require('fs');
      const path = require('path');

      if (req.file) {
        // 1. Delete the original uploaded file
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
          console.log(`🗑️ Deleted original file: ${req.file.filename}`);
        }

        // 2. Get the base name without the extension (e.g., "document-123" instead of "document-123.jpg")
        const baseName = path.parse(req.file.filename).name;
        const uploadDir = req.file.destination;
        const files = fs.readdirSync(uploadDir);
        
        // 3. Sweep the folder for ANY leftovers belonging to this base name
        files.forEach(file => {
          if (file.includes(baseName) && file !== req.file.filename) {
            fs.unlinkSync(path.join(uploadDir, file));
            console.log(`🗑️ Cleaned up Python leftover: ${file}`);
          }
        });
      }
    } catch (cleanupError) {
      console.error(`⚠️ Failed during cleanup: ${cleanupError.message}`);
    }
    // Return success response with all processing results
    res.status(200).json({
      success: true,
      message: 'File uploaded successfully',
      file: fileInfo
    });

  } catch (error) {
    // Cleanup on catastrophic error
    if (tempPagesDir) {
      try {
        await cleanupPageImages(tempPagesDir);
      } catch (cleanupErr) {
        console.error('Cleanup error:', cleanupErr);
      }
    }
    
    console.error('❌ Upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading file',
      error: error.message
    });
  }
});

// Document routes (GET /api/documents, etc.)
const documentRoutes = require('./routes/documentRoutes');
app.use('/api/documents', documentRoutes);

// POST /api/documents/:id/chat - RAG Chat endpoint
// ============================================
// RAG HELPER FUNCTIONS
// ============================================

/**
 * Extract keywords from question (remove stopwords)
 */
function extractKeywords(question) {
  const stopwords = new Set([
    'what', 'is', 'the', 'a', 'an', 'of', 'in', 'on', 'for', 'to', 'with',
    'how', 'many', 'much', 'are', 'was', 'were', 'been', 'be', 'have', 'has',
    'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'can',
    'may', 'might', 'must', 'this', 'that', 'these', 'those', 'i', 'you',
    'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
    'my', 'your', 'his', 'its', 'our', 'their', 'am', 'who', 'which',
    'where', 'when', 'why', 'there', 'here', 'then', 'than', 'so', 'but',
    'and', 'or', 'if', 'because', 'as', 'until', 'while', 'at', 'by', 'from',
    'give', 'show', 'tell', 'written', 'please', 'document', 'page', 'find',
  ]);
  
  // Convert to lowercase, split by non-word characters, filter stopwords and short words
  const keywords = question
    .toLowerCase()
    .split(/\W+/)
    .filter(word => 
      word.length > 2 && 
      !stopwords.has(word) &&
      !/^\d+$/.test(word) // Keep numbers if they're part of words
    );
  
  return [...new Set(keywords)]; // Remove duplicates
}

/**
 * Flatten structured tree into array of nodes
 * Handles both single-level arrays and nested trees
 */
function flattenStructuredTree(tree, parentPath = '') {
  if (!tree || !Array.isArray(tree)) {
    return [];
  }
  
  const flattened = [];
  
  function traverse(nodes, currentPath) {
    for (const node of nodes) {
      // Create path for context
      const nodePath = currentPath ? `${currentPath} > ${node.hint || node.text}` : (node.hint || node.text);
      
      flattened.push({
        id: node.id,
        type: node.type,
        text: node.text,
        hint: node.hint,
        path: nodePath,
        tableData: node.tableData || null,
        metadata: node.metadata || {}
      });
      
      // Recursively traverse children
      if (node.children && Array.isArray(node.children) && node.children.length > 0) {
        traverse(node.children, nodePath);
      }
    }
  }
  
  traverse(tree, parentPath);
  return flattened;
}

/**
 * Retrieve relevant nodes based on keyword matching
 */
function retrieveRelevantNodes(flatTree, keywords) {
  if (!keywords || keywords.length === 0) return flatTree;

  const relevantIndices = new Set();

  flatTree.forEach((node, index) => {
    const nodeTextLower = node.text?.toLowerCase() || '';
    const tableRawLower = node.tableData?.rawText?.toLowerCase() || '';
    let tableStructuredLower = '';

    if (node.tableData?.structuredData?.rows) {
       tableStructuredLower = JSON.stringify(node.tableData.structuredData.rows).toLowerCase();
    }

    const matches = keywords.some(keyword =>
      nodeTextLower.includes(keyword) ||
      tableRawLower.includes(keyword) ||
      tableStructuredLower.includes(keyword)
    );

    if (matches) {
      relevantIndices.add(index);
      
      // The +3 Window: Stitches broken sentences, ignores massive chapters
      if (index > 0) relevantIndices.add(index - 1);
      if (index < flatTree.length - 1) relevantIndices.add(index + 1);
      if (index < flatTree.length - 2) relevantIndices.add(index + 2);
      if (index < flatTree.length - 3) relevantIndices.add(index + 3);
    }
  });

  return flatTree.filter((_, index) => relevantIndices.has(index));
}

/**
 * Format table data as clean Markdown table
 */
function formatTableAsMarkdown(tableData) {
  if (!tableData || !tableData.structuredData || !tableData.structuredData.rows) {
    // Fallback to raw text
    if (tableData && tableData.rawText) {
      return `[TABLE START]\n${tableData.rawText}\n[TABLE END]`;
    }
    return '';
  }
  
  const { rows, hasHeaders } = tableData.structuredData;
  
  if (!rows || rows.length === 0) {
    return tableData.rawText ? `[TABLE START]\n${tableData.rawText}\n[TABLE END]` : '';
  }
  
  let markdown = '\n';
  
  // Add header row
  const headerRow = rows[0];
  markdown += '| ' + headerRow.join(' | ') + ' |\n';
  
  // Add separator
  markdown += '| ' + headerRow.map(() => '---').join(' | ') + ' |\n';
  
  // Add data rows (skip first row if it's headers)
  const dataRows = hasHeaders ? rows.slice(1) : rows.slice(1);
  for (const row of dataRows) {
    markdown += '| ' + row.join(' | ') + ' |\n';
  }
  
  return markdown + '\n';
}

/**
 * Build context string from retrieved nodes
 */
function buildContextFromNodes(nodes) {
  if (!nodes || nodes.length === 0) {
    return '';
  }
  
  let context = '';
  const MAX_CHARS = 25000;
  
  for (const node of nodes) {
    // If we are about to blow up the API, STOP adding text!
    if (context.length > MAX_CHARS) {
      console.log(`⚠️ Circuit Breaker hit! Truncating context to save API limits.`);
      break; 
    }
    // Add path for context (helps LLM understand document structure)
    if (node.path) {
      context += `\n[${node.path}]\n`;
    }
    
    if (node.type === 'table') {
      // Format table specially
      if (node.tableData) {
        context += formatTableAsMarkdown(node.tableData);
      }
    } else if (node.type === 'heading') {
      // Headings in bold
      context += `**${node.text}**\n`;
    } else {
      // Regular content
      context += `${node.text}\n`;
    }
  }
  
  return context.trim();
}

// ============================================
// RAG-ENHANCED CHAT ENDPOINT
// ============================================

// POST /api/documents/:id/chat - RAG Chat endpoint with keyword retrieval
app.post('/api/documents/:id/chat', chatLimiter, async (req, res) => { 
  try {
    const { id } = req.params;
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ 
        success: false, 
        error: "Please provide a question." 
      });
    }

    console.log(`\n💬 RAG Chat Request for document ${id}`);
    console.log(`📝 Question: "${question}"`);

    // Fetch document from MongoDB
    const document = await Document.findById(id); 
    if (!document) {
      return res.status(404).json({ 
        success: false, 
        error: "Document not found." 
      });
    }

    // ========================================
    // 1. CHECK MONGODB CACHE FIRST
    // ========================================
    const normalizedQuestion = question.toLowerCase().trim();
    
    if (document.chatHistory && document.chatHistory.length > 0) {
      const cachedChat = document.chatHistory.find(
        chat => chat.question.toLowerCase().trim() === normalizedQuestion
      );

      if (cachedChat) {
        console.log(`⚡ CACHE HIT! Returning saved answer for: "${question}"`);
        return res.json({ 
          success: true, 
          answer: cachedChat.answer,
          documentId: id,
          question: question,
          metadata: {
            method: 'database_cache',
            tokenCost: '$0.00',
            savedTokens: '100%' // Saved you a full API call!
          }
        });
      }
    }

    // ========================================
    //  TREE FLATTENING & RETRIEVAL
    // ========================================
    
    console.log(`\n🔍 STEP 1: Keyword Extraction & Tree Retrieval`);
    
    // Extract keywords from question
    const keywords = extractKeywords(question);
    console.log(`📌 Keywords extracted: [${keywords.join(', ')}]`);
    
    // Flatten structured tree (handle both PDFs and single images)
    let flatTree = [];
    
    if (document.isPdf && document.pages && document.pages.length > 0) {
      // Multi-page PDF - combine all page trees
      console.log(`📄 Processing ${document.pages.length}-page PDF...`);
      
      for (let i = 0; i < document.pages.length; i++) {
        const page = document.pages[i];
        if (page.structuredTree && Array.isArray(page.structuredTree)) {
          const pageNodes = flattenStructuredTree(
            page.structuredTree, 
            `Page ${page.pageNumber}`
          );
          flatTree = flatTree.concat(pageNodes);
        }
      }
    } else if (document.structuredTree && Array.isArray(document.structuredTree)) {
      // Single image - use root structured tree
      console.log(`📷 Processing single image document...`);
      flatTree = flattenStructuredTree(document.structuredTree);
    } else {
      // No structured tree available - fallback to plain text
      console.log(`⚠️  No structured tree found, falling back to plain text`);
      
      let docText = document.extractedText || '';
      if (document.pages && document.pages.length > 0) {
        docText = document.pages
          .map(p => p.extractedText)
          .filter(text => text)
          .join('\n\n--- Page Break ---\n\n');
      }
      
      if (!docText || docText.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: "No text content found in this document."
        });
      }
      
      // Use legacy approach
      const prompt = `You are an accessibility assistant helping a user understand a document. 
Answer the user's question based STRICTLY on the document text provided below. 
If the answer is not in the text, say "I cannot find that information in the document."
Keep your answer concise and easy to read out loud.

DOCUMENT TEXT:
${docText.substring(0, 3000)}

USER QUESTION: ${question}`;
const chatCompletion = await groq.chat.completions.create
    ({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_tokens: 512
    });

      const answer = chatCompletion.choices[0]?.message?.content;
      console.log(`✅ AI Answer (legacy): ${answer}`);

      // ========================================
      //  SAVE GOOD ANSWERS TO CACHE
      // ========================================
      // Protect the cache from bad or missing answers!
     if (answer) { // First, make sure Groq actually gave us a string!
        const failurePhrases = ["cannot find that information", "i don't know", "not in the document"];
        const isBadAnswer = failurePhrases.some(phrase => answer.toLowerCase().includes(phrase));

        if (!isBadAnswer) {
          // Bulletproof direct MongoDB push
          await Document.findByIdAndUpdate(id, {
            $push: { chatHistory: { question: question, answer: answer } }
          });
          console.log(`💾 Saved good Q&A to MongoDB Cache!`);
        } else {
          console.log(`🚫 AI could not find the answer. Did NOT save to cache to prevent poisoning.`);
        }
      } else {
        console.log(`⚠️ AI returned an empty answer. Did NOT save to cache.`);
      }

      return res.json({ 
        success: true, 
        answer: answer,
        documentId: id,
        question: question,
        method: 'legacy_plaintext'
      });
    }
    
    console.log(`📊 Total nodes in tree: ${flatTree.length}`);
    
    // Retrieve relevant nodes based on keywords
    let relevantNodes = retrieveRelevantNodes(flatTree, keywords);
    console.log(`🎯 Relevant nodes found: ${relevantNodes.length}`);
    
    // Fallback: Use full tree if too few results or tree is small
    if (relevantNodes.length === 0 || flatTree.length < 150) {
      console.log(`⚠️  Fallback: Using full tree (${flatTree.length} nodes)`);
      relevantNodes = flatTree;
    }
    
    // ========================================
    //  CONTEXT BUILDING
    // ========================================
    
    console.log(`\n📝 STEP 2: Building Context from Retrieved Nodes`);
    
    const contextString = buildContextFromNodes(relevantNodes);
    
    console.log(`📏 Context length: ${contextString.length} characters`);
    console.log(`💰 Token savings: ~${Math.round((1 - contextString.length / 3000) * 100)}% vs sending full text`);
    
    // ========================================
    // GENERATION (Groq with System/User Roles)
    // ========================================
    
    console.log(`\n🤖 STEP 3: Generating Answer with Groq`);
    
    // System prompt with context
    const systemPrompt = `You are an expert document assistant. 
You are currently reading a document named: "${document.originalName}".

You must answer ONLY using the provided context chunks below. 
If someone asks what the document is about, use the document name to help figure it out.

CRITICAL: You are reading tabular data. If a cell appears blank or missing between columns, it means that attribute does NOT exist. Do not shift values from other columns into empty spaces.

If the answer is not in the context, say "I cannot find that information in the document."

Keep answers concise and easy to read out loud.

DOCUMENT CONTEXT:
${contextString}`;

    // User prompt is just the question
    const userPrompt = question;
    
    // Send to Groq with separate system and user messages
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_tokens: 512
    });

    const answer = chatCompletion.choices[0]?.message?.content;
    console.log(`✅ AI Answer: ${answer}\n`);

    //  SAVE GOOD ANSWERS TO CACHE (LEGACY)
      if (answer) { // First, make sure Groq actually gave us a string!
        const failurePhrases = ["cannot find that information", "i don't know", "not in the document"];
        const isBadAnswer = failurePhrases.some(phrase => answer.toLowerCase().includes(phrase));

        if (!isBadAnswer) {
          // Bulletproof direct MongoDB push
          await Document.findByIdAndUpdate(id, {
            $push: { chatHistory: { question: question, answer: answer } }
          });
          console.log(`💾 Saved good Q&A to MongoDB Cache!`);
        } else {
          console.log(`🚫 AI could not find the answer. Did NOT save to cache to prevent poisoning.`);
        }
      } else {
        console.log(`⚠️ AI returned an empty answer. Did NOT save to cache.`);
      }

    // Send response to frontend
    res.json({ 
      success: true, 
      answer: answer,
      documentId: id,
      question: question,
      metadata: {
        method: 'rag_keyword_retrieval',
        totalNodes: flatTree.length,
        retrievedNodes: relevantNodes.length,
        keywords: keywords,
        contextLength: contextString.length
      }
    });

  } catch (error) {
    console.error('❌ Chat API Error:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process question.',
      details: error.message 
    });
  }
});

// Multer error handling middleware (FIXED: Added next parameter)
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum size is 50MB.'
      });
    }
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
  
  if (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
  
  next();
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Global error handler (FIXED: All 4 parameters at the very bottom)
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Promise Rejection:', err);
  // Close server & exit process
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  // This helps ensure child processes (Python) are cleaned up
  process.exit();
});