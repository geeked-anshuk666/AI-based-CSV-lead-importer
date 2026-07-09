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
  X,
  AlertTriangle
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
  const [isModalAnimating, setIsModalAnimating] = useState(false);

  // Shared confirmation dialog for both delete contexts
  const [confirmDialog, setConfirmDialog] = useState<{
    type: 'lead' | 'previewRow' | 'bulkDelete';
    leadId?: string;
    leadName?: string;
    rowIdx?: number;
    bulkIds?: string[];
  } | null>(null);

  // Bulk selection state for main dashboard
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  
  // State for View Details modal
  const [selectedHistoryRun, setSelectedHistoryRun] = useState<{
    id: string;
    fileName: string;
    totalRecords: number;
    processedRecords: number;
    skippedRecords: number;
    createdAt: string;
    leads: any[];
  } | null>(null);

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

  const startImportPipeline = async () => {
    if (!uploadData) return;

    setError(null);
    setIsProcessing(true);
    setStatusMessage('Sending confirmed records to worker queue...');

    try {
      // BUG FIX: Send the (possibly pruned) rows to the confirm endpoint.
      // The worker has NOT processed anything yet - upload only parsed and stored rows.
      const confirmRes = await fetch(`${API_BASE}/imports/${uploadData.runId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: uploadData.previewRows })
      });

      if (!confirmRes.ok) {
        const errData = await confirmRes.json();
        throw new Error(errData.error || 'Failed to confirm import.');
      }

      const confirmData = await confirmRes.json();

      // If user pruned all rows to 0, skip to a completed state immediately
      if (uploadData.previewRows.length === 0) {
        setImportStep(3);
        setIsProcessing(false);
        setStatusMessage('Import completed - 0 records were selected for import.');
        setImportResult({
          ...uploadData,
          processedRecords: 0,
          skippedRecords: 0,
          leads: []
        });
        fetchHistory();
        return;
      }

      // Transition to step 3 with animation, then subscribe to SSE
      setIsModalAnimating(true);
      setTimeout(() => {
        setImportStep(3);
        setIsModalAnimating(false);
      }, 350);

      setStatusMessage(`Mapping ${uploadData.previewRows.length} leads dynamically...`);

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
    } catch (err: any) {
      setError(err.message || 'Failed to start import pipeline.');
      setIsProcessing(false);
    }
  };

  const fetchImportDetails = async (runId: string) => {
    try {
      const res = await fetch(`${API_BASE}/imports/${runId}`);
      if (res.ok) {
        const data = await res.json();
        setImportResult(data);
        return data;
      }
    } catch (err) {
      console.error('Error fetching final import details:', err);
    }
    return null;
  };

  const handleViewHistoryDetails = async (run: any) => {
    try {
      setError(null);
      // Fetch details which include all imported leads for this run
      const res = await fetch(`${API_BASE}/imports/${run.id}`);
      if (res.ok) {
        const data = await res.json();
        // Store only up to first 10 leads for record preview as requested
        setSelectedHistoryRun({
          ...run,
          leads: data.leads || []
        });
      } else {
        console.error('Failed to fetch details for log view');
      }
    } catch (err) {
      console.error('Error fetching history details:', err);
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

  // Delete a lead record directly from the database table
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

  // Confirm handler — runs the right deletion based on dialog type
  const handleConfirmDelete = async () => {
    if (!confirmDialog) return;
    if (confirmDialog.type === 'lead' && confirmDialog.leadId) {
      await handleDeleteLead(confirmDialog.leadId);
    } else if (confirmDialog.type === 'previewRow' && confirmDialog.rowIdx !== undefined) {
      handleRemoveRecord(confirmDialog.rowIdx);
    } else if (confirmDialog.type === 'bulkDelete' && confirmDialog.bulkIds) {
      // Fire all deletes in parallel for efficiency
      await Promise.all(confirmDialog.bulkIds.map(id => handleDeleteLead(id)));
      setSelectedLeads(new Set());
    }
    setConfirmDialog(null);
  };

  // Toggle a single lead's selection
  const toggleSelectLead = (id: string) => {
    setSelectedLeads(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Select or deselect all currently visible (filtered) leads
  const toggleSelectAll = () => {
    const allIds = filteredLeads.map((l: any) => l.id);
    const allSelected = allIds.every((id: string) => selectedLeads.has(id));
    setSelectedLeads(allSelected ? new Set() : new Set(allIds));
  };

  const resetState = () => {
    setFile(null);
    setUploadData(null);
    setImportResult(null);
    setStats(null);
    setProgress(0);
    setError(null);
    setIsModalAnimating(false);
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
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all ${activeView === 'manage'
                  ? 'bg-neutral-900/80 text-teal-400 border border-neutral-800/40 shadow-inner'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/30'
                }`}
            >
              <Users className="w-4 h-4" />
              Manage Leads
            </button>

            <button
              onClick={() => setActiveView('history')}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold tracking-wide transition-all ${activeView === 'history'
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

            {/* ── Toolbar: search + refresh, or bulk-action bar when rows selected ── */}
            {selectedLeads.size > 0 ? (
              <div className="px-8 py-4 border-b border-neutral-900/20 bg-neutral-950/30 flex items-center gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
                {/* Count badge */}
                <span className="px-3 py-1.5 bg-teal-950/40 border border-teal-900/30 rounded-lg text-[11px] font-bold text-teal-400 tabular-nums">
                  {selectedLeads.size} selected
                </span>

                <div className="h-4 w-px bg-neutral-800" />

                {/* Select All */}
                <button
                  onClick={() => setSelectedLeads(new Set(filteredLeads.map((l: any) => l.id)))}
                  className="px-3 py-1.5 bg-neutral-900/60 hover:bg-neutral-800 border border-neutral-800/60 rounded-lg text-[11px] font-semibold text-neutral-300 hover:text-neutral-100 transition-all duration-150"
                >
                  Select All ({filteredLeads.length})
                </button>

                {/* Unselect All */}
                <button
                  onClick={() => setSelectedLeads(new Set())}
                  className="px-3 py-1.5 bg-neutral-900/60 hover:bg-neutral-800 border border-neutral-800/60 rounded-lg text-[11px] font-semibold text-neutral-300 hover:text-neutral-100 transition-all duration-150"
                >
                  Unselect All
                </button>

                <div className="flex-1" />

                {/* Bulk Delete */}
                <button
                  onClick={() => setConfirmDialog({
                    type: 'bulkDelete',
                    bulkIds: Array.from(selectedLeads)
                  })}
                  className="flex items-center gap-2 px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white text-[11px] font-bold rounded-lg shadow-md shadow-red-900/20 transition-all duration-150 active:scale-[0.97]"
                >
                  <X className="w-3 h-3 stroke-[3]" />
                  Delete {selectedLeads.size} Records
                </button>
              </div>
            ) : (
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
            )}

            <div className="flex-1 overflow-auto px-8 py-6">
              <div className="bg-neutral-900/10 border border-neutral-900/40 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto overflow-y-visible">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-neutral-950/40 text-neutral-400 font-bold border-b border-neutral-900/40">
                        {/* Checkbox column header — select all toggle */}
                        <th className="p-3 w-10 sticky left-0 z-20 bg-neutral-950/90 backdrop-blur-sm">
                          <input
                            type="checkbox"
                            checked={filteredLeads.length > 0 && filteredLeads.every((l: any) => selectedLeads.has(l.id))}
                            onChange={toggleSelectAll}
                            className="w-3.5 h-3.5 rounded accent-teal-500 cursor-pointer"
                            title="Select all"
                          />
                        </th>
                        {/* X column header */}
                        <th className="p-2 w-8 sticky left-[52px] z-20 bg-neutral-950/90 backdrop-blur-sm"></th>
                        <th className="p-4 font-semibold">Lead Name</th>
                        <th className="p-4 font-semibold">Email</th>
                        <th className="p-4 font-semibold">Contact</th>
                        <th className="p-4 font-semibold">Date Created</th>
                        <th className="p-4 font-semibold">Company</th>
                        <th className="p-4 font-semibold">Status</th>
                        <th className="p-4 font-semibold max-w-[160px]">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLeads.map((lead, idx) => {
                        const isSelected = selectedLeads.has(lead.id);
                        return (
                          <tr
                            key={lead.id ?? idx}
                            className={`border-b border-neutral-900/20 text-neutral-300 transition-colors group ${
                              isSelected
                                ? 'bg-teal-950/20 hover:bg-teal-950/30'
                                : 'hover:bg-neutral-900/10'
                            }`}
                          >
                            {/* Checkbox — sticky left col 1 */}
                            <td className={`p-3 sticky left-0 z-10 backdrop-blur-sm transition-colors ${
                              isSelected ? 'bg-teal-950/30' : 'bg-neutral-950 group-hover:bg-neutral-900/80'
                            }`}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelectLead(lead.id)}
                                className="w-3.5 h-3.5 rounded accent-teal-500 cursor-pointer"
                              />
                            </td>
                            {/* Red X — sticky col 2 */}
                            <td className={`p-2 sticky left-[52px] z-10 backdrop-blur-sm transition-colors ${
                              isSelected ? 'bg-teal-950/30' : 'bg-neutral-950 group-hover:bg-neutral-900/80'
                            }`}>
                              <button
                                onClick={() => setConfirmDialog({
                                  type: 'lead',
                                  leadId: lead.id,
                                  leadName: lead.name || lead.email || 'this lead'
                                })}
                                className="w-6 h-6 flex items-center justify-center bg-red-950/20 hover:bg-red-500 border border-red-900/30 hover:border-red-400 rounded-md text-red-400 hover:text-white transition-all duration-150 active:scale-[0.88]"
                                title="Delete this lead"
                              >
                                <X className="w-3 h-3 stroke-[2.5]" />
                              </button>
                            </td>
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
                              <span className={`px-2.5 py-1 rounded text-[10px] font-bold ${lead.crmStatus === 'SALE_DONE' ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/30' :
                                lead.crmStatus === 'GOOD_LEAD_FOLLOW_UP' ? 'bg-teal-950/40 text-teal-400 border border-teal-900/30' :
                                lead.crmStatus === 'DID_NOT_CONNECT' ? 'bg-amber-950/40 text-amber-400 border border-amber-900/30' :
                                'bg-red-950/40 text-red-400 border border-red-900/30'
                              }`}>
                                {lead.crmStatus}
                              </span>
                            </td>
                            <td className="p-4 text-neutral-400 max-w-[160px] truncate" title={lead.crmNote || ''}>
                              {lead.crmNote || '-'}
                            </td>
                          </tr>
                        );
                      })}
                      {filteredLeads.length === 0 && (
                        <tr>
                          <td colSpan={9} className="p-12 text-center text-neutral-500">
                            No leads matching search query. Import contacts to fill the database.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
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
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${run.status === 'COMPLETED' ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/30' :
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
                          onClick={() => handleViewHistoryDetails(run)}
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

      {/* Stepped Import Wizard Modal - dynamically sized per step */}
      {showImportModal && (
        <div className="fixed inset-0 bg-neutral-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div
            className="bg-neutral-900 border border-neutral-900/40 rounded-[20px] overflow-hidden shadow-2xl flex flex-col relative"
            style={{
              transition: 'width 0.45s cubic-bezier(0.4, 0, 0.2, 1), max-width 0.45s cubic-bezier(0.4, 0, 0.2, 1), height 0.45s cubic-bezier(0.4, 0, 0.2, 1)',
              width: '100%',
              maxWidth: importStep === 2 ? '1200px' : '560px',
              height: importStep === 2 ? '85vh' : 'auto',
              minHeight: importStep === 2 ? 'auto' : '420px'
            }}
          >

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
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${importStep >= 1 ? 'bg-teal-500 text-neutral-950' : 'bg-neutral-800 text-neutral-500'
                  }`}>
                  {importStep > 1 ? <Check className="w-3 h-3 text-neutral-950 stroke-[3]" /> : '1'}
                </div>
                <span className="text-[10px] uppercase tracking-wider font-bold text-neutral-400">Upload</span>
              </div>

              <div className="flex items-center gap-2">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${importStep >= 2 ? 'bg-teal-500 text-neutral-950' : 'bg-neutral-800 text-neutral-500'
                  }`}>
                  {importStep > 2 ? <Check className="w-3 h-3 text-neutral-950 stroke-[3]" /> : '2'}
                </div>
                <span className="text-[10px] uppercase tracking-wider font-bold text-neutral-400">Preview</span>
              </div>

              <div className="flex items-center gap-2">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${importStep >= 3 ? 'bg-teal-500 text-neutral-950' : 'bg-neutral-800 text-neutral-500'
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
                    className={`border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer transition-all duration-300 relative overflow-hidden group max-w-xl mx-auto w-full ${dragActive
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
                            className={`preview-row border-b border-neutral-900/20 text-neutral-300 transition-colors ${rowIdx % 2 === 0 ? 'bg-neutral-900' : 'bg-neutral-950/40'
                              }`}
                          >
                            {Object.values(row).map((val: any, valIdx) => (
                              <td key={valIdx} className="p-4 whitespace-nowrap text-neutral-400">{String(val || '')}</td>
                            ))}
                            {/* Red X - opens confirmation before removing from preview */}
                            <td className="p-4 text-right whitespace-nowrap">
                              <button
                                onClick={() => setConfirmDialog({
                                  type: 'previewRow',
                                  rowIdx: rowIdx
                                })}
                                className="p-1.5 bg-red-950/15 hover:bg-red-950/40 border border-red-900/20 hover:border-red-900/40 rounded-lg text-red-400 transition-all active:scale-[0.92]"
                                title="Remove from import"
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
                    {uploadData.fileName} • {uploadData.previewRows.length} records ready
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
                    disabled={isModalAnimating}
                    className="px-5 py-2.5 bg-neutral-100 hover:bg-neutral-200 disabled:opacity-50 text-neutral-950 text-xs font-bold rounded-xl shadow-lg transition-all duration-300"
                  >
                    Import {uploadData.previewRows.length} Leads
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

      {/* ── Confirmation Dialog ─────────────────────────────────────────── */}
      {confirmDialog && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(9, 9, 11, 0.75)', backdropFilter: 'blur(6px)' }}
        >
          <div
            className="bg-neutral-900 border border-neutral-800/60 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            style={{ animation: 'scaleIn 0.18s cubic-bezier(0.34,1.56,0.64,1) both' }}
          >
            {/* Danger header strip */}
            <div className="h-1 w-full bg-gradient-to-r from-red-600 to-rose-500" />

            <div className="p-7 space-y-5">
              {/* Icon + title row */}
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-red-950/40 border border-red-900/40 flex items-center justify-center shrink-0 mt-0.5">
                  <AlertTriangle className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-neutral-100 tracking-tight">
                    {confirmDialog.type === 'lead' ? 'Delete Lead Record' :
                     confirmDialog.type === 'bulkDelete' ? `Delete ${confirmDialog.bulkIds?.length} Records` :
                     'Remove from Import'}
                  </h3>
                  <p className="text-xs text-neutral-400 mt-2 leading-relaxed">
                    {confirmDialog.type === 'lead'
                      ? `This action is permanent and cannot be undone - once deleted, ${confirmDialog.leadName ? `"${confirmDialog.leadName}"` : 'this lead'
                      } will be removed from the database and all associated data will be lost forever.`
                      : confirmDialog.type === 'bulkDelete'
                      ? `You are about to permanently delete ${confirmDialog.bulkIds?.length} lead record${(confirmDialog.bulkIds?.length ?? 0) > 1 ? 's' : ''} from the database. This action is irreversible and cannot be undone — all associated data for the selected contacts will be lost forever.`
                      : 'This record will be excluded from the upcoming import. You can always re-upload the CSV file if you change your mind, but this action cannot be undone within the current session.'}
                  </p>
                </div>
              </div>

              {/* Divider */}
              <div className="h-px bg-neutral-800/60" />

              {/* Action buttons */}
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setConfirmDialog(null)}
                  className="px-5 py-2.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700/60 text-xs font-bold rounded-xl text-neutral-300 hover:text-neutral-100 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDelete}
                  className="px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-red-900/30 transition-all duration-200 active:scale-[0.97]"
                >
                  {confirmDialog.type === 'lead' ? 'Yes, Delete Permanently' :
                   confirmDialog.type === 'bulkDelete' ? `Yes, Delete ${confirmDialog.bulkIds?.length} Records` :
                   'Yes, Remove Record'}
                </button>
              </div>
            </div>
          </div>

          <style>{`
            @keyframes scaleIn {
              from { opacity: 0; transform: scale(0.92); }
              to   { opacity: 1; transform: scale(1); }
            }
          `}</style>
        </div>
      )}

      {/* ── View Details Modal ───────────────────────────────────────────── */}
      {selectedHistoryRun && (
        <div className="fixed inset-0 bg-neutral-950/85 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div
            className="bg-neutral-900 border border-neutral-800/60 rounded-[20px] overflow-hidden shadow-2xl flex flex-col relative w-full"
            style={{
              maxWidth: '1000px',
              height: '75vh',
            }}
          >
            {/* Modal Header */}
            <div className="px-8 py-5 bg-neutral-900/40 flex justify-between items-center h-[80px] shrink-0 border-b border-neutral-900/40">
              <div>
                <h3 className="text-lg font-bold text-neutral-200">Import Log Details</h3>
                <p className="text-[10px] text-neutral-500 font-semibold mt-0.5">
                  Imported on {new Date(selectedHistoryRun.createdAt).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => setSelectedHistoryRun(null)}
                className="p-1.5 hover:bg-neutral-800 rounded-lg text-neutral-500 hover:text-neutral-300 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-neutral-950/20">
              {/* Stats Grid */}
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-neutral-900/50 p-4 rounded-xl border border-neutral-800/40">
                  <span className="text-[9px] text-neutral-500 font-bold uppercase tracking-wider block">File Name</span>
                  <span className="text-xs font-bold text-neutral-200 mt-1 block truncate" title={selectedHistoryRun.fileName}>
                    {selectedHistoryRun.fileName}
                  </span>
                </div>
                <div className="bg-neutral-900/50 p-4 rounded-xl border border-neutral-800/40">
                  <span className="text-[9px] text-neutral-500 font-bold uppercase tracking-wider block">Total Records</span>
                  <span className="text-xs font-bold text-neutral-300 mt-1 block">
                    {selectedHistoryRun.totalRecords}
                  </span>
                </div>
                <div className="bg-neutral-900/50 p-4 rounded-xl border border-neutral-800/40">
                  <span className="text-[9px] text-neutral-500 font-bold uppercase tracking-wider block">Processed successfully</span>
                  <span className="text-xs font-bold text-teal-400 mt-1 block">
                    {selectedHistoryRun.processedRecords}
                  </span>
                </div>
                <div className="bg-neutral-900/50 p-4 rounded-xl border border-neutral-800/40">
                  <span className="text-[9px] text-neutral-500 font-bold uppercase tracking-wider block">Skipped Records</span>
                  <span className="text-xs font-bold text-neutral-500 mt-1 block">
                    {selectedHistoryRun.skippedRecords}
                  </span>
                </div>
              </div>

              {/* Records Section */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                    Imported Records Preview
                  </h4>
                  <span className="text-[10px] text-neutral-500 font-medium">
                    Showing first {Math.min(10, selectedHistoryRun.leads.length)} of {selectedHistoryRun.leads.length} leads
                  </span>
                </div>

                <div className="border border-neutral-900/40 rounded-xl overflow-hidden bg-neutral-900/10">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-neutral-950/60 text-neutral-400 font-semibold border-b border-neutral-900/40">
                          <th className="p-3 font-semibold">Lead Name</th>
                          <th className="p-3 font-semibold">Email</th>
                          <th className="p-3 font-semibold">Contact</th>
                          <th className="p-3 font-semibold">Company</th>
                          <th className="p-3 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedHistoryRun.leads.slice(0, 10).map((lead: any, leadIdx: number) => (
                          <tr
                            key={lead.id || leadIdx}
                            className={`border-b border-neutral-900/10 text-neutral-300 transition-colors ${
                              leadIdx % 2 === 0 ? 'bg-neutral-900/40' : 'bg-neutral-950/20'
                            }`}
                          >
                            <td className="p-3 font-semibold text-neutral-200">{lead.name || '-'}</td>
                            <td className="p-3 text-neutral-400">{lead.email || '-'}</td>
                            <td className="p-3 text-neutral-400">
                              {lead.countryCode ? `${lead.countryCode} ` : ''}{lead.mobileWithoutCountryCode || '-'}
                            </td>
                            <td className="p-3 text-neutral-450">{lead.company || '-'}</td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${
                                lead.crmStatus === 'SALE_DONE' ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-900/30' :
                                lead.crmStatus === 'GOOD_LEAD_FOLLOW_UP' ? 'bg-teal-950/40 text-teal-400 border border-teal-900/30' :
                                lead.crmStatus === 'DID_NOT_CONNECT' ? 'bg-amber-950/40 text-amber-400 border border-amber-900/30' :
                                'bg-red-950/40 text-red-400 border border-red-900/30'
                              }`}>
                                {lead.crmStatus}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {selectedHistoryRun.leads.length === 0 && (
                          <tr>
                            <td colSpan={5} className="p-8 text-center text-neutral-500 italic">
                              No records were processed for this run.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-8 py-5 bg-neutral-900/40 flex justify-end items-center h-[80px] shrink-0 border-t border-neutral-900/40">
              <button
                onClick={() => setSelectedHistoryRun(null)}
                className="px-5 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-950 text-xs font-bold rounded-xl shadow-lg transition-all duration-300"
              >
                Close View
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

  );
}
