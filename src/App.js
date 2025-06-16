import React, { useState, useEffect, useRef, useCallback } from 'react';

// --- IndexedDB Setup ---
const DB_NAME = 'DokuMiniDB';
const DB_VERSION = 1;
const USER_STORE = 'users';
const DOC_STORE = 'documents';

const openDatabase = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(USER_STORE)) {
        db.createObjectStore(USER_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(DOC_STORE)) {
        const docStore = db.createObjectStore(DOC_STORE, { keyPath: 'id', autoIncrement: true });
        docStore.createIndex('userIdAndFolder', ['userId', 'folder'], { unique: false });
        docStore.createIndex('userId', 'userId', { unique: false });
        docStore.createIndex('uploadDate', 'uploadDate', { unique: false }); // Index for sorting by date
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      reject('Error opening database: ' + event.target.errorCode);
    };
  });
};

// --- New IndexedDB Utility Functions (Promise-based) ---
const getItem = (storeName, key) => {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDatabase();
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };
      request.onerror = (event) => {
        reject(event.target.error);
      };
    } catch (error) {
      reject(error);
    }
  });
};

const addItem = (storeName, item) => {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDatabase();
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.add(item);

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };
      request.onerror = (event) => {
        reject(event.target.error);
      };
    } catch (error) {
      reject(error);
    }
  });
};

const deleteItem = (storeName, key) => {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDatabase();
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);

      request.onsuccess = () => {
        resolve();
      };
      request.onerror = (event) => {
        reject(event.target.error);
      };
    } catch (error) {
      reject(error);
    }
  });
};

const getAllItemsByIndex = (storeName, indexName, range) => {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDatabase();
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(range);

      request.onsuccess = (event) => {
        resolve(event.target.result);
      };
      request.onerror = (event) => {
        reject(event.target.error);
      };
    } catch (error) {
      reject(error);
    }
  });
};

// --- Basic Client-Side Hashing (for demonstration, not cryptographically secure) ---
const sha256 = async (message) => {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hexHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hexHash;
};

// Main App Component
function App() {
  const [user, setUser] = useState(null);
  const [loadingApp, setLoadingApp] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');

  const [currentFolder, setCurrentFolder] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [sortKey, setSortKey] = useState('uploadDate');
  const [sortOrder, setSortOrder] = useState('desc');
  const [searchQuery, setSearchQuery] = useState('');

  const [isLoginMode, setIsLoginMode] = useState(true); // State to toggle between Login and Register form
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false); // State for upload modal
  const [folderCounts, setFolderCounts] = useState({ Pendidikan: 0, Pribadi: 0, Lainnya: 0 }); // New state for dynamic counts
  const [totalDocsCount, setTotalDocsCount] = useState(0); // New state for total documents
  const [totalStorageUsed, setTotalStorageUsed] = useState(0); // New state for total storage in bytes

  const fileInputRef = useRef(null);

  // --- Authentication Logic ---
  useEffect(() => {
    const storedUser = localStorage.getItem('currentUser');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    setLoadingApp(false);
  }, []);

  // Effect to update folder counts and total storage/docs when user logs in or documents change
  useEffect(() => {
    const updateAllCounts = async () => {
      if (user) {
        try {
          const allUserDocs = await getAllItemsByIndex(DOC_STORE, 'userId', IDBKeyRange.only(user.id));
          const counts = { Pendidikan: 0, Pribadi: 0, Lainnya: 0 };
          let currentTotalSize = 0;

          allUserDocs.forEach(doc => {
            if (counts.hasOwnProperty(doc.folder)) {
              counts[doc.folder]++;
            }
            // Use fileSize if it exists, otherwise fallback to the byteLength of fileData
            // This ensures backward compatibility with documents saved before fileSize was added
            const size = doc.fileSize || (doc.fileData ? doc.fileData.byteLength : 0);
            currentTotalSize += size;
          });

          setFolderCounts(counts);
          setTotalDocsCount(allUserDocs.length);
          setTotalStorageUsed(currentTotalSize); // Store in bytes
        } catch (error) {
          console.error("Error updating all counts:", error);
        }
      }
    };
    updateAllCounts();
  }, [user, documents]); // Re-run when user or documents state changes

  const showMessage = (msg, type) => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => {
      setMessage('');
      setMessageType('');
    }, 3000);
  };

  const handleRegister = async () => {
    setAuthLoading(true);
    setMessage('');
    try {
      const existingUser = await getItem(USER_STORE, email);
      if (existingUser) {
        showMessage('Email ini sudah terdaftar!', 'error');
      } else {
        const passwordHash = await sha256(password);
        const newUser = { id: email, email: email, passwordHash: passwordHash };
        await addItem(USER_STORE, newUser);
        showMessage('Registrasi berhasil! Silakan login.', 'success');
        setIsLoginMode(true); // Switch to login mode after successful registration
        setEmail(''); // Clear form
        setPassword('');
      }
    } catch (error) {
      showMessage(`Gagal mendaftar: ${error.message}`, 'error');
      console.error("Registration error:", error);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogin = async () => {
    setAuthLoading(true);
    setMessage('');
    try {
      const storedUser = await getItem(USER_STORE, email);
      if (storedUser) {
        const inputPasswordHash = await sha256(password);
        if (inputPasswordHash === storedUser.passwordHash) {
          const loggedInUser = { id: storedUser.id, email: storedUser.email };
          setUser(loggedInUser);
          localStorage.setItem('currentUser', JSON.stringify(loggedInUser));
          showMessage('Login berhasil!', 'success');
          setEmail(''); // Clear form
          setPassword('');
        } else {
          showMessage('Kata sandi salah.', 'error');
        }
      } else {
        showMessage('Email tidak terdaftar.', 'error');
      }
    } catch (error) {
      showMessage(`Gagal login: ${error.message}`, 'error');
      console.error("Login error:", error);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('currentUser');
    setCurrentFolder(null);
    setDocuments([]);
    setSearchQuery('');
    setFolderCounts({ Pendidikan: 0, Pribadi: 0, Lainnya: 0 }); // Reset counts on logout
    setTotalDocsCount(0);
    setTotalStorageUsed(0);
    showMessage('Logout berhasil.', 'success');
  };

  // --- Document Management Logic (IndexedDB) ---
  useEffect(() => {
    const fetchDocuments = async () => {
      if (!user || !currentFolder) {
        setDocuments([]);
        return;
      }
      try {
        const fetchedDocs = await getAllItemsByIndex(DOC_STORE, 'userIdAndFolder', IDBKeyRange.only([user.id, currentFolder]));
        setDocuments(fetchedDocs || []);
      } catch (error) {
        showMessage(`Terjadi kesalahan saat memuat dokumen: ${error.message}`, 'error');
        console.error("Error fetching documents from IndexedDB:", error);
      }
    };

    fetchDocuments();
  }, [user, currentFolder]);

  const handleFileChange = (e) => {
    if (e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setNewFileName(e.target.files[0].name.split('.').slice(0, -1).join('.') || e.target.files[0].name);
    } else {
      setSelectedFile(null);
      setNewFileName('');
    }
  };

  const handleUploadDocument = async () => {
    if (!selectedFile || !newFileName || !currentFolder || !user) {
      showMessage('Pastikan Anda login, pilih file, masukkan nama dokumen, dan pilih folder.', 'error');
      return;
    }

    setUploading(true);
    setMessage('');

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const fileData = event.target.result;
        const newDoc = {
          userId: user.id,
          folder: currentFolder,
          fileName: newFileName,
          originalFileName: selectedFile.name,
          uploadDate: new Date().toISOString(),
          fileData: fileData,
          mimeType: selectedFile.type,
          fileSize: selectedFile.size, // Store file size for accurate total calculation
        };

        const docId = await addItem(DOC_STORE, newDoc);
        showMessage('Dokumen berhasil diunggah!', 'success');
        setSelectedFile(null);
        setNewFileName('');
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        // Update documents state for immediate re-render, and trigger folder counts update
        setDocuments(prevDocs => [...prevDocs, { ...newDoc, id: docId }]);
        setIsUploadModalOpen(false); // Close modal on successful upload
      };
      reader.onerror = (error) => {
        showMessage(`Gagal membaca file: ${error.message}`, 'error');
        console.error("FileReader error:", error);
        setUploading(false);
      };
      reader.readAsArrayBuffer(selectedFile);
    } catch (error) {
      showMessage(`Terjadi kesalahan saat mengunggah: ${error.message}`, 'error');
      console.error("Upload process error:", error);
      setUploading(false);
    }
    // Do not set uploading to false here, it's handled in onload/onerror
  };


  const handleDeleteDocument = async (docId) => {
    if (!user) {
      showMessage('Anda harus login untuk menghapus dokumen.', 'error');
      return;
    }

    // Replace window.confirm with a custom modal in a real app
    const confirmDelete = window.confirm("Apakah Anda yakin ingin menghapus dokumen ini?");
    if (!confirmDelete) return;

    setMessage('');
    try {
      await deleteItem(DOC_STORE, docId);
      showMessage('Dokumen berhasil dihapus!', 'success');
      // Update state to reflect deletion, and trigger folder counts update
      setDocuments(prevDocs => prevDocs.filter(doc => doc.id !== docId));
    } catch (error) {
      showMessage(`Gagal menghapus dokumen: ${error.message}`, 'error');
      console.error("Delete process error:", error);
    }
  };

  const handleDownloadDocument = (doc) => {
    try {
      const blob = new Blob([doc.fileData], { type: doc.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.originalFileName || doc.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      showMessage('Gagal mengunduh dokumen.', 'error');
      console.error("Download error:", error);
    }
  };

  // Filter documents based on search query
  const filteredDocuments = documents.filter(doc =>
    doc.fileName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Client-side sorting on filtered documents
  const sortedAndFilteredDocuments = [...filteredDocuments].sort((a, b) => {
    if (sortKey === 'uploadDate') {
      const dateA = new Date(a.uploadDate);
      const dateB = new Date(b.uploadDate);
      return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
    } else { // sortKey === 'fileName'
      const nameA = a.fileName.toLowerCase();
      const nameB = b.fileName.toLowerCase();
      if (nameA < nameB) return sortOrder === 'asc' ? -1 : 1;
      if (nameA > nameB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    }
  });

  // Calculate storage usage in MB
  const formatBytes = (bytes, decimals = 2) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  // Get recent documents (last 5, for display on dashboard)
  const getRecentDocuments = useCallback(async () => {
    if (!user) return [];
    try {
        const allUserDocs = await getAllItemsByIndex(DOC_STORE, 'userId', IDBKeyRange.only(user.id));
        // Sort by uploadDate descending and take top 5
        return [...allUserDocs].sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate)).slice(0, 5);
    } catch (error) {
        console.error("Error fetching recent documents:", error);
        return [];
    }
  }, [user]);

  const [recentDocs, setRecentDocs] = useState([]);
  useEffect(() => {
      if (user && !currentFolder) { // Only fetch recent docs on dashboard view
          getRecentDocuments().then(docs => setRecentDocs(docs));
      } else {
          setRecentDocs([]); // Clear when not on dashboard
      }
  }, [user, currentFolder, getRecentDocuments, documents]); // Re-fetch if documents change


  if (loadingApp) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <div className="text-center p-6 bg-white rounded-lg shadow-lg">
          <svg className="animate-spin h-8 w-8 text-rose-600 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="mt-4 text-gray-700">Memuat aplikasi...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-950 to-pink-950 flex flex-col items-center justify-center font-sans text-gray-100 p-4">
      <div className="w-full max-w-6xl bg-white rounded-2xl shadow-xl p-8 md:p-10 relative">

        {/* Top Header Bar */}
        {user && (
           <div className="absolute top-0 left-0 right-0 p-4 bg-gray-900 bg-opacity-80 backdrop-blur-sm rounded-t-2xl flex items-center justify-between z-20">
             <img src="/logoapp.png" alt="DokuMini Logo" className="h-8 w-auto mr-4" onError={(e) => { e.target.onerror = null; e.target.src='https://placehold.co/120x32/1a202c/FFFFFF?text=DokuMini'; }} />
             <div className="flex items-center space-x-4">
                 <span className="text-white text-sm hidden sm:inline-block">Selamat datang, {user.email}</span>
                 <button
                     onClick={handleLogout}
                     disabled={authLoading}
                     className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-1.5 px-4 rounded-md text-sm transition-all duration-300 disabled:opacity-50"
                 >
                     Logout
                 </button>
             </div>
           </div>
        )}


        {/* Main Content Area */}
        <div className={user ? "pt-20" : "pt-0"}> {/* Padding to offset the fixed header */}
          {message && (
            <div className={`p-4 mb-6 rounded-lg text-center font-medium ${messageType === 'success' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'} shadow-md`}>
              {message}
            </div>
          )}

          {user ? (
            /* Dashboard Content After Login */
            <div>
              {!currentFolder ? (
                /* Main Dashboard View (Archive Folders, Summary, Recent Docs) */
                <div>
                  {/* Welcome & Date Section */}
                  <div className="mb-8 p-6 bg-gradient-to-r from-blue-600 to-indigo-700 text-white rounded-xl shadow-lg">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-3xl font-extrabold">DokuMini</h2>
                      <p className="text-base font-light opacity-80">{new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                    </div>
                    <div className="flex items-center mb-4">
                        <span className="text-4xl mr-3">👋</span>
                        <p className="text-xl font-semibold">Selamat datang, {user.email}!</p>
                    </div>
                    <p className="text-sm font-light opacity-90">Kelola semua arsip pribadi Anda di satu tempat yang aman.</p>
                  </div>

                  {/* Summary Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
                    <SummaryCard
                      title="Total Dokumen"
                      value={totalDocsCount}
                      unit="Files"
                      icon="📄"
                      bgColor="bg-blue-100"
                      textColor="text-blue-800"
                    />
                    <SummaryCard
                      title="Penyimpanan Digunakan"
                      value={formatBytes(totalStorageUsed)}
                      unit="Used"
                      icon="💾"
                      bgColor="bg-indigo-100"
                      textColor="text-indigo-800"
                    />
                    <SummaryCard
                      title="Tanggal Hari Ini"
                      value={new Date().toLocaleDateString('en-GB')}
                      unit="Date"
                      icon="📅"
                      bgColor="bg-purple-100"
                      textColor="text-purple-800"
                    />
                  </div>

                  {/* Archive Folders Section */}
                  <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-3 border-gray-200">Folder Arsip Anda</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <FolderCard
                      title="Arsip Pendidikan"
                      description="Catatan akademik, sertifikat, dan dokumen pendidikan."
                      docCount={folderCounts.Pendidikan}
                      icon="🎓"
                      onClick={() => setCurrentFolder('Pendidikan')}
                    />
                    <FolderCard
                      title="Arsip Pribadi"
                      description="Dokumen identitas, catatan pribadi, dan file rahasia."
                      docCount={folderCounts.Pribadi}
                      icon="👤"
                      onClick={() => setCurrentFolder('Pribadi')}
                    />
                    <FolderCard
                      title="Arsip Lainnya"
                      description="Dokumen serba-serbi, referensi, dan file umum lainnya."
                      docCount={folderCounts.Lainnya}
                      icon="📁"
                      onClick={() => setCurrentFolder('Lainnya')}
                    />
                  </div>

                  {/* Recent Documents Section */}
                  <div className="mt-12">
                    <div className="flex justify-between items-center mb-6">
                      <h2 className="text-2xl font-bold text-gray-800">Dokumen Terbaru</h2>
                    </div>
                    {recentDocs.length === 0 ? (
                      <p className="text-gray-600 italic text-center py-8">Belum ada dokumen terbaru yang diunggah.</p>
                    ) : (
                      <div className="bg-white rounded-lg shadow-md border border-gray-100">
                        {recentDocs.map((doc, index) => (
                          <div
                            key={doc.id}
                            className={`flex items-center justify-between p-4 ${index === recentDocs.length - 1 ? '' : 'border-b border-gray-100'}`}
                          >
                            <div className="flex-grow">
                              <p className="text-base font-medium text-gray-800">{doc.fileName}</p>
                              <p className="text-xs text-gray-500">Diunggah: {new Date(doc.uploadDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                            </div>
                            <button
                              onClick={() => handleDownloadDocument(doc)}
                              className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold py-1.5 px-3 rounded-md text-xs transition-colors duration-200"
                            >
                              Unduh
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Specific Folder Document List View */
                <div>
                    <p className="text-gray-500 text-sm mb-4 cursor-pointer hover:text-rose-600" onClick={() => setCurrentFolder(null)}>Beranda &gt; Dokumen &gt; <span className="font-semibold text-gray-700">{currentFolder}</span></p>

                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8">
                      <h2 className="text-3xl font-bold text-gray-800 mb-4 md:mb-0">{currentFolder}</h2>
                      <div className="flex space-x-3 w-full md:w-auto">
                          <button
                              onClick={() => setCurrentFolder(null)}
                              className="bg-gray-800 hover:bg-gray-900 text-white font-semibold py-2.5 px-6 rounded-lg shadow-md transition-all duration-300 ease-in-out transform hover:scale-105 flex items-center justify-center flex-1 md:flex-none"
                          >
                              &larr; Kembali
                          </button>
                          <button
                              onClick={() => setIsUploadModalOpen(true)}
                              className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2.5 px-6 rounded-lg shadow-md transition-all duration-300 ease-in-out transform hover:scale-105 flex items-center justify-center flex-1 md:flex-none"
                          >
                              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                              Unggah Dokumen
                          </button>
                      </div>
                  </div>

                  {/* Search and Sort Section */}
                  <div className="flex flex-col md:flex-row items-center gap-4 mb-6">
                      <input
                          type="text"
                          placeholder="Cari berdasarkan nama dokumen..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="flex-grow p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400 w-full text-gray-900 placeholder-gray-500"
                      />
                      <div className="flex items-center space-x-3 w-full md:w-auto">
                          <span className="font-semibold text-gray-700 whitespace-nowrap hidden md:block">Urutkan:</span>
                          <select
                              value={sortKey}
                              onChange={(e) => setSortKey(e.target.value)}
                              className="p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400 w-full md:w-auto text-gray-900"
                          >
                              <option value="uploadDate">Tanggal Unggah</option>
                              <option value="fileName">Nama Dokumen</option>
                          </select>
                          <button
                              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                              className="p-3 bg-gray-200 rounded-lg hover:bg-gray-300 text-gray-700 transition duration-200 shadow-sm hover:shadow-md w-full md:w-auto flex items-center justify-center"
                          >
                              {sortOrder === 'asc' ? '⬆️ Asc' : '⬇️ Desc'}
                          </button>
                      </div>
                  </div>

                  {/* Document List Table Header */}
                  <div className="hidden md:grid grid-cols-5 gap-4 py-3 px-5 bg-gray-100 text-gray-600 font-semibold rounded-lg shadow-sm mb-3">
                      <div className="col-span-2">Nama File</div>
                      <div className="col-span-1">Tanggal Modifikasi</div>
                      <div className="col-span-1">Ukuran</div>
                      <div className="col-span-1 text-center">Aksi</div>
                  </div>

                  {/* Document List */}
                  {sortedAndFilteredDocuments.length === 0 ? (
                      <p className="text-gray-600 italic text-center py-10">Tidak ada dokumen yang ditemukan di folder ini atau cocok dengan pencarian Anda.</p>
                  ) : (
                    <div className="space-y-3">
                        {sortedAndFilteredDocuments.map((doc) => (
                            <div
                                key={doc.id}
                                className="bg-white p-5 rounded-lg shadow-sm grid grid-cols-1 md:grid-cols-5 gap-4 items-center border border-gray-100 hover:shadow-md transition-all duration-200"
                            >
                                <div className="col-span-2">
                                    <p className="text-base font-medium text-gray-800 break-words">{doc.fileName}</p>
                                    <p className="text-xs text-gray-500 md:hidden mt-1">Diunggah: {new Date(doc.uploadDate).toLocaleDateString('id-ID', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
                                </div>
                                <div className="text-sm text-gray-500 col-span-1 hidden md:block">
                                    {new Date(doc.uploadDate).toLocaleDateString('id-ID', { year: 'numeric', month: 'short', day: 'numeric' })}
                                </div>
                                <div className="text-sm text-gray-500 col-span-1">
                                    {formatBytes(doc.fileSize || (doc.fileData ? doc.fileData.byteLength : 0))}
                                </div>
                                <div className="flex space-x-2 mt-3 md:mt-0 col-span-1 justify-start md:justify-center">
                                    <button
                                        onClick={() => handleDownloadDocument(doc)}
                                        className="bg-rose-500 hover:bg-rose-600 text-white font-semibold py-1.5 px-3 rounded-lg text-xs shadow-sm transition-all duration-300 ease-in-out transform hover:scale-105"
                                    >
                                        Unduh
                                    </button>
                                    <button
                                        onClick={() => handleDeleteDocument(doc.id)}
                                        className="bg-gray-700 hover:bg-gray-800 text-white font-semibold py-1.5 px-3 rounded-lg text-xs shadow-sm transition-all duration-300 ease-in-out transform hover:scale-105"
                                    >
                                        Hapus
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                  )}
                  {/* Storage Usage */}
                  <div className="text-right text-gray-500 text-sm mt-6">
                      {sortedAndFilteredDocuments.length} file(s) | {formatBytes(sortedAndFilteredDocuments.reduce((sum, doc) => sum + (doc.fileSize || (doc.fileData ? doc.fileData.byteLength : 0)), 0))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Login / Register Form */
            <div className="mt-4 p-4 md:p-8">
              <div className="text-center mb-8">
                  <img
                      src="/logoapp.png"
                      alt="DokuMini Logo"
                      className="mx-auto h-24"
                      onError={(e) => {
                          e.target.onerror = null;
                          e.target.src='https://placehold.co/200x96/FFFFFF/111827?text=DokuMini';
                      }}
                  />
              </div>
              <h2 className="text-3xl font-extrabold text-gray-800 mb-2 text-center">
                  Welcome to DokuMini
              </h2>
              <p className="text-2xl font-bold text-gray-800 mb-8 text-center">{isLoginMode ? 'Sign in' : 'Sign up'}</p>

              <div className="space-y-5 max-w-sm mx-auto">
                <input
                  type="email"
                  placeholder="Enter your username or email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-400 focus:border-transparent transition duration-200 placeholder-gray-500 text-gray-900"
                  autoCapitalize="none"
                />
                <input
                  type="password"
                  placeholder="Enter your Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-rose-400 focus:border-transparent transition duration-200 placeholder-gray-500 text-gray-900"
                />
                <button
                  onClick={isLoginMode ? handleLogin : handleRegister}
                  disabled={authLoading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-6 rounded-lg shadow-md transition-all duration-300 ease-in-out transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed text-lg"
                >
                  {authLoading ? 'Memproses...' : (isLoginMode ? 'Sign in' : 'Sign up')}
                </button>
              </div>
              <div className="text-center mt-6 text-gray-600">
                  {isLoginMode ? (
                      <span>No Account? <button onClick={() => setIsLoginMode(false)} className="text-rose-600 hover:underline font-semibold">Sign up</button></span>
                  ) : (
                      <span>Have an Account? <button onClick={() => setIsLoginMode(true)} className="text-rose-600 hover:underline font-semibold">Sign in</button></span>
                  )}
              </div>
              <p className="text-center text-xs text-gray-500 mt-6">
                * Aplikasi ini menyimpan semua data di browser Anda. Tidak ada sinkronisasi cloud.
              </p>
            </div>
          )}
        </div>

        {/* Upload Modal */}
        {isUploadModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-md relative">
              <button
                onClick={() => setIsUploadModalOpen(false)}
                className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 text-2xl font-bold"
              >
                &times;
              </button>
              <h3 className="text-2xl font-bold text-gray-800 mb-6 text-center">Unggah Dokumen</h3>

              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center mb-6 bg-gray-50">
                <svg className="mx-auto w-16 h-16 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 0115.9 6L16 6a3 3 0 013 3v10a2 2 0 01-2 2H7a2 2 0 01-2-2v-1"></path></svg>
                <p className="text-gray-600 mb-4">Tarik dan lepas file di sini atau</p>
                <input
                  type="file"
                  onChange={handleFileChange}
                  ref={fileInputRef}
                  className="hidden"
                  id="file-upload"
                />
                <label htmlFor="file-upload" className="inline-block bg-rose-500 hover:bg-rose-600 text-white font-semibold py-2 px-5 rounded-lg cursor-pointer transition-colors duration-200">
                  Pilih File
                </label>
              </div>

              {selectedFile && (
                <p className="text-gray-700 mb-4">File terpilih: <span className="font-semibold">{selectedFile.name}</span></p>
              )}

              <div className="space-y-4 mb-6">
                <input
                  type="text"
                  placeholder="Nama Dokumen"
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400 text-gray-900 placeholder-gray-500"
                />
                <textarea
                  placeholder="Deskripsi (opsional)"
                  rows="3"
                  className="w-full p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400 text-gray-900 placeholder-gray-500"
                ></textarea> {/* This description is not currently saved, just a UI element */}
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => { setIsUploadModalOpen(false); setSelectedFile(null); setNewFileName(''); if(fileInputRef.current) fileInputRef.current.value = ''; }}
                  className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2.5 px-6 rounded-lg transition-colors duration-200"
                >
                  Batal
                </button>
                <button
                  onClick={handleUploadDocument}
                  disabled={uploading || !selectedFile || !newFileName}
                  className="bg-rose-600 hover:bg-rose-700 text-white font-bold py-2.5 px-6 rounded-lg shadow-md transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploading ? 'Mengunggah...' : 'Unggah'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Summary Card Component
function SummaryCard({ title, value, unit, icon, bgColor, textColor }) {
    return (
        <div className={`${bgColor} ${textColor} p-6 rounded-xl shadow-lg flex flex-col items-start`}>
            <span className="text-4xl mb-3">{icon}</span>
            <h3 className="text-xl font-semibold mb-1">{title}</h3>
            <p className="text-3xl font-bold">{value}</p>
            <p className="text-sm opacity-90">{unit}</p>
        </div>
    );
}

// Folder Card Component
function FolderCard({ title, onClick, icon, description, docCount }) {
  return (
    <div
      onClick={onClick}
      className="flex flex-col items-start p-6 bg-white rounded-xl shadow-md hover:shadow-lg transition-all duration-300 ease-in-out transform hover:-translate-y-1 cursor-pointer group border border-gray-100"
    >
      <div className="flex items-center justify-between w-full mb-3">
        <span className="text-5xl group-hover:scale-110 transition-transform duration-300 text-rose-500">{icon}</span>
        <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h.01M12 12h.01M19 12h.01"></path></svg>
      </div>
      <h3 className="text-xl font-semibold text-gray-800 mb-2 text-left">{title}</h3>
      <p className="text-sm text-gray-500 mb-4 text-left flex-grow">{description}</p>
      <div className="w-full">
        <p className="text-sm text-gray-600 font-medium mb-4">{docCount} Dokumen</p>
        <div className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 px-4 rounded-lg shadow-md transition-all duration-300 ease-in-out transform group-hover:scale-105 flex items-center justify-center w-full">
          Buka Folder
          <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
        </div>
      </div>
    </div>
  );
}

export default App;
