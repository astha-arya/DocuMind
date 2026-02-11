const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { buildDocumentTree, getNavigationMap, getDocumentStats } = require('./utils/structureParser');

// Load environment variables
dotenv.config();

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
    fileSize: 10 * 1024 * 1024 // 10MB file size limit
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

// File upload route with automated preprocessing and OCR pipeline
app.post('/api/upload', upload.single('document'), async (req, res) => {
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

    // Check if file is an image (not PDF)
    const isImage = /image\/(jpeg|jpg|png|gif)/.test(req.file.mimetype);
    
    // If image, run the complete preprocessing + OCR pipeline
    if (isImage) {
      let preprocessResult = null;
      let ocrResult = null;
      
      try {
        console.log('\n🔄 Starting automated pipeline...');
        console.log('📸 Step 1/2: Image Preprocessing');
        
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
        console.log('\n🔍 Step 2/2: Running OCR');
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
      // PDF file - skip image processing pipeline
      fileInfo.preprocessed = false;
      fileInfo.ocrCompleted = false;
      fileInfo.note = 'Image processing skipped (PDF file)';
      console.log('📄 PDF uploaded - image processing pipeline skipped');
    }

    // Return success response with all processing results
    res.status(200).json({
      success: true,
      message: 'File uploaded successfully',
      file: fileInfo
    });

  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading file',
      error: error.message
    });
  }
});

// Multer error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum size is 10MB.'
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

// Global error handler
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