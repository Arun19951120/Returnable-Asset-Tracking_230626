"use client";

import { useEffect, useState } from "react";
import { fetchAll } from "@/lib/storage";
import { Asset } from "@/lib/types";
import { Brain, TrendingUp, AlertTriangle, CheckCircle } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const DEMAND_DATA = [
  { month: "Jan", containers: 120, racks: 80, shells: 60 },
  { month: "Feb", containers: 135, racks: 90, shells: 72 },
  { month: "Mar", containers: 148, racks: 95, shells: 68 },
  { month: "Apr", containers: 160, racks: 110, shells: 85 },
  { month: "May", containers: 142, racks: 105, shells: 78 },
  { month: "Jun", containers: 175, racks: 120, shells: 95 },
  { month: "Jul", containers: 188, racks: 130, shells: 102 },
  { month: "Aug", containers: 195, racks: 140, shells: 110 },
];

const HEALTH_TREND = [
  { week: "W1", score: 88 }, { week: "W2", score: 85 },
  { week: "W3", score: 82 }, { week: "W4", score: 79 },
  { week: "W5", score: 81 }, { week: "W6", score: 77 },
  { week: "W7", score: 74 }, { week: "W8", score: 72 },
];

export default function Forecasting() {
  const [assets, setAssets] = useState<Asset[]>([]);
  useEffect(() => { fetchAll<Asset>("assets").then(setAssets); }, []);

  const criticalAssets = assets.filter((a) => a.healthScore < 50);
  const warningAssets = assets.filter((a) => a.healthScore >= 50 && a.healthScore < 75);
  const healthyAssets = assets.filter((a) => a.healthScore >= 75);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900">
          <Brain className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">AI Forecasting & Maintenance</h1>
          <p className="text-sm text-slate-500">Predictive demand & fleet health analytics</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
          <div><p className="text-xl font-bold text-emerald-800">{healthyAssets.length}</p><p className="text-xs text-emerald-600">Healthy (≥75)</p></div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
          <div><p className="text-xl font-bold text-amber-800">{warningAssets.length}</p><p className="text-xs text-amber-600">Warning (50–74)</p></div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
          <div><p className="text-xl font-bold text-red-800">{criticalAssets.length}</p><p className="text-xs text-red-600">Critical (&lt;50)</p></div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-slate-500" />
          <h2 className="font-semibold text-slate-800">Seasonal Demand Forecast</h2>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={DEMAND_DATA} barGap={4}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="containers" name="Containers" fill="#1e293b" radius={[3, 3, 0, 0]} />
            <Bar dataKey="racks" name="Racks" fill="#64748b" radius={[3, 3, 0, 0]} />
            <Bar dataKey="shells" name="Shells" fill="#94a3b8" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <Brain className="h-4 w-4 text-slate-500" />
          <h2 className="font-semibold text-slate-800">Fleet Health Trend</h2>
          <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Declining — Maintenance Recommended</span>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={HEALTH_TREND}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="week" tick={{ fontSize: 11 }} />
            <YAxis domain={[60, 100]} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey="score" name="Health Score" stroke="#1e293b" strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {criticalAssets.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-white">
          <div className="border-b border-red-100 px-5 py-4">
            <h2 className="font-semibold text-red-800">Critical — Immediate Refurbishment Required</h2>
          </div>
          <div className="divide-y divide-slate-50">
            {criticalAssets.map((asset) => (
              <div key={asset.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="font-medium text-slate-800">{asset.name}</p>
                  <p className="font-mono text-xs text-slate-400">{asset.uuid}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">{asset.location}</span>
                  <span className="rounded-full bg-red-100 px-2 py-0.5 font-mono text-xs font-bold text-red-700">{asset.healthScore}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
