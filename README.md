# 🧠 DocuMind: Agentic AI Document Accessibility Platform

DocuMind is an accessibility-first, AI-powered document assistant designed to make complex, visual documents (like invoices, multi-page PDFs, and reports) fully navigable and understandable for visually impaired users. 

Instead of relying on basic LLM wrappers, DocuMind utilizes an **Agentic AI Workflow** with an Actor-Reviewer architecture, custom Computer Vision preprocessing, and a Retrieval-Augmented Generation (RAG) chat API to ensure zero-hallucination document querying.

## ✨ Key Features (Backend Core)

* **Robust Document Ingestion:** Supports high-resolution images and multi-page PDFs, dynamically splitting and processing documents page-by-page.
* **Computer Vision Preprocessing:** Utilizes Python and OpenCV (Grayscale, Gaussian Blur, Otsu's Thresholding) to clean, upscale, and de-noise images before text extraction.
* **Advanced Text Extraction:** Uses Tesseract OCR to extract exact word coordinates, building a structured DOM tree of headings, paragraphs, and tables.
* **Multi-Agent Architecture (Actor-Reviewer):**
  * **The Vision Agent (Llama-4-Vision):** Scans the document for layout structures, logos, and tables that OCR cannot understand.
  * **The Actor Agent (Llama-3.3-70b):** Synthesizes OCR text and Vision data to write a screen-reader-friendly audio navigation script.
  * **The Reviewer Agent:** Acts as an automated fact-checker, grading the Actor's script against the raw OCR text to catch and flag AI hallucinations.
* **Zero-Hallucination RAG Chat:** An interactive API endpoint allowing users to ask specific questions about the uploaded document, constrained by strict anti-hallucination prompting.

## 🛠️ Tech Stack

* **Server:** Node.js, Express.js
* **Database:** MongoDB, Mongoose
* **File Handling:** Multer
* **Computer Vision & OCR:** Python, OpenCV, Tesseract OCR
* **AI Engine:** Groq SDK (Llama 3.3 Versatile, Llama 4 Vision)

## 🏗️ System Architecture Pipeline

1. **Upload:** File is received via `/api/upload`. PDFs are chunked into individual images.
2. **Pre-processing (Python):** Images are upscaled and binarized using OpenCV for maximum OCR accuracy.
3. **Extraction (Python):** Tesseract OCR reads the text and generates positional metadata.
4. **Analysis (Groq):** Llama Vision identifies non-text elements (tables, images).
5. **Synthesis (Groq):** Llama Text writes an audio-navigable JSON script.
6. **Storage:** The raw text, vision notes, and audio script are securely saved to MongoDB.
7. **Query (RAG):** User hits `/api/documents/:id/chat` with a question, and the AI answers strictly using the saved OCR data.

## 🚀 API Endpoints

### 1. Upload & Process Document
`POST /api/upload`
* **Form-Data:** `document` (File: PDF, JPEG, PNG)
* **Response:** Returns complete processing metrics, extracted text, and the AI-generated audio navigation script.

### 2. Document Q&A (RAG)
`POST /api/documents/:id/chat`
* **Body:** `{ "question": "What is the total amount due?" }`
* **Response:**
  ```json
  {
    "success": true,
    "answer": "The total amount due is $154.06."
  }
