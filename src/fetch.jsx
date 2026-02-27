import React, { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { 
  Mail, Database, Server, User, Clock, ChevronRight, RefreshCw, 
  Search, Zap, ChevronLeft, ChevronsLeft, ChevronsRight, AlertCircle,
  X, CheckCircle
} from "lucide-react";

const socket = io(import.meta.env.VITE_BACKEND_URL || "http://localhost:5050");

export default function FetchEmails() {
  const [mysqlData, setMysqlData] = useState([]);
  const [mongoData, setMongoData] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  
  // Pagination State
  const [page, setPage] = useState(1);
  const [limit] = useState(12);
  const [mysqlMeta, setMysqlMeta] = useState({ total: 0, totalPages: 1 });
  const [mongoMeta, setMongoMeta] = useState({ total: 0, totalPages: 1 });

  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // Notification State
  const [notification, setNotification] = useState(null);
  const [showNotification, setShowNotification] = useState(false);
  
  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  
  // Real-time stats
  const [realtimeStats, setRealtimeStats] = useState({
    mysql: 0,
    mongodb: 0,
    lastUpdated: null
  });

  // Determine current max pages based on active tab
  const getMaxPages = () => {
    if (activeTab === 'mysql') return mysqlMeta.totalPages;
    if (activeTab === 'mongodb') return mongoMeta.totalPages;
    return Math.max(mysqlMeta.totalPages, mongoMeta.totalPages);
  };

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

    // Listen for email queued events (real-time updates)
    socket.on("emailQueued", (data) => {
      console.log("Email queued:", data);
      
      // Show notification
      setNotification({
        type: "info",
        title: data.type === 'bulk' ? 'Bulk Upload Started' : 'Email Queued',
        message: data.type === 'bulk' 
          ? `${data.count} emails queued for processing` 
          : 'Email added to processing queue',
        details: []
      });
      setShowNotification(true);
      
      // Set refreshing state
      setRefreshing(true);
      
      // Wait a moment for processing, then refresh data
      setTimeout(() => {
        socket.emit("getMysqlEmails", { page, limit });
        socket.emit("getMongoEmails", { page, limit });
        setRefreshing(false);
      }, 1000);
    });

    // Listen for job completion
    socket.on("jobCompleted", (data) => {
      console.log("Job completed:", data);
      
      if (data.result && data.result.duplicates && data.result.duplicates.length > 0) {
        setNotification({
          type: "warning",
          title: "Duplicates Found",
          message: `${data.result.duplicates.length} duplicate email(s) were skipped during processing.`,
          details: data.result.duplicates.slice(0, 3),
          total: data.result.duplicates.length
        });
        setShowNotification(true);
      }
      
      // Refresh data
      socket.emit("getMysqlEmails", { page, limit });
      socket.emit("getMongoEmails", { page, limit });
    });

    // Listen for MySQL data
    socket.on("mysqlEmails", (data) => {
      setMysqlData(data.emails);
      setMysqlMeta({ total: data.total, totalPages: data.totalPages });
      setIsLoading(false);
      setRefreshing(false);
      
      // Update real-time stats
      setRealtimeStats(prev => ({
        ...prev,
        mysql: data.total,
        lastUpdated: new Date()
      }));
    });

    // Listen for MongoDB data
    socket.on("mongoEmails", (data) => {
      setMongoData(data.emails);
      setMongoMeta({ total: data.total, totalPages: data.totalPages });
      setIsLoading(false);
      setRefreshing(false);
      
      // Update real-time stats
      setRealtimeStats(prev => ({
        ...prev,
        mongodb: data.total,
        lastUpdated: new Date()
      }));
    });

    // Listen for errors
    socket.on("error", (err) => {
      console.error("Socket error:", err);
      setNotification({
        type: "error",
        title: "Error",
        message: err.message || "An error occurred",
        details: []
      });
      setShowNotification(true);
      setIsLoading(false);
      setRefreshing(false);
    });

    // Initial data fetch
    const fetchData = () => {
      setIsLoading(true);
      socket.emit("getMysqlEmails", { page, limit });
      socket.emit("getMongoEmails", { page, limit });
    };

    fetchData();

    // Refresh data every 30 seconds for real-time updates
    const refreshInterval = setInterval(() => {
      if (isConnected) {
        socket.emit("getMysqlEmails", { page, limit });
        socket.emit("getMongoEmails", { page, limit });
      }
    }, 30000);

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("emailQueued");
      socket.off("jobCompleted");
      socket.off("mysqlEmails");
      socket.off("mongoEmails");
      socket.off("error");
      clearInterval(refreshInterval);
    };
  }, [page, limit, isConnected]);

  // Handle Page Changes
  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= getMaxPages()) {
      setPage(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Search filtering
  const filteredMysqlData = mysqlData.filter(email =>
    email.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    email.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    email.body?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredMongoData = mongoData.filter(email =>
    email.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    email.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    email.body?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getTimeAgo = (timestamp) => {
    if (!timestamp) return "Just now";
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 4) return `${weeks}w ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  };

  const getLastUpdateTime = () => {
    if (!realtimeStats.lastUpdated) return "Never";
    return getTimeAgo(realtimeStats.lastUpdated);
  };

  // Refresh data manually
  const refreshData = () => {
    setRefreshing(true);
    socket.emit("getMysqlEmails", { page, limit });
    socket.emit("getMongoEmails", { page, limit });
    
    // Auto reset refreshing state
    setTimeout(() => setRefreshing(false), 2000);
  };

  const EmailCard = ({ email, type }) => (
    <div className="group relative bg-gradient-to-br from-gray-900/80 to-black/80 backdrop-blur-sm 
                    rounded-2xl p-6 border border-gray-800 hover:border-purple-500/50 
                    transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl hover:shadow-purple-500/10">
      <div className="absolute top-5 right-4">
        <div className={`p-2 rounded-full ${type === 'mysql' ? 'bg-blue-500/20' : 'bg-emerald-500/20'}`}>
          {type === 'mysql' ? 
            <Database className="w-4 h-4 text-blue-400" /> : 
            <Server className="w-4 h-4 text-emerald-400" />
          }
        </div>
      </div>

      
      <div className="flex items-start space-x-4">
        <div className="flex-shrink-0">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl 
                        flex items-center justify-center group-hover:rotate-12 transition-transform">
            <Mail className="w-6 h-6 text-white" />
          </div>
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-white truncate group-hover:text-purple-300 transition-colors">
              {email.subject || "No Subject"}
            </h3>
            <span className="text-xs text-gray-400 flex items-center mr-9">
              <Clock className="w-3 h-3 mr-1" />
               {getTimeAgo(email.created_at)}
            </span>
          </div>
          
          <div className="flex items-center mb-4">
            <User className="w-4 h-4 text-gray-400 mr-2" />
            <span className="text-sm text-gray-300 truncate">{email.email}</span>
            <span className={`ml-2 px-2 py-1 text-xs rounded-full ${type === 'mysql' ? 'bg-blue-500/20 text-blue-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
              {type === 'mysql' ? 'MySQL' : 'MongoDB'}
            </span>
          </div>
          
          <p className="text-gray-400 text-sm line-clamp-2 leading-relaxed">
            {email.body || "No content available"}
          </p>
          
          <div className="mt-6 pt-4 border-t border-gray-800 flex items-center justify-between">
            <span className="text-xs text-gray-500">
              ID: {email.id || email._id}
            </span>
            <button className="flex items-center text-sm text-purple-400 hover:text-purple-300 
                             transition-colors group/btn">
              View Details
              <ChevronRight className="w-4 h-4 ml-1 group-hover/btn:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-black to-gray-950 p-4 md:p-8">
      
      {/* Notification Component */}
      {showNotification && notification && (
        <div className="fixed top-4 right-4 z-50 w-96 animate-fade-in-down">
          <div className={`rounded-xl p-4 border backdrop-blur-sm shadow-2xl ${
            notification.type === "warning" 
              ? "bg-yellow-500/20 border-yellow-500/30" 
              : notification.type === "error"
              ? "bg-red-500/20 border-red-500/30"
              : "bg-blue-500/20 border-blue-500/30"
          }`}>
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${
                notification.type === "warning" 
                  ? "bg-yellow-500/20" 
                  : notification.type === "error"
                  ? "bg-red-500/20"
                  : "bg-blue-500/20"
              }`}>
                {notification.type === "warning" ? (
                  <AlertCircle className="w-5 h-5 text-yellow-400" />
                ) : notification.type === "error" ? (
                  <AlertCircle className="w-5 h-5 text-red-400" />
                ) : (
                  <CheckCircle className="w-5 h-5 text-blue-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between mb-1">
                  <h3 className="font-semibold text-white text-sm">{notification.title}</h3>
                  <button 
                    onClick={() => setShowNotification(false)}
                    className="text-gray-400 hover:text-white ml-2"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-sm text-gray-300 mb-2">{notification.message}</p>
                
                {notification.details && notification.details.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-gray-400 mb-1">
                      {notification.total > 3 
                        ? `Showing 3 of ${notification.total} duplicates:` 
                        : "Duplicates:"}
                    </p>
                    <div className="max-h-16 overflow-y-auto bg-black/20 rounded p-2">
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

      {/* Header */}
      <div className="max-w-7xl mx-auto">
        <header className="mb-8 md:mb-12">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-3 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl">
                  <Zap className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-white via-purple-200 to-pink-200 bg-clip-text text-transparent">
                    Email Dashboard
                  </h1>
                  <div className="flex items-center gap-2 mt-1">
                    <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-red-400'} animate-pulse`}></div>
                    <span className="text-xs text-gray-400">
                      {isConnected ? 'Connected' : 'Disconnected'} • Updated {getLastUpdateTime()}
                      {refreshing && ' • Refreshing...'}
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-gray-400">Real-time email monitoring from multiple databases</p>
            </div>
            
            <div className="flex items-center gap-4">
              {/* Search Input */}
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search emails..."
                  className="px-4 py-2.5 pl-10 bg-gray-900/50 border border-gray-800 rounded-xl 
                           text-white placeholder-gray-500 focus:outline-none focus:ring-2 
                           focus:ring-purple-500/50 w-48 md:w-64"
                />
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
              </div>
              
              <button 
                onClick={refreshData}
                disabled={refreshing}
                className={`px-4 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 
                         rounded-xl hover:opacity-90 transition-opacity flex items-center gap-2 
                         text-white ${refreshing ? 'opacity-70' : ''}`}
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="bg-gray-900/40 backdrop-blur-sm rounded-xl p-4 border border-gray-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">MySQL Total</p>
                  <p className="text-2xl font-bold text-white">{mysqlMeta.total.toLocaleString()}</p>
                  <p className="text-xs text-gray-500 mt-1">{mysqlMeta.totalPages} pages</p>
                </div>
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  <Database className="w-5 h-5 text-blue-400" />
                </div>
              </div>
            </div>
            
            <div className="bg-gray-900/40 backdrop-blur-sm rounded-xl p-4 border border-gray-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">MongoDB Total</p>
                  <p className="text-2xl font-bold text-white">{mongoMeta.total.toLocaleString()}</p>
                  <p className="text-xs text-gray-500 mt-1">{mongoMeta.totalPages} pages</p>
                </div>
                <div className="p-2 bg-emerald-500/20 rounded-lg">
                  <Server className="w-5 h-5 text-emerald-400" />
                </div>
              </div>
            </div>
            
            <div className="bg-gray-900/40 backdrop-blur-sm rounded-xl p-4 border border-gray-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">Combined Total</p>
                  <p className="text-2xl font-bold text-white">{(mysqlMeta.total + mongoMeta.total).toLocaleString()}</p>
                  <p className="text-xs text-gray-500 mt-1">Across both databases</p>
                </div>
                <div className="p-2 bg-purple-500/20 rounded-lg">
                  <Mail className="w-5 h-5 text-purple-400" />
                </div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex space-x-1 p-1 bg-gray-900/50 backdrop-blur-sm rounded-xl border border-gray-800 w-fit mb-6">
            {['all', 'mysql', 'mongodb'].map((tab) => (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); setPage(1); }}
                className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {tab === 'all' ? 'All Emails' : tab === 'mysql' ? 'MySQL Only' : 'MongoDB Only'}
              </button>
            ))}
          </div>
        </header>

        {/* Content */}
        <main className="space-y-8 min-h-[600px]">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-gray-400">Loading Page {page}...</p>
              </div>
            </div>
          ) : (
            <>
              {/* MySQL Section */}
              {(activeTab === 'all' || activeTab === 'mysql') && (
                <section className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Database className="w-6 h-6 text-blue-400" />
                      <h2 className="text-2xl font-bold text-white">MySQL Results</h2>
                      <span className="text-gray-500 text-sm">Page {page} of {mysqlMeta.totalPages}</span>
                      <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">
                        Showing {filteredMysqlData.length} of {mysqlData.length} emails
                      </span>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                    {filteredMysqlData.length > 0 ? (
                        filteredMysqlData.map((email) => (
                        <EmailCard key={email.id} email={email} type="mysql" />
                        ))
                    ) : (
                        <div className="col-span-3 text-center py-12">
                          <Database className="w-16 h-16 text-gray-700 mx-auto mb-4" />
                          <p className="text-gray-500 text-lg">No MySQL emails found</p>
                          {searchQuery && (
                            <p className="text-gray-600 text-sm mt-2">
                              Try a different search term or clear the search
                            </p>
                          )}
                        </div>
                    )}
                  </div>
                </section>
              )}

              {/* MongoDB Section */}
              {(activeTab === 'all' || activeTab === 'mongodb') && (
                <section className="space-y-6 pt-8 border-t border-gray-800">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Server className="w-6 h-6 text-emerald-400" />
                      <h2 className="text-2xl font-bold text-white">MongoDB Results</h2>
                      <span className="text-gray-500 text-sm">Page {page} of {mongoMeta.totalPages}</span>
                      <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">
                        Showing {filteredMongoData.length} of {mongoData.length} emails
                      </span>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                    {filteredMongoData.length > 0 ? (
                        filteredMongoData.map((email) => (
                        <EmailCard key={email._id} email={email} type="mongodb" />
                        ))
                    ) : (
                        <div className="col-span-3 text-center py-12">
                          <Server className="w-16 h-16 text-gray-700 mx-auto mb-4" />
                          <p className="text-gray-500 text-lg">No MongoDB emails found</p>
                          {searchQuery && (
                            <p className="text-gray-600 text-sm mt-2">
                              Try a different search term or clear the search
                            </p>
                          )}
                        </div>
                    )}
                  </div>
                </section>
              )}
            </>
          )}
        </main>

        {/* Pagination Controls */}
        <div className="mt-12 pt-8 border-t border-gray-800 flex flex-col items-center justify-center gap-4">
          <div className="flex items-center gap-2 bg-gray-900/50 p-2 rounded-xl border border-gray-800">
            {/* First Page */}
            <button
              onClick={() => handlePageChange(1)}
              disabled={page === 1}
              className="p-2 rounded-lg hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent text-white transition-colors"
              title="First Page"
            >
              <ChevronsLeft className="w-5 h-5" />
            </button>

            {/* Previous Page */}
            <button
              onClick={() => handlePageChange(page - 1)}
              disabled={page === 1}
              className="p-2 rounded-lg hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent text-white transition-colors"
              title="Previous Page"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            {/* Page Indicator */}
            <div className="px-6 py-2 bg-gray-800 rounded-lg text-sm font-medium text-white min-w-[120px] text-center">
               Page <span className="text-purple-400">{page}</span> of <span className="text-gray-400">{getMaxPages()}</span>
            </div>

            {/* Next Page */}
            <button
              onClick={() => handlePageChange(page + 1)}
              disabled={page >= getMaxPages()}
              className="p-2 rounded-lg hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent text-white transition-colors"
              title="Next Page"
            >
              <ChevronRight className="w-5 h-5" />
            </button>

             {/* Last Page */}
             <button
              onClick={() => handlePageChange(getMaxPages())}
              disabled={page >= getMaxPages()}
              className="p-2 rounded-lg hover:bg-gray-800 disabled:opacity-30 disabled:hover:bg-transparent text-white transition-colors"
              title="Last Page"
            >
              <ChevronsRight className="w-5 h-5" />
            </button>
          </div>
          <p className="text-gray-500 text-xs">Showing {limit} items per page • Total: {(mysqlMeta.total + mongoMeta.total).toLocaleString()} emails</p>
        </div>
      </div>
    </div>
  );
}