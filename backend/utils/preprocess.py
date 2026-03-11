#!/usr/bin/env python3
"""
DocuMind Image Preprocessing Script
Enhances images for better OCR accuracy using OpenCV
Now includes table detection and extraction
"""

import cv2
import sys
import os
import json
from pathlib import Path
import numpy as np


def detect_and_extract_tables(image, output_dir, base_filename):
    """
    Detect and extract tables from document image using morphological operations.
    
    This function:
    1. Detects table structures by finding intersecting horizontal and vertical lines
    2. Saves each table as a separate cropped image
    3. Creates a 'clean' version with grid lines removed for better OCR
    
    Args:
        image (numpy.ndarray): Input image (BGR format)
        output_dir (str): Directory to save extracted tables
        base_filename (str): Base filename for naming extracted tables
        
    Returns:
        list: Array of detected tables with metadata
    """
    try:
        # Convert to grayscale for processing
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        
        # Apply binary thresholding
        _, binary = cv2.threshold(gray, 128, 255, cv2.THRESH_BINARY_INV)
        
        # Define structure elements for detecting horizontal and vertical lines
        # Adjust these values based on your table line thickness
        horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (40, 1))
        vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 40))
        
        # Detect horizontal lines
        horizontal_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel, iterations=2)
        
        # Detect vertical lines
        vertical_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vertical_kernel, iterations=2)
        
        # Combine horizontal and vertical lines to get table structure
        table_mask = cv2.addWeighted(horizontal_lines, 0.5, vertical_lines, 0.5, 0.0)
        
        # Enhance the table mask
        _, table_mask = cv2.threshold(table_mask, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        # Find contours of potential tables
        contours, _ = cv2.findContours(table_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        tables_found = []
        table_count = 0
        
        # Minimum area threshold to filter out noise (adjust as needed)
        min_table_area = 5000
        
        for contour in contours:
            area = cv2.contourArea(contour)
            
            # Filter by area to get only significant tables
            if area > min_table_area:
                table_count += 1
                
                # Get bounding box coordinates
                x, y, w, h = cv2.boundingRect(contour)
                
                # Add padding around the table (10 pixels)
                padding = 10
                x_padded = max(0, x - padding)
                y_padded = max(0, y - padding)
                w_padded = min(image.shape[1] - x_padded, w + 2 * padding)
                h_padded = min(image.shape[0] - y_padded, h + 2 * padding)
                
                # Crop the table region from original image
                table_crop = image[y_padded:y_padded + h_padded, x_padded:x_padded + w_padded]
                
                # Save the original table crop
                table_filename = f"{base_filename}_table_{table_count}.png"
                table_path = os.path.join(output_dir, table_filename)
                cv2.imwrite(table_path, table_crop)
                
                # Create clean version (remove grid lines)
                table_clean = remove_table_lines(table_crop)
                
                # Save the clean version
                table_clean_filename = f"{base_filename}_table_{table_count}_clean.png"
                table_clean_path = os.path.join(output_dir, table_clean_filename)
                cv2.imwrite(table_clean_path, table_clean)
                
                # Store table metadata
                table_info = {
                    "table_number": table_count,
                    "original_path": table_path,
                    "clean_path": table_clean_path,
                    "bounding_box": {
                        "x": int(x_padded),
                        "y": int(y_padded),
                        "width": int(w_padded),
                        "height": int(h_padded)
                    },
                    "area": int(area)
                }
                
                tables_found.append(table_info)
        
        return tables_found
        
    except Exception as e:
        # If table detection fails, log but don't crash
        print(f"Warning: Table detection failed: {str(e)}", file=sys.stderr)
        return []


def remove_table_lines(table_image):
    """
    Remove horizontal and vertical grid lines from table image.
    This helps Tesseract read the table content better.
    
    Args:
        table_image (numpy.ndarray): Cropped table image
        
    Returns:
        numpy.ndarray: Table image with grid lines removed
    """
    try:
        # Convert to grayscale
        gray = cv2.cvtColor(table_image, cv2.COLOR_BGR2GRAY)
        
        # Apply binary thresholding
        _, binary = cv2.threshold(gray, 128, 255, cv2.THRESH_BINARY_INV)
        
        # Detect horizontal lines
        horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (40, 1))
        horizontal_lines_mask = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel, iterations=2)
        
        # Detect vertical lines
        vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 40))
        vertical_lines_mask = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vertical_kernel, iterations=2)
        
        # Combine both line masks
        lines_mask = cv2.addWeighted(horizontal_lines_mask, 1, vertical_lines_mask, 1, 0.0)
        
        # Dilate the lines mask slightly to ensure complete removal
        dilate_kernel = np.ones((3, 3), np.uint8)
        lines_mask = cv2.dilate(lines_mask, dilate_kernel, iterations=1)
        
        # Create a copy of the original image
        result = table_image.copy()
        
        # Convert mask to BGR for proper replacement
        lines_mask_bgr = cv2.cvtColor(lines_mask, cv2.COLOR_GRAY2BGR)
        
        # Replace line pixels with white background
        result[lines_mask_bgr > 0] = 255
        
        return result
        
    except Exception as e:
        # If line removal fails, return original image
        print(f"Warning: Table line removal failed: {str(e)}", file=sys.stderr)
        return table_image


def preprocess_image(input_path):
    """
    Preprocess an image for OCR using:
    - Table detection and extraction (NEW)
    - Image scaling (2x upscaling for better resolution)
    - Grayscale conversion
    - Gaussian Blur (noise reduction)
    - Otsu's Thresholding (adaptive binarization)
    - Dilation (thickens letters for better recognition)
    
    Args:
        input_path (str): Path to the input image
        
    Returns:
        dict: JSON object with processed image path and metadata
    """
    try:
        # Validate input file exists
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"Input file not found: {input_path}")
        
        # Read the image
        image = cv2.imread(input_path)
        
        if image is None:
            raise ValueError(f"Failed to read image: {input_path}")
        
        # Get original dimensions
        original_height, original_width = image.shape[:2]
        
        # Get output directory and base filename
        input_dir = os.path.dirname(input_path)
        input_filename = os.path.basename(input_path)
        name_without_ext = os.path.splitext(input_filename)[0]
        
        # ========================================
        # NEW: TABLE DETECTION AND EXTRACTION
        # ========================================
        print("Detecting tables...", file=sys.stderr)
        tables_detected = detect_and_extract_tables(image, input_dir, name_without_ext)
        print(f"Found {len(tables_detected)} table(s)", file=sys.stderr)
        
        # ========================================
        # EXISTING: MAIN IMAGE PREPROCESSING
        # ========================================
        
        # Step 1: Scale image 2x for better OCR accuracy
        # Using INTER_CUBIC for high-quality upscaling
        scaled_width = original_width * 2
        scaled_height = original_height * 2
        scaled = cv2.resize(
            image, 
            (scaled_width, scaled_height), 
            interpolation=cv2.INTER_CUBIC
        )
        
        # Step 2: Convert to grayscale
        gray = cv2.cvtColor(scaled, cv2.COLOR_BGR2GRAY)
        
        # Step 3: Apply Gaussian Blur to reduce noise
        # Kernel size (5,5) works well for most documents
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        
        # Step 4: Apply Otsu's Thresholding
        # This automatically calculates the optimal threshold value
        _, threshold = cv2.threshold(
            blurred, 
            0, 
            255, 
            cv2.THRESH_BINARY + cv2.THRESH_OTSU
        )
        
        # Step 5: Apply Dilation to thicken the letters
        # This helps with thin or broken characters
        # Create a rectangular kernel for dilation
        kernel = np.ones((2, 2), np.uint8)
        dilated = cv2.dilate(threshold, kernel, iterations=1)
        
        # Step 6: Apply opening (erosion followed by dilation) to remove noise
        # This helps clean up small specks while keeping text intact
        opening_kernel = np.ones((2, 2), np.uint8)
        final_image = cv2.morphologyEx(dilated, cv2.MORPH_OPEN, opening_kernel)
        
        # Generate output filename for main processed image
        output_filename = f"processed_{name_without_ext}.jpg"
        output_path = os.path.join(input_dir, output_filename)
        
        # Save the processed image with high quality
        success = cv2.imwrite(output_path, final_image, [cv2.IMWRITE_JPEG_QUALITY, 95])
        
        if not success:
            raise IOError(f"Failed to save processed image to: {output_path}")
        
        # Prepare response with metadata
        result = {
            "success": True,
            "original_image": input_path,
            "processed_image": output_path,
            "original_dimensions": {
                "width": int(original_width),
                "height": int(original_height)
            },
            "processed_dimensions": {
                "width": int(scaled_width),
                "height": int(scaled_height)
            },
            "scaling_factor": 2.0,
            "preprocessing_steps": [
                "Table Detection and Extraction",
                "2x Image Scaling (INTER_CUBIC)",
                "Grayscale conversion",
                "Gaussian Blur (5x5 kernel)",
                "Otsu's Thresholding",
                "Dilation (2x2 kernel, 1 iteration)",
                "Morphological Opening (noise removal)"
            ],
            "tables_detected": tables_detected,
            "table_count": len(tables_detected)
        }
        
        # Print JSON result to stdout (Node.js will capture this)
        print(json.dumps(result))
        return result
        
    except FileNotFoundError as e:
        error_result = {
            "success": False,
            "error": "File not found",
            "message": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)
        
    except ValueError as e:
        error_result = {
            "success": False,
            "error": "Invalid image",
            "message": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)
        
    except Exception as e:
        error_result = {
            "success": False,
            "error": "Processing failed",
            "message": str(e),
            "type": type(e).__name__
        }
        print(json.dumps(error_result))
        sys.exit(1)


def main():
    """Main entry point for the script"""
    if len(sys.argv) != 2:
        error_result = {
            "success": False,
            "error": "Invalid arguments",
            "message": "Usage: python3 preprocess.py <image_path>"
        }
        print(json.dumps(error_result))
        sys.exit(1)
    
    image_path = sys.argv[1]
    preprocess_image(image_path)


if __name__ == "__main__":
    main()