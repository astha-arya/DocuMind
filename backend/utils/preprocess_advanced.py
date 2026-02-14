#!/usr/bin/env python3
"""
DocuMind Advanced Preprocessing Script
Multiple preprocessing modes for different document types
"""

import cv2
import sys
import os
import json
import numpy as np


def preprocess_standard(image):
    """
    Standard preprocessing - works well for most documents
    - 2x scaling
    - Grayscale
    - Gaussian blur
    - Otsu's threshold
    - Dilation
    """
    # Scale 2x
    h, w = image.shape[:2]
    scaled = cv2.resize(image, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
    
    # Grayscale
    gray = cv2.cvtColor(scaled, cv2.COLOR_BGR2GRAY)
    
    # Blur
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    
    # Threshold
    _, threshold = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    
    # Dilate
    kernel = np.ones((2, 2), np.uint8)
    dilated = cv2.dilate(threshold, kernel, iterations=1)
    
    # Opening (remove noise)
    opening_kernel = np.ones((2, 2), np.uint8)
    final = cv2.morphologyEx(dilated, cv2.MORPH_OPEN, opening_kernel)
    
    return final


def preprocess_aggressive(image):
    """
    Aggressive preprocessing - for low-quality or faded documents
    - 2x scaling
    - Adaptive thresholding
    - Stronger dilation
    - Denoising
    """
    # Scale 2x
    h, w = image.shape[:2]
    scaled = cv2.resize(image, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
    
    # Grayscale
    gray = cv2.cvtColor(scaled, cv2.COLOR_BGR2GRAY)
    
    # Denoise
    denoised = cv2.fastNlMeansDenoising(gray, h=10)
    
    # Adaptive threshold (better for varying lighting)
    threshold = cv2.adaptiveThreshold(
        denoised, 
        255, 
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
        cv2.THRESH_BINARY, 
        11, 
        2
    )
    
    # Stronger dilation
    kernel = np.ones((3, 3), np.uint8)
    dilated = cv2.dilate(threshold, kernel, iterations=2)
    
    return dilated


def preprocess_minimal(image):
    """
    Minimal preprocessing - for high-quality scans
    - 2x scaling only
    - Grayscale
    - Light threshold
    """
    # Scale 2x
    h, w = image.shape[:2]
    scaled = cv2.resize(image, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
    
    # Grayscale
    gray = cv2.cvtColor(scaled, cv2.COLOR_BGR2GRAY)
    
    # Simple threshold
    _, threshold = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)
    
    return threshold


def preprocess_receipt(image):
    """
    Receipt-specific preprocessing
    - 3x scaling (receipts often have small text)
    - Strong contrast enhancement
    - Heavy dilation
    """
    # Scale 3x for small text
    h, w = image.shape[:2]
    scaled = cv2.resize(image, (w * 3, h * 3), interpolation=cv2.INTER_CUBIC)
    
    # Grayscale
    gray = cv2.cvtColor(scaled, cv2.COLOR_BGR2GRAY)
    
    # Enhance contrast using CLAHE
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    
    # Threshold
    _, threshold = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    
    # Heavy dilation for thin receipt text
    kernel = np.ones((3, 3), np.uint8)
    dilated = cv2.dilate(threshold, kernel, iterations=2)
    
    return dilated


def auto_detect_mode(image):
    """
    Auto-detect best preprocessing mode based on image characteristics
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # Calculate image statistics
    mean_brightness = np.mean(gray)
    std_brightness = np.std(gray)
    
    # Low contrast = aggressive mode
    if std_brightness < 40:
        return "aggressive"
    
    # Very high quality = minimal mode
    if mean_brightness > 200 and std_brightness > 50:
        return "minimal"
    
    # Default to standard
    return "standard"


def preprocess_image(input_path, mode="auto"):
    """
    Preprocess image with specified mode
    
    Modes:
    - auto: Auto-detect best mode
    - standard: Default preprocessing (recommended)
    - aggressive: For low-quality documents
    - minimal: For high-quality scans
    - receipt: Optimized for receipts
    """
    try:
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"Input file not found: {input_path}")
        
        image = cv2.imread(input_path)
        if image is None:
            raise ValueError(f"Failed to read image: {input_path}")
        
        original_height, original_width = image.shape[:2]
        
        # Auto-detect mode if requested
        if mode == "auto":
            mode = auto_detect_mode(image)
        
        # Apply preprocessing based on mode
        if mode == "aggressive":
            processed = preprocess_aggressive(image)
            steps = [
                "2x Image Scaling (INTER_CUBIC)",
                "Grayscale conversion",
                "Fast NL Means Denoising",
                "Adaptive Thresholding (Gaussian)",
                "Dilation (3x3 kernel, 2 iterations)"
            ]
        elif mode == "minimal":
            processed = preprocess_minimal(image)
            steps = [
                "2x Image Scaling (INTER_CUBIC)",
                "Grayscale conversion",
                "Simple Binary Thresholding"
            ]
        elif mode == "receipt":
            processed = preprocess_receipt(image)
            steps = [
                "3x Image Scaling (INTER_CUBIC)",
                "Grayscale conversion",
                "CLAHE Contrast Enhancement",
                "Otsu's Thresholding",
                "Dilation (3x3 kernel, 2 iterations)"
            ]
        else:  # standard
            processed = preprocess_standard(image)
            steps = [
                "2x Image Scaling (INTER_CUBIC)",
                "Grayscale conversion",
                "Gaussian Blur (5x5 kernel)",
                "Otsu's Thresholding",
                "Dilation (2x2 kernel, 1 iteration)",
                "Morphological Opening (noise removal)"
            ]
        
        # Save processed image
        input_filename = os.path.basename(input_path)
        name_without_ext = os.path.splitext(input_filename)[0]
        output_filename = f"processed_{name_without_ext}.jpg"
        input_dir = os.path.dirname(input_path)
        output_path = os.path.join(input_dir, output_filename)
        
        success = cv2.imwrite(output_path, processed, [cv2.IMWRITE_JPEG_QUALITY, 95])
        
        if not success:
            raise IOError(f"Failed to save processed image to: {output_path}")
        
        processed_height, processed_width = processed.shape[:2]
        
        result = {
            "success": True,
            "original_image": input_path,
            "processed_image": output_path,
            "original_dimensions": {
                "width": int(original_width),
                "height": int(original_height)
            },
            "processed_dimensions": {
                "width": int(processed_width),
                "height": int(processed_height)
            },
            "mode": mode,
            "preprocessing_steps": steps
        }
        
        print(json.dumps(result))
        return result
        
    except Exception as e:
        error_result = {
            "success": False,
            "error": type(e).__name__,
            "message": str(e)
        }
        print(json.dumps(error_result))
        sys.exit(1)


def main():
    if len(sys.argv) < 2:
        error_result = {
            "success": False,
            "error": "Invalid arguments",
            "message": "Usage: python3 preprocess_advanced.py <image_path> [mode]",
            "modes": ["auto", "standard", "aggressive", "minimal", "receipt"]
        }
        print(json.dumps(error_result))
        sys.exit(1)
    
    image_path = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else "auto"
    
    preprocess_image(image_path, mode)


if __name__ == "__main__":
    main()