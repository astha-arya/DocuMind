🧠 DocuMind: Agentic AI Document Accessibility Platform
DocuMind is a full-stack, accessibility-first document assistant designed to make complex, visual documents (like invoices, multi-page PDFs, and reports) fully navigable and understandable for visually impaired users.

Instead of relying on basic LLM wrappers, DocuMind utilizes an Agentic AI Workflow (Actor-Reviewer architecture), custom Computer Vision preprocessing, and native Browser Accessibility APIs to create an interactive Audio-Pilot that guides users through documents without hallucinations.

✨ Key Features
🖥️ The Frontend (Accessibility UI)
The Audio-Pilot": Utilizes the native Web Speech API to automatically read AI-generated document summaries, layout notes, and navigation hints.
WCAG 2.1 AA Compliant: Features a high-contrast dark mode (shadcn/ui), strictly enforced ARIA labels, aria-live polite regions for screen readers, and hidden skip-links.
Keyboard-First Navigation: Users can navigate between pages of a complex PDF using Left/Right arrow keys, instantly triggering contextual audio summaries for the new page.
Multimodal Chat: Users can type questions or use the built-in Speech-to-Text microphone to dictate questions to the AI.
Global Localization: Built to support multilingual document processing and localized TTS voices (including Hindi and Tamil).

⚙️ The Backend (AI & Vision Core)
Hybrid Document Ingestion: Supports high-resolution images and multi-page PDFs, dynamically chunking and processing documents page-by-page.
Computer Vision Preprocessing: Utilizes Python and OpenCV (Grayscale, Gaussian Blur, Otsu's Thresholding) to clean, upscale, and de-noise images before text extraction.

Multi-Agent Architecture:
The Vision Agent (Llama-4-Vision): Scans the document for layout structures, logos, and tables that traditional OCR misses.
The Actor Agent (Llama-3.3-70b): Synthesizes OCR text and Vision data to write a screen-reader-friendly audio navigation script.
The Reviewer Agent: Acts as an automated fact-checker, grading the Actor's script against the raw OCR text to flag AI hallucinations.
Zero-Hallucination RAG Chat: An interactive API endpoint constrained by strict anti-hallucination prompting and backed by a MongoDB cache to save tokens on repeat questions.
The Digital Janitor: Automated cleanup routines to prevent server memory leaks from temporary Python image processing.

🛠️ Tech Stack
Frontend: Next.js (TypeScript), React, Tailwind CSS, shadcn/ui, Web Speech API (TTS/STT).
Backend: Node.js, Express.js, MongoDB (Mongoose), multer.
Computer Vision & OCR: Python, OpenCV, Tesseract OCR.
AI Engine: Groq SDK (Llama 3.3 Versatile, Llama 4 Vision).

🏗️ System Architecture Pipeline
Upload: User uploads a file via the Next.js UI. Node.js catches it via /api/upload. PDFs are split into individual images.
Pre-processing (Python): Images are upscaled and binarized using OpenCV for maximum OCR accuracy.
Extraction (Python): Tesseract OCR reads the text and generates positional metadata.
Analysis & Synthesis (Groq): Llama Vision identifies non-text elements. Llama Text writes an audio-navigable JSON script.
Storage: Raw text, vision notes, and the audio script are saved to MongoDB. Temporary processing files are swept from the server.
Interaction: The Next.js UI receives the structured payload, waking up the Audio-Pilot to read the summary, and opening the RAG endpoint for voice-dictated Q&A.
