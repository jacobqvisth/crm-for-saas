'use client';

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, FileText, Check, AlertCircle, ChevronRight, ChevronLeft, Download } from 'lucide-react';
import Papa from 'papaparse';
import { useWorkspace } from '@/lib/hooks/use-workspace';
import { createClient } from '@/lib/supabase/client';
import toast from 'react-hot-toast';
import type { InsertTables } from '@/lib/database.types';

type CsvRow = Record<string, string>;

const CONTACT_FIELDS = [
  { value: 'email', label: 'Email' },
  { value: 'first_name', label: 'First Name' },
  { value: 'last_name', label: 'Last Name' },
  { value: 'phone', label: 'Phone' },
  { value: 'company_name', label: 'Company Name' },
  { value: 'lead_status', label: 'Lead Status' },
] as const;

const HEADER_MAP: Record<string, string> = {
  'email': 'email', 'e-mail': 'email', 'email address': 'email', 'emailaddress': 'email',
  'first name': 'first_name', 'firstname': 'first_name', 'first_name': 'first_name', 'first': 'first_name',
  'last name': 'last_name', 'lastname': 'last_name', 'last_name': 'last_name', 'last': 'last_name', 'surname': 'last_name',
  'phone': 'phone', 'phone number': 'phone', 'phonenumber': 'phone', 'tel': 'phone', 'telephone': 'phone', 'mobile': 'phone',
  'company': 'company_name', 'company name': 'company_name', 'company_name': 'company_name', 'organization': 'company_name', 'org': 'company_name',
  'lead status': 'lead_status', 'lead_status': 'lead_status', 'status': 'lead_status',
};

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'customer', 'churned'];

export function CsvImportWizard() {
  const router = useRouter();
  const { workspaceId } = useWorkspace();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [duplicateMode, setDuplicateMode] = useState<'skip' | 'update'>('skip');
  const [importListId, setImportListId] = useState('');
  const [defaultLeadStatus, setDefaultLeadStatus] = useState('');
  const [lists, setLists] = useState<{ id: string; name: string }[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState<{ imported: number; updated: number; skipped: number; errors: number; errorRows: CsvRow[] } | null>(null);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) parseFile(f);
  }, []);

  const parseFile = (f: File) => {
    if (f.size > 50 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 50MB.');
      return;
    }
    setFile(f);

    Papa.parse(f, {
      header: true,
      skipEmptyLines: true,
      preview: 10000,
      complete: (results) => {
        const data = results.data as CsvRow[];
        const hdrs = results.meta.fields || [];
        setHeaders(hdrs);
        setRows(data);
        setTotalRows(data.length);

        // Auto-detect mapping
        const autoMapping: Record<string, string> = {};
        hdrs.forEach(h => {
          const normalized = h.toLowerCase().trim();
          if (HEADER_MAP[normalized]) {
            autoMapping[h] = HEADER_MAP[normalized];
          }
        });
        setMapping(autoMapping);
      },
      error: () => {
        toast.error('Failed to parse CSV file');
      },
    });

    // Count all rows for large files
    let count = 0;
    Papa.parse(f, {
      header: true,
      skipEmptyLines: true,
      step: () => { count++; },
      complete: () => { setTotalRows(count); },
    });
  };

  const emailMapped = Object.values(mapping).includes('email');

  const validationIssues = rows.slice(0, 10).map((row, i) => {
    const emailHeader = Object.entries(mapping).find(([, v]) => v === 'email')?.[0];
    const email = emailHeader ? row[emailHeader] : '';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { row: i, issue: 'Invalid or missing email' };
    }
    return null;
  }).filter(Boolean);

  const invalidCount = (() => {
    const emailHeader = Object.entries(mapping).find(([, v]) => v === 'email')?.[0];
    if (!emailHeader) return 0;
    return rows.filter(row => {
      const email = row[emailHeader];
      return !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }).length;
  })();

  const startImport = async () => {
    if (!workspaceId) return;
    setImporting(true);
    setStep(4);

    const supabase = createClient();

    // Fetch lists for dropdown (in step 3)
    const emailHeader = Object.entries(mapping).find(([, v]) => v === 'email')?.[0];
    if (!emailHeader) return;

    // Re-parse the full file for import
    const allRows: CsvRow[] = [];
    await new Promise<void>((resolve) => {
      Papa.parse(file!, {
        header: true,
        skipEmptyLines: true,
        step: (result) => { allRows.push(result.data as CsvRow); },
        complete: () => resolve(),
      });
    });

    const BATCH_SIZE = 500;
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    const errorRows: CsvRow[] = [];

    setProgress({ current: 0, total: allRows.length });

    // Build reverse mapping: contact field -> csv header
    const fieldToHeader: Record<string, string> = {};
    Object.entries(mapping).forEach(([csvHeader, contactField]) => {
      fieldToHeader[contactField] = csvHeader;
    });

    // Get company name mapping
    const companyHeader = fieldToHeader['company_name'];

    for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
      const batch = allRows.slice(i, i + BATCH_SIZE);

      try {
        // Filter valid emails
        const validBatch = batch.filter(row => {
          const email = row[emailHeader];
          return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
        });
        const invalidBatch = batch.filter(row => {
          const email = row[emailHeader];
          return !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
        });
        skipped += invalidBatch.length;
        errorRows.push(...invalidBatch);

        if (validBatch.length === 0) {
          setProgress({ current: Math.min(i + BATCH_SIZE, allRows.length), total: allRows.length });
          continue;
        }

        // Handle companies if mapped
        const companyIdMap: Record<string, string> = {};
        if (companyHeader) {
          const companyNames = [...new Set(validBatch.map(row => row[companyHeader]?.trim()).filter(Boolean))];
          for (const name of companyNames) {
            const { data: existing } = await supabase
              .from('companies')
              .select('id')
              .eq('workspace_id', workspaceId)
              .eq('name', name)
              .single();

            if (existing) {
              companyIdMap[name] = existing.id;
            } else {
              const { data: created } = await supabase
                .from('companies')
                .insert({ workspace_id: workspaceId, name })
                .select('id')
                .single();
              if (created) companyIdMap[name] = created.id;
            }
          }
        }

        // Check for existing contacts
        const emails = validBatch.map(row => row[emailHeader].trim().toLowerCase());
        const { data: existingContacts } = await supabase
          .from('contacts')
          .select('id, email')
          .eq('workspace_id', workspaceId)
          .in('email', emails);

        const existingEmailMap = new Map((existingContacts || []).map(c => [c.email.toLowerCase(), c.id]));

        // Build contact rows
        const toInsert: InsertTables<'contacts'>[] = [];
        const toUpdate: Array<{ id: string; data: Partial<InsertTables<'contacts'>> }> = [];

        for (const row of validBatch) {
          const email = row[emailHeader].trim().toLowerCase();
          const existingId = existingEmailMap.get(email);

          // Build custom fields from unmapped columns
          const customFields: Record<string, string> = {};
          headers.forEach(h => {
            if (!mapping[h] && row[h]?.trim()) {
              customFields[h] = row[h].trim();
            }
          });
          // Also map columns explicitly mapped to custom_fields.*
          Object.entries(mapping).forEach(([csvHeader, field]) => {
            if (field.startsWith('custom_fields.') && row[csvHeader]?.trim()) {
              customFields[field.replace('custom_fields.', '')] = row[csvHeader].trim();
            }
          });

          const resolvedLeadStatus = defaultLeadStatus || (fieldToHeader['lead_status'] && LEAD_STATUSES.includes(row[fieldToHeader['lead_status']]?.trim().toLowerCase()) ? row[fieldToHeader['lead_status']].trim().toLowerCase() : 'new');

          const contactData = {
            email,
            first_name: fieldToHeader['first_name'] ? row[fieldToHeader['first_name']]?.trim() || null : null,
            last_name: fieldToHeader['last_name'] ? row[fieldToHeader['last_name']]?.trim() || null : null,
            phone: fieldToHeader['phone'] ? row[fieldToHeader['phone']]?.trim() || null : null,
            company_id: companyHeader && row[companyHeader]?.trim() ? companyIdMap[row[companyHeader].trim()] || null : null,
            lead_status: resolvedLeadStatus as InsertTables<'contacts'>['lead_status'],
            custom_fields: Object.keys(customFields).length > 0 ? customFields : null,
          };

          if (existingId) {
            if (duplicateMode === 'update') {
              toUpdate.push({ id: existingId, data: contactData });
            } else {
              skipped++;
            }
          } else {
            toInsert.push({ ...contactData, workspace_id: workspaceId });
          }
        }

        // Bulk insert
        if (toInsert.length > 0) {
          const { data: insertedData, error: insertError } = await supabase
            .from('contacts')
            .insert(toInsert)
            .select('id');

          if (insertError) {
            errors += toInsert.length;
          } else {
            imported += insertedData?.length || 0;

            // Create activities for new contacts
            if (insertedData) {
              const activityRows = insertedData.map(c => ({
                workspace_id: workspaceId,
                type: 'contact_created',
                contact_id: c.id,
                subject: 'Imported from CSV',
              }));
              await supabase.from('activities').insert(activityRows);

              // Add to list if selected
              if (importListId && insertedData) {
                const listRows = insertedData.map(c => ({
                  list_id: importListId,
                  contact_id: c.id,
                }));
                await supabase.from('contact_list_members').insert(listRows);
              }
            }
          }
        }

        // Bulk update
        for (const item of toUpdate) {
          const { error: updateError } = await supabase
            .from('contacts')
            .update(item.data)
            .eq('id', item.id)
            .eq('workspace_id', workspaceId);

          if (updateError) errors++;
          else updated++;
        }
      } catch {
        errors += batch.length;
        errorRows.push(...batch);
      }

      setProgress({ current: Math.min(i + BATCH_SIZE, allRows.length), total: allRows.length });
    }

    setResult({ imported, updated, skipped, errors, errorRows });
    setImporting(false);
  };

  // Fetch lists when entering step 3
  const loadLists = async () => {
    if (!workspaceId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from('contact_lists')
      .select('id, name')
      .eq('workspace_id', workspaceId)
      .order('name');
    if (data) setLists(data);
  };

  const downloadErrorCsv = () => {
    if (!result?.errorRows.length) return;
    const csv = Papa.unparse(result.errorRows);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import-errors.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Import Contacts</h1>
      <p className="text-sm text-slate-500 mb-8">Upload a CSV file to import contacts into your CRM</p>

      {/* Steps indicator */}
      <div className="flex items-center gap-2 mb-8">
        {[1, 2, 3, 4].map(s => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step > s ? 'bg-green-500 text-white' :
              step === s ? 'bg-indigo-600 text-white' :
              'bg-slate-200 text-slate-500'
            }`}>
              {step > s ? <Check className="w-4 h-4" /> : s}
            </div>
            <span className={`text-sm ${step === s ? 'font-medium text-slate-900' : 'text-slate-500'}`}>
              {s === 1 ? 'Upload' : s === 2 ? 'Map Columns' : s === 3 ? 'Preview' : 'Import'}
            </span>
            {s < 4 && <ChevronRight className="w-4 h-4 text-slate-300" />}
          </div>
        ))}
      </div>

      {/* Step 1: Upload */}
      {step === 1 && (
        <div className="bg-white rounded-xl border border-slate-200 p-8">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            className="border-2 border-dashed border-slate-300 rounded-xl p-12 text-center hover:border-indigo-400 transition-colors"
          >
            <Upload className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-600 mb-2">Drag and drop your CSV file here</p>
            <p className="text-sm text-slate-400 mb-4">or</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
            >
              Browse files
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) parseFile(e.target.files[0]); }}
            />
            <p className="text-xs text-slate-400 mt-4">Accepts .csv and .txt files, max 50MB</p>
          </div>

          {file && (
            <div className="mt-6 p-4 bg-slate-50 rounded-lg flex items-center gap-3">
              <FileText className="w-5 h-5 text-slate-500" />
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-900">{file.name}</p>
                <p className="text-xs text-slate-500">{totalRows.toLocaleString()} rows, {headers.length} columns</p>
              </div>
              <button
                onClick={() => setStep(2)}
                className="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Column Mapping */}
      {step === 2 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Map CSV columns to contact fields</h2>

          {!emailMapped && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              Email mapping is required
            </div>
          )}

          <div className="space-y-3">
            {headers.map(header => (
              <div key={header} className="flex items-center gap-4">
                <div className="w-48 flex-shrink-0">
                  <span className="text-sm font-medium text-slate-700">{header}</span>
                  <span className="text-xs text-slate-400 block truncate">{rows[0]?.[header] || ''}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
                <select
                  value={mapping[header] || ''}
                  onChange={(e) => {
                    setMapping(prev => {
                      const next = { ...prev };
                      if (e.target.value) next[header] = e.target.value;
                      else delete next[header];
                      return next;
                    });
                  }}
                  className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">— Skip this column —</option>
                  {CONTACT_FIELDS.map(f => (
                    <option key={f.value} value={f.value} disabled={Object.values(mapping).includes(f.value) && mapping[header] !== f.value}>
                      {f.label}
                    </option>
                  ))}
                  <option value={`custom_fields.${header}`}>Custom Field: {header}</option>
                </select>
              </div>
            ))}
          </div>

          <div className="flex justify-between mt-6 pt-4 border-t border-slate-200">
            <button onClick={() => setStep(1)} className="inline-flex items-center gap-1 px-4 py-2 text-sm text-slate-600 hover:text-slate-800">
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={() => { setStep(3); loadLists(); }}
              disabled={!emailMapped}
              className="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Preview & Options */}
      {step === 3 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Preview & Options</h2>

          {/* Preview table */}
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-2 text-left font-medium text-slate-500 text-xs">#</th>
                  {Object.entries(mapping).map(([csvHeader, field]) => (
                    <th key={csvHeader} className="px-3 py-2 text-left font-medium text-slate-600 text-xs">
                      <div>{CONTACT_FIELDS.find(f => f.value === field)?.label || field}</div>
                      <div className="text-slate-400 font-normal">{csvHeader}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((row, i) => {
                  const issue = validationIssues.find(v => v?.row === i);
                  return (
                    <tr key={i} className={`border-b border-slate-100 ${issue ? 'bg-red-50' : ''}`}>
                      <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                      {Object.entries(mapping).map(([csvHeader]) => (
                        <td key={csvHeader} className="px-3 py-2 text-slate-700">{row[csvHeader] || '—'}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {validationIssues.length > 0 && (
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700">
              <AlertCircle className="w-4 h-4 inline mr-1" />
              {invalidCount} rows have validation issues (invalid email) and will be skipped
            </div>
          )}

          {/* Options */}
          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Duplicate handling</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="dup" checked={duplicateMode === 'skip'} onChange={() => setDuplicateMode('skip')} className="text-indigo-600" />
                  Skip duplicates
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="dup" checked={duplicateMode === 'update'} onChange={() => setDuplicateMode('update')} className="text-indigo-600" />
                  Update existing contacts
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Add imported contacts to list (optional)</label>
              <select
                value={importListId}
                onChange={(e) => setImportListId(e.target.value)}
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">No list</option>
                {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Set lead status for all (optional)</label>
              <select
                value={defaultLeadStatus}
                onChange={(e) => setDefaultLeadStatus(e.target.value)}
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Keep from CSV or default to &quot;New&quot;</option>
                {LEAD_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg mb-6 text-sm text-slate-700">
            Ready to import <strong>{(totalRows - invalidCount).toLocaleString()}</strong> contacts
            {invalidCount > 0 && <span> ({invalidCount} will be skipped due to invalid email)</span>}
          </div>

          <div className="flex justify-between pt-4 border-t border-slate-200">
            <button onClick={() => setStep(2)} className="inline-flex items-center gap-1 px-4 py-2 text-sm text-slate-600 hover:text-slate-800">
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={startImport}
              className="inline-flex items-center gap-2 px-6 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
            >
              Start Import
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Progress / Results */}
      {step === 4 && (
        <div className="bg-white rounded-xl border border-slate-200 p-8">
          {importing ? (
            <div className="text-center">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Importing contacts...</h2>
              <div className="w-full bg-slate-200 rounded-full h-3 mb-4">
                <div
                  className="bg-indigo-600 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
                />
              </div>
              <p className="text-sm text-slate-600">
                {progress.current.toLocaleString()} of {progress.total.toLocaleString()} contacts
              </p>
            </div>
          ) : result ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900 mb-6">Import Complete</h2>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                <div className="p-4 bg-green-50 rounded-lg">
                  <p className="text-2xl font-bold text-green-700">{result.imported}</p>
                  <p className="text-sm text-green-600">Imported</p>
                </div>
                <div className="p-4 bg-blue-50 rounded-lg">
                  <p className="text-2xl font-bold text-blue-700">{result.updated}</p>
                  <p className="text-sm text-blue-600">Updated</p>
                </div>
                <div className="p-4 bg-yellow-50 rounded-lg">
                  <p className="text-2xl font-bold text-yellow-700">{result.skipped}</p>
                  <p className="text-sm text-yellow-600">Skipped</p>
                </div>
                <div className="p-4 bg-red-50 rounded-lg">
                  <p className="text-2xl font-bold text-red-700">{result.errors}</p>
                  <p className="text-sm text-red-600">Errors</p>
                </div>
              </div>

              {result.errorRows.length > 0 && (
                <button
                  onClick={downloadErrorCsv}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 mb-4"
                >
                  <Download className="w-4 h-4" />
                  Download error rows
                </button>
              )}

              <div>
                <button
                  onClick={() => router.push('/contacts')}
                  className="inline-flex items-center gap-2 px-6 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                >
                  View contacts
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
