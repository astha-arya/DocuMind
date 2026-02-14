#!/usr/bin/env python3
"""
Preprocessing Comparison Tool
Tests all preprocessing modes and saves side-by-side comparison
"""

import cv2
import sys
import os
import numpy as np
from pathlib import Path


def preprocess_standard(image):
    """Standard mode"""
    h, w = image.shape[:2]
    scaled = cv2.resize(image, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(scaled, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _, threshold = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    kernel = np.ones((2, 2), np.uint8)
    dilated = cv2.dilate(threshold, kernel, iterations=1)
    opening_kernel = np.ones((2, 2), np.uint8)
    final = cv2.morphologyEx(dilated, cv2.MORPH_OPEN, opening_kernel)
    return final


def preprocess_aggressive(image):
    """Aggressive mode"""
    h, w = image.shape[:2]
    scaled = cv2.resize(image, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(scaled, cv2.COLOR_BGR2GRAY)
    denoised = cv2.fastNlMeansDenoising(gray, h=10)
    threshold = cv2.adaptiveThreshold(denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
                                       cv2.THRESH_BINARY, 11, 2)
    kernel = np.ones((3, 3), np.uint8)
    dilated = cv2.dilate(threshold, kernel, iterations=2)
    return dilated


def preprocess_minimal(image):
    """Minimal mode"""
    h, w = image.shape[:2]
    scaled = cv2.resize(image, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(scaled, cv2.COLOR_BGR2GRAY)
    _, threshold = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)
    return threshold


def preprocess_receipt(image):
    """Receipt mode"""
    h, w = image.shape[:2]
    scaled = cv2.resize(image, (w * 3, h * 3), interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(scaled, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    _, threshold = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    kernel = np.ones((3, 3), np.uint8)
    dilated = cv2.dilate(threshold, kernel, iterations=2)
    return dilated


def add_label(image, text):
    """Add a label to an image"""
    labeled = image.copy()
    if len(labeled.shape) == 2:
        labeled = cv2.cvtColor(labeled, cv2.COLOR_GRAY2BGR)
    
    cv2.rectangle(labeled, (0, 0), (labeled.shape[1], 40), (0, 0, 0), -1)
    cv2.putText(labeled, text, (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 
                0.8, (255, 255, 255), 2)
    return labeled


def create_comparison(input_path, output_dir="uploads"):
    """Create side-by-side comparison of all preprocessing modes"""
    
    if not os.path.exists(input_path):
        print(f"Error: File not found: {input_path}")
        return
    
    # Read original image
    original = cv2.imread(input_path)
    if original is None:
        print(f"Error: Failed to read image: {input_path}")
        return
    
    print(f"Processing: {input_path}")
    print(f"Original size: {original.shape[1]}x{original.shape[0]}")
    print()
    
    # Process with all modes
    print("Applying preprocessing modes...")
    standard = preprocess_standard(original)
    aggressive = preprocess_aggressive(original)
    minimal = preprocess_minimal(original)
    receipt = preprocess_receipt(original)
    
    print("✓ Standard mode")
    print("✓ Aggressive mode")
    print("✓ Minimal mode")
    print("✓ Receipt mode")
    print()
    
    # Resize all to same height for comparison
    target_height = 800
    
    def resize_to_height(img, h):
        aspect = img.shape[1] / img.shape[0]
        return cv2.resize(img, (int(h * aspect), h))
    
    original_resized = resize_to_height(original, target_height)
    standard_resized = resize_to_height(standard, target_height)
    aggressive_resized = resize_to_height(aggressive, target_height)
    minimal_resized = resize_to_height(minimal, target_height)
    receipt_resized = resize_to_height(receipt, target_height)
    
    # Convert grayscale to BGR for consistent stacking
    standard_bgr = cv2.cvtColor(standard_resized, cv2.COLOR_GRAY2BGR)
    aggressive_bgr = cv2.cvtColor(aggressive_resized, cv2.COLOR_GRAY2BGR)
    minimal_bgr = cv2.cvtColor(minimal_resized, cv2.COLOR_GRAY2BGR)
    receipt_bgr = cv2.cvtColor(receipt_resized, cv2.COLOR_GRAY2BGR)
    
    # Add labels
    original_labeled = add_label(original_resized, "ORIGINAL")
    standard_labeled = add_label(standard_bgr, "STANDARD (2x + Dilation)")
    aggressive_labeled = add_label(aggressive_bgr, "AGGRESSIVE (Denoise + Adaptive)")
    minimal_labeled = add_label(minimal_bgr, "MINIMAL (2x + Simple Threshold)")
    receipt_labeled = add_label(receipt_bgr, "RECEIPT (3x + CLAHE + Heavy Dilation)")
    
    # Create grid layout (2x3)
    row1 = np.hstack([original_labeled, standard_labeled, aggressive_labeled])
    row2 = np.hstack([
        minimal_labeled, 
        receipt_labeled,
        np.zeros_like(minimal_labeled)  # Empty space
    ])
    
    comparison = np.vstack([row1, row2])
    
    # Save comparison
    input_filename = os.path.basename(input_path)
    name_without_ext = os.path.splitext(input_filename)[0]
    output_path = os.path.join(output_dir, f"comparison_{name_without_ext}.jpg")
    
    cv2.imwrite(output_path, comparison, [cv2.IMWRITE_JPEG_QUALITY, 90])
    
    print(f"✓ Comparison saved: {output_path}")
    print(f"  Size: {comparison.shape[1]}x{comparison.shape[0]}")
    print()
    
    # Save individual processed versions
    individual_dir = os.path.join(output_dir, "preprocessing_modes")
    os.makedirs(individual_dir, exist_ok=True)
    
    cv2.imwrite(os.path.join(individual_dir, f"{name_without_ext}_standard.jpg"), standard)
    cv2.imwrite(os.path.join(individual_dir, f"{name_without_ext}_aggressive.jpg"), aggressive)
    cv2.imwrite(os.path.join(individual_dir, f"{name_without_ext}_minimal.jpg"), minimal)
    cv2.imwrite(os.path.join(individual_dir, f"{name_without_ext}_receipt.jpg"), receipt)
    
    print(f"✓ Individual modes saved to: {individual_dir}/")
    print()
    print("=" * 60)
    print("RECOMMENDATIONS:")
    print("=" * 60)
    print("STANDARD: Best for most documents (recommended default)")
    print("AGGRESSIVE: Use for faded/low-contrast documents")
    print("MINIMAL: Use for high-quality scans only")
    print("RECEIPT: Use for receipts with small/thin text")
    print("=" * 60)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 compare_preprocessing.py <image_path>")
        print("Example: python3 compare_preprocessing.py uploads/receipt.jpg")
        sys.exit(1)
    
    create_comparison(sys.argv[1])