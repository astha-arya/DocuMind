"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  FileText,
  Send,
  Volume2,
  VolumeX,
  Plus,
  Menu,
  X,
  Mic,
  MicOff,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";

// Use environment variable if available, otherwise default to local backend
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface DocumentListItem {
  _id: string; // MongoDB uses _id
  originalName: string;
  uploadDate: string;
}

// --- UPGRADED AI INTERFACE ---
interface DocumentDetail {
  _id: string;
  originalName: string;
  uploadDate: string;
  extractedText: string;
  aiAnalysis?: {
    pages?: {
      pageNumber: number;
      visionAnalysis?: {
        layoutNotes?: string;
      };
      audioNavigation?: {
        audioIntro?: string;
        navigationHints?: { summary: string }[];
      };
    }[];
  };
  chatHistory?: Message[];
}

export default function DocuMindPage() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSpeechEnabled, setIsSpeechEnabled] = useState(false);
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<DocumentDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hello! I'm DocuMind, your document assistant. I can help you understand and navigate your uploaded documents. What would you like to know?",
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false); // New state for upload
  const [isRecording, setIsRecording] = useState(false);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [lastAnnouncement, setLastAnnouncement] = useState("");
  const [srAnnouncement, setSrAnnouncement] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("en-US");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null); // New ref for hidden file input
  const recognitionRef = useRef<any>(null);
  const speechSynthesisRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Fetch documents list on mount
  const fetchDocuments = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/documents`);
      if (response.ok) {
        const data = await response.json();
        // The backend returns { success: true, count: X, data: [...] }
        const docs = data.data || [];
        setDocuments(docs);
      }
    } catch (error) {
      console.error("Failed to fetch documents:", error);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  // Fetch document detail
  const fetchDocumentDetail = async (docId: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/documents/${docId}`);
      if (response.ok) {
        const data = await response.json();
        const doc = data.data || data;
        setSelectedDocument(doc);
        
        // --- DATA TRANSLATOR: Convert MongoDB Chat to Next.js Chat ---
        const formattedChat: Message[] = [];
        if (doc.chatHistory && Array.isArray(doc.chatHistory)) {
          doc.chatHistory.forEach((chat: any, index: number) => {
            formattedChat.push({ id: `user-${index}`, role: "user", content: chat.question });
            formattedChat.push({ id: `bot-${index}`, role: "assistant", content: chat.answer });
          });
        }

        setMessages(
          formattedChat.length > 0
            ? formattedChat
            : [
                {
                  id: "welcome",
                  role: "assistant",
                  content: `I have loaded "${doc.originalName || doc.filename}". What would you like to know?`,
                },
              ]
        );
        setCurrentPageIndex(0);
      }
    } catch (error) {
      console.error("Failed to fetch document detail:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // --- Handle Actual File Upload ---
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setSrAnnouncement("Uploading and analyzing document. Please wait.");
    const formData = new FormData();
    // MATCH 1: Backend multer expects 'document', not 'file'
    formData.append("document", file); 

    try {
      // MATCH 2: Backend URL is /api/upload
      const response = await fetch(`${API_BASE_URL}/api/upload`, {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        setIsUploadDialogOpen(false);
        await fetchDocuments(); // Refresh the sidebar
        
        // Auto-select the newly uploaded document
        if (result.file && result.file._id) {
          fetchDocumentDetail(result.file._id);
        }
      } else {
        const errorData = await response.json();
        console.error("Upload failed", errorData);
        alert(`Upload failed: ${errorData.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error("Error uploading file:", error);
      alert("Error connecting to server.");
    } finally {
      setIsUploading(false);
      // Reset input so you can upload the same file again if needed
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Text-to-Speech: Speak text with Natural Voice
  const speak = useCallback(
    (text: string, onEnd?: () => void) => {
      if (!isSpeechEnabled || typeof window === "undefined") return;

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);

      utterance.lang = selectedLanguage;

      // --- UPGRADED VOICE HUNTING ---
      const voices = window.speechSynthesis.getVoices();
      
      // 1. Grab the base language code (e.g., 'hi' from 'hi-IN')
      const baseLang = selectedLanguage.split('-')[0].toLowerCase();
      
      // 2. Hunt for a voice that matches the language
      let voiceToUse = voices.find((v) => v.lang.toLowerCase().includes(baseLang));
      
      // 3. If English, strictly hunt for the premium voices
      if (baseLang === "en") {
        voiceToUse = voices.find(v => 
          (v.lang.includes("en") && (v.name.includes("Samantha") || v.name.includes("Daniel") || v.name.includes("Premium") || v.name.includes("Natural")))
        ) || voiceToUse; 
      }

      if (voiceToUse) {
        utterance.voice = voiceToUse;
      }

      utterance.rate = 0.95; 
      utterance.pitch = 1;
      utterance.volume = 1;

      if (onEnd) {
        utterance.onend = onEnd;
      }

      speechSynthesisRef.current = utterance;
      setLastAnnouncement(text);
      window.speechSynthesis.speak(utterance);
    },
    [isSpeechEnabled, selectedLanguage] 
  );

  // Smart Speaker: Translates text via backend before speaking if language is not English
  const translateAndSpeak = useCallback(async (textToSpeak: string, languageCode: string, onEndCallback?: () => void) => {
    if (languageCode === 'en-US') {
      speak(textToSpeak, onEndCallback);
      return;
    }

    try {
      window.speechSynthesis.cancel();
      console.log(`🌐 Sending to backend translation API: [${languageCode}]`);
      
      const response = await fetch(`${API_BASE_URL}/api/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          text: textToSpeak, 
          targetLanguage: languageCode 
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          console.log("✅ Translation success:", data.translatedText.substring(0, 50) + "...");
          speak(data.translatedText, onEndCallback);
        } else {
          console.error("❌ Backend returned false success flag.");
          speak(textToSpeak, onEndCallback);
        }
      } else {
        console.error(`❌ Backend API failed with status: ${response.status}`);
        speak(textToSpeak, onEndCallback);
      }
    } catch (error) {
      console.error("❌ Network fetch completely failed:", error);
      speak(textToSpeak, onEndCallback);
    }
  }, [speak]);

  // --- NEW: Force the browser to load premium voices immediately ---
  useEffect(() => {
    if (typeof window !== "undefined") {
      const loadVoices = () => window.speechSynthesis.getVoices();
      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

 // Auto-speak summary when document loads, page changes, and speech is enabled
  useEffect(() => {
    if (selectedDocument && isSpeechEnabled) {
      const pages = selectedDocument.aiAnalysis?.pages;
      
      if (pages && pages.length > 0 && pages[currentPageIndex]) {
        const page = pages[currentPageIndex];
        
        // 1. Grab the Audio Intro
        let fullScript = page.audioNavigation?.audioIntro || "Summary loaded.";
        
        // 2. Append Layout Notes (if they exist)
        if (page.visionAnalysis?.layoutNotes) {
          fullScript += ` Layout notes: ${page.visionAnalysis.layoutNotes}`;
        }
        
        // 3. Append Sections (if they exist)
        if (page.audioNavigation?.navigationHints && page.audioNavigation.navigationHints.length > 0) {
          fullScript += ` I have detected ${page.audioNavigation.navigationHints.length} sections. `;
          page.audioNavigation.navigationHints.forEach((hint: any, idx: number) => {
            fullScript += `Section ${idx + 1}: ${hint.summary}. `;
          });
        }

        // Speak the full stitched script
        translateAndSpeak(fullScript, selectedLanguage, () => {
          if (pages.length > 1) {
            setTimeout(() => {
              translateAndSpeak(`You are on page ${currentPageIndex + 1} of ${pages.length}. Use your right arrow key to proceed, or ask me a question.`, selectedLanguage);
            }, 500);
          } else {
            setTimeout(() => {
              translateAndSpeak("I have loaded the sections for this page. What would you like to know?", selectedLanguage);
            }, 500);
          }
        });
      }
    }
  }, [selectedDocument, isSpeechEnabled, currentPageIndex,, selectedLanguage, translateAndSpeak]);
  
  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Initialize Speech Recognition
  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = "en-US";

        recognition.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          setInputValue((prev) => prev + " " + transcript);
          setIsRecording(false);
        };

        recognition.onerror = () => {
          setIsRecording(false);
        };

        recognition.onend = () => {
          setIsRecording(false);
        };

        recognitionRef.current = recognition;
      }
    }
  }, []);

  // Sync the microphone language whenever the user changes the dropdown
  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = selectedLanguage;
    }
  }, [selectedLanguage]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      const pages = selectedDocument?.aiAnalysis?.pages;

      switch (e.key) {
        case "ArrowRight":
          if (pages && currentPageIndex < pages.length - 1) {
            e.preventDefault();
            const nextIndex = currentPageIndex + 1;
            setCurrentPageIndex(nextIndex);
            const nextIntro = pages[nextIndex].audioNavigation?.audioIntro || `Page ${pages[nextIndex].pageNumber}`;
            translateAndSpeak(nextIntro, selectedLanguage);
          }
          break;
        case "ArrowLeft":
          if (pages && currentPageIndex > 0) {
            e.preventDefault();
            const prevIndex = currentPageIndex - 1;
            setCurrentPageIndex(prevIndex);
            const prevIntro = pages[prevIndex].audioNavigation?.audioIntro || `Page ${pages[prevIndex].pageNumber}`;
            translateAndSpeak(prevIntro, selectedLanguage);
          }
          break;
        case " ":
          if (!e.shiftKey && lastAnnouncement) {
            e.preventDefault();
            speak(lastAnnouncement);
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedDocument, currentPageIndex, lastAnnouncement, speak]);

  // Send message to API
  const handleSendMessage = async () => {
    if (!inputValue.trim() || !selectedDocument) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: inputValue,
    };

    setMessages((prev) => [...prev, userMessage]);
    const questionText = inputValue;
    setInputValue("");
    setIsLoading(true);
    setSrAnnouncement("Sending question to AI. Please wait.");

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/documents/${selectedDocument._id}/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          // Send BOTH the question and the selected language to your backend
          body: JSON.stringify({ 
            question: questionText,
            language: selectedLanguage 
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          // Backend returns 'answer', not 'response' or 'message'
          content: data.answer || "I received your question but couldn't generate an answer.",
        };
        setMessages((prev) => [...prev, assistantMessage]);
        setSrAnnouncement(`AI answered: ${assistantMessage.content}`);

        // Speak the response if speech is enabled
        if (isSpeechEnabled) {
          speak(assistantMessage.content);
        }
      } else {
        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "Sorry, I encountered an error processing your request.",
        };
        setMessages((prev) => [...prev, errorMessage]);
        if (isSpeechEnabled) speak(errorMessage.content);
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Sorry, I couldn't connect to the server. Please try again.",
      };
      setMessages((prev) => [...prev, errorMessage]);
      if (isSpeechEnabled) speak(errorMessage.content);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

const toggleSpeech = () => {
    const newState = !isSpeechEnabled;
    setIsSpeechEnabled(newState);

    if (!newState && typeof window !== "undefined") {
      window.speechSynthesis.cancel();
    }

    if (newState && selectedDocument) {
      const page = selectedDocument.aiAnalysis?.pages?.[currentPageIndex];
      if (page) {
        // Rebuild the full script for the manual toggle
        let fullScript = page.audioNavigation?.audioIntro || "Summary loaded.";
        
        if (page.visionAnalysis?.layoutNotes) {
          fullScript += ` Layout notes: ${page.visionAnalysis.layoutNotes}`;
        }
        
        if (page.audioNavigation?.navigationHints && page.audioNavigation.navigationHints.length > 0) {
          fullScript += ` I have detected ${page.audioNavigation.navigationHints.length} sections. `;
          page.audioNavigation.navigationHints.forEach((hint: any, idx: number) => {
            fullScript += `Section ${idx + 1}: ${hint.summary}. `;
          });
        }

        setTimeout(() => {
          translateAndSpeak(fullScript, selectedLanguage);
        }, 100);
      }
    }
  };

  const toggleRecording = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition is not supported in your browser.");
      return;
    }

    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
    } else {
      if (typeof window !== "undefined") {
        window.speechSynthesis.cancel();
      }
      recognitionRef.current.start();
      setIsRecording(true);
    }
  };

  return (
    <div className="flex h-screen bg-[#000000] text-[#FFFFFF]">
      
      {/* 1. BULLETPROOF SKIP LINK: Slid off-screen, comes down on focus */}
      <a
        href="#chat-input"
        className="absolute -translate-y-[150%] focus:translate-y-0 top-4 left-4 z-50 px-6 py-3 bg-[#FFFF00] text-[#000000] font-bold rounded-md ring-4 ring-[#FFFFFF] outline-none transition-transform"
      >
        Skip to Chat
      </a>

      {/* 2. THE GLOBAL ANNOUNCER: Invisible to eyes, speaks to Screen Readers */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {srAnnouncement}
      </div>

      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/70 z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-80 bg-[#0a0a0a] border-r border-[#333333] transform transition-transform duration-300 ease-in-out ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
        aria-label="Document sidebar"
        role="complementary"
      >
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between p-4 border-b border-[#333333]">
            <h2 className="text-xl font-bold text-[#FFFFFF]">Documents</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSidebarOpen(false)}
              className="lg:hidden focus:ring-4 focus:ring-[#FFFF00] focus:outline-none hover:bg-[#333333]"
              aria-label="Close sidebar"
            >
              <X className="size-6" aria-hidden="true" />
            </Button>
          </div>

          {/* Upload Button */}
          <div className="p-4">
            <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  className="w-full h-14 text-lg font-semibold bg-[#FFFFFF] text-[#000000] hover:bg-[#e0e0e0] focus:ring-4 focus:ring-[#FFFF00] focus:outline-none"
                  aria-label="Upload a new document"
                >
                  <Plus className="size-6 mr-2" aria-hidden="true" />
                  Upload Document
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[#000000] border-[#333333] text-[#FFFFFF]">
                <DialogHeader>
                  <DialogTitle className="text-2xl text-[#FFFFFF]">
                    Upload Document
                  </DialogTitle>
                  <DialogDescription className="text-[#a0a0a0]">
                    Select a document file to upload and analyze
                  </DialogDescription>
                </DialogHeader>
                
                {/* HIDDEN FILE INPUT */}
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  accept="application/pdf,image/png,image/jpeg,image/jpg" 
                  className="hidden" 
                />

                <div className="space-y-4 pt-4">
                  <div className="border-2 border-dashed border-[#333333] rounded-lg p-8 text-center hover:border-[#FFFFFF] transition-colors">
                    {isUploading ? (
                      <Loader2 className="size-12 mx-auto mb-4 text-[#FFFF00] animate-spin" aria-hidden="true" />
                    ) : (
                      <FileText className="size-12 mx-auto mb-4 text-[#a0a0a0]" aria-hidden="true" />
                    )}
                    
                    <p className="text-lg mb-2">
                      {isUploading ? "Uploading & Analyzing..." : "Drag and drop your file here"}
                    </p>
                    {!isUploading && <p className="text-[#a0a0a0] mb-4">or</p>}
                    
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      className="h-12 px-6 text-lg bg-[#FFFFFF] text-[#000000] hover:bg-[#e0e0e0] focus:ring-4 focus:ring-[#FFFF00] focus:outline-none disabled:opacity-50"
                      aria-label="Browse files to upload"
                    >
                      {isUploading ? "Please Wait..." : "Browse Files"}
                    </Button>
                  </div>
                  <p className="text-sm text-[#a0a0a0]">
                    Supported formats: PDF, PNG, JPG (Max 10MB)
                  </p>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Document List */}
          <ScrollArea className="flex-1 px-4">
            <nav aria-label="Document list">
              <ul className="space-y-2 pb-4" role="list">
                {documents.map((doc) => (
                  <li key={doc._id}>
                    <button
                      onClick={() => {
                        fetchDocumentDetail(doc._id);
                        setIsSidebarOpen(false);
                      }}
                      className={`w-full text-left p-4 rounded-lg transition-colors focus:ring-4 focus:ring-[#FFFF00] focus:outline-none ${
                        selectedDocument?._id === doc._id
                          ? "bg-[#333333] border-2 border-[#FFFFFF]"
                          : "bg-[#1a1a1a] hover:bg-[#262626] border-2 border-transparent"
                      }`}
                      aria-label={`Select document: ${doc.originalName || "Document"}`}
                      aria-current={selectedDocument?._id === doc._id ? "true" : undefined}
                    >
                      <div className="flex items-start gap-3">
                        <FileText className="size-6 mt-1 shrink-0" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-lg truncate text-[#FFFFFF]">
                            {doc.originalName || "Unnamed Document"}
                          </p>
                          <p className="text-sm text-[#a0a0a0]">
                            {doc.uploadDate ? new Date(doc.uploadDate).toLocaleDateString() : "Just now"}
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
                {documents.length === 0 && (
                  <li className="text-center py-8 text-[#a0a0a0]">
                    No documents uploaded yet
                  </li>
                )}
              </ul>
            </nav>
          </ScrollArea>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0" role="main">
        <header className="flex items-center justify-between p-4 border-b border-[#333333] bg-[#000000]">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden focus:ring-4 focus:ring-[#FFFF00] focus:outline-none hover:bg-[#333333]"
              aria-label="Open document sidebar"
            >
              <Menu className="size-6" aria-hidden="true" />
            </Button>
            <h1 className="text-2xl font-bold text-[#FFFFFF]">DocuMind</h1>
          </div>

          <div className="flex items-center gap-4">
            {/* NEW: Accessible Language Dropdown */}
            <label htmlFor="language-select" className="sr-only">Select Spoken Language</label>
            <select
              id="language-select"
              value={selectedLanguage}
              onChange={(e) => {
                const newLang = e.target.value;
                setSelectedLanguage(newLang);
                
                // --- THE ACCESSIBILITY UPGRADE ---
                // Find the human-readable text of the selected option (e.g., "Hindi (हिंदी)")
                const langText = e.target.options[e.target.selectedIndex].text;
                // Tell the screen reader to announce the change immediately
                setSrAnnouncement(`Spoken language changed to ${langText}`);
              }}
              className="h-12 px-4 bg-[#1a1a1a] border-2 border-[#FFFFFF] text-[#FFFFFF] font-semibold rounded-md focus:ring-4 focus:ring-[#FFFF00] focus:outline-none cursor-pointer"
            >
              <option value="en-US">English</option>
              <option value="hi-IN">Hindi (हिंदी)</option>
              <option value="ta-IN">Tamil (தமிழ்)</option>
            </select>

            <Button
              onClick={toggleSpeech}
              variant="ghost" 
              className={`h-12 px-4 text-lg font-semibold border-2 focus:ring-4 focus:ring-[#FFFF00] focus:outline-none transition-colors ${
                isSpeechEnabled
                  ? "bg-[#FFFF00] text-[#000000] border-[#FFFF00] hover:bg-[#cccc00]"
                  : "bg-transparent text-[#FFFFFF] border-[#FFFFFF] hover:bg-[#333333]"
              }`}
              aria-label={isSpeechEnabled ? "Pause speech synthesis" : "Play speech synthesis"}
              aria-pressed={isSpeechEnabled}
            >
              {isSpeechEnabled ? (
                <>
                  <Volume2 className="size-6 mr-2" aria-hidden="true" />
                  <span>Speech On</span>
                </>
              ) : (
                <>
                  <VolumeX className="size-6 mr-2" aria-hidden="true" />
                  <span>Speech Off</span>
                </>
              )}
            </Button>
          </div>
        </header>

        {/* --- UPGRADED AI UI DISPLAY --- */}
        <section className="p-6 border-b border-[#333333] bg-[#0a0a0a]" aria-labelledby="summary-heading">
          <h2 id="summary-heading" className="text-xl font-bold mb-4 text-[#FFFFFF]">
            Document Summary
          </h2>
          <div className="bg-[#1a1a1a] rounded-lg p-6 border border-[#333333] space-y-6">
            {selectedDocument ? (
              <>
                <h3 className="text-2xl font-semibold text-[#FFFFFF]">
                  {selectedDocument.originalName || "Document"}
                </h3>

                {selectedDocument.aiAnalysis?.pages && selectedDocument.aiAnalysis.pages[currentPageIndex] ? (
                  <div className="space-y-6">
                    {/* Audio Intro Box */}
                    <div className="bg-[#262626] p-5 rounded-md border border-[#404040]">
                      <h4 className="text-[#FFFF00] font-medium mb-2 flex items-center gap-2">
                        <Volume2 className="size-5" /> Audio Intro
                      </h4>
                      <p className="text-lg leading-relaxed text-[#e0e0e0]">
                        {selectedDocument.aiAnalysis.pages[currentPageIndex].audioNavigation?.audioIntro || "No audio intro available."}
                      </p>
                    </div>

                    {/* Layout Notes */}
                    {selectedDocument.aiAnalysis.pages[currentPageIndex].visionAnalysis?.layoutNotes && (
                      <div>
                        <h4 className="text-sm text-[#a0a0a0] uppercase tracking-wider mb-2 font-bold">Layout Notes</h4>
                        <p className="text-[#cccccc] text-lg">
                          {selectedDocument.aiAnalysis.pages[currentPageIndex].visionAnalysis?.layoutNotes}
                        </p>
                      </div>
                    )}

                    {/* Navigation Hints / Sections */}
                    {selectedDocument.aiAnalysis.pages[currentPageIndex].audioNavigation?.navigationHints && (
                      <div>
                        <h4 className="text-sm text-[#a0a0a0] uppercase tracking-wider mb-3 font-bold">Sections Detected</h4>
                        <ul className="space-y-3">
                          {selectedDocument.aiAnalysis.pages[currentPageIndex].audioNavigation?.navigationHints?.map((hint, idx) => (
                            <li key={idx} className="flex gap-4 text-[#cccccc] bg-[#000000] p-4 rounded border border-[#333333]">
                              <span className="text-[#FFFF00] font-bold text-lg">{idx + 1}.</span>
                              <span className="text-lg leading-relaxed">{hint.summary}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {selectedDocument.aiAnalysis.pages.length > 1 && (
                      <div className="mt-4 pt-4 border-t border-[#333333]">
                        <p className="text-md text-[#FFFF00] font-medium">
                          Page {currentPageIndex + 1} of {selectedDocument.aiAnalysis.pages.length}. 
                          Use Left/Right arrow keys to navigate pages.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-lg text-[#a0a0a0]">
                    {selectedDocument.extractedText 
                      ? selectedDocument.extractedText.substring(0, 500) + "..." 
                      : "No analysis available yet."}
                  </p>
                )}
              </>
            ) : (
              <p className="text-lg text-[#a0a0a0]">
                {isLoading ? "Loading document..." : "Select or upload a document to view its summary"}
              </p>
            )}
          </div>
        </section>

        <section className="flex-1 flex flex-col min-h-0" aria-labelledby="chat-heading">
          <h2 id="chat-heading" className="sr-only">Chat with DocuMind</h2>

          <ScrollArea className="flex-1 p-4">
            <div role="log" aria-live="polite" aria-atomic="false" aria-relevant="additions" className="space-y-4">
              {messages.map((message, index) => (
                <div 
                  key={message.id || (message as any)._id || `msg-${index}`} 
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] p-4 rounded-2xl text-lg ${
                    message.role === "user"
                      ? "bg-[#FFFFFF] text-[#000000] rounded-br-md"
                      : "bg-[#1a1a1a] text-[#FFFFFF] border border-[#333333] rounded-bl-md"}`}>
                    <p className="leading-relaxed whitespace-pre-wrap">{message.content}</p>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] p-4 rounded-2xl text-lg bg-[#1a1a1a] text-[#FFFFFF] border border-[#333333] rounded-bl-md">
                    <p className="leading-relaxed flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin text-[#FFFF00]" />
                      Thinking...
                    </p>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} aria-hidden="true" />
            </div>
          </ScrollArea>

          <div className="p-4 border-t border-[#333333] bg-[#0a0a0a]">
            <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }} className="flex gap-3">
              <label htmlFor="chat-input" className="sr-only">Type your message</label>
              <Input
                id="chat-input"
                ref={chatInputRef}
                type="text"
                placeholder="Ask about your document..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 h-14 text-lg px-4 bg-[#1a1a1a] border-2 border-[#333333] text-[#FFFFFF] placeholder:text-[#a0a0a0] focus:ring-4 focus:ring-[#FFFF00] focus:border-[#FFFF00] focus:outline-none"
              />
              <Button
                type="button"
                onClick={toggleRecording}
                className={`h-14 px-4 border-2 focus:ring-4 focus:ring-[#FFFF00] focus:outline-none transition-all ${
                  isRecording 
                    ? "bg-[#ff4444] text-[#FFFFFF] border-[#ff4444] hover:bg-[#cc0000]" 
                    : "bg-[#333333] text-[#FFFFFF] border-[#333333] hover:bg-[#444444]"
                }`}
                aria-label={isRecording ? "Stop recording" : "Start recording"}
              >
                <Mic className={`size-6 ${isRecording ? "animate-pulse" : ""}`} />
              </Button>
              <Button
                type="submit"
                className="h-14 px-6 bg-[#FFFFFF] text-[#000000] focus:ring-4 focus:ring-[#FFFF00] focus:outline-none disabled:opacity-50"
                disabled={!inputValue.trim() || isLoading}
              >
                <Send className="size-6" />
                <span className="sr-only">Send</span>
              </Button>
            </form>
          </div>
        </section>
      </main>
    </div>
  );
}