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
        docStore.createIndex('uploadDate', 'uploadDate', { unique: false });
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

// --- IndexedDB Utility Functions ---
const getItem = (storeName, key) => {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDatabase();
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error);
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
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error);
    } catch (error) {
      reject(error);
    }
  });
};

const updateItem = (storeName, item) => {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDatabase();
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      // .put() updates if key exists, or adds if it doesn't.
      const request = store.put(item);
      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
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
      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
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
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error);
    } catch (error) {
      reject(error);
    }
  });
};

const sha256 = async (message) => {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

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
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [folderCounts, setFolderCounts] = useState({ Pendidikan: 0, Pribadi: 0, Lainnya: 0 });
  const [totalDocsCount, setTotalDocsCount] = useState(0);
  const [totalStorageUsed, setTotalStorageUsed] = useState(0);
  const [websiteName, setWebsiteName] = useState('DokuMini');
  const [isEditingName, setIsEditingName] = useState(false);
  const fileInputRef = useRef(null);

  // State for editing a document
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState(null);

  useEffect(() => {
    const storedUser = localStorage.getItem('currentUser');
    if (storedUser) setUser(JSON.parse(storedUser));
    const savedName = localStorage.getItem('websiteName');
    if (savedName) setWebsiteName(savedName);
    setLoadingApp(false);
  }, []);

  useEffect(() => {
    localStorage.setItem('websiteName', websiteName);
  }, [websiteName]);

  useEffect(() => {
    const updateAllCounts = async () => {
      if (user) {
        try {
          const allUserDocs = await getAllItemsByIndex(DOC_STORE, 'userId', IDBKeyRange.only(user.id));
          const counts = { Pendidikan: 0, Pribadi: 0, Lainnya: 0 };
          let currentTotalSize = 0;
          allUserDocs.forEach(doc => {
            if (counts.hasOwnProperty(doc.folder)) counts[doc.folder]++;
            currentTotalSize += doc.fileSize || (doc.fileData ? doc.fileData.byteLength : 0);
          });
          setFolderCounts(counts);
          setTotalDocsCount(allUserDocs.length);
          setTotalStorageUsed(currentTotalSize);
        } catch (error) {
          console.error("Error updating all counts:", error);
        }
      }
    };
    updateAllCounts();
  }, [user, documents]);

  const showMessage = (msg, type) => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => { setMessage(''); setMessageType(''); }, 3000);
  };

  const handleRegister = async () => {
    setAuthLoading(true);
    try {
      if (await getItem(USER_STORE, email)) {
        showMessage('Email ini sudah terdaftar!', 'error');
      } else {
        const passwordHash = await sha256(password);
        await addItem(USER_STORE, { id: email, email, passwordHash });
        showMessage('Registrasi berhasil! Silakan login.', 'success');
        setIsLoginMode(true);
        setEmail('');
        setPassword('');
      }
    } catch (error) {
      showMessage(`Gagal mendaftar: ${error.message}`, 'error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogin = async () => {
    setAuthLoading(true);
    try {
      const storedUser = await getItem(USER_STORE, email);
      if (storedUser && await sha256(password) === storedUser.passwordHash) {
        const loggedInUser = { id: storedUser.id, email: storedUser.email };
        setUser(loggedInUser);
        localStorage.setItem('currentUser', JSON.stringify(loggedInUser));
        showMessage('Login berhasil!', 'success');
        setEmail('');
        setPassword('');
      } else {
        showMessage('Email atau kata sandi salah.', 'error');
      }
    } catch (error) {
      showMessage(`Gagal login: ${error.message}`, 'error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('currentUser');
    setCurrentFolder(null);
    setDocuments([]);
  };

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
        showMessage(`Gagal memuat dokumen: ${error.message}`, 'error');
      }
    };
    fetchDocuments();
  }, [user, currentFolder]);

  const handleFileChange = (e) => {
    if (e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setNewFileName(e.target.files[0].name.split('.').slice(0, -1).join('.') || e.target.files[0].name);
    }
  };

  const handleUploadDocument = async () => {
    if (!selectedFile || !newFileName.trim() || !currentFolder || !user) {
      showMessage('Harap lengkapi semua field.', 'error');
      return;
    }
    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const newDoc = {
          userId: user.id,
          folder: currentFolder,
          fileName: newFileName.trim(),
          originalFileName: selectedFile.name,
          uploadDate: new Date().toISOString(),
          fileData: event.target.result,
          mimeType: selectedFile.type,
          fileSize: selectedFile.size,
        };
        const docId = await addItem(DOC_STORE, newDoc);
        setDocuments(prev => [...prev, { ...newDoc, id: docId }]);
        setIsUploadModalOpen(false);
        setSelectedFile(null);
        setNewFileName('');
        if (fileInputRef.current) fileInputRef.current.value = '';
        showMessage('Dokumen berhasil diunggah!', 'success');
      };
      reader.readAsArrayBuffer(selectedFile);
    } catch (error) {
      showMessage(`Gagal mengunggah: ${error.message}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDocument = async (docId) => {
    if (window.confirm("Apakah Anda yakin ingin menghapus dokumen ini?")) {
      try {
        await deleteItem(DOC_STORE, docId);
        setDocuments(prev => prev.filter(doc => doc.id !== docId));
        showMessage('Dokumen berhasil dihapus.', 'success');
      } catch (error) {
        showMessage(`Gagal menghapus dokumen: ${error.message}`, 'error');
      }
    }
  };

  const handleDownloadDocument = (doc) => {
    const blob = new Blob([doc.fileData], { type: doc.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.originalFileName || doc.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Handlers for Edit Modal
  const handleOpenEditModal = (doc) => {
    setEditingDoc(doc);
    setIsEditModalOpen(true);
  };

  const handleCloseEditModal = () => {
    setEditingDoc(null);
    setIsEditModalOpen(false);
  };

  const handleUpdateDocumentName = async (newFileName) => {
    if (!editingDoc || !newFileName.trim()) {
      showMessage('Nama dokumen tidak boleh kosong.', 'error');
      return;
    }
    const updatedDoc = { ...editingDoc, fileName: newFileName.trim() };
    try {
      await updateItem(DOC_STORE, updatedDoc);
      setDocuments(prev => prev.map(doc => doc.id === editingDoc.id ? updatedDoc : doc));
      showMessage('Nama dokumen berhasil diperbarui!', 'success');
      handleCloseEditModal();
    } catch (error) {
      showMessage(`Gagal memperbarui dokumen: ${error.message}`, 'error');
    }
  };

  const filteredDocuments = documents.filter(doc =>
    doc.fileName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sortedAndFilteredDocuments = [...filteredDocuments].sort((a, b) => {
    if (sortKey === 'fileName') {
      return a.fileName.localeCompare(b.fileName) * (sortOrder === 'asc' ? 1 : -1);
    }
    return (new Date(b.uploadDate) - new Date(a.uploadDate)) * (sortOrder === 'asc' ? -1 : 1);
  });

  const formatBytes = (bytes, decimals = 2) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  };

  const getRecentDocuments = useCallback(async () => {
    if (!user) return [];
    try {
      const allUserDocs = await getAllItemsByIndex(DOC_STORE, 'userId', IDBKeyRange.only(user.id));
      return [...allUserDocs].sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate)).slice(0, 5);
    } catch (error) {
      console.error("Error fetching recent documents:", error);
      return [];
    }
  }, [user]);

  const [recentDocs, setRecentDocs] = useState([]);
  useEffect(() => {
    if (user && !currentFolder) {
      getRecentDocuments().then(docs => setRecentDocs(docs));
    }
  }, [user, currentFolder, documents, getRecentDocuments]);

  if (loadingApp) return <div className="flex items-center justify-center min-h-screen">Memuat...</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-950 to-pink-950 flex flex-col items-center justify-center font-sans text-gray-100 p-4">
      <div className="w-full max-w-6xl bg-white rounded-2xl shadow-xl p-8 md:p-10 relative">
        {user && (
          <div className="absolute top-0 left-0 right-0 p-4 bg-gray-900/80 backdrop-blur-sm rounded-t-2xl flex items-center justify-between z-20">
            <h1 className="text-xl font-bold text-white">{websiteName}</h1>
            <div className="flex items-center space-x-4">
              <span className="text-white text-sm hidden sm:inline-block">Selamat datang, {user.email}</span>
              <button onClick={handleLogout} className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-1.5 px-4 rounded-md text-sm">Logout</button>
            </div>
          </div>
        )}
        <div className={user ? "pt-20" : "pt-0"}>
          {message && <div className={`p-4 mb-6 rounded-lg text-center font-medium ${messageType === 'success' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>{message}</div>}
          {!user ? (
            <div className="mt-4 p-4 md:p-8 text-center">
              <h2 className="text-4xl font-extrabold text-gray-800 mb-2">{websiteName}</h2>
              <p className="text-gray-500 mb-10">Unggah Mudah, Akses Cepat, Arsip Teratur</p>
              
              <div className="max-w-sm mx-auto bg-blue-50 p-8 rounded-lg shadow-inner">
                <p className="text-2xl font-bold text-gray-800 mb-8">{isLoginMode ? 'Sign in' : 'Sign up'}</p>
                <div className="space-y-5">
                  <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full p-4 border border-gray-300 rounded-lg text-gray-900" />
                  <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full p-4 border border-gray-300 rounded-lg text-gray-900" />
                  <button onClick={isLoginMode ? handleLogin : handleRegister} disabled={authLoading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-6 rounded-lg">{authLoading ? 'Memproses...' : (isLoginMode ? 'Sign in' : 'Sign up')}</button>
                </div>
              </div>

              <div className="text-center mt-6 text-gray-600">
                {isLoginMode ? (<span>Belum punya akun? <button onClick={() => setIsLoginMode(false)} className="text-rose-600 hover:underline">Sign up</button></span>) : (<span>Sudah punya akun? <button onClick={() => setIsLoginMode(true)} className="text-rose-600 hover:underline">Sign in</button></span>)}
              </div>
            </div>
          ) : !currentFolder ? (
            <div>
              <div className="mb-8 p-6 bg-gradient-to-r from-blue-600 to-indigo-700 text-white rounded-xl shadow-lg">
                <div className="flex items-center justify-between">
                  {isEditingName ? <input type="text" value={websiteName} onChange={(e) => setWebsiteName(e.target.value)} onBlur={() => setIsEditingName(false)} onKeyDown={(e) => e.key === 'Enter' && setIsEditingName(false)} className="text-3xl font-extrabold bg-transparent border-b-2" autoFocus /> : <h2 className="text-3xl font-extrabold flex items-center">{websiteName} <button onClick={() => setIsEditingName(true)} className="ml-3 p-1 rounded-full hover:bg-white/20"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" /></svg></button></h2>}
                  <p className="opacity-80">{new Date().toLocaleDateString('id-ID', { dateStyle: 'long' })}</p>
                </div>
              </div>
              <div className="grid md:grid-cols-3 gap-6 mb-10">
                <SummaryCard title="Total Dokumen" value={totalDocsCount} unit="Files" icon="📄" />
                <SummaryCard title="Penyimpanan" value={formatBytes(totalStorageUsed)} unit="Digunakan" icon="💾" />
                <SummaryCard title="Folder" value="3" unit="Kategori" icon="📁" />
              </div>
              <h3 className="text-2xl font-bold text-gray-800 mb-6">Folder Arsip</h3>
              <div className="grid md:grid-cols-3 gap-6">
                <FolderCard title="Pendidikan" docCount={folderCounts.Pendidikan} icon="🎓" onClick={() => setCurrentFolder('Pendidikan')} />
                <FolderCard title="Pribadi" docCount={folderCounts.Pribadi} icon="👤" onClick={() => setCurrentFolder('Pribadi')} />
                <FolderCard title="Lainnya" docCount={folderCounts.Lainnya} icon="📁" onClick={() => setCurrentFolder('Lainnya')} />
              </div>
            </div>
          ) : (
            <div>
              <p className="text-gray-500 text-sm mb-4 cursor-pointer" onClick={() => setCurrentFolder(null)}>Beranda &gt; <span className="font-semibold">{currentFolder}</span></p>
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-3xl font-bold text-gray-800">{currentFolder}</h2>
                <div className="flex space-x-3">
                  <button onClick={() => setCurrentFolder(null)} className="bg-gray-800 hover:bg-gray-900 text-white font-semibold py-2.5 px-6 rounded-lg">&larr; Kembali</button>
                  <button onClick={() => setIsUploadModalOpen(true)} className="bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2.5 px-6 rounded-lg">Unggah Dokumen</button>
                </div>
              </div>
              <div className="flex items-center gap-4 mb-6">
                <input type="text" placeholder="Cari..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="flex-grow p-3 border rounded-lg text-gray-900" />
              </div>
              <div className="space-y-3">
                {sortedAndFilteredDocuments.map(doc => (
                  <div key={doc.id} className="bg-white p-5 rounded-lg grid md:grid-cols-5 gap-4 items-center border hover:shadow-md">
                    <p className="col-span-2 font-medium text-gray-800 break-words">{doc.fileName}</p>
                    <p className="text-sm text-gray-500">{new Date(doc.uploadDate).toLocaleDateString()}</p>
                    <p className="text-sm text-gray-500">{formatBytes(doc.fileSize)}</p>
                    <div className="flex space-x-2 justify-end">
                      <button onClick={() => handleDownloadDocument(doc)} className="bg-green-500 hover:bg-green-600 text-white p-2 rounded-lg text-xs">Unduh</button>
                      <button onClick={() => handleOpenEditModal(doc)} className="bg-blue-500 hover:bg-blue-600 text-white p-2 rounded-lg text-xs">Edit</button>
                      <button onClick={() => handleDeleteDocument(doc.id)} className="bg-red-500 hover:bg-red-600 text-white p-2 rounded-lg text-xs">Hapus</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        {isUploadModalOpen && <UploadModal close={() => setIsUploadModalOpen(false)} upload={handleUploadDocument} handleFileChange={handleFileChange} newFileName={newFileName} setNewFileName={setNewFileName} selectedFile={selectedFile} uploading={uploading} fileInputRef={fileInputRef} />}
        {isEditModalOpen && <EditModal doc={editingDoc} close={handleCloseEditModal} save={handleUpdateDocumentName} />}
      </div>
    </div>
  );
}

const SummaryCard = ({ title, value, unit, icon }) => (
  <div className="bg-slate-100 text-slate-800 p-6 rounded-xl shadow">
    <span className="text-4xl mb-3 block">{icon}</span>
    <h3 className="text-xl font-semibold">{title}</h3>
    <p className="text-3xl font-bold">{value}</p>
    <p className="text-sm opacity-90">{unit}</p>
  </div>
);

const FolderCard = ({ title, docCount, icon, onClick }) => (
  <div onClick={onClick} className="p-6 bg-white rounded-xl shadow-md hover:shadow-lg hover:-translate-y-1 cursor-pointer group border">
    <span className="text-5xl group-hover:scale-110 transition-transform text-rose-500 block mb-3">{icon}</span>
    <h3 className="text-xl font-semibold text-gray-800 mb-2">{title}</h3>
    <p className="text-sm text-gray-600 font-medium">{docCount} Dokumen</p>
  </div>
);

const UploadModal = ({ close, upload, handleFileChange, newFileName, setNewFileName, selectedFile, uploading, fileInputRef }) => (
  <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
    <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-md relative">
      <button onClick={close} className="absolute top-4 right-4 text-gray-500 text-2xl">&times;</button>
      <h3 className="text-2xl font-bold text-gray-800 mb-6 text-center">Unggah Dokumen</h3>
      <div className="border-2 border-dashed rounded-lg p-8 text-center mb-6">
        <input type="file" onChange={handleFileChange} ref={fileInputRef} className="hidden" id="file-upload" />
        <label htmlFor="file-upload" className="bg-rose-500 hover:bg-rose-600 text-white font-semibold py-2 px-5 rounded-lg cursor-pointer">Pilih File</label>
        {selectedFile && <p className="text-gray-700 mt-4">File: <span className="font-semibold">{selectedFile.name}</span></p>}
      </div>
      <div className="space-y-4 mb-6">
        <input type="text" placeholder="Nama Dokumen" value={newFileName} onChange={e => setNewFileName(e.target.value)} className="w-full p-3 border rounded-lg text-gray-900" />
      </div>
      <div className="flex justify-end space-x-3">
        <button onClick={close} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2.5 px-6 rounded-lg">Batal</button>
        <button onClick={upload} disabled={uploading || !selectedFile || !newFileName} className="bg-rose-600 hover:bg-rose-700 text-white font-bold py-2.5 px-6 rounded-lg disabled:opacity-50">{uploading ? 'Mengunggah...' : 'Unggah'}</button>
      </div>
    </div>
  </div>
);

// New Component for Editing Document
const EditModal = ({ doc, close, save }) => {
  const [name, setName] = useState(doc.fileName);

  const handleSave = () => {
    save(name);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-md relative">
        <button onClick={close} className="absolute top-4 right-4 text-gray-500 text-2xl">&times;</button>
        <h3 className="text-2xl font-bold text-gray-800 mb-6 text-center">Edit Dokumen</h3>
        <div className="space-y-4 mb-6">
          <label className="block text-sm font-medium text-gray-700">Nama Dokumen</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full p-3 border rounded-lg text-gray-900" />
        </div>
        <div className="flex justify-end space-x-3">
          <button onClick={close} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2.5 px-6 rounded-lg">Batal</button>
          <button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 px-6 rounded-lg">Simpan</button>
        </div>
      </div>
    </div>
  );
};

export default App;
