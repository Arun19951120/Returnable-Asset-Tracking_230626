"use client";

export type DayRange = "today" | "7" | "30" | "90" | "Q1" | "Q2" | "Q3" | "Q4" | "all";

export function filterByDays<T extends { createdAt?: string; lastUpdated?: string; timestamp?: string }>(
  items: T[],
  range: DayRange,
  dateField: keyof T = "createdAt" as keyof T
): T[] {
  if (range === "all") return items;
  const now = new Date();
  // Quarter filter: match current year's quarter
  if (range === "Q1" || range === "Q2" || range === "Q3" || range === "Q4") {
    const qStart: Record<string, number> = { Q1: 0, Q2: 3, Q3: 6, Q4: 9 };
    const startM = qStart[range];
    const start = new Date(now.getFullYear(), startM, 1).getTime();
    const end   = new Date(now.getFullYear(), startM + 3, 0, 23, 59, 59, 999).getTime();
    return items.filter((item) => {
      const val = item[dateField] as string | undefined;
      if (!val) return true;
      const t = new Date(val).getTime();
      return t >= start && t <= end;
    });
  }
  const ms = range === "today" ? 86400000 : parseInt(range) * 86400000;
  return items.filter((item) => {
    const val = item[dateField] as string | undefined;
    if (!val) return true;
    return now.getTime() - new Date(val).getTime() <= ms;
  });
}

interface FilterBarProps {
  dayRange: DayRange;
  onDayRangeChange: (v: DayRange) => void;
  locationFilter?: string;
  locations?: string[];
  onLocationChange?: (v: string) => void;
  /** Pass objects so the dropdown shows names but filters by id */
  projects?: { id: string; name: string }[];
  projectFilter?: string;
  onProjectChange?: (v: string) => void;
  statusFilter?: string;
  statusOptions?: string[];
  onStatusChange?: (v: string) => void;
  extraFilters?: React.ReactNode;
}

export default function FilterBar({
  dayRange, onDayRangeChange,
  locationFilter, locations, onLocationChange,
  projects, projectFilter, onProjectChange,
  statusFilter, statusOptions, onStatusChange,
  extraFilters,
}: FilterBarProps) {
  const DAY_OPTIONS: { label: string; value: DayRange }[] = [
    { label: "Today", value: "today" },
    { label: "7d", value: "7" },
    { label: "30d", value: "30" },
    { label: "90d", value: "90" },
    { label: "All", value: "all" },
  ];

  const year = new Date().getFullYear();
  const QUARTER_OPTIONS: { label: string; value: DayRange }[] = [
    { label: `Q1 (Jan–Mar ${year})`, value: "Q1" },
    { label: `Q2 (Apr–Jun ${year})`, value: "Q2" },
    { label: `Q3 (Jul–Sep ${year})`, value: "Q3" },
    { label: `Q4 (Oct–Dec ${year})`, value: "Q4" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Day range pills */}
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {DAY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onDayRangeChange(opt.value)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              dayRange === opt.value
                ? "bg-indigo-600 text-white"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {/* Quarter pills */}
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {QUARTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onDayRangeChange(opt.value)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              dayRange === opt.value
                ? "bg-indigo-600 text-white"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            }`}
          >
            {opt.value}
          </button>
        ))}
      </div>

      {/* Location filter */}
      {locations && onLocationChange && (
        <select
          value={locationFilter}
          onChange={(e) => onLocationChange(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 outline-none focus:border-slate-400"
        >
          <option value="">All Locations</option>
          {locations.map((l) => <option key={l}>{l}</option>)}
        </select>
      )}

      {/* Status filter */}
      {statusOptions && onStatusChange && (
        <select
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 outline-none focus:border-slate-400"
        >
          <option value="">All Statuses</option>
          {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      )}

      {/* Project filter */}
      {projects && onProjectChange && (
        <select
          value={projectFilter}
          onChange={(e) => onProjectChange(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 outline-none focus:border-slate-400"
        >
          <option value="">All Projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}

      {extraFilters}
    </div>
  );
}
