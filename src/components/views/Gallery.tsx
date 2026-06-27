"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { fetchAll, addDocument } from "@/lib/storage";
import { GalleryImage } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { Upload, X, Loader2, Image as ImageIcon, Tag, Plus, Trash2 } from "lucide-react";

const CATEGORIES = ["FLC", "PLS", "Thermoform Tray", "RSR", "Bins", "Wooden Crate", "Other"];
const WATERMARK_TEXT = "AKN Design Tech";

function applyWatermark(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);

      // Diagonal repeating watermark
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = "#ffffff";
      const fontSize = Math.max(18, Math.min(img.width, img.height) * 0.06);
      ctx.font = `bold ${fontSize}px Arial`;
      ctx.textAlign = "center";

      const step = fontSize * 5;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(-Math.PI / 5);
      for (let y = -canvas.height; y < canvas.height; y += step) {
        for (let x = -canvas.width * 1.5; x < canvas.width * 1.5; x += step * 3) {
          ctx.fillText(WATERMARK_TEXT, x, y);
        }
      }
      ctx.restore();

      // Bottom-right badge
      ctx.save();
      ctx.globalAlpha = 0.75;
      const badgeH = fontSize * 1.6;
      const badgePad = fontSize * 0.5;
      const textW = ctx.measureText("© " + WATERMARK_TEXT).width + badgePad * 2;
      const bx = canvas.width - textW - 10;
      const by = canvas.height - badgeH - 10;
      ctx.fillStyle = "rgba(15,17,23,0.7)";
      ctx.beginPath();
      ctx.roundRect(bx, by, textW, badgeH, 6);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#a5b4fc";
      ctx.font = `semibold ${fontSize * 0.75}px Arial`;
      ctx.textAlign = "left";
      ctx.fillText("© " + WATERMARK_TEXT, bx + badgePad, by + badgeH * 0.65);
      ctx.restore();

      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.src = dataUrl;
  });
}

export default function Gallery() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "Admin";
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<GalleryImage | null>(null);
  const [filter, setFilter] = useState("All");
  const [showUpload, setShowUpload] = useState(false);
  const [caption, setCaption] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [preview, setPreview] = useState<string | null>(null);
  const [rawFile, setRawFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchAll<GalleryImage>("gallery_images");
    setImages(data.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRawFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function handleUpload() {
    if (!rawFile || !preview) return;
    setUploading(true);
    try {
      // Apply watermark
      const watermarked = await applyWatermark(preview);

      // Upload watermarked blob
      const blob = await fetch(watermarked).then((r) => r.blob());
      const formData = new FormData();
      formData.append("file", new File([blob], rawFile.name, { type: "image/jpeg" }));
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");
      const { url, name } = await res.json();

      await addDocument("gallery_images", {
        url,
        name,
        category,
        caption,
        uploadedBy: profile?.displayName ?? "Unknown",
        uploadedAt: new Date().toISOString(),
      });

      setShowUpload(false);
      setCaption("");
      setPreview(null);
      setRawFile(null);
      load();
    } catch (err) {
      alert("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  const categories = ["All", ...CATEGORIES];
  const filtered = filter === "All" ? images : images.filter((i) => i.category === filter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Product Gallery</h1>
          <p className="text-sm text-slate-500">Showcase packaging solutions — watermarked for protection</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-200 hover:shadow-indigo-300 transition-all"
          >
            <Plus className="h-4 w-4" /> Upload Image
          </button>
        )}
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
              filter === c
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-200"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 text-center">
          <ImageIcon className="h-10 w-10 text-slate-300 mb-2" />
          <p className="text-sm text-slate-400">No images yet</p>
          {isAdmin && (
            <button onClick={() => setShowUpload(true)} className="mt-3 text-xs text-indigo-600 font-semibold hover:underline">
              Upload the first image
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((img) => (
            <div
              key={img.id}
              onClick={() => setLightbox(img)}
              className="group relative cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm hover:shadow-lg transition-all hover:-translate-y-0.5"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={img.caption ?? img.name}
                className="h-48 w-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all">
                <p className="text-xs font-semibold text-white truncate">{img.caption || img.name}</p>
                {img.category && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] text-white/90">
                    <Tag className="h-2.5 w-2.5" />{img.category}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-slate-900">Upload Gallery Image</h2>
              <button onClick={() => { setShowUpload(false); setPreview(null); setRawFile(null); }}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleFileSelect} />

            {!preview ? (
              <button
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 py-12 hover:border-indigo-300 hover:bg-indigo-50 transition-all"
              >
                <Upload className="h-8 w-8 text-slate-400" />
                <p className="text-sm text-slate-500">Click to select an image</p>
                <p className="text-xs text-slate-400">PNG, JPG, WebP up to 10MB</p>
              </button>
            ) : (
              <div className="relative mb-4 overflow-hidden rounded-xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="preview" className="w-full h-48 object-cover" />
                <button onClick={() => { setPreview(null); setRawFile(null); }}
                  className="absolute top-2 right-2 rounded-full bg-black/50 p-1 text-white hover:bg-black/70">
                  <X className="h-3 w-3" />
                </button>
                <div className="absolute bottom-2 left-2 rounded-full bg-indigo-600/90 px-2 py-0.5 text-[10px] font-semibold text-white">
                  Watermark will be applied
                </div>
              </div>
            )}

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Category</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Caption (optional)</label>
                <input type="text" value={caption} onChange={(e) => setCaption(e.target.value)}
                  placeholder="Describe this packaging..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
              </div>
            </div>

            <div className="mt-5 flex gap-3">
              <button onClick={() => { setShowUpload(false); setPreview(null); setRawFile(null); }}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleUpload} disabled={!rawFile || uploading}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? "Uploading…" : "Upload with Watermark"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setLightbox(null)}>
          <div className="relative max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setLightbox(null)}
              className="absolute -top-10 right-0 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors">
              <X className="h-5 w-5" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightbox.url} alt={lightbox.caption ?? lightbox.name} className="w-full rounded-2xl object-contain max-h-[80vh]" />
            <div className="mt-3 flex items-center justify-between">
              <div>
                <p className="text-white font-semibold">{lightbox.caption || lightbox.name}</p>
                <p className="text-white/60 text-sm">{lightbox.category} · Uploaded by {lightbox.uploadedBy}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
