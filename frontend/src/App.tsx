import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

const API_URL = 'http://localhost:3000/api';
const userId = '1'; // Mock user

function App() {
  const [view, setView] = useState('list');
  const [documents, setDocuments] = useState<any[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [diffData, setDiffData] = useState<any>(null);
  const [file, setFile] = useState<File | null>(null);

  // In a real scenario, we'd fetch actual documents. Here we mock a generic UI state.
  useEffect(() => {
    // We would fetch documents here
    setDocuments([
      { id: 1, title: 'Project Requirements.pdf', versions: [{id: 1, versionNum: 1}, {id: 2, versionNum: 2}] }
    ]);
  }, []);

  const handleUpload = async (e: any) => {
    e.preventDefault();
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', file.name);
    formData.append('projectId', '1');

    try {
      await axios.post(`${API_URL}/documents`, formData, {
        headers: { 'x-user-id': userId }
      });
      alert('Upload successful');
    } catch (e) {
      alert('Upload failed');
    }
  };

  const loadDiff = async (docId: number, v1: number, v2: number) => {
    try {
      const res = await axios.get(`${API_URL}/documents/${docId}/compare?v1=${v1}&v2=${v2}`, {
        headers: { 'x-user-id': userId }
      });
      setDiffData(res.data.diff);
      setView('diff');
    } catch (e) {
      alert('Compare failed');
    }
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1>Document Management System</h1>
        <button className="btn" onClick={() => setView('list')}>Dashboard</button>
      </header>

      {view === 'list' && (
        <div className="card">
          <h2>Upload Document</h2>
          <form onSubmit={handleUpload} style={{marginBottom: '2rem'}}>
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <button type="submit" className="btn">Upload</button>
          </form>

          <h2>Documents</h2>
          <ul className="doc-list">
            {documents.map(doc => (
              <li key={doc.id} className="doc-item">
                <div>
                  <strong>{doc.title}</strong>
                  <p>Versions: {doc.versions.length}</p>
                </div>
                <div>
                  {doc.versions.length >= 2 && (
                    <button className="btn" onClick={() => loadDiff(doc.id, doc.versions[0].id, doc.versions[1].id)}>
                      Compare V1 & V2
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {view === 'diff' && diffData && (
        <div className="card">
          <h2>Document Difference Highlights</h2>
          <div className="diff-container" style={{display: 'block'}}>
            {diffData.map((part: any, index: number) => (
              <span key={index} className={part.added ? 'diff-added' : part.removed ? 'diff-removed' : ''}>
                {part.value}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
