"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { fetchAll, addDocument, deleteDocument } from "@/lib/storage";
import { GalleryImage } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import {
  Upload, X, Loader2, Image as ImageIcon, Tag, Plus, Trash2,
  ChevronLeft, ChevronRight, Play, Pause,
} from "lucide-react";

const CATEGORIES = ["FLC", "PLS", "Thermoform Tray", "RSR", "Bins", "Other"];
const WATERMARK_TEXT = "RSPL Returnable Asset Tracking";
const SLIDESHOW_INTERVAL = 4000;

function applyWatermark(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);

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
  const [filter, setFilter] = useState("All");
  const [showUpload, setShowUpload] = useState(false);
  const [caption, setCaption] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [preview, setPreview] = useState<string | null>(null);
  const [rawFile, setRawFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Lightbox / slideshow state
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<GalleryImage | null>(null);
  const [deleting, setDeleting] = useState(false);
  const slideshowRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchAll<GalleryImage>("gallery_images");
    setImages(data.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (lightboxIdx === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft")  goPrev();
      if (e.key === "Escape")     closeLightbox();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Slideshow auto-advance
  useEffect(() => {
    if (playing && lightboxIdx !== null) {
      slideshowRef.current = setInterval(() => {
        setLightboxIdx((i) => i === null ? null : (i + 1) % filtered.length);
      }, SLIDESHOW_INTERVAL);
    } else {
      if (slideshowRef.current) clearInterval(slideshowRef.current);
    }
    return () => { if (slideshowRef.current) clearInterval(slideshowRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, lightboxIdx]);

  const categories = ["All", ...CATEGORIES];
  const filtered = filter === "All" ? images : images.filter((i) => i.category === filter);

  function openLightbox(idx: number) { setLightboxIdx(idx); setPlaying(false); }
  function closeLightbox() { setLightboxIdx(null); setPlaying(false); }
  function goNext() { setLightboxIdx((i) => i === null ? null : (i + 1) % filtered.length); }
  function goPrev() { setLightboxIdx((i) => i === null ? null : (i - 1 + filtered.length) % filtered.length); }

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
      const watermarked = await applyWatermark(preview);
      const blob = await fetch(watermarked).then((r) => r.blob());
      const formData = new FormData();
      formData.append("file", new File([blob], rawFile.name, { type: "image/jpeg" }));
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");
      const { url, name } = await res.json();
      await addDocument("gallery_images", {
        url, name, category, caption,
        uploadedBy: profile?.displayName ?? "Unknown",
        uploadedAt: new Date().toISOString(),
      });
      setShowUpload(false);
      setCaption("");
      setPreview(null);
      setRawFile(null);
      load();
    } catch {
      alert("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await deleteDocument("gallery_images", confirmDelete.id);
      setConfirmDelete(null);
      // If currently viewing this image in lightbox, close it
      if (lightboxIdx !== null && filtered[lightboxIdx]?.id === confirmDelete.id) {
        closeLightbox();
      }
      await load();
    } catch {
      alert("Delete failed. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  const lightboxImg = lightboxIdx !== null ? filtered[lightboxIdx] : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Product Gallery</h1>
          <p className="text-sm text-slate-500">Showcase packaging solutions — watermarked for protection</p>
        </div>
        <div className="flex items-center gap-2">
          {filtered.length > 1 && (
            <button
              onClick={() => { openLightbox(0); setPlaying(true); }}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all shadow-sm"
            >
              <Play className="h-4 w-4 text-indigo-500" /> Slideshow
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setShowUpload(true)}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-200 hover:shadow-indigo-300 transition-all"
            >
              <Plus className="h-4 w-4" /> Upload Image
            </button>
          )}
        </div>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <button key={c} onClick={() => setFilter(c)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
              filter === c ? "bg-indigo-600 text-white shadow-md shadow-indigo-200" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}>
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
          {filtered.map((img, idx) => (
            <div key={img.id} className="group relative cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm hover:shadow-lg transition-all hover:-translate-y-0.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={img.caption ?? img.name}
                onClick={() => openLightbox(idx)}
                className="h-48 w-full object-cover group-hover:scale-105 transition-transform duration-300"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
              <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all pointer-events-none">
                <p className="text-xs font-semibold text-white truncate">{img.caption || img.name}</p>
                {img.category && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] text-white/90">
                    <Tag className="h-2.5 w-2.5" />{img.category}
                  </span>
                )}
              </div>
              {/* Delete button — admin only */}
              {isAdmin && (
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(img); }}
                  className="absolute top-2 right-2 rounded-full bg-black/50 p-1.5 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-all"
                  title="Delete image"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Lightbox / Slideshow ── */}
      {lightboxImg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
          onClick={closeLightbox}
        >
          {/* Prev */}
          {filtered.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); goPrev(); }}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/25 transition-colors"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}

          {/* Main image */}
          <div className="relative flex flex-col items-center max-w-4xl w-full px-16" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxImg.url}
              alt={lightboxImg.caption ?? lightboxImg.name}
              className="w-full rounded-2xl object-contain max-h-[78vh] shadow-2xl"
            />

            {/* Caption bar */}
            <div className="mt-4 flex w-full items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-white font-semibold truncate">{lightboxImg.caption || lightboxImg.name}</p>
                <p className="text-white/50 text-sm">{lightboxImg.category} · {lightboxImg.uploadedBy}</p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {/* Slide counter */}
                <span className="text-white/40 text-xs font-mono">{(lightboxIdx ?? 0) + 1} / {filtered.length}</span>

                {/* Play/pause slideshow */}
                {filtered.length > 1 && (
                  <button
                    onClick={() => setPlaying((p) => !p)}
                    className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${playing ? "bg-indigo-600 text-white" : "bg-white/10 text-white hover:bg-white/25"}`}
                    title={playing ? "Pause slideshow" : "Play slideshow"}
                  >
                    {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>
                )}

                {/* Delete in lightbox — admin only */}
                {isAdmin && (
                  <button
                    onClick={() => { closeLightbox(); setConfirmDelete(lightboxImg); }}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-red-600 transition-colors"
                    title="Delete image"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}

                {/* Close */}
                <button
                  onClick={closeLightbox}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/25 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Dot indicators */}
            {filtered.length > 1 && filtered.length <= 20 && (
              <div className="mt-3 flex gap-1.5">
                {filtered.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => { setLightboxIdx(i); setPlaying(false); }}
                    className={`h-1.5 rounded-full transition-all ${i === lightboxIdx ? "w-6 bg-indigo-400" : "w-1.5 bg-white/30 hover:bg-white/60"}`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Next */}
          {filtered.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); goNext(); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/25 transition-colors"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}
        </div>
      )}

      {/* ── Upload modal ── */}
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
              <button onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 py-12 hover:border-indigo-300 hover:bg-indigo-50 transition-all">
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

      {/* ── Delete confirm modal ── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
                <Trash2 className="h-5 w-5 text-red-600" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-slate-900">Delete image?</h3>
                <p className="mt-1 text-sm text-slate-500 truncate">
                  "{confirmDelete.caption || confirmDelete.name}" will be permanently removed.
                </p>
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button onClick={() => setConfirmDelete(null)}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors">
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
