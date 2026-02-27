import { useState, useEffect } from "react";
import { io } from "socket.io-client";
import {useNavigate} from "react-router-dom"

import { 
  Send, Mail, Type, FileText, CheckCircle, Zap, 
  Hash, Upload, FileUp, Download, AlertCircle, RefreshCw,
  X
} from "lucide-react";
import './App.css';

// Connect to your backend server
const socket = io(import.meta.env.VITE_BACKEND_URL || "http://localhost:5050");

function App() {
  // Mode State
  const [mode, setMode] = useState("single"); // 'single' | 'bulk'

  // Single Email State
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  
  // Bulk Upload State
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkData, setBulkData] = useState([]);
  const [bulkStatus, setBulkStatus] = useState("idle"); // 'idle' | 'parsing' | 'uploading' | 'success' | 'error'

  // Common State
  const [isSent, setIsSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [characterCount, setCharacterCount] = useState(0);

  // Notification State
  const [notification, setNotification] = useState(null);
  const [showNotification, setShowNotification] = useState(false);
  const [activeJobs, setActiveJobs] = useState([]);

  // Socket connection state
  const [isConnected, setIsConnected] = useState(false);

  const navigate=useNavigate()

  // Initialize socket connection
  useEffect(() => {
if (socket.connected) {
      setIsConnected(true);
    }

    const onConnect = () => {
      setIsConnected(true);
      console.log("Connected to server");
    };

    const onDisconnect = () => {
      setIsConnected(false);
      console.log("Disconnected from server");
    };

    // Use named functions so they can be cleaned up reliably
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    // Listen for job completion
    socket.on("jobCompleted", (data) => {
      console.log("Job completed:", data);
      
      if (data.result && data.result.duplicates && data.result.duplicates.length > 0) {
        setNotification({
          type: "warning",
          title: "Duplicates Found",
          message: `${data.result.duplicates.length} duplicate email(s) were skipped.`,
          details: data.result.duplicates.slice(0, 5),
          total: data.result.duplicates.length
        });
        setShowNotification(true);
      }
    });

    // Listen for errors
    socket.on("error", (error) => {
      setNotification({
        type: "error",
        title: "Error",
        message: error.message || "An error occurred",
        details: []
      });
      setShowNotification(true);
    });

    // Get active jobs
    socket.on("activeJobs", (jobs) => {
      setActiveJobs(jobs);
    });

    // Request active jobs periodically
    const interval = setInterval(() => {
      if (isConnected) {
        socket.emit("getActiveJobs");
      }
    }, 2000);

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("jobCompleted");
      socket.off("error");
      socket.off("activeJobs");
      clearInterval(interval);
    };
  }, [isConnected]);

  // Handle single email submission
  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!email || !subject || !body) {
      setNotification({
        type: "error",
        title: "Validation Error",
        message: "Please fill in all fields",
        details: []
      });
      setShowNotification(true);
      return;
    }

    setIsLoading(true);
    
    // Show sending notification
    setNotification({
      type: "info",
      title: "Sending Email",
      message: "Your email is being processed...",
      details: []
    });
    setShowNotification(true);

    socket.emit("sendEmail", { email, subject, body });
    
    setIsSent(true);
    setIsLoading(false);
    navigate("/fetch")

    
    // Clear form
    setTimeout(() => {
      setEmail("");
      setSubject("");
      setBody("");
      setCharacterCount(0);
      setIsSent(false);
    }, 500);
  };

  const handleBodyChange = (e) => {
    setBody(e.target.value);
    setCharacterCount(e.target.value.length);
  };

  // Handle bulk file upload
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setBulkFile(file);
    setBulkStatus("parsing");
    
    // Clear any existing data
    setBulkData([]);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target.result;
        let data = [];
        
        if (file.name.endsWith('.json')) {
          data = JSON.parse(text);
        } else if (file.name.endsWith('.csv')) {
          // Enhanced CSV Parser
          const lines = text.split('\n').filter(line => line.trim());
          const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
          
          // Find indices for required fields
          const emailIndex = headers.findIndex(h => h.includes('email'));
          const subjectIndex = headers.findIndex(h => h.includes('subject'));
          const bodyIndex = headers.findIndex(h => h.includes('body') || h.includes('content') || h.includes('message'));
          
          if (emailIndex === -1) {
            throw new Error("CSV must contain an 'email' column");
          }

          for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            
            const cells = lines[i].split(',').map(cell => cell.trim());
            
            if (cells.length >= headers.length) {
              const email = cells[emailIndex];
              const subject = subjectIndex !== -1 ? cells[subjectIndex] : "No Subject";
              const body = bodyIndex !== -1 ? cells[bodyIndex] : "No Content";
              
              if (email) {
                data.push({
                  email,
                  subject,
                  body
                });
              }
            }
          }
        }

        if (data.length > 0) {
          setBulkData(data);
          setBulkStatus("idle");
          
          // Show success notification
          setNotification({
            type: "success",
            title: "File Parsed Successfully",
            message: `Loaded ${data.length} email(s) from file`,
            details: []
          });
          setShowNotification(true);
        } else {
          setBulkStatus("error");
          setNotification({
            type: "error",
            title: "Invalid File",
            message: "File is empty or has invalid format",
            details: []
          });
          setShowNotification(true);
        }
      } catch (err) {
        console.error(err);
        setBulkStatus("error");
        setNotification({
          type: "error",
          title: "Parsing Error",
          message: err.message,
          details: []
        });
        setShowNotification(true);
      }
    };
    
    reader.onerror = () => {
      setBulkStatus("error");
      setNotification({
        type: "error",
        title: "File Error",
        message: "Failed to read file",
        details: []
      });
      setShowNotification(true);
    };
    
    reader.readAsText(file);
  };

  // Handle bulk email submission
  const handleBulkSubmit = async (e) => {
    e.preventDefault();
    if (bulkData.length === 0) {
      setNotification({
        type: "error",
        title: "No Data",
        message: "Please upload a file with email data",
        details: []
      });
      setShowNotification(true);
      return;
    }

    setIsLoading(true);
    setBulkStatus("uploading");

    // Clear previous notifications
    setShowNotification(false);

    // Show processing notification
    setNotification({
      type: "info",
      title: "Processing Bulk Emails",
      message: `Queuing ${bulkData.length} email(s) for sending...`,
      details: []
    });
    setShowNotification(true);

    socket.emit("sendBulkEmails", { emails: bulkData });
    
    // Reset form after sending
    setTimeout(() => {
      setIsSent(true);
      setIsLoading(false);
      setBulkStatus("success");
      
      // Show success notification
      setNotification({
        type: "success",
        title: "Emails Queued",
        message: `${bulkData.length} email(s) have been queued for processing`,
        details: []
      });
      setShowNotification(false);
      navigate("/fetch")

      
      // Clear bulk data
      setTimeout(() => {
        setBulkFile(null);
        setBulkData([]);
        setBulkStatus("idle");
        setIsSent(false);
      }, 500);
    }, 1000);
  };

  // Download sample CSV
  const downloadSample = () => {
    const csvContent = "email,subject,body\njohn@example.com,Welcome to our service,Hello John, welcome to our platform!\njane@example.com,Important Update,Please review the latest update in your dashboard\nsmith@example.com,Monthly Newsletter,Check out our monthly newsletter for updates";
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sample_emails.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // Close notification
  const closeNotification = () => {
    setShowNotification(false);
    setTimeout(() => setNotification(null), 300);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-black to-gray-950 p-4 md:p-8 flex items-center justify-center">
      <div className="w-full max-w-6xl z-10">
        
        {/* Notification Component */}
        {showNotification && notification && (
          <div className="fixed top-4 right-4 z-50 w-96 animate-fade-in-down">
            <div className={`rounded-xl p-4 border backdrop-blur-sm shadow-2xl ${
              notification.type === "warning" 
                ? "bg-yellow-500/20 border-yellow-500/30" 
                : notification.type === "error"
                ? "bg-red-500/20 border-red-500/30"
                : notification.type === "success"
                ? "bg-emerald-500/20 border-emerald-500/30"
                : "bg-blue-500/20 border-blue-500/30"
            }`}>
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${
                  notification.type === "warning" 
                    ? "bg-yellow-500/20" 
                    : notification.type === "error"
                    ? "bg-red-500/20"
                    : notification.type === "success"
                    ? "bg-emerald-500/20"
                    : "bg-blue-500/20"
                }`}>
                  {notification.type === "warning" ? (
                    <AlertCircle className="w-5 h-5 text-yellow-400" />
                  ) : notification.type === "error" ? (
                    <AlertCircle className="w-5 h-5 text-red-400" />
                  ) : notification.type === "success" ? (
                    <CheckCircle className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between mb-1">
                    <h3 className="font-semibold text-white text-sm">{notification.title}</h3>
                    <button 
                      onClick={closeNotification}
                      className="text-gray-400 hover:text-white ml-2"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-sm text-gray-300 mb-2">{notification.message}</p>
                  
                  {notification.details && notification.details.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs text-gray-400 mb-1">
                        {notification.total > 5 
                          ? `Showing 5 of ${notification.total} duplicates:` 
                          : "Duplicates:"}
                      </p>
                      <div className="max-h-20 overflow-y-auto bg-black/20 rounded p-2">
                        {notification.details.map((email, idx) => (
                          <div key={idx} className="text-xs text-gray-300 truncate mb-1">
                            • {email}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

      

        {/* Main Form Card */}
        <div className="bg-gradient-to-br from-gray-900/80 to-black/60 backdrop-blur-sm 
                      rounded-2xl p-6 md:p-8 border border-gray-800 shadow-2xl">
          
          {/* Header & Mode Switch */}
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">
                {mode === 'single' ? 'Compose New Email' : 'Bulk Email Upload'}
              </h2>
              <p className="text-gray-400">
                {mode === 'single' ? 'Fill in the details below to send your message' : 'Upload a CSV or JSON file to send multiple emails'}
              </p>
            </div>
            
            {/* Toggle Buttons */}
            <div className="flex bg-gray-900 border border-gray-800 rounded-xl p-1">
              <button
                onClick={() => setMode('single')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  mode === 'single' ? 'bg-gray-800 text-white shadow-md' : 'text-gray-400 hover:text-white'
                }`}
              >
                Single Send
              </button>
              <button
                onClick={() => setMode('bulk')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  mode === 'bulk' ? 'bg-purple-600/20 text-purple-300 shadow-md border border-purple-500/20' : 'text-gray-400 hover:text-white'
                }`}
              >
                Bulk Upload
              </button>
            </div>
          </div>

          {/* Connection Status */}
          <div className="mb-6 flex items-center justify-end">
            <div className={`flex items-center gap-2 ${isConnected ? 'text-emerald-400' : 'text-red-400'}`}>
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-red-400'} animate-pulse`}></div>
              <span className="text-xs">{isConnected ? 'Connected to server' : 'Disconnected'}</span>
            </div>
          </div>

          {/* Success Message */}
          {isSent && (
            <div className="mb-6 bg-gradient-to-r from-emerald-500/20 to-green-500/20 backdrop-blur-sm 
                          border border-emerald-500/30 rounded-2xl p-6 flex items-center gap-4 
                          animate-fade-in-up">
              <div className="p-3 bg-emerald-500/20 rounded-xl">
                <CheckCircle className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">
                  {mode === 'single' ? 'Email Sent Successfully!' : 'Bulk Upload Processing!'}
                </h3>
                <p className="text-emerald-300/80 text-sm">
                  {mode === 'single' ? 'Your message is on its way.' : `Successfully queued ${bulkData.length} emails for sending.`}
                </p>
              </div>
            </div>
          )}

          {/* --- SINGLE MODE FORM --- */}
          {mode === 'single' && (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="group">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-3">
                  <Mail className="w-4 h-4 text-purple-400" />
                  Recipient Email
                </label>
                <div className="relative">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-4 py-4 pl-12 bg-gray-900/50 border border-gray-800 
                             rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500/50 
                             text-white placeholder-gray-500 transition-all"
                    placeholder="recipient@example.com"
                  />
                  <Mail className="absolute left-4 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
                </div>
              </div>

              <div className="group">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-3">
                  <Type className="w-4 h-4 text-blue-400" />
                  Subject Line
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    required
                    className="w-full px-4 py-4 pl-12 bg-gray-900/50 border border-gray-800 
                             rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 
                             text-white placeholder-gray-500 transition-all"
                    placeholder="What's this email about?"
                  />
                  <Hash className="absolute left-4 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
                </div>
              </div>

              <div className="group">
                <div className="flex items-center justify-between mb-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                    <FileText className="w-4 h-4 text-cyan-400" />
                    Message Content
                  </label>
                  <span className={`text-sm ${characterCount > 900 ? 'text-red-400' : 'text-gray-400'}`}>
                    {characterCount}/1000
                  </span>
                </div>
                <div className="relative">
                  <textarea
                    value={body}
                    onChange={handleBodyChange}
                    required
                    rows="8"
                    className="w-full px-4 py-4 bg-gray-900/50 border border-gray-800 
                             rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/50 
                             text-white placeholder-gray-500 resize-none transition-all"
                    placeholder="Write your message here..."
                    maxLength={1000}
                  />
                </div>
              </div>

              {/* Single Mode Footer */}
              <div className="flex items-center justify-end pt-6 border-t border-gray-800 gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setEmail("");
                    setSubject("");
                    setBody("");
                    setCharacterCount(0);
                  }}
                  className="px-4 py-2 text-gray-400 hover:text-white text-sm"
                >
                  Clear Form
                </button>
                <button
                  type="submit"
                  disabled={isLoading || !isConnected}
                  className={`px-8 py-3 rounded-xl font-semibold flex items-center justify-end gap-3 
                           transition-all duration-300 ${
                             isLoading || !isConnected
                               ? "bg-gray-800 cursor-not-allowed text-gray-400"
                               : "bg-gradient-to-r from-purple-600 to-pink-600 hover:shadow-lg text-white"
                           }`}
                >
                  {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  {isLoading ? "Sending..." : "Send Email"}
                </button>
              </div>
            </form>
          )}

          {/* --- BULK MODE FORM --- */}
          {mode === 'bulk' && (
            <form onSubmit={handleBulkSubmit} className="space-y-8">
              
              {/* Upload Area */}
              <div className={`relative border-2 ${bulkStatus === 'parsing' ? 'border-purple-500' : 'border-gray-700'} 
                            border-dashed rounded-2xl p-12 text-center
                            hover:border-purple-500/50 hover:bg-gray-900/30 transition-all duration-300 group`}>
                <input 
                  type="file" 
                  accept=".csv,.json"
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  disabled={bulkStatus === 'parsing'}
                />
                <div className="flex flex-col items-center justify-center space-y-4">
                  {bulkStatus === 'parsing' ? (
                    <div className="p-4 bg-purple-500/20 rounded-full">
                      <RefreshCw className="w-8 h-8 text-purple-400 animate-spin" />
                    </div>
                  ) : (
                    <div className="p-4 bg-gray-800 rounded-full group-hover:bg-purple-500/20 transition-colors">
                      <Upload className="w-8 h-8 text-gray-400 group-hover:text-purple-400" />
                    </div>
                  )}
                  <div>
                    <h3 className="text-xl font-semibold text-white mb-1">
                      {bulkFile ? bulkFile.name : "Drop your file here"}
                    </h3>
                    <p className="text-gray-400 text-sm">
                      {bulkFile 
                        ? `${(bulkFile.size / 1024).toFixed(1)} KB • ${bulkData.length} emails loaded`
                        : "Supports .csv or .json files with email, subject, and body columns"}
                    </p>
                    {bulkStatus === 'parsing' && (
                      <p className="text-purple-400 text-sm mt-2">Parsing file...</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Stats / Sample */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-900/50 rounded-xl p-4 border border-gray-800">
                   <div className="flex items-center gap-3 mb-2">
                     <FileUp className="w-4 h-4 text-purple-400" />
                     <span className="text-sm text-gray-300">Emails Loaded</span>
                   </div>
                   <p className="text-2xl font-bold text-white">{bulkData.length}</p>
                   <p className="text-xs text-gray-500 mt-1">Ready to send</p>
                </div>
                <button 
                  type="button"
                  onClick={downloadSample}
                  className="bg-gray-900/50 rounded-xl p-4 border border-gray-800 text-left hover:bg-gray-800 transition-colors"
                >
                   <div className="flex items-center gap-3 mb-2">
                     <Download className="w-4 h-4 text-blue-400" />
                     <span className="text-sm text-gray-300">Download Sample</span>
                   </div>
                   <p className="text-xs text-gray-500">Get CSV template with example data</p>
                </button>
              </div>

              {/* Bulk Footer */}
              <div className="flex items-center justify-end pt-6 border-t border-gray-800 gap-4">
                {bulkData.length === 0 && (
                  <div className="flex items-center gap-2 text-amber-400 text-sm mr-auto">
                    <AlertCircle className="w-4 h-4" />
                    Please upload a file to proceed
                  </div>
                )}
                {bulkData.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setBulkFile(null);
                      setBulkData([]);
                      setBulkStatus("idle");
                    }}
                    className="px-4 py-2 text-gray-400 hover:text-white text-sm"
                  >
                    Clear File
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isLoading || bulkData.length === 0 || !isConnected}
                  className={`px-8 py-3 rounded-xl font-semibold flex items-center justify-end gap-3 
                           transition-all duration-300 ${
                             isLoading || bulkData.length === 0 || !isConnected
                               ? "bg-gray-800 cursor-not-allowed text-gray-500"
                               : "bg-gradient-to-r from-purple-600 to-pink-600 hover:shadow-lg text-white"
                           }`}
                >
                  {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
                  {isLoading ? "Processing..." : `Send ${bulkData.length} Email${bulkData.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </form>
          )}

        </div>
      </div>
    </div>
  );
}

export default App;