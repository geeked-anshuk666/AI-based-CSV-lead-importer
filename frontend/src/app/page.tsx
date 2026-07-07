'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, 
  FileSpreadsheet, 
  CheckCircle2, 
  XCircle, 
  RefreshCw, 
  History, 
  AlertCircle,
  Database
} from 'lucide-react';

interface ImportRun {
  id: string;
  createdAt: string;
  status: string;
  fileName: string;
  totalRecords: number;
  processedRecords: number;
  skippedRecords: number;
}

export default function Home() {
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  
  // State for Step 2: Preview
  const [uploadData, setUploadData] = useState<{
    runId: string;
    fileName: string;
    totalRecords: number;
    validCount: number;
    skippedCount: number;
    previewRows: any[];
  } | null>(null);

  // State for Step 3 & 4: Processing and Results
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [stats, setStats] = useState<{ processed: number; skipped: number } | null>(null);
  
  // Final Results
  const [importResult, setImportResult] = useState<{
    runId: string;
    fileName: string;
    totalRecords: number;
    processedRecords: number;
    skippedRecords: number;
    leads: any[];
  } | null>(null);

  // History Runs
  const [history, setHistory] = useState<ImportRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'import' | 'history'>('import');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sseRef = useRef<EventSource | null>(null);

  const API_BASE = 'http://localhost:5000/api';

  useEffect(() => {
    fetchHistory();
    return () => {
      if (sseRef.current) sseRef.current.close();
    };
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${API_BASE}/imports/history`);
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch (err) {
      console.error('Failed to fetch import history:', err);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.name.endsWith('.csv')) {
        setFile(droppedFile);
        handleUpload(droppedFile);
      } else {
        setError('Only valid CSV files (.csv) are supported.');
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      handleUpload(selectedFile);
    }
  };

  const handleUpload = async (targetFile: File) => {
    setError(null);
    setUploadData(null);
    setImportResult(null);
    setStats(null);
    setProgress(0);

    const formData = new FormData();
    formData.append('file', targetFile);

    try {
      const res = await fetch(`${API_BASE}/imports/upload`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to upload CSV file.');
      }

      const data = await res.json();
      setUploadData(data);
    } catch (err: any) {
      setError(err.message || 'An error occurred during file parsing.');
      setFile(null);
    }
  };

  const startImportPipeline = () => {
    if (!uploadData) return;

    setIsProcessing(true);
    setError(null);
    setStatusMessage('Publishing tasks to worker queue...');

    // Initialize Server-Sent Events (SSE) listener
    const sse = new EventSource(`${API_BASE}/imports/${uploadData.runId}/progress`);
    sseRef.current = sse;

    sse.onmessage = (event) => {
      try {
        const update = JSON.parse(event.data);
        setProgress(update.progress);
        setStats({ processed: update.processed, skipped: update.skipped });

        if (update.status === 'PROCESSING') {
          setStatusMessage(`Mapping leads dynamically... ${update.progress}%`);
        } else if (update.status === 'COMPLETED') {
          setStatusMessage('Import completed successfully!');
          setIsProcessing(false);
          sse.close();
          fetchImportDetails(uploadData.runId);
          fetchHistory();
        }
      } catch (err) {
        console.error('Error parsing SSE event data:', err);
      }
    };

    sse.onerror = (err) => {
      console.error('SSE connection lost, polling final status...', err);
      setIsProcessing(false);
      sse.close();
      // Check final state in database
      fetchImportDetails(uploadData.runId);
    };
  };

  const fetchImportDetails = async (runId: string) => {
    try {
      const res = await fetch(`${API_BASE}/imports/${runId}`);
      if (res.ok) {
        const data = await res.json();
        setImportResult(data);
      }
    } catch (err) {
      console.error('Error fetching final import details:', err);
    }
  };

  const resetState = () => {
    setFile(null);
    setUploadData(null);
    setImportResult(null);
    setStats(null);
    setProgress(0);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans selection:bg-teal-500 selection:text-white">
      {/* Header */}
      <header className="border-b border-neutral-900 bg-neutral-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-teal-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-teal-500/20">
              <Database className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-neutral-50 to-neutral-300 bg-clip-text text-transparent">GrowEasy CRM</h1>
              <p className="text-xs text-neutral-500 font-medium">AI CSV Lead Importer</p>
            </div>
          </div>
          <div className="flex gap-1 bg-neutral-900 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('import')}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all ${
                activeTab === 'import' 
                  ? 'bg-neutral-800 text-teal-400 shadow-sm' 
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Import Dashboard
            </button>
            <button
              onClick={() => { setActiveTab('history'); fetchHistory(); }}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all ${
                activeTab === 'history' 
                  ? 'bg-neutral-800 text-teal-400 shadow-sm' 
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" />
                Import History
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8">
        {activeTab === 'import' ? (
          <div className="space-y-6">
            
            {/* Step 1: Upload Dropzone */}
            {!file && !uploadData && (
              <div 
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all ${
                  dragActive 
                    ? 'border-teal-500 bg-teal-950/20 shadow-lg shadow-teal-500/5' 
                    : 'border-neutral-850 hover:border-neutral-700 bg-neutral-900/30'
                }`}
              >
                <label htmlFor="csv-file-input" className="sr-only">Upload CSV File</label>
                <input 
                  type="file" 
                  id="csv-file-input"
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  className="hidden" 
                  accept=".csv"
                />
                <div className="w-14 h-14 bg-neutral-900 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-neutral-800">
                  <Upload className="w-6 h-6 text-neutral-400" />
                </div>
                <h3 className="text-sm font-semibold text-neutral-200">Upload CSV Lead List</h3>
                <p className="text-xs text-neutral-500 mt-1 max-w-xs mx-auto">
                  Drag & drop your CSV file here, or click to browse files from your computer (Max 100MB)
                </p>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="bg-red-950/20 border border-red-900/50 p-4 rounded-xl flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-bold text-red-400">Execution Error</h4>
                  <p className="text-xs text-red-500 mt-0.5">{error}</p>
                </div>
              </div>
            )}

            {/* Step 2: Upload Data & Preview Table */}
            {uploadData && !isProcessing && !importResult && (
              <div className="space-y-4">
                <div className="bg-neutral-900/40 border border-neutral-900 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-teal-400" />
                      <span className="text-sm font-bold text-neutral-200">{uploadData.fileName}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-neutral-400 mt-2">
                      <span>Total Rows: <strong>{uploadData.totalRecords}</strong></span>
                      <span>To Map: <strong>{uploadData.validCount}</strong></span>
                      <span>Skipped (Empty): <strong className="text-neutral-500">{uploadData.skippedCount}</strong></span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={resetState}
                      className="px-4 py-2 border border-neutral-800 hover:border-neutral-700 text-xs font-semibold rounded-xl text-neutral-400 hover:text-neutral-200 transition-all"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={startImportPipeline}
                      className="px-5 py-2 bg-teal-600 hover:bg-teal-500 text-xs font-bold rounded-xl text-white shadow-md shadow-teal-600/25 transition-all"
                    >
                      Confirm & Import
                    </button>
                  </div>
                </div>

                <div className="bg-neutral-900/20 border border-neutral-900 rounded-xl overflow-hidden">
                  <div className="p-4 border-b border-neutral-900 bg-neutral-900/30">
                    <h3 className="text-xs font-bold text-neutral-400 tracking-wider uppercase">File Data Preview (Top 10 Rows)</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-neutral-950/60 text-neutral-400 font-bold border-b border-neutral-900">
                          {Object.keys(uploadData.previewRows[0] || {}).map((header, idx) => (
                            <th key={idx} className="p-3 sticky top-0 bg-neutral-950/60 font-semibold">{header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {uploadData.previewRows.map((row, rowIdx) => (
                          <tr key={rowIdx} className="border-b border-neutral-900 hover:bg-neutral-900/20 text-neutral-300">
                            {Object.values(row).map((val: any, valIdx) => (
                              <td key={valIdx} className="p-3 whitespace-nowrap">{String(val || '')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: SSE Processing Progress bar */}
            {isProcessing && (
              <div className="bg-neutral-900/30 border border-neutral-900 p-8 rounded-2xl space-y-6 text-center max-w-lg mx-auto">
                <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
                  <div className="absolute inset-0 border-4 border-neutral-800 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-teal-500 rounded-full animate-spin border-t-transparent"></div>
                  <RefreshCw className="w-6 h-6 text-teal-400 animate-pulse" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-bold text-neutral-200">{statusMessage}</h3>
                  {stats && (
                    <p className="text-xs text-neutral-400">
                      Processed: <strong className="text-neutral-200">{stats.processed}</strong> | Skipped: <strong className="text-neutral-500">{stats.skipped}</strong>
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <div className="w-full bg-neutral-900 rounded-full h-1.5 overflow-hidden border border-neutral-850">
                    <div 
                      className="bg-gradient-to-r from-teal-500 to-emerald-500 h-full transition-all duration-300 rounded-full"
                      style={{ width: `${progress}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between text-[10px] text-neutral-500 font-bold">
                    <span>0%</span>
                    <span>{progress}%</span>
                    <span>100%</span>
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: Import Results Tables */}
            {importResult && (
              <div className="space-y-6 animate-fade-in">
                <div className="bg-neutral-900/40 border border-neutral-900 p-5 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-neutral-200">Import Finished: {importResult.fileName}</h3>
                    <p className="text-xs text-neutral-500 mt-1">Run ID: {importResult.runId}</p>
                  </div>
                  <div className="flex items-center gap-6 text-xs text-neutral-300">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      <span>Imported: <strong>{importResult.processedRecords}</strong></span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500"></span>
                      <span>Skipped: <strong>{importResult.skippedRecords}</strong></span>
                    </div>
                    <button 
                      onClick={resetState}
                      className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs font-semibold rounded-xl text-neutral-400 hover:text-neutral-200 transition-all"
                    >
                      New Import
                    </button>
                  </div>
                </div>

                <div className="bg-neutral-900/20 border border-neutral-900 rounded-2xl overflow-hidden">
                  <div className="p-4 border-b border-neutral-900 bg-neutral-900/30 flex justify-between items-center">
                    <h3 className="text-xs font-bold text-neutral-400 tracking-wider uppercase">Extracted GrowEasy leads ({importResult.leads.length})</h3>
                  </div>
                  <div className="overflow-x-auto max-h-96 overflow-y-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-neutral-950/60 text-neutral-400 font-bold border-b border-neutral-900 sticky top-0 z-10">
                          <th className="p-3 bg-neutral-950/60">Created At</th>
                          <th className="p-3 bg-neutral-950/60">Name</th>
                          <th className="p-3 bg-neutral-950/60">Email</th>
                          <th className="p-3 bg-neutral-950/60">Phone</th>
                          <th className="p-3 bg-neutral-950/60">Company</th>
                          <th className="p-3 bg-neutral-950/60">City/State</th>
                          <th className="p-3 bg-neutral-950/60">Status</th>
                          <th className="p-3 bg-neutral-950/60">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importResult.leads.map((lead, idx) => (
                          <tr key={idx} className="border-b border-neutral-900 hover:bg-neutral-900/10 text-neutral-300">
                            <td className="p-3 whitespace-nowrap text-neutral-500">{new Date(lead.createdAt).toLocaleString()}</td>
                            <td className="p-3 font-semibold whitespace-nowrap text-neutral-200">{lead.name || '-'}</td>
                            <td className="p-3 whitespace-nowrap">{lead.email || '-'}</td>
                            <td className="p-3 whitespace-nowrap text-neutral-400">
                              {lead.countryCode ? `${lead.countryCode} ` : ''}{lead.mobileWithoutCountryCode || '-'}
                            </td>
                            <td className="p-3 whitespace-nowrap text-neutral-400">{lead.company || '-'}</td>
                            <td className="p-3 whitespace-nowrap text-neutral-400">
                              {[lead.city, lead.state].filter(Boolean).join(', ') || '-'}
                            </td>
                            <td className="p-3 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                lead.crmStatus === 'SALE_DONE' ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-900/30' :
                                lead.crmStatus === 'GOOD_LEAD_FOLLOW_UP' ? 'bg-teal-950/50 text-teal-400 border border-teal-900/30' :
                                lead.crmStatus === 'DID_NOT_CONNECT' ? 'bg-amber-950/50 text-amber-400 border border-amber-900/30' :
                                'bg-red-950/50 text-red-400 border border-red-900/30'
                              }`}>
                                {lead.crmStatus}
                              </span>
                            </td>
                            <td className="p-3 text-neutral-400 max-w-xs truncate" title={lead.crmNote || ''}>
                              {lead.crmNote || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* History View Tab */
          <div className="bg-neutral-900/20 border border-neutral-900 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-neutral-900 bg-neutral-900/30">
              <h3 className="text-xs font-bold text-neutral-400 tracking-wider uppercase">Import Logs History</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-neutral-950/60 text-neutral-400 font-bold border-b border-neutral-900">
                    <th className="p-4 font-semibold">Date</th>
                    <th className="p-4 font-semibold">File Name</th>
                    <th className="p-4 font-semibold">Status</th>
                    <th className="p-4 font-semibold">Processed</th>
                    <th className="p-4 font-semibold">Skipped</th>
                    <th className="p-4 font-semibold">Total</th>
                    <th className="p-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((run, idx) => (
                    <tr key={idx} className="border-b border-neutral-900 hover:bg-neutral-900/10 text-neutral-300">
                      <td className="p-4 text-neutral-500 whitespace-nowrap">{new Date(run.createdAt).toLocaleString()}</td>
                      <td className="p-4 font-semibold whitespace-nowrap text-neutral-200">{run.fileName}</td>
                      <td className="p-4 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          run.status === 'COMPLETED' ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-900/30' :
                          run.status === 'PROCESSING' ? 'bg-teal-950/50 text-teal-400 border border-teal-900/30' :
                          'bg-amber-950/50 text-amber-400 border border-amber-900/30'
                        }`}>
                          {run.status}
                        </span>
                      </td>
                      <td className="p-4 text-emerald-400 font-bold">{run.processedRecords}</td>
                      <td className="p-4 text-neutral-500">{run.skippedRecords}</td>
                      <td className="p-4">{run.totalRecords}</td>
                      <td className="p-4 text-right whitespace-nowrap">
                        <button
                          onClick={() => {
                            setUploadData({
                              runId: run.id,
                              fileName: run.fileName,
                              totalRecords: run.totalRecords,
                              validCount: run.processedRecords,
                              skippedCount: run.skippedRecords,
                              previewRows: []
                            });
                            fetchImportDetails(run.id);
                            setActiveTab('import');
                          }}
                          className="px-3 py-1 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-[10px] font-bold rounded-lg text-teal-400 transition-all"
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  ))}
                  {history.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-neutral-500">
                        No imports run yet. Upload a CSV to get started.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
