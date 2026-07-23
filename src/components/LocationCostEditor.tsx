"use client";

import type { Dispatch, SetStateAction } from "react";

/**
 * One cost input per location in a project's movement flow (primary +
 * 1.a/1.b/1.c…). Each value is the asset's declared value at that location;
 * a blank location falls back to the baseline Unit Cost.
 *
 * Shared by the asset add form and the asset detail dialog.
 */
export function LocationCostEditor({
  locations, value, onSet, note,
}: {
  locations: string[];
  value: Record<string, number>;
  onSet: (loc: string, raw: string) => void;
  note?: string;
}) {
  if (locations.length === 0) return null;
  return (
    <div className="border-t border-slate-100 pt-4">
      <p className="mb-1 text-xs font-semibold text-slate-700">Location-wise Cost / Declared Value (₹)</p>
      <p className="mb-3 text-[11px] text-slate-400">
        {note ?? "Optional. Used as the declared value on the Delivery Challan when the asset is at that location. Leave a location blank to fall back to the Unit Cost above."}
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider">
              <th className="border-b border-slate-200 px-3 py-2 text-left font-medium">Flow Location</th>
              <th className="border-b border-slate-200 px-3 py-2 text-left font-medium w-40">Cost (₹)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {locations.map((loc) => (
              <tr key={loc}>
                <td className="px-3 py-1.5 font-medium text-slate-700">{loc}</td>
                <td className="px-2 py-1.5">
                  <input type="number" min={0} placeholder="—"
                    value={value[loc] ?? ""}
                    onChange={(e) => onSet(loc, e.target.value)}
                    className="w-full rounded px-2 py-1 text-xs outline-none border border-transparent focus:border-slate-300 bg-transparent" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Merge one location's cost into a map; blank/NaN removes the entry. */
export function setCostEntry(
  setMap: Dispatch<SetStateAction<Record<string, number>>>,
  loc: string,
  raw: string,
) {
  setMap((m) => {
    const next = { ...m };
    if (raw === "" || isNaN(+raw)) delete next[loc];
    else next[loc] = +raw;
    return next;
  });
}

/** Keep only the costs whose location is in `locs`. */
export function scopeCosts(map: Record<string, number>, locs: string[]): Record<string, number> {
  return Object.fromEntries(Object.entries(map).filter(([loc]) => locs.includes(loc)));
}
