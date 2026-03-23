# DocuMind: Agentic AI Document Accessibility Platform

DocuMind is a full-stack, accessibility-first AI document assistant designed to make complex visual documents (invoices, multi-page PDFs, reports) fully navigable and understandable for visually impaired users.

It uses an Agentic AI workflow (Actor–Reviewer architecture), Computer Vision preprocessing, and browser-native accessibility APIs to deliver an interactive, voice-driven document experience with minimal hallucinations.

---

## Key Features

### Frontend (Accessibility UI)

* Audio-Pilot using Web Speech API to read document summaries, layout descriptions, and navigation hints
* WCAG 2.1 AA compliant interface with ARIA labels, aria-live regions, and skip links
* Keyboard-first navigation for multi-page documents with real-time audio feedback
* Multimodal chat with text and speech-to-text input
* Support for multilingual document processing and localized TTS

---

### Backend (AI & Vision Core)

* Hybrid document ingestion for images and multi-page PDFs with page-wise processing
* Computer Vision preprocessing using OpenCV (grayscale, blur, thresholding)
* + Tesseract OCR extracts text and positional metadata, which is used to construct a structured DOM-like representation of the document (headings, paragraphs, tables)
* Multi-agent architecture:
  * Vision Agent (Llama-4-Vision) for layout and non-text understanding
  * Actor Agent (Llama-3.3) for generating structured audio scripts
  * Reviewer Agent for validating outputs and reducing hallucinations
* RAG-based query system with MongoDB caching for efficient responses
* Automated cleanup system for temporary file management
  

---

## Tech Stack

Frontend:

* Next.js (TypeScript), React
* Tailwind CSS, shadcn/ui
* Web Speech API (TTS/STT)

Backend:

* Node.js, Express.js
* MongoDB (Mongoose), Multer

AI & Vision Pipeline:

* Python, OpenCV, Tesseract OCR
* Groq API (Llama 3.3, Llama 4 Vision)

---

## System Architecture Pipeline

1. Upload: Document is uploaded via `/api/upload` and PDFs are split into images
2. Pre-processing: Images are enhanced using OpenCV
3. Extraction: Tesseract OCR extracts text and positional metadata
4. Analysis & Synthesis: Vision model detects layout, text model generates structured output
5. Storage: Data is stored in MongoDB and temporary files are cleaned
6. Interaction: Users query documents via RAG-based chat
