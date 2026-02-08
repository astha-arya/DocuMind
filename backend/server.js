const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();

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
    // Get absolute path to the Python script
    const scriptPath = path.join(__dirname, 'utils', 'preprocess.py');
    
    // Convert image path to absolute path
    const absoluteImagePath = path.resolve(imagePath);
    
    // Spawn Python process with absolute paths
    const pythonProcess = spawn('python3', [scriptPath, absoluteImagePath]);
    
    let outputData = '';
    let errorData = '';
    
    // Capture stdout (JSON output from Python)
    pythonProcess.stdout.on('data', (data) => {
      outputData += data.toString();
    });
    
    // Capture stderr (error messages)
    pythonProcess.stderr.on('data', (data) => {
      errorData += data.toString();
    });
    
    // Handle process completion
    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        console.error('Python preprocessing error:', errorData);
        return reject({
          error: 'Preprocessing failed',
          details: errorData,
          exitCode: code
        });
      }
      
      try {
        // Parse JSON output from Python script
        const result = JSON.parse(outputData);
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
        details: error.message
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

// File upload route
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
    
    // If image, run preprocessing
    if (isImage) {
      try {
        console.log('🔄 Starting image preprocessing...');
        const preprocessResult = await runPreprocessing(fileInfo.absolutePath);
        
        if (preprocessResult.success) {
          console.log('✅ Image preprocessing completed');
          
          // Add preprocessing info to response
          fileInfo.preprocessed = true;
          fileInfo.processedImage = preprocessResult.processed_image;
          fileInfo.preprocessingSteps = preprocessResult.preprocessing_steps;
          fileInfo.originalDimensions = preprocessResult.original_dimensions;
        }
      } catch (preprocessError) {
        // Log the error but don't fail the upload
        console.error('⚠️  Preprocessing warning:', preprocessError);
        fileInfo.preprocessed = false;
        fileInfo.preprocessingError = preprocessError.error || 'Preprocessing failed';
      }
    } else {
      fileInfo.preprocessed = false;
      fileInfo.note = 'Preprocessing skipped (PDF file)';
    }

    // Return success response
    res.status(200).json({
      success: true,
      message: 'File uploaded successfully',
      file: fileInfo
    });

  } catch (error) {
    console.error('Upload error:', error);
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