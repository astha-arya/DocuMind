const dotenv = require('dotenv');
dotenv.config();

const Document = require('./models/Document');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
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
            ocrCompleted: false
          };
          
          try {
            // Step 2a: Preprocess the page image
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
            
            // Step 2c: Build structure for this page
            console.log(`\n🌳 Step 2c: Building structure for page ${pageNumber}...`);
            try {
              const structuralData = buildDocumentTree(pageData.extractedText);
              const navigationMap = getNavigationMap(structuralData.tree);
              const documentStats = getDocumentStats(structuralData.tree);
              
              pageData.structuredTree = structuralData.tree;
              pageData.structureMetadata = structuralData.metadata;
              pageData.navigationMap = navigationMap;
              pageData.documentStats = documentStats;
              
              console.log(`✅ Page ${pageNumber} structure built: ${documentStats.headings} headings, ${documentStats.contentNodes} content nodes`);
            } catch (structureError) {
              console.error(`⚠️  Structure parsing warning for page ${pageNumber}:`, structureError);
              pageData.structuredTree = [];
              pageData.structureMetadata = { error: 'Structure parsing failed' };
            }
            
            // Step 2d: Cleanup temporary page images (original and processed)
            console.log(`\n🗑️  Step 2d: Cleaning up temporary images for page ${pageNumber}...`);
            try {
              // Mark processed image for deletion (original page image in temp dir will be cleaned up at end)
              if (preprocessResult.processed_image && fs.existsSync(preprocessResult.processed_image)) {
                await fs.promises.unlink(preprocessResult.processed_image);
                console.log(`✅ Deleted processed image: ${path.basename(preprocessResult.processed_image)}`);
              }
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
        
        fileInfo.aggregateStats = {
          totalPages: pdfResult.pageCount,
          successfulPages: successfulPages.length,
          failedPages: pdfResult.pageCount - successfulPages.length,
          totalWords: totalWords,
          averageConfidence: Math.round(avgConfidence * 100) / 100
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
        
        // Step 1: Preprocess the image
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
        
        // Step 3: Build structural tree from extracted text
        console.log('\n🌳 Step 3/3: Building Document Structure');
        
        try {
          const structuralData = buildDocumentTree(fileInfo.extractedText);
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
          
        } catch (structureError) {
          console.error('⚠️  Structure parsing warning:', structureError);
          fileInfo.structuredTree = [];
          fileInfo.structureMetadata = { error: 'Structure parsing failed' };
        }
        
        console.log('\n✅ Pipeline completed successfully!');
        console.log(`📝 Extracted text length: ${fileInfo.extractedText.length} characters\n`);
        
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
            structuredTree: fileInfo.structuredTree
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
app.post('/api/documents/:id/chat', async (req, res) => { 
  try {
    const { id } = req.params;
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ 
        success: false, 
        error: "Please provide a question." 
      });
    }

    console.log(`💬 Answering question for document ${id}: "${question}"`);

    // Fetch document from MongoDB
    const document = await Document.findById(id); 
    if (!document) {
      return res.status(404).json({ 
        success: false, 
        error: "Document not found." 
      });
    }

    // Extract text (works for both single images and multi-page PDFs)
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
    console.log(`\n🔍 --- DEBUG INFO ---`);
    console.log(`🔍 Total Text Length Sent to AI: ${docText.length} characters`);
    console.log(`🔍 Does the text contain '15.': ${docText.includes('15.')}`);
    console.log(`🔍 Does the text contain 'smother': ${docText.includes('smother')}`);
    console.log(`🔍 --------------------\n`);

    // Create strict prompt for Groq
    const prompt = `You are an accessibility assistant helping a user understand a document. 
Answer the user's question based STRICTLY on the document text provided below. 
If the answer is not in the text, say "I cannot find that information in the document."
Keep your answer concise and easy to read out loud.

DOCUMENT TEXT:
${docText}

USER QUESTION: ${question}`;

    // Send to Groq
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_tokens: 512
    });

    const answer = chatCompletion.choices[0]?.message?.content;
    console.log(`✅ AI Answer: ${answer}`);

    // Send response to frontend
    res.json({ 
      success: true, 
      answer: answer,
      documentId: id,
      question: question
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