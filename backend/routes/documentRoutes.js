/**
 * DocuMind Document Routes
 * API endpoints for retrieving and searching processed documents
 */

const express = require('express');
const router = express.Router();
const Document = require('../models/Document');

// GET /api/documents - Get all documents with pagination
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const documents = await Document.find({ processingComplete: true })
      .sort({ uploadedAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('originalName uploadedAt isPdf pageCount size aggregateStats ocrMetadata');
    
    const total = await Document.countDocuments({ processingComplete: true });
    
    res.json({
      success: true,
      data: documents,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching documents',
      error: error.message
    });
  }
});

// GET /api/documents/recent - Get recent documents
router.get('/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const documents = await Document.findRecent(limit);
    
    res.json({
      success: true,
      data: documents
    });
  } catch (error) {
    console.error('Error fetching recent documents:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching recent documents',
      error: error.message
    });
  }
});

// GET /api/documents/:id - Get single document by ID
router.get('/:id', async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }
    
    res.json({
      success: true,
      data: document
    });
  } catch (error) {
    console.error('Error fetching document:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching document',
      error: error.message
    });
  }
});

// GET /api/documents/:id/summary - Get document summary
router.get('/:id/summary', async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }
    
    const summary = document.getSummary();
    
    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('Error fetching document summary:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching document summary',
      error: error.message
    });
  }
});

// GET /api/documents/:id/page/:pageNumber - Get specific page from PDF
router.get('/:id/page/:pageNumber', async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }
    
    if (!document.isPdf) {
      return res.status(400).json({
        success: false,
        message: 'Document is not a PDF'
      });
    }
    
    const pageNumber = parseInt(req.params.pageNumber);
    const page = document.getPage(pageNumber);
    
    if (!page) {
      return res.status(404).json({
        success: false,
        message: `Page ${pageNumber} not found`
      });
    }
    
    res.json({
      success: true,
      data: page
    });
  } catch (error) {
    console.error('Error fetching page:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching page',
      error: error.message
    });
  }
});

// GET /api/documents/:id/text - Get full extracted text
router.get('/:id/text', async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }
    
    const fullText = document.fullText;
    
    res.json({
      success: true,
      data: {
        documentId: document._id,
        originalName: document.originalName,
        text: fullText,
        wordCount: document.isPdf 
          ? document.aggregateStats?.totalWords 
          : document.ocrMetadata?.wordCount
      }
    });
  } catch (error) {
    console.error('Error fetching text:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching text',
      error: error.message
    });
  }
});

// POST /api/documents/:id/search - Search within specific document
router.post('/:id/search', async (req, res) => {
  try {
    const { searchTerm } = req.body;
    
    if (!searchTerm) {
      return res.status(400).json({
        success: false,
        message: 'Search term is required'
      });
    }
    
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }
    
    const results = document.searchText(searchTerm);
    
    res.json({
      success: true,
      data: {
        documentId: document._id,
        originalName: document.originalName,
        searchTerm,
        results,
        matchCount: results.reduce((sum, r) => sum + r.matches.length, 0)
      }
    });
  } catch (error) {
    console.error('Error searching document:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching document',
      error: error.message
    });
  }
});

// POST /api/documents/search - Search across all documents
router.post('/search', async (req, res) => {
  try {
    const { searchTerm, limit } = req.body;
    
    if (!searchTerm) {
      return res.status(400).json({
        success: false,
        message: 'Search term is required'
      });
    }
    
    const documents = await Document.searchAllDocuments(searchTerm, limit || 20);
    
    res.json({
      success: true,
      data: documents,
      searchTerm,
      count: documents.length
    });
  } catch (error) {
    console.error('Error searching documents:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching documents',
      error: error.message
    });
  }
});

// DELETE /api/documents/:id - Delete document
router.delete('/:id', async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    
    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Document not found'
      });
    }
    
    // Delete the document from database
    await Document.findByIdAndDelete(req.params.id);
    
    res.json({
      success: true,
      message: 'Document deleted successfully',
      documentId: req.params.id
    });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting document',
      error: error.message
    });
  }
});

// GET /api/documents/stats/overview - Get overall statistics
router.get('/stats/overview', async (req, res) => {
  try {
    const totalDocuments = await Document.countDocuments();
    const totalPDFs = await Document.countDocuments({ isPdf: true });
    const totalImages = await Document.countDocuments({ isImage: true });
    
    // Aggregate total pages across all PDFs
    const pdfStats = await Document.aggregate([
      { $match: { isPdf: true } },
      {
        $group: {
          _id: null,
          totalPages: { $sum: '$pageCount' },
          avgConfidence: { $avg: '$aggregateStats.averageConfidence' },
          totalWords: { $sum: '$aggregateStats.totalWords' }
        }
      }
    ]);
    
    // Get recent uploads count (last 7 days)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const recentUploads = await Document.countDocuments({
      uploadedAt: { $gte: weekAgo }
    });
    
    res.json({
      success: true,
      data: {
        totalDocuments,
        totalPDFs,
        totalImages,
        totalPages: pdfStats[0]?.totalPages || 0,
        averageOcrConfidence: pdfStats[0]?.avgConfidence || 0,
        totalWordsExtracted: pdfStats[0]?.totalWords || 0,
        recentUploads
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching statistics',
      error: error.message
    });
  }
});

module.exports = router;
