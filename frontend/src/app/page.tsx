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

  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:5000/api';

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
        setError('Only valid CSV files are supported.');
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

    // Initialize Server-Sent Events listener
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

  // Determine current active step
  const getCurrentStep = () => {
    if (importResult) return 4;
    if (isProcessing) return 3;
    if (uploadData) return 2;
    return 1;
  };

  const activeStep = getCurrentStep();

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col selection:bg-teal-500 selection:text-white relative overflow-hidden">
      {/* Dynamic Google Fonts Import */}
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap');
        body {
          font-family: 'Outfit', sans-serif;
        }
      `}</style>

      {/* Decorative Background Elements */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-teal-500/5 rounded-full blur-[120px] pointer-events-none -translate-y-1/2"></div>
      <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-[150px] pointer-events-none translate-y-1/2"></div>

      {/* Floating Header */}
      <header className="border-b border-neutral-900/60 bg-neutral-950/65 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-teal-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-teal-500/10">
              <Database className="w-4.5 h-4.5 text-neutral-950 stroke-[2.5]" />
            </div>
            <div>
              <h1 className="text-md font-bold tracking-tight bg-gradient-to-r from-neutral-50 to-neutral-300 bg-clip-text text-transparent">LeadFlow AI</h1>
              <p className="text-[10px] text-neutral-500 font-semibold tracking-wider uppercase">Dynamic Intake Engine</p>
            </div>
          </div>
          <div className="flex gap-1.5 bg-neutral-900/70 border border-neutral-800/80 p-1 rounded-xl">
            <button
              onClick={() => { setActiveTab('import'); resetState(); }}
              className={`px-4.5 py-2 rounded-lg text-xs font-semibold tracking-wide transition-all duration-300 ${
                activeTab === 'import' 
                  ? 'bg-neutral-800 text-teal-400 shadow-inner' 
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Dashboard
            </button>
            <button
              onClick={() => { setActiveTab('history'); fetchHistory(); }}
              className={`px-4.5 py-2 rounded-lg text-xs font-semibold tracking-wide transition-all duration-300 ${
                activeTab === 'history' 
                  ? 'bg-neutral-800 text-teal-400 shadow-inner' 
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <span className="flex items-center gap-2">
                <History className="w-3.5 h-3.5" />
                History Logs
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-12 z-10">
        {activeTab === 'import' ? (
          <div className="space-y-12">
            
            {/* Cinematic Center Hero */}
            <div className="text-center py-6 max-w-4xl mx-auto">
              <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-tight bg-gradient-to-b from-neutral-50 via-neutral-100 to-neutral-400 bg-clip-text text-transparent">
                Intelligent CSV Lead Pipeline
              </h2>
              <p className="text-sm md:text-md text-neutral-400 max-w-2xl mx-auto mt-4 font-normal leading-relaxed">
                Seamlessly ingest, map, and synchronize contact databases using real-time validation queues.
              </p>
            </div>

            {/* Visual Pipeline Steps */}
            <div className="max-w-3xl mx-auto grid grid-cols-4 gap-4 relative">
              <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-neutral-900 -translate-y-1/2 z-0"></div>
              
              <div className="flex flex-col items-center text-center z-10">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-500 ${
                  activeStep >= 1 ? 'bg-teal-500 text-neutral-950 shadow-md shadow-teal-500/20' : 'bg-neutral-900 text-neutral-500'
                }`}>
                  1
                </div>
                <span className="text-[10px] uppercase tracking-wider font-semibold mt-2 text-neutral-400">Upload</span>
              </div>

              <div className="flex flex-col items-center text-center z-10">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-500 ${
                  activeStep >= 2 ? 'bg-teal-500 text-neutral-950 shadow-md shadow-teal-500/20' : 'bg-neutral-900 text-neutral-500'
                }`}>
                  2
                </div>
                <span className="text-[10px] uppercase tracking-wider font-semibold mt-2 text-neutral-400">Preview</span>
              </div>

              <div className="flex flex-col items-center text-center z-10">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-500 ${
                  activeStep >= 3 ? 'bg-teal-500 text-neutral-950 shadow-md shadow-teal-500/20' : 'bg-neutral-900 text-neutral-500'
                }`}>
                  3
                </div>
                <span className="text-[10px] uppercase tracking-wider font-semibold mt-2 text-neutral-400">Process</span>
              </div>

              <div className="flex flex-col items-center text-center z-10">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-500 ${
                  activeStep >= 4 ? 'bg-teal-500 text-neutral-950 shadow-md shadow-teal-500/20' : 'bg-neutral-900 text-neutral-500'
                }`}>
                  4
                </div>
                <span className="text-[10px] uppercase tracking-wider font-semibold mt-2 text-neutral-400">Complete</span>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-950/20 border border-red-900/40 p-5 rounded-2xl flex items-start gap-4 max-w-2xl mx-auto">
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-bold text-red-400">Validation Interrupted</h4>
                  <p className="text-xs text-red-400/80 mt-1 leading-relaxed">{error}</p>
                </div>
              </div>
            )}

            {/* Bento Layout Main Section */}
            <div className="grid grid-cols-1 gap-8 w-full">
              
              {/* Step 1: Dropzone Card */}
              {!file && !uploadData && (
                <div 
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-3xl p-16 text-center cursor-pointer transition-all duration-500 backdrop-blur-md relative overflow-hidden group ${
                    dragActive 
                      ? 'border-teal-500 bg-teal-950/15 shadow-2xl shadow-teal-500/5' 
                      : 'border-neutral-800 hover:border-neutral-700 bg-neutral-900/20'
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
                  <div className="w-16 h-16 bg-neutral-900/60 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-neutral-800 group-hover:scale-105 transition-transform duration-500">
                    <Upload className="w-6 h-6 text-neutral-400 group-hover:text-teal-400 transition-colors" />
                  </div>
                  <h3 className="text-md font-bold text-neutral-200 tracking-tight">Select Lead Spreadsheet</h3>
                  <p className="text-xs text-neutral-500 mt-2 max-w-sm mx-auto leading-relaxed">
                    Drag and drop your contact CSV here, or browse local directories. Maximum file size is 100MB.
                  </p>
                </div>
              )}

              {/* Step 2: Mapping / Preview Grid */}
              {uploadData && !isProcessing && !importResult && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  
                  {/* Left Column: Summary Metrics */}
                  <div className="md:col-span-1 space-y-6">
                    <div className="bg-neutral-900/30 border border-neutral-900/80 rounded-2xl p-6 space-y-6">
                      <div className="flex items-center gap-3">
                        <FileSpreadsheet className="w-5 h-5 text-teal-400" />
                        <span className="text-sm font-bold text-neutral-200 truncate">{uploadData.fileName}</span>
                      </div>
                      
                      <div className="space-y-4">
                        <div className="bg-neutral-900/40 p-4 rounded-xl border border-neutral-800/40 flex justify-between items-center">
                          <span className="text-xs text-neutral-400">Total Rows</span>
                          <span className="text-sm font-extrabold text-neutral-200">{uploadData.totalRecords}</span>
                        </div>

                        <div className="bg-emerald-950/20 p-4 rounded-xl border border-emerald-900/25 flex justify-between items-center">
                          <span className="text-xs text-emerald-400">Valid Leads</span>
                          <span className="text-sm font-extrabold text-emerald-400">{uploadData.validCount}</span>
                        </div>

                        <div className="bg-neutral-900/20 p-4 rounded-xl border border-neutral-800/30 flex justify-between items-center">
                          <span className="text-xs text-neutral-500">Skipped Empty Rows</span>
                          <span className="text-sm font-extrabold text-neutral-500">{uploadData.skippedCount}</span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2.5 pt-2">
                        <button 
                          onClick={startImportPipeline}
                          className="w-full py-3 bg-neutral-100 hover:bg-neutral-200 text-neutral-950 text-xs font-bold rounded-xl shadow-lg transition-all duration-300"
                        >
                          Confirm and Import
                        </button>
                        <button 
                          onClick={resetState}
                          className="w-full py-3 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs font-bold rounded-xl text-neutral-400 hover:text-neutral-200 transition-all duration-300"
                        >
                          Discard File
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Preview Grid */}
                  <div className="md:col-span-2">
                    <div className="bg-neutral-900/25 border border-neutral-900/80 rounded-2xl overflow-hidden h-full flex flex-col">
                      <div className="p-5 border-b border-neutral-900 bg-neutral-900/40">
                        <h3 className="text-xs font-bold text-neutral-400 tracking-wider uppercase">File Data Preview (Top 10 Rows)</h3>
                      </div>
                      <div className="overflow-x-auto flex-1">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-neutral-950/40 text-neutral-400 font-bold border-b border-neutral-900">
                              {Object.keys(uploadData.previewRows[0] || {}).map((header, idx) => (
                                <th key={idx} className="p-4 font-semibold whitespace-nowrap">{header}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {uploadData.previewRows.map((row, rowIdx) => (
                              <tr key={rowIdx} className="border-b border-neutral-900/50 hover:bg-neutral-900/10 text-neutral-300 transition-colors">
                                {Object.values(row).map((val: any, valIdx) => (
                                  <td key={valIdx} className="p-4 whitespace-nowrap text-neutral-400">{String(val || '')}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                </div>
              )}

              {/* Step 3: SSE Processing Progress Card */}
              {isProcessing && (
                <div className="bg-neutral-900/20 border border-neutral-900 rounded-3xl p-12 max-w-xl mx-auto w-full text-center space-y-8 backdrop-blur-md">
                  <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
                    <div className="absolute inset-0 border-4 border-neutral-800 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-teal-500 rounded-full animate-spin border-t-transparent"></div>
                    <RefreshCw className="w-6 h-6 text-teal-400 animate-pulse" />
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-md font-bold text-neutral-200 tracking-tight">{statusMessage}</h3>
                    {stats && (
                      <p className="text-xs text-neutral-400">
                        Mapped leads: <strong className="text-neutral-200">{stats.processed}</strong> / Total: <strong className="text-neutral-400">{uploadData?.validCount}</strong>
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="w-full bg-neutral-900 rounded-full h-2 overflow-hidden border border-neutral-800">
                      <div 
                        className="bg-gradient-to-r from-teal-500 to-emerald-500 h-full transition-all duration-500 rounded-full"
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                    <div className="flex justify-between text-[10px] text-neutral-500 font-bold tracking-wider">
                      <span>0%</span>
                      <span>{progress}%</span>
                      <span>100%</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 4: Finished Result Tables */}
              {importResult && (
                <div className="space-y-8">
                  <div className="bg-neutral-900/30 border border-neutral-900/80 p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div>
                      <h3 className="text-md font-bold text-neutral-200">Import Job Complete</h3>
                      <p className="text-xs text-neutral-500 mt-1">Run ID: {importResult.runId}</p>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-6 text-xs text-neutral-300">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                        <span>Imported: <strong>{importResult.processedRecords}</strong></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500/60"></span>
                        <span>Skipped: <strong>{importResult.skippedRecords}</strong></span>
                      </div>
                      <button 
                        onClick={resetState}
                        className="px-5 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-950 text-xs font-bold rounded-xl transition-all duration-300 shadow-md"
                      >
                        Reset Pipeline
                      </button>
                    </div>
                  </div>

                  <div className="bg-neutral-900/20 border border-neutral-900 rounded-2xl overflow-hidden">
                    <div className="p-5 border-b border-neutral-900 bg-neutral-900/40">
                      <h3 className="text-xs font-bold text-neutral-400 tracking-wider uppercase">Extracted Leads Record ({importResult.leads.length})</h3>
                    </div>
                    <div className="overflow-x-auto max-h-96 overflow-y-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-neutral-950/60 text-neutral-400 font-bold border-b border-neutral-900 sticky top-0 z-10">
                            <th className="p-4 bg-neutral-950/60 font-semibold">Created At</th>
                            <th className="p-4 bg-neutral-950/60 font-semibold">Name</th>
                            <th className="p-4 bg-neutral-950/60 font-semibold">Email</th>
                            <th className="p-4 bg-neutral-950/60 font-semibold">Phone</th>
                            <th className="p-4 bg-neutral-950/60 font-semibold">Company</th>
                            <th className="p-4 bg-neutral-950/60 font-semibold">City/State</th>
                            <th className="p-4 bg-neutral-950/60 font-semibold">CRM Status</th>
                            <th className="p-4 bg-neutral-950/60 font-semibold">Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importResult.leads.map((lead, idx) => (
                            <tr key={idx} className="border-b border-neutral-900 hover:bg-neutral-900/10 text-neutral-300 transition-colors">
                              <td className="p-4 whitespace-nowrap text-neutral-500">{new Date(lead.createdAt).toLocaleString()}</td>
                              <td className="p-4 font-bold whitespace-nowrap text-neutral-200">{lead.name || '-'}</td>
                              <td className="p-4 whitespace-nowrap text-neutral-400">{lead.email || '-'}</td>
                              <td className="p-4 whitespace-nowrap text-neutral-400">
                                {lead.countryCode ? `${lead.countryCode} ` : ''}{lead.mobileWithoutCountryCode || '-'}
                              </td>
                              <td className="p-4 whitespace-nowrap text-neutral-400">{lead.company || '-'}</td>
                              <td className="p-4 whitespace-nowrap text-neutral-400">
                                {[lead.city, lead.state].filter(Boolean).join(', ') || '-'}
                              </td>
                              <td className="p-4 whitespace-nowrap">
                                <span className={`px-2.5 py-1 rounded text-[10px] font-bold ${
                                  lead.crmStatus === 'SALE_DONE' ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/30' :
                                  lead.crmStatus === 'GOOD_LEAD_FOLLOW_UP' ? 'bg-teal-950/40 text-teal-400 border border-teal-900/30' :
                                  lead.crmStatus === 'DID_NOT_CONNECT' ? 'bg-amber-950/40 text-amber-400 border border-amber-900/30' :
                                  'bg-red-950/40 text-red-400 border border-red-900/30'
                                }`}>
                                  {lead.crmStatus}
                                </span>
                              </td>
                              <td className="p-4 text-neutral-400 max-w-xs truncate" title={lead.crmNote || ''}>
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
          </div>
        ) : (
          /* History View Tab */
          <div className="bg-neutral-900/20 border border-neutral-900 rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-neutral-900 bg-neutral-900/40">
              <h3 className="text-xs font-bold text-neutral-400 tracking-wider uppercase">Lead Intake logs</h3>
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
                    <tr key={idx} className="border-b border-neutral-900 hover:bg-neutral-900/10 text-neutral-300 transition-colors">
                      <td className="p-4 text-neutral-500 whitespace-nowrap">{new Date(run.createdAt).toLocaleString()}</td>
                      <td className="p-4 font-bold whitespace-nowrap text-neutral-200">{run.fileName}</td>
                      <td className="p-4 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          run.status === 'COMPLETED' ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/30' :
                          run.status === 'PROCESSING' ? 'bg-teal-950/40 text-teal-400 border border-teal-900/30' :
                          'bg-amber-950/40 text-amber-400 border border-amber-900/30'
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
                          className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-[10px] font-bold rounded-xl text-teal-400 transition-all duration-300"
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  ))}
                  {history.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-neutral-500">
                        No logs recorded yet. Upload a lead database to begin.
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
