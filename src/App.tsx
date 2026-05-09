/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, ChangeEvent } from 'react';
import { Eye, EyeOff, Trash2, Image as ImageIcon, ChevronUp, ChevronDown, Lock, Unlock, Upload, Scissors, Move, Undo2, Redo2, Download, Smile, Github } from 'lucide-react';
import { toPng } from 'html-to-image';
import '@tensorflow/tfjs';
import * as blazeface from '@tensorflow-models/blazeface';
import { Layer, Point } from './types';
import { getPerspectiveTransform } from './lib/perspective';

const CANVAS_SIZE = 1024;

type DragState = 
  | { type: 'perspective', layerId: string, index: number }
  | { type: 'mask-center' }
  | { type: 'mask-edge' }
  | { type: 'move', layerId: string, startX: number, startY: number, initialCorners: [Point, Point, Point, Point] }
  | { type: 'scale', layerId: string, startX: number, startY: number, initialCorners: [Point, Point, Point, Point], center: Point };

export default function App() {
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  
  const [cutout, setCutout] = useState({
    enabled: false,
    mode: 'hole' as 'hole' | 'crop',
    x: CANVAS_SIZE / 2,
    y: CANVAS_SIZE / 2,
    r: 200,
  });
  
  const [dragState, setDragState] = useState<DragState | null>(null);

  const [toolMode, setToolMode] = useState<'scale' | 'perspective'>('scale');
  const [isDetectingFace, setIsDetectingFace] = useState<string | null>(null);

  const detectAndCutFace = async (layerId: string) => {
    setIsDetectingFace(layerId);
    try {
      const layer = layers.find(l => l.id === layerId);
      if (!layer) return;

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = layer.url;
      
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const model = await blazeface.load();
      const predictions = await model.estimateFaces(img, false);

      if (predictions.length > 0) {
        commitToHistory();
        
        const prediction = predictions[0] as any;
        const topLeft = prediction.topLeft as [number, number];
        const bottomRight = prediction.bottomRight as [number, number];
        
        const width = bottomRight[0] - topLeft[0];
        const height = bottomRight[1] - topLeft[1];
        const cx = topLeft[0] + width / 2;
        const cy = topLeft[1] + height / 2;
        const size = Math.max(width, height) * 1.5;
        const radius = size / 2;
        
        const canvas = document.createElement('canvas');
        canvas.width = layer.originalWidth;
        canvas.height = layer.originalHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
          ctx.clip();
          ctx.drawImage(img, 0, 0);
          
          const newUrl = canvas.toDataURL('image/png');
          updateLayer(layerId, { url: newUrl }, false);
        }
      } else {
        alert("No face detected in this layer.");
      }
    } catch (err) {
      console.error(err);
      alert("Error detecting face. Ensure the image is accessible.");
    } finally {
      setIsDetectingFace(null);
    }
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const [past, setPast] = useState<{ layers: Layer[]; cutout: any }[]>([]);
  const [future, setFuture] = useState<{ layers: Layer[]; cutout: any }[]>([]);

  const stateRef = useRef({ layers, cutout });
  useEffect(() => {
    stateRef.current = { layers, cutout };
  }, [layers, cutout]);

  const commitToHistory = () => {
    const currentState = stateRef.current;
    setPast((p) => {
      if (p.length > 0) {
        const last = p[p.length - 1];
        if (last.layers === currentState.layers && last.cutout === currentState.cutout) return p;
      }
      return [...p, currentState].slice(-30);
    });
    setFuture([]);
  };

  const undo = () => {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setFuture((f) => [{ layers, cutout }, ...f]);
    setLayers(prev.layers);
    setCutout(prev.cutout);
    setPast((p) => p.slice(0, p.length - 1));
  };

  const redo = () => {
    if (future.length === 0) return;
    const next = future[0];
    setPast((p) => [...p, { layers, cutout }]);
    setLayers(next.layers);
    setCutout(next.cutout);
    setFuture((f) => f.slice(1));
  };

  useEffect(() => {
    const resize = () => {
      if (!wrapperRef.current) return;
      const rect = wrapperRef.current.getBoundingClientRect();
      const w = rect.width - 48; // padding
      const h = rect.height - 48;
      setScale(Math.min(w / CANVAS_SIZE, h / CANVAS_SIZE, 1));
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!containerRef.current || !dragState) return;

    const rect = containerRef.current.getBoundingClientRect();
    const localX = (e.clientX - rect.left) / scale;
    const localY = (e.clientY - rect.top) / scale;

    if (dragState.type === 'perspective') {
      setLayers((prev) =>
        prev.map((layer) => {
          if (layer.id === dragState.layerId) {
            const newCorners = [...layer.corners] as [Point, Point, Point, Point];
            newCorners[dragState.index] = { x: localX, y: localY };
            return { ...layer, corners: newCorners };
          }
           return layer;
        })
      );
    } else if (dragState.type === 'mask-center') {
      setCutout(c => ({ ...c, x: localX, y: localY }));
    } else if (dragState.type === 'mask-edge') {
      setCutout(c => ({ ...c, r: Math.max(10, Math.sqrt((localX - c.x)**2 + (localY - c.y)**2)) }));
    } else if (dragState.type === 'move') {
      const dx = localX - dragState.startX;
      const dy = localY - dragState.startY;
      setLayers((prev) => prev.map((layer) => {
        if (layer.id === dragState.layerId) {
          const newCorners = dragState.initialCorners.map(c => ({
            x: c.x + dx,
            y: c.y + dy
          })) as [Point, Point, Point, Point];
          return { ...layer, corners: newCorners };
        }
        return layer;
      }));
    } else if (dragState.type === 'scale') {
      const initialDx = dragState.startX - dragState.center.x;
      const initialDy = dragState.startY - dragState.center.y;
      const initialDist = Math.sqrt(initialDx*initialDx + initialDy*initialDy);
      
      const dx = localX - dragState.center.x;
      const dy = localY - dragState.center.y;
      const newDist = Math.sqrt(dx*dx + dy*dy);
      
      if (initialDist > 0.001) {
        const scaleAmount = newDist / initialDist;
        setLayers((prev) => prev.map((layer) => {
          if (layer.id === dragState.layerId) {
            const newCorners = dragState.initialCorners.map(c => ({
              x: dragState.center.x + (c.x - dragState.center.x) * scaleAmount,
              y: dragState.center.y + (c.y - dragState.center.y) * scaleAmount
            })) as [Point, Point, Point, Point];
            return { ...layer, corners: newCorners };
          }
          return layer;
        }));
      }
    }
  };

  const addImageFromUrl = (url: string, name: string) => {
    return new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const w = img.width;
        const h = img.height;

        const imgScale = Math.min((CANVAS_SIZE * 0.8) / w, (CANVAS_SIZE * 0.8) / h, 1);
        const dw = w * imgScale;
        const dh = h * imgScale;

        const cx = CANVAS_SIZE / 2;
        const cy = CANVAS_SIZE / 2;

        const newLayer: Layer = {
          id: Math.random().toString(36).substring(2, 9),
          url: img.src,
          name,
          opacity: 1,
          visible: true,
          originalWidth: w,
          originalHeight: h,
          locked: false,
          corners: [
            { x: cx - dw / 2, y: cy - dh / 2 },
            { x: cx + dw / 2, y: cy - dh / 2 },
            { x: cx + dw / 2, y: cy + dh / 2 },
            { x: cx - dw / 2, y: cy + dh / 2 },
          ],
        };

        setLayers((prev) => [...prev, newLayer]);
        setSelectedLayerId(newLayer.id);
        resolve();
      };
      img.onerror = () => reject(new Error(`Failed to load image from: ${url}`));
      
      // Fetch as blob to avoid canvas cross-origin issues during export
      fetch(url)
        .then(res => res.blob())
        .then(blob => {
          img.src = URL.createObjectURL(blob);
        })
        .catch(err => {
          console.warn("Failed to fetch image as blob, falling back to direct URL", err);
          img.src = url;
        });
    });
  };

  const handlePointerUp = () => {
    setDragState(null);
  };

  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [githubUrlInput, setGithubUrlInput] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const processGithubImport = async (url: string) => {
    if (!url) return;

    setIsImporting(true);
    setImportError(null);

    let owner, repo, branch = 'main', path = '';
    const treeMatch = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/(?:tree|blob)\/([^\/]+)\/(.*)/);
    if (treeMatch) {
      [, owner, repo, branch, path] = treeMatch;
    } else {
      const repoMatch = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/?$/);
      if (repoMatch) {
        [, owner, repo] = repoMatch;
      } else {
        setImportError("Invalid GitHub URL.");
        setIsImporting(false);
        return;
      }
    }

    try {
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error("Failed to fetch folder contents. Check if repo is public.");
      const data = await res.json();
      
      if (!Array.isArray(data)) {
          throw new Error("URL does not point to a folder");
      }

      const imageFiles = data.filter((item: any) => item.type === 'file' && item.name.match(/\.(png|jpe?g|gif|webp)$/i));
      
      if (imageFiles.length === 0) {
          throw new Error("No images found in the folder.");
      }

      commitToHistory();
      
      // Import them all sequentially
      for (const file of imageFiles) {
          await addImageFromUrl(file.download_url, file.name);
      }
      setGithubModalOpen(false);
      setGithubUrlInput('');
    } catch (err: any) {
      console.error(err);
      setImportError(err.message || "Failed to import from GitHub.");
    } finally {
      setIsImporting(false);
    }
  };

  const handleAddImage = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const url = URL.createObjectURL(file);

    const img = new Image();
    img.onload = () => {
      const w = img.width;
      const h = img.height;

      const imgScale = Math.min((CANVAS_SIZE * 0.8) / w, (CANVAS_SIZE * 0.8) / h, 1);
      const dw = w * imgScale;
      const dh = h * imgScale;

      const cx = CANVAS_SIZE / 2;
      const cy = CANVAS_SIZE / 2;

      const newLayer: Layer = {
        id: Math.random().toString(36).substring(2, 9),
        url,
        name: file.name,
        opacity: 1,
        visible: true,
        originalWidth: w,
        originalHeight: h,
        locked: false,
        corners: [
          { x: cx - dw / 2, y: cy - dh / 2 },
          { x: cx + dw / 2, y: cy - dh / 2 },
          { x: cx + dw / 2, y: cy + dh / 2 },
          { x: cx - dw / 2, y: cy + dh / 2 },
        ],
      };

      commitToHistory();
      setLayers((prev) => [...prev, newLayer]);
      setSelectedLayerId(newLayer.id);
      
      // Reset input
      e.target.value = '';
    };
    img.src = url;
  };

  const deleteLayer = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    commitToHistory();
    setLayers((prev) => prev.filter((l) => l.id !== id));
    if (selectedLayerId === id) setSelectedLayerId(null);
  };

  const moveLayer = (index: number, direction: 1 | -1, e: React.MouseEvent) => {
    e.stopPropagation();
    if (index + direction < 0 || index + direction >= layers.length) return;
    commitToHistory();
    setLayers((prev) => {
      const newLayers = [...prev];
      const temp = newLayers[index];
      newLayers[index] = newLayers[index + direction];
      newLayers[index + direction] = temp;
      return newLayers;
    });
  };

  const updateLayer = (id: string, updates: Partial<Layer>, saveHistory = true) => {
    if (saveHistory) commitToHistory();
    setLayers((prev) =>
      prev.map((layer) => (layer.id === id ? { ...layer, ...updates } : layer))
    );
  };

  const exportLayer = async (e: React.MouseEvent, layer: Layer) => {
    e.stopPropagation();
    const el = document.getElementById(`layer-wrapper-${layer.id}`);
    if (!el) return;
    try {
      const dataUrl = await toPng(el, { backgroundColor: 'rgba(0,0,0,0)', pixelRatio: 2 });
      const a = document.createElement('a');
      a.download = `warped-${layer.name}`;
      if (!a.download.endsWith('.png')) a.download += '.png';
      a.href = dataUrl;
      a.click();
    } catch (err) {
      console.error('Failed to export layer', err);
    }
  };

  const exportCanvas = async () => {
    const el = document.getElementById('main-canvas-workspace');
    if (!el) return;
    try {
      // temporarily hide handles before capture
      const handles = document.getElementById('canvas-handles-container');
      const cutoutUI = document.getElementById('canvas-cutout-ui');
      if (handles) handles.style.display = 'none';
      if (cutoutUI) cutoutUI.style.display = 'none';
      
      const prevClasses = el.className;
      // Strip bg-checkerboard and border classes for clean export
      el.className = "relative overflow-hidden";
      const oldBg = el.style.background;
      el.style.background = 'transparent';

      const dataUrl = await toPng(el, { backgroundColor: 'rgba(0,0,0,0)', pixelRatio: 2 });
      
      if (handles) handles.style.display = '';
      if (cutoutUI) cutoutUI.style.display = '';
      el.className = prevClasses;
      el.style.background = oldBg;

      const a = document.createElement('a');
      a.download = `perspective-map-export.png`;
      a.href = dataUrl;
      a.click();
    } catch (err) {
      console.error('Failed to export canvas', err);
    }
  };

  return (
    <div
      className="flex h-screen w-full font-sans bg-[#111111] text-gray-200 overflow-hidden select-none"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* Sidebar */}
      <div className="w-80 flex-shrink-0 border-r border-white/10 bg-[#1A1A1A] flex flex-col z-10">
        <div className="p-4 flex items-center gap-3 border-b border-white/5">
          <div className="w-5 h-5 bg-blue-500 rounded-sm rotate-45 flex items-center justify-center shadow-lg"></div>
          <div className="flex-1">
            <h1 className="font-medium tracking-tight text-white leading-tight uppercase text-sm flex items-center gap-2">
              Perspective Map
            </h1>
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1">Manual Art Tool</p>
          </div>
          <div className="flex items-center gap-1 border-l border-white/10 pl-3">
             <button
                onClick={undo}
                disabled={past.length === 0}
                className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:text-gray-400 transition-colors rounded hover:bg-white/5"
             >
               <Undo2 className="w-4 h-4" />
             </button>
             <button
                onClick={redo}
                disabled={future.length === 0}
                className="p-1.5 text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:text-gray-400 transition-colors rounded hover:bg-white/5"
             >
               <Redo2 className="w-4 h-4" />
             </button>
             <button
                onClick={exportCanvas}
                className="p-1.5 text-gray-400 hover:text-white transition-colors rounded hover:bg-white/5 ml-1"
                title="Export Canvas"
             >
               <Download className="w-4 h-4" />
             </button>
          </div>
        </div>

        <div className="p-4 border-b border-white/5 space-y-2">
          <label className="flex items-center justify-center gap-2 w-full py-2 px-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded cursor-pointer transition-colors text-xs text-white">
            <Upload className="w-4 h-4" />
            <span className="font-medium tracking-wider">ADD ASSET</span>
            <input type="file" accept="image/*" onChange={handleAddImage} className="hidden" />
          </label>
          <button 
            onClick={() => setGithubModalOpen(true)}
            className="flex items-center justify-center gap-2 w-full py-2 px-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded cursor-pointer transition-colors text-xs text-white"
          >
            <Github className="w-4 h-4" />
            <span className="font-medium tracking-wider">IMPORT FROM GITHUB</span>
          </button>
        </div>

        <div className="p-4 border-b border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-1.5"><Move className="w-3.5 h-3.5" /> Transform Mode</span>
          </div>
          <div className="flex bg-black/40 rounded p-1">
            <button 
              onClick={() => setToolMode('scale')}
              className={`flex-1 text-[10px] py-1 rounded transition-colors ${toolMode === 'scale' ? 'bg-blue-600/50 border-blue-500 text-white shadow-sm' : 'text-gray-500 hover:text-white'}`}
            >
              Scale
            </button>
            <button 
              onClick={() => setToolMode('perspective')}
              className={`flex-1 text-[10px] py-1 rounded transition-colors ${toolMode === 'perspective' ? 'bg-blue-600/50 border-blue-500 text-white shadow-sm' : 'text-gray-500 hover:text-white'}`}
            >
              Perspective
            </button>
          </div>
        </div>

        {selectedLayerId && (
          <div className="p-4 border-b border-white/5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-1.5"><Smile className="w-3.5 h-3.5" /> Face Detect</span>
            </div>
            <button 
              onClick={() => detectAndCutFace(selectedLayerId)}
              disabled={isDetectingFace === selectedLayerId}
              className="w-full text-[10px] py-1.5 rounded transition-colors bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {isDetectingFace === selectedLayerId ? (
                <div className="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
              ) : (
                <>Auto-Crop Face from Selected Layer</>
              )}
            </button>
          </div>
        )}

        <div className="p-4 border-b border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-1.5"><Scissors className="w-3.5 h-3.5" /> Global Cutout</span>
            <button 
              onClick={() => { commitToHistory(); setCutout(c => ({...c, enabled: !c.enabled})); }}
              className={`text-[9px] px-2 py-0.5 rounded border font-medium ${cutout.enabled ? 'bg-blue-600/20 border-blue-500 text-blue-400' : 'bg-white/5 border-white/10 text-gray-500 hover:text-white'}`}
            >
              {cutout.enabled ? 'ON' : 'OFF'}
            </button>
          </div>
          {cutout.enabled && (
            <div className="flex bg-black/40 rounded p-1">
              <button 
                onClick={() => { commitToHistory(); setCutout(c => ({...c, mode: 'hole'})); }}
                className={`flex-1 text-[10px] py-1 rounded transition-colors ${cutout.mode === 'hole' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-white'}`}
              >
                Hole
              </button>
              <button 
                onClick={() => { commitToHistory(); setCutout(c => ({...c, mode: 'crop'})); }}
                className={`flex-1 text-[10px] py-1 rounded transition-colors ${cutout.mode === 'crop' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-white'}`}
              >
                Crop
              </button>
            </div>
          )}
        </div>

        <div className="p-4 pb-2">
           <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Layers</span>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
          {layers.length === 0 && (
            <div className="text-center p-8 text-gray-500">
              <ImageIcon className="w-8 h-8 mx-auto mb-3 opacity-20" />
              <p className="text-xs">No assets yet.</p>
              <p className="text-[10px] mt-1">Upload an image to start mapping.</p>
            </div>
          )}

          {/* Render layers in reverse to match traditional layer stack (top visually = rendered last/top z-index) */}
          {[...layers].reverse().map((layer, reverseIndex) => {
            const actualIndex = layers.length - 1 - reverseIndex;
            const isSelected = selectedLayerId === layer.id;

            return (
              <div
                key={layer.id}
                onClick={() => setSelectedLayerId(layer.id)}
                className={`group p-2.5 rounded-md transition-all cursor-pointer border ${
                  isSelected
                    ? 'bg-blue-600/20 border-blue-500/30 shadow-inner'
                    : 'bg-white/5 border-white/10 opacity-60 hover:opacity-100'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      updateLayer(layer.id, { visible: !layer.visible });
                    }}
                    className={`p-1 rounded hover:bg-white/10 transition-colors ${
                      layer.visible ? 'text-white' : 'text-gray-500'
                    }`}
                  >
                    {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                  <span className={`flex-1 text-[11px] font-medium truncate ${isSelected ? 'text-white' : 'text-gray-400'}`} title={layer.name}>
                    {layer.name}
                  </span>
                  
                  <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => moveLayer(actualIndex, 1, e)}
                      disabled={actualIndex === layers.length - 1}
                      className="text-gray-500 hover:text-white disabled:opacity-30 disabled:hover:text-gray-500"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => moveLayer(actualIndex, -1, e)}
                      disabled={actualIndex === 0}
                      className="text-gray-500 hover:text-white disabled:opacity-30 disabled:hover:text-gray-500"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  
                  <button
                    onClick={(e) => { e.stopPropagation(); detectAndCutFace(layer.id); }}
                    disabled={isDetectingFace === layer.id}
                    className="p-1 text-gray-500 hover:text-white rounded transition-colors ml-1 disabled:opacity-50"
                    title="Crop to Face"
                  >
                    {isDetectingFace === layer.id ? (
                      <div className="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                    ) : (
                      <Smile className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <button
                    onClick={(e) => exportLayer(e, layer)}
                    className="p-1 text-gray-500 hover:text-white rounded transition-colors ml-1"
                    title="Export Warped Layer"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={(e) => deleteLayer(layer.id, e)}
                    className="p-1 text-gray-500 hover:text-red-400 rounded transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div 
                  className="flex items-center gap-2 pl-1"
                  onClick={(e) => e.stopPropagation()} // prevent select trigger on slider interact
                >
                  <span className="text-[9px] text-gray-500 w-8 font-mono">
                    {Math.round(layer.opacity * 100)}%
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={layer.opacity}
                    onPointerDown={() => commitToHistory()}
                    onChange={(e) => updateLayer(layer.id, { opacity: parseFloat(e.target.value) }, false)}
                    className="flex-1 h-1 bg-[#1A1A1A] border border-white/10 rounded-full appearance-none cursor-pointer accent-blue-500"
                  />
                  <button
                    onClick={() => updateLayer(layer.id, { locked: !layer.locked })}
                    className={`p-1 rounded transition-colors ${
                      layer.locked ? 'text-red-400' : 'text-gray-600 hover:text-gray-400'
                    }`}
                  >
                    {layer.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Workspace */}
      <div 
        ref={wrapperRef}
        className="flex-1 relative flex items-center justify-center bg-[#0F0F0F]"
      >
        <div
          ref={containerRef}
          id="main-canvas-workspace"
          className="bg-checkerboard relative overflow-hidden shadow-2xl border border-white/20"
          style={{
            width: `${CANVAS_SIZE}px`,
            height: `${CANVAS_SIZE}px`,
            transform: `scale(${scale})`,
            transformOrigin: 'center center',
            touchAction: 'none'
          }}
        >
          {/* Masked Layers */}
          <div 
            className="absolute inset-0 pointer-events-none"
            style={
              cutout.enabled
                ? {
                    WebkitMaskImage:
                      cutout.mode === 'hole'
                        ? `radial-gradient(circle at ${cutout.x}px ${cutout.y}px, transparent ${cutout.r}px, black ${cutout.r + 0.5}px)`
                        : `radial-gradient(circle at ${cutout.x}px ${cutout.y}px, black ${cutout.r}px, transparent ${cutout.r + 0.5}px)`,
                    maskImage:
                      cutout.mode === 'hole'
                        ? `radial-gradient(circle at ${cutout.x}px ${cutout.y}px, transparent ${cutout.r}px, black ${cutout.r + 0.5}px)`
                        : `radial-gradient(circle at ${cutout.x}px ${cutout.y}px, black ${cutout.r}px, transparent ${cutout.r + 0.5}px)`,
                  }
                : {}
            }
          >
            {layers.map((layer) => {
               if (!layer.visible) return null;

               const srcPoints: [Point, Point, Point, Point] = [
                 { x: 0, y: 0 },
                 { x: layer.originalWidth, y: 0 },
                 { x: layer.originalWidth, y: layer.originalHeight },
                 { x: 0, y: layer.originalHeight }
               ];
               
               const transform = getPerspectiveTransform(srcPoints, layer.corners);

               return (
                 <div
                   key={layer.id}
                   id={`layer-wrapper-${layer.id}`}
                   className="absolute inset-0"
                 >
                   <img
                     src={layer.url}
                     alt={layer.name}
                     className="absolute left-0 top-0 max-w-none transform-gpu origin-top-left"
                     style={{
                       width: `${layer.originalWidth}px`,
                       height: `${layer.originalHeight}px`,
                       transform: transform,
                       opacity: layer.opacity,
                     }}
                   />
                 </div>
               );
            })}
          </div>

          {/* Handles Container */}
          <div id="canvas-handles-container" className="absolute inset-0 pointer-events-none z-40">
            {layers.map((layer) => {
               if (!layer.visible || selectedLayerId !== layer.id || layer.locked) return null;
               
               const minX = Math.min(...layer.corners.map(c => c.x));
               const maxX = Math.max(...layer.corners.map(c => c.x));
               const minY = Math.min(...layer.corners.map(c => c.y));
               const maxY = Math.max(...layer.corners.map(c => c.y));
               const centerX = (minX + maxX) / 2;
               const centerY = (minY + maxY) / 2;

               return (
                 <React.Fragment key={`handles-${layer.id}`}>
                   {/* Bounding box dashed outline */}
                   <div 
                      className="absolute border border-dashed border-gray-400/50 pointer-events-none"
                      style={{ left: minX, top: minY, width: maxX - minX, height: maxY - minY }}
                   />
                   
                   {/* Move handle in center */}
                   <div
                      className="absolute w-12 h-12 -ml-6 -mt-6 bg-blue-500/10 backdrop-blur-sm border border-blue-500/40 rounded-xl shadow-lg pointer-events-auto flex items-center justify-center cursor-move text-white hover:bg-blue-500/30 hover:border-blue-500 transition-all z-50 hover:scale-110"
                      style={{ left: centerX, top: centerY }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        commitToHistory();
                        const rect = containerRef.current!.getBoundingClientRect();
                        const localX = (e.clientX - rect.left) / scale;
                        const localY = (e.clientY - rect.top) / scale;
                        setDragState({ type: 'move', layerId: layer.id, startX: localX, startY: localY, initialCorners: [...layer.corners] });
                      }}
                   >
                      <Move className="w-5 h-5 drop-shadow-md" />
                   </div>
                   
                   {/* Scale handles on bounding box corners */}
                   {toolMode === 'scale' && [
                     {x: minX, y: minY},
                     {x: maxX, y: minY},
                     {x: maxX, y: maxY},
                     {x: minX, y: maxY}
                   ].map((pt, i) => (
                      <div
                        key={`scale-${layer.id}-${i}`}
                        className="absolute w-8 h-8 -ml-4 -mt-4 bg-transparent group pointer-events-auto z-50 flex items-center justify-center"
                        style={{ left: pt.x, top: pt.y, cursor: i % 2 === 0 ? 'nwse-resize' : 'nesw-resize' }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          commitToHistory();
                          const rect = containerRef.current!.getBoundingClientRect();
                          const localX = (e.clientX - rect.left) / scale;
                          const localY = (e.clientY - rect.top) / scale;
                          setDragState({ 
                            type: 'scale', 
                            layerId: layer.id, 
                            startX: localX, 
                            startY: localY, 
                            initialCorners: [...layer.corners],
                            center: { x: centerX, y: centerY }
                          });
                        }}
                      >
                        <div className="w-5 h-5 bg-white border-2 border-blue-500 shadow-md group-hover:scale-125 transition-transform flex items-center justify-center shadow-black/50">
                          <div className="w-1.5 h-1.5 bg-blue-500 pointer-events-none" />
                        </div>
                      </div>
                   ))}

                   {/* Perspective Handles */}
                   {toolMode === 'perspective' && layer.corners.map((pt, i) => (
                     <div
                        key={`handle-${layer.id}-${i}`}
                        className="absolute w-8 h-8 -ml-4 -mt-4 bg-transparent group pointer-events-auto flex items-center justify-center z-50 cursor-crosshair"
                        style={{
                          left: `${pt.x}px`,
                          top: `${pt.y}px`
                        }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          commitToHistory();
                          setDragState({ type: 'perspective', layerId: layer.id, index: i });
                          setSelectedLayerId(layer.id);
                        }}
                     >
                        <div className="w-5 h-5 bg-white border-2 border-red-500 shadow-md group-hover:scale-125 transition-transform flex items-center justify-center shadow-black/50">
                          <div className="w-1.5 h-1.5 bg-red-500 pointer-events-none" />
                        </div>
                     </div>
                   ))}
                 </React.Fragment>
               );
            })}
          </div>

          {/* Global Cutout Area UI */}
          {cutout.enabled && (
            <div id="canvas-cutout-ui" className="absolute inset-0 pointer-events-none z-50">
              {/* Circle outline */}
              <div 
                className="absolute border border-blue-500/80 rounded-full bg-blue-500/5 shadow-[0_0_15px_rgba(59,130,246,0.3)]"
                style={{
                  left: cutout.x - cutout.r,
                  top: cutout.y - cutout.r,
                  width: cutout.r * 2,
                  height: cutout.r * 2
                }}
              />
              
              {/* Center point dragging handle */}
              <div 
                className="absolute w-5 h-5 -ml-2.5 -mt-2.5 bg-blue-500 border border-white rounded-full cursor-move pointer-events-auto shadow-md hover:scale-110 transition-transform flex items-center justify-center p-0.5"
                style={{ left: cutout.x, top: cutout.y }}
                onPointerDown={(e) => { e.stopPropagation(); commitToHistory(); setDragState({ type: 'mask-center' }); }}
              >
                  <Move className="w-full h-full text-white" />
              </div>
              
              {/* Edge radius handle */}
              <div 
                className="absolute w-4 h-4 -ml-2 -mt-2 bg-white border border-blue-600 rounded-full cursor-nesw-resize pointer-events-auto shadow-md hover:scale-125 transition-transform"
                style={{ left: cutout.x + (cutout.r * Math.cos(Math.PI/4)), top: cutout.y + (cutout.r * Math.sin(Math.PI/4)) }}
                onPointerDown={(e) => { e.stopPropagation(); commitToHistory(); setDragState({ type: 'mask-edge' }); }}
              />
            </div>
          )}
        </div>
      </div>

      {githubModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#1A1A1A] border border-white/10 rounded-xl max-w-md w-full shadow-2xl overflow-hidden shadow-black/50">
            <div className="p-4 border-b border-white/10">
              <h2 className="text-sm font-medium text-white tracking-tight uppercase flex items-center gap-2">
                <Github className="w-4 h-4" />
                Import from GitHub
              </h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">
                  Folder URL
                </label>
                <input 
                  type="text" 
                  value={githubUrlInput}
                  onChange={(e) => setGithubUrlInput(e.target.value)}
                  placeholder="https://github.com/owner/repo/tree/main/folder"
                  className="w-full bg-black/50 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
              {importError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-xs text-center">
                  {importError}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-white/10 flex items-center gap-2 justify-end bg-black/20">
              <button 
                onClick={() => setGithubModalOpen(false)}
                disabled={isImporting}
                className="px-4 py-2 text-xs font-medium text-gray-400 hover:text-white transition-colors disabled:opacity-50"
              >
                CANCEL
              </button>
              <button 
                onClick={() => processGithubImport(githubUrlInput)}
                disabled={!githubUrlInput.trim() || isImporting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded transition-colors disabled:opacity-50 disabled:hover:bg-blue-600 flex items-center gap-2"
              >
                {isImporting ? (
                  <>
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
                    IMPORTING...
                  </>
                ) : (
                  'IMPORT FILES'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
