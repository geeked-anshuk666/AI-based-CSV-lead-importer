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
  Database,
  Search,
  Users,
  Layers,
  Briefcase,
  Settings,
  HelpCircle,
  Check,
  X
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
  const [activeView, setActiveView] = useState<'manage' | 'history'>('manage');
  const [showImportModal, setShowImportModal] = useState(false);
  const [importStep, setImportStep] = useState<1 | 2 | 3>(1);
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

  // State for Step 3: Processing and Results
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

  // History Runs & Leads list
  const [history, setHistory] = useState<ImportRun[]>([]);
  const [dbLeads, setDbLeads] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sseRef = useRef<EventSource | null>(null);

  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:5000/api';

  useEffect(() => {
    fetchHistory();
    fetchLeads();
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

  const fetchLeads = async () => {
    try {
      const res = await fetch(`${API_BASE}/imports/history`);
      if (res.ok) {
        const runs = await res.json();
        let allLeads: any[] = [];
        for (const run of runs) {
          if (run.status === 'COMPLETED') {
            const detailRes = await fetch(`${API_BASE}/imports/${run.id}`);
            if (detailRes.ok) {
              const details = await detailRes.json();
              if (details.leads) {
                allLeads = [...allLeads, ...details.leads];
              }
            }
          }
        }
        allLeads.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setDbLeads(allLeads);
      }
    } catch (err) {
      console.error('Failed to fetch database leads:', err);
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
      setImportStep(2);
    } catch (err: any) {
      setError(err.message || 'An error occurred during file parsing.');
      setFile(null);
    }
  };

  const startImportPipeline = () => {
    if (!uploadData) return;

    setImportStep(3);
    setIsProcessing(true);
    setError(null);
    setStatusMessage('Publishing tasks to worker queue...');

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
          fetchLeads();
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

  // Remove a specific record row from the upload data state prior to import
  const handleRemoveRecord = (rowIdxToRemove: number) => {
    if (!uploadData) return;
    const updatedRows = [...uploadData.previewRows];
    updatedRows.splice(rowIdxToRemove, 1);
    
    setUploadData({
      ...uploadData,
      totalRecords: uploadData.totalRecords - 1,
      validCount: uploadData.validCount - 1,
      previewRows: updatedRows
    });
  };

  // Delete a lead record directly from the database table (Screenshot 3 request)
  const handleDeleteLead = async (leadId: string) => {
    try {
      const res = await fetch(`${API_BASE}/leads/${leadId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setDbLeads(prev => prev.filter(l => l.id !== leadId));
      } else {
        const errData = await res.json();
        console.error('Delete failed:', errData.error);
      }
    } catch (err) {
      console.error('Failed to delete lead from database:', err);
    }
  };

  const resetState = () => {
    setFile(null);
    setUploadData(null);
    setImportResult(null);
    setStats(null);
    setProgress(0);
    setError(null);
    setImportStep(1);
  };

  const closeImportModal = () => {
    setShowImportModal(false);
    resetState();
  };

  const filteredLeads = dbLeads.filter(lead => {
    const query = searchQuery.toLowerCase();
    return (
      (lead.name && lead.name.toLowerCase().includes(query)) ||
      (lead.email && lead.email.toLowerCase().includes(query)) ||
      (lead.company && lead.company.toLowerCase().includes(query)) ||
      (lead.mobileWithoutCountryCode && lead.mobileWithoutCountryCode.includes(query))
    );
  });

  return (
    <div className="min-h-[100dvh] bg-neutral-950 text-neutral-100 flex font-sans selection:bg-teal-500 selection:text-white relative overflow-hidden">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap');
        body {
          font-family: 'Outfit', sans-serif;
        }
      `}</style>

      {/* Decorative Lights */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-teal-500/5 rounded-full blur-[120px] pointer-events-none -translate-y-1/2"></div>
      <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-[150px] pointer-events-none translate-y-1/2"></div>

      {/* Navigation Sidebar */}
      <aside className="w-64 border-r border-neutral-900/60 bg-neutral-950/70 backdrop-blur-xl flex flex-col z-20 shrink-0">
        <div className="p-6 border-b border-neutral-900/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-teal-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-teal-500/10">
              <Database className="w-4.5 h-4.5 text-neutral-950 stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-neutral-200 tracking-tight">LeadFlow AI</h2>
              <div className="flex items-center gap-1.5 text-[10px] text-teal-400 font-bold uppercase tracking-wider mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-400"></span>
                <span>Active Portal</span>
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-6 overflow-y-auto">
          <div className="space-y-1">
            <span className="px-3 text-[10px] uppercase tracking-wider font-bold text-neutral-600 block mb-2">Main Functions</span>
            
            <button 
              onClick={() => setActiveView('manage')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all ${
                activeView === 'manage' 
                  ? 'bg-neutral-900/80 text-teal-400 border border-neutral-800/40 shadow-inner' 
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/30'
              }`}
            >
              <Users className="w-4 h-4" />
              Manage Leads
            </button>

            <button 
              onClick={() => setActiveView('history')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all ${
                activeView === 'history' 
                  ? 'bg-neutral-900/80 text-teal-400 border border-neutral-800/40 shadow-inner' 
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/30'
              }`}
            >
              <Layers className="w-4 h-4" />
              Lead Source Logs
            </button>
          </div>

          <div className="space-y-1">
            <span className="px-3 text-[10px] uppercase tracking-wider font-bold text-neutral-600 block mb-2">Control Center</span>
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-neutral-500 cursor-not-allowed">
              <Briefcase className="w-4 h-4" />
              Team Members
            </div>
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-neutral-500 cursor-not-allowed">
              <Settings className="w-4 h-4" />
              Portal Settings
            </div>
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-neutral-500 cursor-not-allowed">
              <HelpCircle className="w-4 h-4" />
              Help Center
            </div>
          </div>
        </nav>

        <div className="p-4 border-t border-neutral-900/60 bg-neutral-950/40 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-xs font-bold text-neutral-300">
            A
          </div>
          <div>
            <h4 className="text-xs font-bold text-neutral-300">Administrator</h4>
            <p className="text-[10px] text-neutral-500 mt-0.5">System Owner</p>
          </div>
        </div>
      </aside>

      {/* Main Canvas */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {activeView === 'manage' ? (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="p-8 border-b border-neutral-900/30 bg-neutral-950/20 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <h2 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-neutral-50 to-neutral-300 bg-clip-text text-transparent">Manage Your Leads</h2>
                <p className="text-xs text-neutral-500 mt-1 font-medium">Monitor lead status, verify dynamic properties, and check ingestion streams.</p>
              </div>
              <div>
                <button 
                  onClick={() => setShowImportModal(true)}
                  className="px-5 py-3 bg-neutral-100 hover:bg-neutral-200 text-neutral-950 text-xs font-bold rounded-xl shadow-lg transition-all duration-300 active:scale-[0.98]"
                >
                  Import Leads via CSV
                </button>
              </div>
            </div>

            <div className="px-8 py-5 border-b border-neutral-900/20 bg-neutral-950/10 flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                <input 
                  type="text"
                  placeholder="Enter email or phone number..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-neutral-900/50 hover:bg-neutral-900/70 border border-neutral-800/80 focus:border-neutral-700 rounded-xl text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none transition-all"
                />
              </div>

              <div className="flex gap-2.5 w-full sm:w-auto justify-end">
                <button 
                  onClick={fetchLeads}
                  className="p-2.5 bg-neutral-900/50 border border-neutral-800/80 rounded-xl text-neutral-400 hover:text-neutral-200 transition-all active:scale-[0.96]"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto px-8 py-6">
              <div className="bg-neutral-900/10 border border-neutral-900/40 rounded-2xl overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-neutral-950/40 text-neutral-400 font-bold border-b border-neutral-900/40">
                      <th className="p-4 font-semibold">Lead Name</th>
                      <th className="p-4 font-semibold">Email</th>
                      <th className="p-4 font-semibold">Contact</th>
                      <th className="p-4 font-semibold">Date Created</th>
                      <th className="p-4 font-semibold">Company</th>
                      <th className="p-4 font-semibold">Status</th>
                      <th className="p-4 font-semibold">Notes</th>
                      <th className="p-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLeads.map((lead, idx) => (
                      <tr key={idx} className="border-b border-neutral-900/20 hover:bg-neutral-900/10 text-neutral-300 transition-colors">
                        <td className="p-4 font-bold whitespace-nowrap text-neutral-200">{lead.name || '-'}</td>
                        <td className="p-4 whitespace-nowrap text-neutral-400">{lead.email || '-'}</td>
                        <td className="p-4 whitespace-nowrap text-neutral-400">
                          {lead.countryCode ? `${lead.countryCode} ` : ''}{lead.mobileWithoutCountryCode || '-'}
                        </td>
                        <td className="p-4 whitespace-nowrap text-neutral-500">
                          {new Date(lead.createdAt).toLocaleString()}
                        </td>
                        <td className="p-4 whitespace-nowrap text-neutral-400">{lead.company || '-'}</td>
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
                        {/* Red X Button to manually delete database lead record */}
                        <td className="p-4 text-right whitespace-nowrap">
                          <button
                            onClick={() => handleDeleteLead(lead.id)}
                            className="p-1.5 bg-red-950/15 hover:bg-red-950/40 border border-red-900/20 hover:border-red-900/40 rounded-lg text-red-400 transition-all active:scale-[0.92]"
                            title="Delete Lead Record"
                          >
                            <X className="w-3.5 h-3.5 stroke-[2.5]" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredLeads.length === 0 && (
                      <tr>
                        <td colSpan={8} className="p-12 text-center text-neutral-500">
                          No leads matching search query. Import contacts to fill rows database.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-grow p-8 space-y-6">
            <div>
              <h2 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-neutral-50 to-neutral-300 bg-clip-text text-transparent">Lead Source History Logs</h2>
              <p className="text-xs text-neutral-500 mt-1 font-medium">Verify system processing statistics and worker execution history records.</p>
            </div>

            <div className="bg-neutral-900/25 border border-neutral-900/30 rounded-2xl overflow-hidden">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-neutral-950/60 text-neutral-400 font-bold border-b border-neutral-900/40">
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
                    <tr key={idx} className="border-b border-neutral-900/20 hover:bg-neutral-900/10 text-neutral-300 transition-colors">
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
                            setShowImportModal(true);
                            setImportStep(2);
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
      </div>

      {/* Stepped Import Wizard Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-neutral-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-neutral-900 border border-neutral-900/40 rounded-[20px] w-full max-w-[1200px] h-[85vh] overflow-hidden shadow-2xl flex flex-col relative animate-in fade-in zoom-in-95 duration-200">
            
            {/* Modal Header: Glaring line removed */}
            <div className="px-8 py-5 bg-neutral-900/40 flex justify-between items-center h-[80px] shrink-0">
              <div className="flex items-center gap-6">
                <h3 className="text-xl font-bold text-neutral-200">Import Leads</h3>
                {uploadData && importStep === 2 && (
                  <div className="flex items-center gap-3 text-xs text-neutral-450 border-l border-neutral-900/60 pl-6 h-5">
                    <span className="font-semibold text-neutral-350">{uploadData.fileName}</span>
                    <span className="text-neutral-800">|</span>
                    <span className="text-teal-400 font-medium">✓ Valid ({uploadData.validCount})</span>
                    <span className="text-neutral-800">|</span>
                    <span className="text-neutral-500 font-medium">○ Skipped ({uploadData.skippedCount})</span>
                  </div>
                )}
              </div>
              <button 
                onClick={closeImportModal}
                className="p-1.5 hover:bg-neutral-800 rounded-lg text-neutral-500 hover:text-neutral-300 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Stepper Progress Indicator: Glaring line removed */}
            <div className="px-8 py-3 bg-neutral-900/20 flex gap-8 items-center h-[50px] shrink-0">
              <div className="flex items-center gap-2">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  importStep >= 1 ? 'bg-teal-500 text-neutral-950' : 'bg-neutral-800 text-neutral-500'
                }`}>
                  {importStep > 1 ? <Check className="w-3 h-3 text-neutral-950 stroke-[3]" /> : '1'}
                </div>
                <span className="text-[10px] uppercase tracking-wider font-bold text-neutral-400">Upload</span>
              </div>

              <div className="flex items-center gap-2">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  importStep >= 2 ? 'bg-teal-500 text-neutral-950' : 'bg-neutral-800 text-neutral-500'
                }`}>
                  {importStep > 2 ? <Check className="w-3 h-3 text-neutral-950 stroke-[3]" /> : '2'}
                </div>
                <span className="text-[10px] uppercase tracking-wider font-bold text-neutral-400">Preview</span>
              </div>

              <div className="flex items-center gap-2">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  importStep >= 3 ? 'bg-teal-500 text-neutral-950' : 'bg-neutral-800 text-neutral-500'
                }`}>
                  3
                </div>
                <span className="text-[10px] uppercase tracking-wider font-bold text-neutral-400">Process</span>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-hidden relative bg-neutral-950/20">
              
              {/* Step 1: Upload Dropzone */}
              {importStep === 1 && (
                <div className="p-8 h-full flex flex-col justify-center space-y-6">
                  <div 
                    onDragEnter={handleDrag}
                    onDragOver={handleDrag}
                    onDragLeave={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer transition-all duration-300 relative overflow-hidden group max-w-xl mx-auto w-full ${
                      dragActive 
                        ? 'border-teal-500 bg-teal-950/10 shadow-lg shadow-teal-500/5' 
                        : 'border-neutral-800 hover:border-neutral-700 bg-neutral-900/10'
                    }`}
                  >
                    <label htmlFor="modal-csv-input" className="sr-only">Upload CSV File</label>
                    <input 
                      type="file" 
                      id="modal-csv-input"
                      ref={fileInputRef} 
                      onChange={handleFileChange} 
                      className="hidden" 
                      accept=".csv"
                    />
                    <div className="w-12 h-12 bg-neutral-950 rounded-xl flex items-center justify-center mx-auto mb-4 border border-neutral-800">
                      <Upload className="w-5 h-5 text-neutral-400 group-hover:text-teal-400 transition-colors" />
                    </div>
                    <h4 className="text-sm font-bold text-neutral-200">Drop your CSV file here</h4>
                    <p className="text-[10px] text-neutral-500 mt-1 max-w-xs mx-auto leading-relaxed">
                      Or click to browse local directories (max size 5MB).
                    </p>
                  </div>

                  <div className="bg-neutral-950/40 p-5 rounded-xl border border-neutral-900/30 max-w-xl mx-auto w-full">
                    <h5 className="text-[10px] uppercase tracking-wider font-bold text-neutral-400 mb-2">Required Headers</h5>
                    <p className="text-[10px] text-neutral-500 leading-relaxed">
                      Headers must match exactly: <code className="text-teal-400 bg-teal-950/30 px-1 py-0.5 rounded">created_at</code>, <code className="text-teal-400 bg-teal-950/30 px-1 py-0.5 rounded">name</code>, <code className="text-teal-400 bg-teal-950/30 px-1 py-0.5 rounded">email</code>, <code className="text-teal-400 bg-teal-950/30 px-1 py-0.5 rounded">country_code</code>, <code className="text-teal-400 bg-teal-950/30 px-1 py-0.5 rounded">mobile_without_country_code</code>.
                    </p>
                  </div>
                </div>
              )}

              {/* Step 2: Zebra Table Preview with Red Delete button */}
              {importStep === 2 && uploadData && (
                <div className="h-full flex flex-col p-8 space-y-4">
                  <div className="relative w-full max-w-xs shrink-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500" />
                    <input 
                      type="text"
                      placeholder="Search preview rows..."
                      onChange={(e) => {
                        const query = e.target.value.toLowerCase();
                        const tableRows = document.querySelectorAll('.preview-row');
                        tableRows.forEach((row: any) => {
                          const text = row.innerText.toLowerCase();
                          row.style.display = text.includes(query) ? '' : 'none';
                        });
                      }}
                      className="w-full pl-9 pr-4 py-2 bg-neutral-900/50 hover:bg-neutral-900/70 border border-neutral-800/60 rounded-xl text-xs text-neutral-200 focus:outline-none transition-all"
                    />
                  </div>

                  <div className="flex-1 overflow-auto border border-neutral-900/30 rounded-[14px] bg-neutral-900/20">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-neutral-950 text-neutral-400 font-medium border-b border-neutral-900/40 sticky top-0 z-10">
                          {Object.keys(uploadData.previewRows[0] || {}).map((header, idx) => (
                            <th key={idx} className="p-4 bg-neutral-950">{header}</th>
                          ))}
                          <th className="p-4 bg-neutral-950 text-right w-12">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {uploadData.previewRows.map((row, rowIdx) => (
                          <tr 
                            key={rowIdx} 
                            className={`preview-row border-b border-neutral-900/20 text-neutral-300 transition-colors ${
                              rowIdx % 2 === 0 ? 'bg-neutral-900' : 'bg-neutral-950/40'
                            }`}
                          >
                            {Object.values(row).map((val: any, valIdx) => (
                              <td key={valIdx} className="p-4 whitespace-nowrap text-neutral-400">{String(val || '')}</td>
                            ))}
                            {/* Red X Button to manually delete lead record prior to import (Screenshot 3 style) */}
                            <td className="p-4 text-right whitespace-nowrap">
                              <button
                                onClick={() => handleRemoveRecord(rowIdx)}
                                className="p-1.5 bg-red-950/15 hover:bg-red-950/40 border border-red-900/20 hover:border-red-900/40 rounded-lg text-red-400 transition-all active:scale-[0.92]"
                                title="Remove Lead Record"
                              >
                                <X className="w-3.5 h-3.5 stroke-[2.5]" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Step 3: Thick Progress Bar matching Screenshot 2 */}
              {importStep === 3 && (
                <div className="p-8 h-full flex flex-col justify-center">
                  {isProcessing ? (
                    <div className="max-w-2xl mx-auto w-full bg-neutral-900/60 p-8 rounded-2xl border border-neutral-900/40 space-y-5 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)]">
                      {/* Top Header Row of Ingestion */}
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-neutral-200 tracking-tight">{statusMessage}</span>
                        <span className="font-bold text-teal-400">{progress}%</span>
                      </div>

                      {/* Wide Thicker Ingestion Progress Bar (Height 12px) */}
                      <div className="w-full bg-neutral-950 rounded-full h-3 overflow-hidden border border-neutral-900/30">
                        <div 
                          className="bg-gradient-to-r from-teal-500 to-emerald-500 h-full transition-all duration-300 rounded-full"
                          style={{ width: `${progress}%` }}
                        ></div>
                      </div>

                      {/* Bottom Info Row */}
                      {stats && (
                        <div className="flex justify-between items-center text-[10px] text-neutral-500 font-bold uppercase tracking-wider">
                          <span>0%</span>
                          <span>Mapped leads: {stats.processed} / Total: {uploadData?.validCount}</span>
                          <span>100%</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    importResult && (
                      <div className="max-w-xl mx-auto w-full space-y-6">
                        <div className="bg-emerald-950/20 border border-emerald-900/30 p-5 rounded-2xl flex items-center gap-4">
                          <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
                          <div>
                            <h4 className="text-sm font-bold text-emerald-400">Lead Database Synchronization Succeeded</h4>
                            <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                              Leads records were parsed, verified, and mapped successfully to active database rows.
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="bg-neutral-950/40 p-4 rounded-xl border border-neutral-900/30">
                            <span className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider block">Imported Records</span>
                            <span className="text-lg font-bold text-teal-400 mt-1 block">{importResult.processedRecords}</span>
                          </div>

                          <div className="bg-neutral-950/40 p-4 rounded-xl border border-neutral-900/30">
                            <span className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider block">Skipped Records</span>
                            <span className="text-lg font-bold text-neutral-500 mt-1 block">{importResult.skippedRecords}</span>
                          </div>
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}

            </div>

            {/* Modal Footer: Glaring line removed */}
            <div className="px-8 py-5 bg-neutral-900/40 flex justify-between items-center h-[80px] shrink-0">
              <div>
                {uploadData && importStep === 2 && (
                  <span className="text-xs text-neutral-550 tracking-wide font-semibold">
                    {uploadData.fileName} • {uploadData.validCount} records ready
                  </span>
                )}
              </div>
              
              <div className="flex gap-3">
                <button 
                  onClick={closeImportModal}
                  className="px-5 py-2.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs font-bold rounded-xl text-neutral-400 hover:text-neutral-200 transition-all duration-300"
                >
                  Cancel
                </button>
                {importStep === 2 && uploadData && (
                  <button 
                    onClick={startImportPipeline}
                    className="px-5 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-950 text-xs font-bold rounded-xl shadow-lg transition-all duration-300"
                  >
                    Import {uploadData.validCount} Leads
                  </button>
                )}
                {importStep === 3 && !isProcessing && (
                  <button 
                    onClick={closeImportModal}
                    className="px-5 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-950 text-xs font-bold rounded-xl shadow-lg transition-all duration-300"
                  >
                    Finish
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
