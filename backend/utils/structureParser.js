/**
 * DocuMind Structural Parser
 * Builds hierarchical document trees from raw OCR text
 * Now supports table injection based on spatial coordinates
 */

/**
 * Check if a line appears to be a heading
 * @param {string} line - The line to check
 * @returns {boolean} - True if line looks like a heading
 */
function isHeading(line) {
  const trimmed = line.trim();
  
  // Empty lines are not headings
  if (trimmed.length === 0) {
    return false;
  }
  
  // Short lines (< 25 chars) are more likely to be headings
  const isShort = trimmed.length < 25;
  
  // Check if line is ALL CAPS
  const isAllCaps = trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
  
  // Check if line ends with a colon
  const endsWithColon = trimmed.endsWith(':');
  
  // Check if line starts with common heading indicators
  const startsWithNumber = /^\d+[\.\)]/.test(trimmed); // "1." or "1)"
  const startsWithBullet = /^[•\-\*→]/.test(trimmed);
  const startsWithHeadingWord = /^(SECTION|CHAPTER|PART|ARTICLE|ITEM|SUBJECT|RE:|TO:|FROM:|DATE:)/i.test(trimmed);
  
  // A line is a heading if:
  // - It's short and (all caps OR ends with colon)
  // - OR it starts with heading indicators
  // - OR it's all caps (regardless of length, if reasonable)
  return (
    (isShort && (isAllCaps || endsWithColon)) ||
    startsWithNumber ||
    startsWithBullet ||
    startsWithHeadingWord ||
    (isAllCaps && trimmed.length < 50)
  );
}

/**
 * Generate a hint from text (first 50 characters)
 * @param {string} text - The full text
 * @returns {string} - First 50 characters with ellipsis if truncated
 */
function generateHint(text) {
  const trimmed = text.trim();
  if (trimmed.length <= 50) {
    return trimmed;
  }
  return trimmed.substring(0, 50) + '...';
}

/**
 * Clean and normalize a line of text
 * @param {string} line - Raw line
 * @returns {string} - Cleaned line
 */
function cleanLine(line) {
  return line
    .trim()
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .replace(/\t/g, ' '); // Replace tabs with spaces
}

/**
 * Create a table node from extracted table data
 * @param {Object} table - Extracted table data
 * @param {number} nodeId - Node ID counter
 * @returns {Object} - Table node for the tree
 */
function createTableNode(table, nodeId) {
  // Determine display text for the table
  let displayText = `[TABLE ${table.tableNumber}]`;
  
  // Use structured data if available, otherwise fall back to text
  const hasStructuredData = table.structuredData && 
                           table.structuredData.rows && 
                           Array.isArray(table.structuredData.rows);
  
  if (hasStructuredData) {
    // Add row/column info to display text
    displayText += ` (${table.structuredData.rowCount || table.structuredData.rows.length} rows × ${table.structuredData.columnCount || 0} cols)`;
  } else if (table.text) {
    // Count lines in text-based table
    const lineCount = table.text.split('\n').length;
    displayText += ` (${lineCount} lines)`;
  }
  
  return {
    id: `node_${nodeId}`,
    type: 'table',
    text: displayText,
    hint: generateHint(displayText),
    tableData: {
      tableNumber: table.tableNumber,
      boundingBox: table.boundingBox,
      extractionMethod: table.extractionMethod || 'unknown',
      confidence: table.confidence || null,
      
      // Store structured data if available
      structuredData: hasStructuredData ? table.structuredData : null,
      
      // Store raw text as fallback
      rawText: table.text || '',
      
      // Additional metadata
      originalPath: table.originalPath || null,
      cleanPath: table.cleanPath || null,
      wordCount: table.wordCount || 0
    },
    children: [],
    metadata: {
      yCoordinate: table.boundingBox.y,
      charCount: displayText.length,
      wordCount: table.wordCount || (table.text ? table.text.split(/\s+/).length : 0)
    }
  };
}

/**
 * Build a hierarchical document tree from raw text with table integration
 * @param {string} rawText - Raw extracted text from OCR
 * @param {Array} extractedTables - Optional array of extracted table objects
 * @returns {Object} - Structured document tree
 */
function buildDocumentTree(rawText, extractedTables = []) {
  // Handle empty or null text
  if (!rawText || typeof rawText !== 'string') {
    return {
      metadata: {
        totalNodes: 0,
        totalLines: 0,
        headingCount: 0,
        contentCount: 0,
        tableCount: 0
      },
      tree: []
    };
  }
  
  // Split text into lines
  const lines = rawText.split('\n').map(cleanLine).filter(line => line.length > 0);
  
  if (lines.length === 0) {
    return {
      metadata: {
        totalNodes: 0,
        totalLines: 0,
        headingCount: 0,
        contentCount: 0,
        tableCount: 0
      },
      tree: []
    };
  }
  
  // Build the initial tree structure from text
  const tree = [];
  let currentParent = null;
  let nodeIdCounter = 0;
  let headingCount = 0;
  let contentCount = 0;
  
  // Create nodes with estimated Y-coordinates (line-based approximation)
  // Assume each line is approximately 20-30 pixels tall
  const APPROXIMATE_LINE_HEIGHT = 25;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    nodeIdCounter++;
    
    // Estimate Y-coordinate based on line number
    const estimatedY = i * APPROXIMATE_LINE_HEIGHT;
    
    if (isHeading(line)) {
      // This is a heading - create a parent node
      headingCount++;
      
      const parentNode = {
        id: `node_${nodeIdCounter}`,
        type: 'heading',
        text: line,
        hint: generateHint(line),
        level: 1, // Default level, can be enhanced later
        children: [],
        metadata: {
          lineNumber: i + 1,
          estimatedY: estimatedY,
          charCount: line.length,
          wordCount: line.split(/\s+/).length
        }
      };
      
      // Add to tree
      tree.push(parentNode);
      currentParent = parentNode;
      
    } else {
      // This is content - add as child to current parent or as standalone
      contentCount++;
      
      const contentNode = {
        id: `node_${nodeIdCounter}`,
        type: 'content',
        text: line,
        hint: generateHint(line),
        metadata: {
          lineNumber: i + 1,
          estimatedY: estimatedY,
          charCount: line.length,
          wordCount: line.split(/\s+/).length
        }
      };
      
      if (currentParent) {
        // Add to current parent's children
        currentParent.children.push(contentNode);
      } else {
        // No parent yet, add as top-level content
        tree.push(contentNode);
      }
    }
  }
  
  // ========================================
  // INJECT TABLES BASED ON Y-COORDINATES
  // ========================================
  
  let tableCount = 0;
  
  if (extractedTables && Array.isArray(extractedTables) && extractedTables.length > 0) {
    console.log(`\n📊 Injecting ${extractedTables.length} table(s) into document tree...`);
    
    // Sort tables by Y-coordinate (top to bottom)
    const sortedTables = [...extractedTables].sort((a, b) => 
      (a.boundingBox?.y || 0) - (b.boundingBox?.y || 0)
    );
    
    for (const table of sortedTables) {
      nodeIdCounter++;
      tableCount++;
      
      const tableNode = createTableNode(table, nodeIdCounter);
      const tableY = table.boundingBox.y;
      
      console.log(`  📍 Table ${table.tableNumber} at Y=${tableY}`);
      
      // Find the correct position to inject this table
      let injected = false;
      
      // Try to find the most appropriate parent heading
      for (let i = 0; i < tree.length; i++) {
        const node = tree[i];
        
        if (node.type === 'heading') {
          const headingY = node.metadata.estimatedY;
          
          // Check if table should go under this heading
          // (table Y is after heading, but before next heading)
          const nextHeading = tree.find((n, idx) => idx > i && n.type === 'heading');
          const nextHeadingY = nextHeading ? nextHeading.metadata.estimatedY : Infinity;
          
          if (tableY >= headingY && tableY < nextHeadingY) {
            // Table belongs under this heading
            
            // Find exact position within children based on Y-coordinate
            let insertIndex = node.children.length;
            
            for (let j = 0; j < node.children.length; j++) {
              const childY = node.children[j].metadata.estimatedY || node.children[j].metadata.yCoordinate || 0;
              
              if (tableY < childY) {
                insertIndex = j;
                break;
              }
            }
            
            // Insert table at the calculated position
            node.children.splice(insertIndex, 0, tableNode);
            injected = true;
            console.log(`  ✅ Injected under heading: "${node.hint}"`);
            break;
          }
        }
      }
      
      // If table wasn't injected under a heading, add it at the appropriate top-level position
      if (!injected) {
        let insertIndex = tree.length;
        
        for (let i = 0; i < tree.length; i++) {
          const nodeY = tree[i].metadata.estimatedY || tree[i].metadata.yCoordinate || 0;
          
          if (tableY < nodeY) {
            insertIndex = i;
            break;
          }
        }
        
        tree.splice(insertIndex, 0, tableNode);
        console.log(`  ✅ Injected at top level (position ${insertIndex})`);
      }
    }
  }
  
  return {
    metadata: {
      totalNodes: nodeIdCounter,
      totalLines: lines.length,
      headingCount: headingCount,
      contentCount: contentCount,
      tableCount: tableCount,
      averageLineLength: Math.round(
        lines.reduce((sum, line) => sum + line.length, 0) / lines.length
      ),
      processingTimestamp: new Date().toISOString()
    },
    tree: tree
  };
}

/**
 * Flatten the tree for easy navigation
 * @param {Array} tree - The document tree
 * @returns {Array} - Flattened array of all nodes with parent references
 */
function flattenTree(tree) {
  const flattened = [];
  
  function traverse(nodes, parentId = null, depth = 0) {
    for (const node of nodes) {
      const flatNode = {
        ...node,
        parentId: parentId,
        depth: depth,
        hasChildren: node.children && node.children.length > 0
      };
      
      // Remove children from flat node to avoid duplication
      const { children, ...nodeWithoutChildren } = flatNode;
      flattened.push(nodeWithoutChildren);
      
      // Recursively traverse children
      if (node.children && node.children.length > 0) {
        traverse(node.children, node.id, depth + 1);
      }
    }
  }
  
  traverse(tree);
  return flattened;
}

/**
 * Get navigation map - list of all headings and tables for quick access
 * @param {Array} tree - The document tree
 * @returns {Array} - Array of heading and table nodes with navigation info
 */
function getNavigationMap(tree) {
  const navMap = [];
  
  function traverse(nodes, path = []) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      
      // Include headings and tables in navigation
      if (node.type === 'heading' || node.type === 'table') {
        const currentPath = [...path, node.hint];
        
        const navEntry = {
          id: node.id,
          type: node.type,
          text: node.text,
          hint: node.hint,
          path: currentPath,
          pathString: currentPath.join(' > '),
          childCount: node.children ? node.children.length : 0
        };
        
        // Add table-specific navigation info
        if (node.type === 'table') {
          navEntry.tableNumber = node.tableData?.tableNumber;
          navEntry.hasStructuredData = node.tableData?.structuredData !== null;
          navEntry.extractionMethod = node.tableData?.extractionMethod;
        } else {
          // Headings have line numbers
          navEntry.lineNumber = node.metadata.lineNumber;
        }
        
        navMap.push(navEntry);
        
        // Recursively process children
        if (node.children && node.children.length > 0) {
          traverse(node.children, currentPath);
        }
      }
    }
  }
  
  traverse(tree);
  return navMap;
}

/**
 * Search within the document tree (including tables)
 * @param {Array} tree - The document tree
 * @param {string} searchTerm - Term to search for
 * @returns {Array} - Matching nodes
 */
function searchTree(tree, searchTerm) {
  if (!searchTerm || searchTerm.trim().length === 0) {
    return [];
  }
  
  const results = [];
  const lowerSearch = searchTerm.toLowerCase();
  
  function traverse(nodes) {
    for (const node of nodes) {
      let matchFound = false;
      
      // Check if node text contains search term
      if (node.text.toLowerCase().includes(lowerSearch)) {
        matchFound = true;
      }
      
      // For table nodes, also search in raw text
      if (node.type === 'table' && node.tableData?.rawText) {
        if (node.tableData.rawText.toLowerCase().includes(lowerSearch)) {
          matchFound = true;
        }
      }
      
      if (matchFound) {
        const result = {
          id: node.id,
          type: node.type,
          text: node.text,
          hint: node.hint,
          matchType: node.type
        };
        
        // Add type-specific info
        if (node.type === 'table') {
          result.tableNumber = node.tableData?.tableNumber;
        } else if (node.type === 'heading' || node.type === 'content') {
          result.lineNumber = node.metadata.lineNumber;
        }
        
        results.push(result);
      }
      
      // Recursively search children
      if (node.children && node.children.length > 0) {
        traverse(node.children);
      }
    }
  }
  
  traverse(tree);
  return results;
}

/**
 * Get statistics about the document structure (including tables)
 * @param {Array} tree - The document tree
 * @returns {Object} - Document statistics
 */
function getDocumentStats(tree) {
  let totalHeadings = 0;
  let totalContent = 0;
  let totalTables = 0;
  let maxDepth = 0;
  let totalWords = 0;
  let totalChars = 0;
  
  function traverse(nodes, depth = 0) {
    maxDepth = Math.max(maxDepth, depth);
    
    for (const node of nodes) {
      if (node.type === 'heading') {
        totalHeadings++;
      } else if (node.type === 'content') {
        totalContent++;
      } else if (node.type === 'table') {
        totalTables++;
      }
      
      totalWords += node.metadata.wordCount || 0;
      totalChars += node.metadata.charCount || 0;
      
      // Recursively traverse children
      if (node.children && node.children.length > 0) {
        traverse(node.children, depth + 1);
      }
    }
  }
  
  traverse(tree);
  
  return {
    headings: totalHeadings,
    contentNodes: totalContent,
    tables: totalTables,
    totalNodes: totalHeadings + totalContent + totalTables,
    maxDepth: maxDepth,
    totalWords: totalWords,
    totalCharacters: totalChars,
    averageWordsPerNode: totalWords / (totalHeadings + totalContent + totalTables) || 0
  };
}

// Export functions
module.exports = {
  buildDocumentTree,
  flattenTree,
  getNavigationMap,
  searchTree,
  getDocumentStats,
  isHeading,
  generateHint,
  createTableNode
};