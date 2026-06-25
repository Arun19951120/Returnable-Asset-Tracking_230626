"use client";

import { Camera, ArrowRight, QrCode, Wifi, ScanBarcode } from "lucide-react";

/**
 * The Asset Scanner is now fully integrated into the Asset Movement screen.
 * This stub guides users to the right place.
 */
export default function Scanner() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-8">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600">
        <Camera className="h-8 w-8 text-white" />
      </div>

      <div className="text-center max-w-md">
        <h2 className="text-2xl font-bold text-slate-900">Scanner Moved</h2>
        <p className="mt-2 text-slate-500">
          Asset scanning — QR Code, Barcode, RFID, and BLE — is now built directly
          into <strong>Asset Movement</strong>. Use the scanner panel inside Check Out,
          Check In, or Transfer tabs.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
        {[
          { label: "QR Code",  icon: QrCode,       desc: "Live camera scan",     color: "bg-blue-50 border-blue-200 text-blue-700" },
          { label: "Barcode",  icon: ScanBarcode,  desc: "USB/BT scanner input", color: "bg-green-50 border-green-200 text-green-700" },
          { label: "RFID",     icon: Wifi,         desc: "RFID reader (HID)",    color: "bg-purple-50 border-purple-200 text-purple-700" },
          { label: "BLE",      icon: Wifi,         desc: "BLE beacon scan",      color: "bg-amber-50 border-amber-200 text-amber-700" },
        ].map(({ label, icon: Icon, desc, color }) => (
          <div key={label} className={`rounded-xl border p-3 ${color}`}>
            <Icon className="h-5 w-5 mb-1" />
            <p className="text-sm font-semibold">{label}</p>
            <p className="text-[10px] opacity-70">{desc}</p>
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-400 flex items-center gap-1">
        Go to <strong className="text-slate-600">Asset Movement</strong>
        <ArrowRight className="h-3 w-3" />
        select Check Out / Check In / Transfer
      </p>
    </div>
  );
}
