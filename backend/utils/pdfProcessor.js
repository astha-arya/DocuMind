/**
 * DocuMind PDF Processing Utility
 * Uses system pdftoppm (Poppler) to split PDFs into images.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const { existsSync } = require('fs');

/**
 * Convert PDF to individual page images using direct system call
 * @param {string} pdfPath - Absolute path to the PDF file
 * @param {string} outputDir - Directory to save page images
 * @returns {Promise<Object>} - Array of page image paths and metadata
 */
async function splitPdfToImages(pdfPath, outputDir) {
  return new Promise(async (resolve, reject) => {
    try {
      // 1. Setup paths
      const pdfFilename = path.basename(pdfPath, path.extname(pdfPath));
      const pdfOutputDir = path.join(outputDir, `${pdfFilename}_pages`);
      
      // 2. Create clean output directory
      if (existsSync(pdfOutputDir)) {
        await fs.rm(pdfOutputDir, { recursive: true, force: true });
      }
      await fs.mkdir(pdfOutputDir, { recursive: true });

      // 3. Define the command (Pointed to your confirmed Homebrew path)
      const binaryPath = '/opt/homebrew/bin/pdftoppm';
      // AFTER (fast)
      const args = [
        '-jpeg',
        '-jpegopt', 'quality=85',    // ← Line 1: ADD THIS
        '-scale-to', '1200',         // ← Line 2: CHANGE from 1500 to 1200
        pdfPath,
        path.join(pdfOutputDir, 'page')
       ];

      console.log(`🚀 Executing PDF Split: ${binaryPath} ${args.join(' ')}`);

      // 4. Spawn the process
      const child = spawn(binaryPath, args);

      child.on('close', async (code) => {
        if (code === 0) {
          // Read the directory to get all generated images
          const files = await fs.readdir(pdfOutputDir);
          const pageImages = files
            .filter(f => f.endsWith('.jpg'))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .map(f => path.join(pdfOutputDir, f));

          console.log(`✅ PDF split complete: ${pageImages.length} pages generated.`);
          
          resolve({
            success: true,
            pageCount: pageImages.length,
            pages: pageImages,
            outputDir: pdfOutputDir
          });
        } else {
          console.error(`❌ pdftoppm failed with exit code ${code}`);
          reject(new Error(`pdftoppm failed with exit code ${code}`));
        }
      });

      child.on('error', (err) => {
        console.error('❌ Failed to start pdftoppm:', err);
        reject(err);
      });

    } catch (err) {
      console.error('❌ Internal Processor Error:', err);
      reject(err);
    }
  });
}

/**
 * Clean up temporary page images
 * @param {string} outputDir - Directory containing page images
 */
async function cleanupPageImages(outputDir) {
  try {
    if (outputDir && existsSync(outputDir)) {
      await fs.rm(outputDir, { recursive: true, force: true });
      console.log(`🗑️  Cleaned up temporary pages: ${path.basename(outputDir)}`);
      return { success: true };
    }
  } catch (error) {
    console.warn(`⚠️  Cleanup warning: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Get PDF info (page count) using pdftoppm info logic
 * @param {string} pdfPath - Path to the PDF file
 */
async function getPdfInfo(pdfPath) {
  return new Promise((resolve) => {
    const binaryPath = '/opt/homebrew/bin/pdfinfo'; // Part of the Poppler suite
    const child = spawn(binaryPath, [pdfPath]);
    
    let output = '';
    child.stdout.on('data', (data) => output += data.toString());
    
    child.on('close', (code) => {
      if (code === 0) {
        const pagesMatch = output.match(/Pages:\s+(\d+)/);
        const pageCount = pagesMatch ? parseInt(pagesMatch[1]) : 0;
        resolve({ success: true, pageCount });
      } else {
        resolve({ success: false, pageCount: 0 });
      }
    });
  });
}

module.exports = {
  splitPdfToImages,
  cleanupPageImages,
  getPdfInfo
};