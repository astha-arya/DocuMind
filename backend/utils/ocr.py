#!/usr/bin/env python3
"""
DocuMind OCR Script
Extracts text from images and PDFs using Tesseract OCR
Optimized for Apple Silicon Macs
"""

import pytesseract
import cv2
import sys
import os
import json
from pathlib import Path
from PIL import Image

# Configure Tesseract path for Apple Silicon (Homebrew)
pytesseract.pytesseract.tesseract_cmd = '/opt/homebrew/bin/tesseract'


def extract_text_from_image(image_path, lang='eng'):
    """
    Extract text from an image using Tesseract OCR
    
    Args:
        image_path (str): Path to the image file
        lang (str): Language code for OCR (default: 'eng')
        
    Returns:
        dict: JSON object with extracted text and metadata
    """
    try:
        # Validate input file exists
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Image file not found: {image_path}")
        
        # Read the image using OpenCV
        image = cv2.imread(image_path)
        
        if image is None:
            # Try with PIL as fallback
            image = Image.open(image_path)
        
        # Perform OCR with custom configuration
        # PSM 3 = Fully automatic page segmentation (default)
        # OEM 3 = Default OCR Engine Mode (LSTM + Legacy)
        custom_config = r'--oem 3 --psm 3'
        
        # Extract text
        text = pytesseract.image_to_string(image, lang=lang, config=custom_config)
        
        # Get additional data (confidence scores, bounding boxes)
        data = pytesseract.image_to_data(image, lang=lang, output_type=pytesseract.Output.DICT)
        
        # Calculate average confidence
        confidences = [int(conf) for conf in data['conf'] if int(conf) > 0]
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0
        
        # Count words
        word_count = len([word for word in data['text'] if word.strip()])
        
        # Prepare result
        result = {
            "success": True,
            "image_path": image_path,
            "text": text.strip(),
            "metadata": {
                "word_count": word_count,
                "average_confidence": round(avg_confidence, 2),
                "language": lang,
                "tesseract_version": str(pytesseract.get_tesseract_version())
            }
        }
        
        # Print JSON result to stdout
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
        
    except pytesseract.TesseractNotFoundError:
        error_result = {
            "success": False,
            "error": "Tesseract not found",
            "message": "Tesseract is not installed or not found at /opt/homebrew/bin/tesseract",
            "solution": "Install Tesseract using: brew install tesseract"
        }
        print(json.dumps(error_result))
        sys.exit(1)
        
    except Exception as e:
        error_result = {
            "success": False,
            "error": "OCR failed",
            "message": str(e),
            "type": type(e).__name__
        }
        print(json.dumps(error_result))
        sys.exit(1)


def main():
    """Main entry point for the script"""
    if len(sys.argv) < 2:
        error_result = {
            "success": False,
            "error": "Invalid arguments",
            "message": "Usage: python3 ocr.py <image_path> [language]"
        }
        print(json.dumps(error_result))
        sys.exit(1)
    
    image_path = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 else 'eng'
    
    extract_text_from_image(image_path, language)


if __name__ == "__main__":
    main()