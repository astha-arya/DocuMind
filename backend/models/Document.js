/**
 * DocuMind Document Model
 * Stores complete document processing results including OCR, structure, and metadata
 */

const mongoose = require('mongoose');

// Sub-schema for OCR Metadata
const OcrMetadataSchema = new mongoose.Schema({
  wordCount: {
    type: Number,
    required: true,
    min: 0
  },
  averageConfidence: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  language: {
    type: String,
    default: 'eng'
  },
  tesseractVersion: String
}, { _id: false });

// Sub-schema for Node Metadata (used in structured tree)
const NodeMetadataSchema = new mongoose.Schema({
  lineNumber: Number,
  charCount: Number,
  wordCount: Number
}, { _id: false });

// Sub-schema for Structure Tree Node
const StructureNodeSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['heading', 'content'],
    required: true
  },
  text: {
    type: String,
    required: true
  },
  hint: {
    type: String,
    required: true
  },
  level: Number,
  children: [mongoose.Schema.Types.Mixed], // Recursive structure
  metadata: NodeMetadataSchema
}, { _id: false });

// Sub-schema for Navigation Map Entry
const NavigationMapEntrySchema = new mongoose.Schema({
  id: String,
  text: String,
  hint: String,
  path: [String],
  pathString: String,
  childCount: Number,
  lineNumber: Number
}, { _id: false });

// Sub-schema for Structure Metadata
const StructureMetadataSchema = new mongoose.Schema({
  totalNodes: Number,
  totalLines: Number,
  headingCount: Number,
  contentCount: Number,
  averageLineLength: Number,
  processingTimestamp: Date,
  error: String
}, { _id: false });

// Sub-schema for Document Statistics
const DocumentStatsSchema = new mongoose.Schema({
  headings: Number,
  contentNodes: Number,
  totalNodes: Number,
  maxDepth: Number,
  totalWords: Number,
  totalCharacters: Number,
  averageWordsPerNode: Number
}, { _id: false });

// Sub-schema for Individual Page
const PageSchema = new mongoose.Schema({
  pageNumber: {
    type: Number,
    required: true,
    min: 1
  },
  imagePath: String,
  preprocessed: {
    type: Boolean,
    default: false
  },
  processedImagePath: String,
  preprocessingSteps: [String],
  ocrCompleted: {
    type: Boolean,
    default: false
  },
  extractedText: {
    type: String,
    default: ''
  },
  ocrMetadata: OcrMetadataSchema,
  structuredTree: [StructureNodeSchema],
  structureMetadata: StructureMetadataSchema,
  navigationMap: [NavigationMapEntrySchema],
  documentStats: DocumentStatsSchema,
  error: Boolean,
  errorMessage: String,
  errorStage: String
}, { _id: false });

// Sub-schema for Aggregate Statistics
const AggregateStatsSchema = new mongoose.Schema({
  totalPages: {
    type: Number,
    required: true,
    min: 0
  },
  successfulPages: {
    type: Number,
    required: true,
    min: 0
  },
  failedPages: {
    type: Number,
    default: 0,
    min: 0
  },
  totalWords: {
    type: Number,
    default: 0,
    min: 0
  },
  averageConfidence: {
    type: Number,
    min: 0,
    max: 100
  }
}, { _id: false });

// Sub-schema for Original Dimensions
const DimensionsSchema = new mongoose.Schema({
  width: Number,
  height: Number
}, { _id: false });

// Main Document Schema
const DocumentSchema = new mongoose.Schema({
  // Basic File Metadata
  filename: {
    type: String,
    required: true,
    trim: true
  },
  originalName: {
    type: String,
    required: true,
    trim: true
  },
  path: {
    type: String,
    required: true
  },
  absolutePath: String,
  size: {
    type: Number,
    required: true,
    min: 0
  },
  mimetype: {
    type: String,
    required: true
  },
  uploadedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  // Document Type Flags
  isPdf: {
    type: Boolean,
    default: false
  },
  isImage: {
    type: Boolean,
    default: false
  },
  
  // Single Image Processing (for non-PDF uploads)
  preprocessed: Boolean,
  processedImagePath: String,
  preprocessingSteps: [String],
  originalDimensions: DimensionsSchema,
  ocrCompleted: Boolean,
  extractedText: String,
  ocrMetadata: OcrMetadataSchema,
  structuredTree: [StructureNodeSchema],
  structureMetadata: StructureMetadataSchema,
  navigationMap: [NavigationMapEntrySchema],
  documentStats: DocumentStatsSchema,
  
  // PDF Multi-Page Processing
  pageCount: {
    type: Number,
    min: 0
  },
  pages: [PageSchema],
  aggregateStats: AggregateStatsSchema,
  
  // Error Handling
  error: Boolean,
  errorMessage: String,
  errorDetails: String,
  pipelineError: String,
  
  // Additional Metadata
  processingComplete: {
    type: Boolean,
    default: true
  },
  note: String,
  
  // User/Session Info (optional - for future use)
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  sessionId: String,
  
  // Tags and Categories (optional - for future use)
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  category: {
    type: String,
    trim: true,
    lowercase: true
  }
}, {
  timestamps: true, // Adds createdAt and updatedAt automatically
  collection: 'documents'
});

// Indexes for efficient querying
DocumentSchema.index({ originalName: 'text', extractedText: 'text' }); // Full-text search
DocumentSchema.index({ uploadedAt: -1 }); // Sort by upload date
DocumentSchema.index({ isPdf: 1, pageCount: 1 }); // Filter PDFs by page count
DocumentSchema.index({ 'aggregateStats.averageConfidence': 1 }); // Filter by OCR quality
DocumentSchema.index({ processingComplete: 1, error: 1 }); // Filter by status

// Virtual for full text across all pages (PDFs)
DocumentSchema.virtual('fullText').get(function() {
  if (this.isPdf && this.pages) {
    return this.pages
      .map(page => page.extractedText)
      .filter(text => text)
      .join('\n\n--- Page Break ---\n\n');
  }
  return this.extractedText || '';
});

// Virtual for total processing time (if timestamps exist)
DocumentSchema.virtual('processingTime').get(function() {
  if (this.createdAt && this.updatedAt) {
    return this.updatedAt - this.createdAt; // milliseconds
  }
  return null;
});

// Method to get page by number
DocumentSchema.methods.getPage = function(pageNumber) {
  if (!this.isPdf || !this.pages) return null;
  return this.pages.find(page => page.pageNumber === pageNumber);
};

// Method to search text across all pages
DocumentSchema.methods.searchText = function(searchTerm) {
  const results = [];
  const lowerSearch = searchTerm.toLowerCase();
  
  if (this.isPdf && this.pages) {
    this.pages.forEach(page => {
      if (page.extractedText && page.extractedText.toLowerCase().includes(lowerSearch)) {
        results.push({
          pageNumber: page.pageNumber,
          text: page.extractedText,
          matches: page.extractedText.match(new RegExp(searchTerm, 'gi')) || []
        });
      }
    });
  } else if (this.extractedText && this.extractedText.toLowerCase().includes(lowerSearch)) {
    results.push({
      pageNumber: 1,
      text: this.extractedText,
      matches: this.extractedText.match(new RegExp(searchTerm, 'gi')) || []
    });
  }
  
  return results;
};

// Method to get document summary
DocumentSchema.methods.getSummary = function() {
  const summary = {
    id: this._id,
    name: this.originalName,
    type: this.isPdf ? 'PDF' : 'Image',
    uploadedAt: this.uploadedAt,
    size: this.size
  };
  
  if (this.isPdf) {
    summary.pages = this.pageCount;
    summary.totalWords = this.aggregateStats?.totalWords || 0;
    summary.averageConfidence = this.aggregateStats?.averageConfidence || 0;
  } else {
    summary.wordCount = this.ocrMetadata?.wordCount || 0;
    summary.confidence = this.ocrMetadata?.averageConfidence || 0;
  }
  
  return summary;
};

// Static method to find recent documents
DocumentSchema.statics.findRecent = function(limit = 10) {
  return this.find({ processingComplete: true })
    .sort({ uploadedAt: -1 })
    .limit(limit)
    .select('originalName uploadedAt isPdf pageCount aggregateStats ocrMetadata');
};

// Static method to find by text
DocumentSchema.statics.searchAllDocuments = function(searchTerm, limit = 20) {
  return this.find({
    $text: { $search: searchTerm },
    processingComplete: true
  })
  .sort({ score: { $meta: 'textScore' } })
  .limit(limit);
};

// Pre-save middleware to ensure data consistency
DocumentSchema.pre('save', function() {
  // Ensure isImage flag is set correctly
  if (!this.isPdf && this.mimetype && this.mimetype.startsWith('image/')) {
    this.isImage = true;
  }
  
  // Calculate failedPages if not set
  if (this.isPdf && this.aggregateStats && !this.aggregateStats.failedPages) {
    this.aggregateStats.failedPages = 
      this.aggregateStats.totalPages - this.aggregateStats.successfulPages;
  }
});

// Export the model
const Document = mongoose.model('Document', DocumentSchema);

module.exports = Document;