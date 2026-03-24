"use client";

import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import Link from "next/link";

interface SequenceRow {
  id: string;
  name: string;
  status: string;
  enrolled: number;
  active: number;
  replied: number;
  completed: number;
  replyRate: number;
}

interface SequencePerformanceProps {
  sequences: SequenceRow[];
}

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  paused: "bg-yellow-100 text-yellow-700",
  draft: "bg-slate-100 text-slate-600",
  archived: "bg-slate-100 text-slate-500",
};

export function SequencePerformance({ sequences }: SequencePerformanceProps) {
  const router = useRouter();

  if (sequences.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Sequence Performance</h2>
        <div className="text-center py-12">
          <Mail className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500 mb-2">No sequence data yet</p>
          <Link href="/sequences" className="text-sm text-indigo-600 hover:text-indigo-700">
            Create a sequence and enroll contacts to see performance
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Sequence Performance</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-2 pr-4 text-slate-500 font-medium">Sequence</th>
              <th className="text-left py-2 px-3 text-slate-500 font-medium">Status</th>
              <th className="text-right py-2 px-3 text-slate-500 font-medium">Enrolled</th>
              <th className="text-right py-2 px-3 text-slate-500 font-medium">Active</th>
              <th className="text-right py-2 px-3 text-slate-500 font-medium">Replied</th>
              <th className="text-right py-2 px-3 text-slate-500 font-medium">Completed</th>
              <th className="text-right py-2 pl-3 text-slate-500 font-medium">Reply Rate</th>
            </tr>
          </thead>
          <tbody>
            {sequences.map((seq) => (
              <tr
                key={seq.id}
                onClick={() => router.push("/sequences")}
                className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
              >
                <td className="py-2.5 pr-4 font-medium text-slate-900 truncate max-w-[200px]">
                  {seq.name}
                </td>
                <td className="py-2.5 px-3">
                  <span
                    className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${
                      statusColors[seq.status] ?? "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {seq.status}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-right text-slate-700">{seq.enrolled}</td>
                <td className="py-2.5 px-3 text-right text-slate-700">{seq.active}</td>
                <td className="py-2.5 px-3 text-right text-slate-700">{seq.replied}</td>
                <td className="py-2.5 px-3 text-right text-slate-700">{seq.completed}</td>
                <td className="py-2.5 pl-3 text-right font-medium text-indigo-600">
                  {seq.replyRate}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
