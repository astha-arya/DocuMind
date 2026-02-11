/**
 * DocuMind Structural Parser
 * Builds hierarchical document trees from raw OCR text
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
 * Build a hierarchical document tree from raw text
 * @param {string} rawText - Raw extracted text from OCR
 * @returns {Object} - Structured document tree
 */
function buildDocumentTree(rawText) {
  // Handle empty or null text
  if (!rawText || typeof rawText !== 'string') {
    return {
      metadata: {
        totalNodes: 0,
        totalLines: 0,
        headingCount: 0,
        contentCount: 0
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
        contentCount: 0
      },
      tree: []
    };
  }
  
  // Build the tree structure
  const tree = [];
  let currentParent = null;
  let nodeIdCounter = 0;
  let headingCount = 0;
  let contentCount = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    nodeIdCounter++;
    
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
  
  return {
    metadata: {
      totalNodes: nodeIdCounter,
      totalLines: lines.length,
      headingCount: headingCount,
      contentCount: contentCount,
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
 * Get navigation map - list of all headings for quick access
 * @param {Array} tree - The document tree
 * @returns {Array} - Array of heading nodes with navigation info
 */
function getNavigationMap(tree) {
  const navMap = [];
  
  function traverse(nodes, path = []) {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      
      if (node.type === 'heading') {
        const currentPath = [...path, node.hint];
        navMap.push({
          id: node.id,
          text: node.text,
          hint: node.hint,
          path: currentPath,
          pathString: currentPath.join(' > '),
          childCount: node.children ? node.children.length : 0,
          lineNumber: node.metadata.lineNumber
        });
        
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
 * Search within the document tree
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
      // Check if node text contains search term
      if (node.text.toLowerCase().includes(lowerSearch)) {
        results.push({
          id: node.id,
          type: node.type,
          text: node.text,
          hint: node.hint,
          matchType: node.type === 'heading' ? 'heading' : 'content',
          lineNumber: node.metadata.lineNumber
        });
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
 * Get statistics about the document structure
 * @param {Array} tree - The document tree
 * @returns {Object} - Document statistics
 */
function getDocumentStats(tree) {
  let totalHeadings = 0;
  let totalContent = 0;
  let maxDepth = 0;
  let totalWords = 0;
  let totalChars = 0;
  
  function traverse(nodes, depth = 0) {
    maxDepth = Math.max(maxDepth, depth);
    
    for (const node of nodes) {
      if (node.type === 'heading') {
        totalHeadings++;
      } else {
        totalContent++;
      }
      
      totalWords += node.metadata.wordCount;
      totalChars += node.metadata.charCount;
      
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
    totalNodes: totalHeadings + totalContent,
    maxDepth: maxDepth,
    totalWords: totalWords,
    totalCharacters: totalChars,
    averageWordsPerNode: totalWords / (totalHeadings + totalContent) || 0
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
  generateHint
};