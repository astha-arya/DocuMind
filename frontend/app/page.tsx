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

const API_BASE_URL = "http://localhost:5001";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface DocumentListItem {
  id: string;
  name: string;
  uploadedAt: string;
}

interface DocumentDetail {
  id: string;
  name: string;
  uploadedAt: string;
  structuredTree: unknown;
  aiAnalysis: {
    summary: string;
    pages?: { pageNumber: number; summary: string }[];
  };
  chatHistory: Message[];
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
  const [isRecording, setIsRecording] = useState(false);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [lastAnnouncement, setLastAnnouncement] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const speechSynthesisRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Fetch documents list on mount
  useEffect(() => {
    const fetchDocuments = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/documents`);
        if (response.ok) {
          const data = await response.json();
          setDocuments(data);
          // Auto-select first document if available
          if (data.length > 0) {
            fetchDocumentDetail(data[0].id);
          }
        }
      } catch (error) {
        console.error("Failed to fetch documents:", error);
      }
    };
    fetchDocuments();
  }, []);

  // Fetch document detail
  const fetchDocumentDetail = async (docId: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/documents/${docId}`);
      if (response.ok) {
        const data: DocumentDetail = await response.json();
        setSelectedDocument(data);
        setMessages(
          data.chatHistory.length > 0
            ? data.chatHistory
            : [
                {
                  id: "welcome",
                  role: "assistant",
                  content:
                    "Hello! I'm DocuMind, your document assistant. I can help you understand and navigate your uploaded documents. What would you like to know?",
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

  // Text-to-Speech: Speak text
  const speak = useCallback(
    (text: string, onEnd?: () => void) => {
      if (!isSpeechEnabled || typeof window === "undefined") return;

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.9;
      utterance.pitch = 1;
      utterance.volume = 1;

      if (onEnd) {
        utterance.onend = onEnd;
      }

      speechSynthesisRef.current = utterance;
      setLastAnnouncement(text);
      window.speechSynthesis.speak(utterance);
    },
    [isSpeechEnabled]
  );

  // Auto-speak summary when document loads and speech is enabled
  useEffect(() => {
    if (selectedDocument && isSpeechEnabled) {
      const summary = selectedDocument.aiAnalysis?.summary;
      if (summary) {
        speak(summary, () => {
          // After summary finishes, ask about Page 1
          const pages = selectedDocument.aiAnalysis?.pages;
          if (pages && pages.length > 0) {
            setTimeout(() => {
              speak("Would you like to hear the summary for Page 1?");
            }, 500);
          }
        });
      }
    }
  }, [selectedDocument, isSpeechEnabled, speak]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Initialize Speech Recognition
  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = "en-US";

        recognition.onresult = (event: SpeechRecognitionEvent) => {
          const transcript = event.results[0][0].transcript;
          setInputValue((prev) => prev + transcript);
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

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in input
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      const pages = selectedDocument?.aiAnalysis?.pages;

      switch (e.key) {
        case "ArrowRight":
          // Next page summary
          if (pages && currentPageIndex < pages.length - 1) {
            e.preventDefault();
            const nextIndex = currentPageIndex + 1;
            setCurrentPageIndex(nextIndex);
            const pageText = `Page ${pages[nextIndex].pageNumber}: ${pages[nextIndex].summary}`;
            speak(pageText);
          }
          break;
        case "ArrowLeft":
          // Previous page summary
          if (pages && currentPageIndex > 0) {
            e.preventDefault();
            const prevIndex = currentPageIndex - 1;
            setCurrentPageIndex(prevIndex);
            const pageText = `Page ${pages[prevIndex].pageNumber}: ${pages[prevIndex].summary}`;
            speak(pageText);
          }
          break;
        case " ":
          // Spacebar: Repeat last announcement
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

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/documents/${selectedDocument.id}/chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message: questionText }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: data.response || data.message || "I received your question.",
        };
        setMessages((prev) => [...prev, assistantMessage]);

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
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Sorry, I couldn't connect to the server. Please try again.",
      };
      setMessages((prev) => [...prev, errorMessage]);
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
      // Speak the current summary when turning on
      const summary = selectedDocument.aiAnalysis?.summary;
      if (summary) {
        setTimeout(() => {
          speak(summary);
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
      recognitionRef.current.start();
      setIsRecording(true);
    }
  };

  const selectDocument = (doc: DocumentListItem) => {
    fetchDocumentDetail(doc.id);
    setIsSidebarOpen(false);
  };

  return (
    <div className="flex h-screen bg-[#000000] text-[#FFFFFF]">
      {/* Skip to Chat Link - Visually Hidden but accessible to screen readers */}
      <a
        href="#chat-input"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-[#FFFF00] focus:text-[#000000] focus:font-bold focus:rounded-md focus:ring-4 focus:ring-[#FFFFFF] focus:outline-none"
        aria-label="Skip to chat input"
      >
        Skip to Chat
      </a>

      {/* Mobile Sidebar Overlay */}
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
          {/* Sidebar Header */}
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
            <Dialog
              open={isUploadDialogOpen}
              onOpenChange={setIsUploadDialogOpen}
            >
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
                <div className="space-y-4 pt-4">
                  <div className="border-2 border-dashed border-[#333333] rounded-lg p-8 text-center hover:border-[#FFFFFF] transition-colors">
                    <FileText
                      className="size-12 mx-auto mb-4 text-[#a0a0a0]"
                      aria-hidden="true"
                    />
                    <p className="text-lg mb-2">
                      Drag and drop your file here
                    </p>
                    <p className="text-[#a0a0a0] mb-4">or</p>
                    <Button
                      className="h-12 px-6 text-lg bg-[#FFFFFF] text-[#000000] hover:bg-[#e0e0e0] focus:ring-4 focus:ring-[#FFFF00] focus:outline-none"
                      aria-label="Browse files to upload"
                    >
                      Browse Files
                    </Button>
                  </div>
                  <p className="text-sm text-[#a0a0a0]">
                    Supported formats: PDF, DOCX, TXT (Max 10MB)
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
                  <li key={doc.id}>
                    <button
                      onClick={() => selectDocument(doc)}
                      className={`w-full text-left p-4 rounded-lg transition-colors focus:ring-4 focus:ring-[#FFFF00] focus:outline-none ${
                        selectedDocument?.id === doc.id
                          ? "bg-[#333333] border-2 border-[#FFFFFF]"
                          : "bg-[#1a1a1a] hover:bg-[#262626] border-2 border-transparent"
                      }`}
                      aria-label={`Select document: ${doc.name}, uploaded on ${new Date(doc.uploadedAt).toLocaleDateString()}`}
                      aria-current={
                        selectedDocument?.id === doc.id ? "true" : undefined
                      }
                    >
                      <div className="flex items-start gap-3">
                        <FileText
                          className="size-6 mt-1 shrink-0"
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-lg truncate text-[#FFFFFF]">
                            {doc.name}
                          </p>
                          <p className="text-sm text-[#a0a0a0]">
                            {new Date(doc.uploadedAt).toLocaleDateString()}
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
        {/* Header */}
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

          {/* Speech Toggle */}
          <Button
            onClick={toggleSpeech}
            variant="outline"
            className={`h-12 px-4 text-lg font-semibold border-2 focus:ring-4 focus:ring-[#FFFF00] focus:outline-none ${
              isSpeechEnabled
                ? "bg-[#FFFFFF] text-[#000000] border-[#FFFFFF]"
                : "bg-transparent text-[#FFFFFF] border-[#FFFFFF] hover:bg-[#333333]"
            }`}
            aria-label={
              isSpeechEnabled
                ? "Pause speech synthesis"
                : "Play speech synthesis"
            }
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
        </header>

        {/* Document Summary Section */}
        <section
          className="p-6 border-b border-[#333333] bg-[#0a0a0a]"
          aria-labelledby="summary-heading"
        >
          <h2
            id="summary-heading"
            className="text-xl font-bold mb-4 text-[#FFFFFF]"
          >
            Document Summary
          </h2>
          <div className="bg-[#1a1a1a] rounded-lg p-6 border border-[#333333]">
            {selectedDocument ? (
              <>
                <h3 className="text-lg font-semibold mb-2 text-[#FFFFFF]">
                  {selectedDocument.name}
                </h3>
                <p className="text-lg leading-relaxed text-[#e0e0e0]">
                  {selectedDocument.aiAnalysis?.summary ||
                    "No summary available for this document."}
                </p>
                {selectedDocument.aiAnalysis?.pages &&
                  selectedDocument.aiAnalysis.pages.length > 0 && (
                    <p className="mt-4 text-sm text-[#a0a0a0]">
                      Use Left/Right arrow keys to navigate pages. Spacebar to
                      repeat last announcement. Currently on page{" "}
                      {currentPageIndex + 1} of{" "}
                      {selectedDocument.aiAnalysis.pages.length}.
                    </p>
                  )}
              </>
            ) : (
              <p className="text-lg text-[#a0a0a0]">
                {isLoading
                  ? "Loading document..."
                  : "Select a document to view its summary"}
              </p>
            )}
          </div>
        </section>

        {/* Chat Interface */}
        <section
          className="flex-1 flex flex-col min-h-0"
          aria-labelledby="chat-heading"
        >
          <h2 id="chat-heading" className="sr-only">
            Chat with DocuMind
          </h2>

          {/* Chat Messages */}
          <ScrollArea className="flex-1 p-4">
            <div
              role="log"
              aria-live="polite"
              aria-atomic="false"
              aria-relevant="additions"
              aria-label="Chat messages"
              className="space-y-4"
            >
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] p-4 rounded-2xl text-lg ${
                      message.role === "user"
                        ? "bg-[#FFFFFF] text-[#000000] rounded-br-md"
                        : "bg-[#1a1a1a] text-[#FFFFFF] border border-[#333333] rounded-bl-md"
                    }`}
                    role="article"
                    aria-label={`${message.role === "user" ? "You said" : "DocuMind said"}: ${message.content}`}
                  >
                    <p className="leading-relaxed">{message.content}</p>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] p-4 rounded-2xl text-lg bg-[#1a1a1a] text-[#FFFFFF] border border-[#333333] rounded-bl-md">
                    <p className="leading-relaxed animate-pulse">Thinking...</p>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} aria-hidden="true" />
            </div>
          </ScrollArea>

          {/* Chat Input */}
          <div className="p-4 border-t border-[#333333] bg-[#0a0a0a]">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex gap-3"
            >
              <label htmlFor="chat-input" className="sr-only">
                Type your message to DocuMind
              </label>
              <Input
                id="chat-input"
                ref={chatInputRef}
                type="text"
                placeholder="Ask about your document..."
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 h-14 text-lg px-4 bg-[#1a1a1a] border-2 border-[#333333] text-[#FFFFFF] placeholder:text-[#a0a0a0] focus:ring-4 focus:ring-[#FFFF00] focus:border-[#FFFF00] focus:outline-none"
                aria-label="Type your message to DocuMind"
              />
              {/* Microphone Button */}
              <Button
                type="button"
                onClick={toggleRecording}
                className={`h-14 px-4 border-2 focus:ring-4 focus:ring-[#FFFF00] focus:outline-none ${
                  isRecording
                    ? "bg-[#ff4444] text-[#FFFFFF] border-[#ff4444] hover:bg-[#cc3333]"
                    : "bg-[#333333] text-[#FFFFFF] border-[#333333] hover:bg-[#444444]"
                }`}
                aria-label="Hold to record question"
                aria-pressed={isRecording}
              >
                {isRecording ? (
                  <MicOff className="size-6" aria-hidden="true" />
                ) : (
                  <Mic className="size-6" aria-hidden="true" />
                )}
                <span className="sr-only">
                  {isRecording ? "Stop recording" : "Start recording"}
                </span>
              </Button>
              <Button
                type="submit"
                className="h-14 px-6 bg-[#FFFFFF] text-[#000000] hover:bg-[#e0e0e0] focus:ring-4 focus:ring-[#FFFF00] focus:outline-none"
                aria-label="Send message"
                disabled={!inputValue.trim() || isLoading}
              >
                <Send className="size-6" aria-hidden="true" />
                <span className="sr-only">Send</span>
              </Button>
            </form>
            <p className="mt-2 text-sm text-[#a0a0a0]">
              Press Enter to send. Use the microphone to dictate your question.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
