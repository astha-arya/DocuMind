#!/usr/bin/env python3
"""
DocuMind Image Preprocessing Script
Enhances images for better OCR accuracy using OpenCV
"""

import cv2
import sys
import os
import json
from pathlib import Path
import numpy as np


def preprocess_image(input_path):
    """
    Preprocess an image for OCR using:
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
        
        # Optional: Apply opening (erosion followed by dilation) to remove noise
        # This helps clean up small specks while keeping text intact
        opening_kernel = np.ones((2, 2), np.uint8)
        final_image = cv2.morphologyEx(dilated, cv2.MORPH_OPEN, opening_kernel)
        
        # Generate output filename
        input_filename = os.path.basename(input_path)
        name_without_ext = os.path.splitext(input_filename)[0]
        output_filename = f"processed_{name_without_ext}.jpg"
        
        # Save in the same directory as input (uploads folder)
        input_dir = os.path.dirname(input_path)
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
                "2x Image Scaling (INTER_CUBIC)",
                "Grayscale conversion",
                "Gaussian Blur (5x5 kernel)",
                "Otsu's Thresholding",
                "Dilation (2x2 kernel, 1 iteration)",
                "Morphological Opening (noise removal)"
            ]
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