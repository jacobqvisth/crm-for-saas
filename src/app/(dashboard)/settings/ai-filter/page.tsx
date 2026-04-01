"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Loader2, Sparkles } from "lucide-react";
import toast from "react-hot-toast";
import Link from "next/link";

const DEFAULT_ICP_PROMPT = `We sell AI-powered workshop management software to automotive workshops and car dealerships in Sweden (and the Nordics).

GOOD FITS — we want to reach these people:
- Verkstadschef (workshop manager) at independent repair shops
- VD (verkställande direktör / CEO / MD) at car dealerships or repair shops with 5–50 employees
- Ägare (owner) of independent automotive workshops
- Bilmekaniker who owns or runs their own small shop
- Service manager or workshop owner at independent garages

POOR FITS — rule these out:
- Employees at automotive parts suppliers or component manufacturers (e.g. Bosch, NGK, Mekonomen parts division)
- HR, marketing, finance, or administrative roles — not decision-makers for operations software
- Companies with 200+ employees or national franchise chains with many locations
- Rental car companies, car washes, towing companies, or parking operators
- Anyone outside the automotive repair / service / dealership sector
- Roles that are clearly not involved in daily workshop operations`;

type Verdict = "good" | "maybe" | "poor";

type TestResult = {
  verdict: Verdict;
  reason: string;
};

export default function AIFilterSettingsPage() {
  const router = useRouter();
  const [icpPrompt, setIcpPrompt] = useState(DEFAULT_ICP_PROMPT);
  const [filterEnabled, setFilterEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [testInput, setTestInput] = useState("");
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  useEffect(() => {
    fetch("/api/settings/ai-filter")
      .then((r) => r.json())
      .then((data) => {
        if (data.icp_prompt) setIcpPrompt(data.icp_prompt);
        setFilterEnabled(data.filter_enabled ?? true);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/ai-filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icp_prompt: icpPrompt, filter_enabled: filterEnabled }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testInput.trim()) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/prospector/ai-filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profiles: [
            {
              person_id: "test",
              full_name: testInput,
              current_job_title: "",
              company_name: "",
            },
          ],
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        if (err.error === "no_icp_prompt") {
          toast.error("Save your ICP description first");
        } else if (err.error === "filter_disabled") {
          toast.error("Enable the filter first");
        } else {
          toast.error("AI filter unavailable");
        }
        return;
      }
      const { verdicts } = await res.json();
      if (verdicts?.[0]) {
        setTestResult({ verdict: verdicts[0].verdict, reason: verdicts[0].reason });
      }
    } catch {
      toast.error("Test failed");
    } finally {
      setTestLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const verdictConfig = testResult
    ? {
        good: { label: "Good fit", color: "text-green-700 bg-green-50 border-green-200", icon: "✅" },
        maybe: { label: "Maybe", color: "text-yellow-700 bg-yellow-50 border-yellow-200", icon: "⚠️" },
        poor: { label: "Poor fit", color: "text-red-700 bg-red-50 border-red-200", icon: "❌" },
      }[testResult.verdict]
    : null;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/settings"
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ChevronLeft className="w-4 h-4" />
          Settings
        </Link>
      </div>

      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="w-5 h-5 text-indigo-600" />
        <h1 className="text-2xl font-bold text-slate-900">AI Lead Filter</h1>
      </div>
      <p className="text-sm text-slate-500 mb-8">
        Describe your ideal customer. The AI will evaluate Prospector results before you add them to your CRM.
      </p>

      {/* Toggle row */}
      <div className="flex items-center justify-between py-4 border-b border-slate-200 mb-6">
        <div>
          <p className="text-sm font-medium text-slate-900">Enable AI Lead Filter</p>
          <p className="text-xs text-slate-500 mt-0.5">Shows an &quot;AI Check&quot; button in the Prospector</p>
        </div>
        <button
          type="button"
          onClick={() => setFilterEnabled((v) => !v)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
            filterEnabled ? "bg-indigo-600" : "bg-slate-200"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              filterEnabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* ICP Prompt */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-slate-700 mb-1">
          ICP Description
        </label>
        <p className="text-xs text-slate-500 mb-2">
          Describe who you want to reach and who to rule out. Be specific about titles, company types, and red flags.
        </p>
        <textarea
          rows={12}
          value={icpPrompt}
          onChange={(e) => setIcpPrompt(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
        />
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full sm:w-auto flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium py-2 px-6 rounded-lg text-sm transition-colors mb-10"
      >
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        {saving ? "Saving…" : "Save settings"}
      </button>

      {/* Divider */}
      <div className="border-t border-slate-200 pt-8">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Test the Filter</h2>

        <div className="mb-3">
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Test with a profile
          </label>
          <textarea
            rows={4}
            value={testInput}
            onChange={(e) => {
              setTestInput(e.target.value);
              setTestResult(null);
            }}
            placeholder="e.g. Johan Pettersson, VD at Lecab Bil, Automotive, Karlstad Sweden"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
          />
        </div>

        <button
          onClick={handleTest}
          disabled={testLoading || !testInput.trim()}
          className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-medium py-2 px-4 rounded-lg text-sm transition-colors"
        >
          {testLoading && <Loader2 className="w-4 h-4 animate-spin" />}
          {testLoading ? "Testing…" : "Test"}
        </button>

        {testResult && verdictConfig && (
          <div className={`mt-3 inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium ${verdictConfig.color}`}>
            <span>{verdictConfig.icon}</span>
            <span>{verdictConfig.label}</span>
            <span className="font-normal">— &quot;{testResult.reason}&quot;</span>
          </div>
        )}
      </div>
    </div>
  );
}
