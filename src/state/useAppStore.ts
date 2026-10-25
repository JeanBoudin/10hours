import { create } from 'zustand';

export type AudioFile = {
  path: string;
  name: string;
  duration?: number;
};

export type VisualFile = {
  path: string;
  name: string;
  kind: 'image' | 'video' | 'gif';
};

export type OverlayFile = {
  path: string;
  name: string;
};

export type OverlayCorner = 'tl' | 'tr' | 'bl' | 'br';
export type OverlayMode = 'intro' | 'custom' | 'all';

export const OVERLAY_INTRO_SECONDS = 15;
export const OVERLAY_FADE_SECONDS = 0.5;
// Gabarit de la vidéo exportée (1920x1080): la capture garde sa taille jusqu'à 40 % de la largeur.
export const OVERLAY_MAX_WIDTH = 768;
export const OVERLAY_MARGIN = 48;

// Durée d'affichage de la capture en secondes, ou null pour toute la vidéo.
export const getOverlayDuration = (mode: OverlayMode, customSeconds: number) => {
  if (mode === 'all') return null;
  return mode === 'intro' ? OVERLAY_INTRO_SECONDS : customSeconds;
};

type ExportStatus = 'idle' | 'exporting' | 'success' | 'error';

interface AppState {
  audioFile?: AudioFile;
  visualFile?: VisualFile;
  overlayFile?: OverlayFile;
  overlayCorner: OverlayCorner;
  overlayMode: OverlayMode;
  overlaySeconds: number;
  loopStart: number;
  loopEnd: number;
  crossfadeMs: number;
  autoCrossfade: boolean;
  zeroCrossingSnap: boolean;
  volume: number;
  outputDir?: string;
  status: ExportStatus;
  statusMessage?: string;
  lastExportPath?: string;
  exportDurationHours: number;
  exportDurationMinutes: number;
  setAudioFile: (file?: AudioFile) => void;
  setVisualFile: (file?: VisualFile) => void;
  setOverlayFile: (file?: OverlayFile) => void;
  setOverlayCorner: (corner: OverlayCorner) => void;
  setOverlayMode: (mode: OverlayMode) => void;
  setOverlaySeconds: (seconds: number) => void;
  setLoopBounds: (start: number, end: number) => void;
  setAudioDuration: (duration: number) => void;
  setVolume: (volume: number) => void;
  setCrossfade: (ms: number) => void;
  toggleAutoCrossfade: (enabled: boolean) => void;
  toggleZeroCrossingSnap: (enabled: boolean) => void;
  setOutputDir: (path: string) => void;
  setStatus: (status: ExportStatus, message?: string, exportedPath?: string) => void;
  setExportDurationHours: (hours: number) => void;
  setExportDurationMinutes: (minutes: number) => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const useAppStore = create<AppState>((set, get) => ({
  overlayCorner: 'tr',
  overlayMode: 'intro',
  overlaySeconds: 30,
  loopStart: 0,
  loopEnd: 0,
  crossfadeMs: 150,
  autoCrossfade: true,
  zeroCrossingSnap: true,
  volume: 0.8,
  status: 'idle',
  exportDurationHours: 1,
  exportDurationMinutes: 0,
  setAudioFile: (file) =>
    set(() => ({
      audioFile: file,
      loopStart: 0,
      loopEnd: file?.duration ?? 0
    })),
  setVisualFile: (file) => set({ visualFile: file }),
  setOverlayFile: (file) => set({ overlayFile: file }),
  setOverlayCorner: (corner) => set({ overlayCorner: corner }),
  setOverlayMode: (mode) => set({ overlayMode: mode }),
  setOverlaySeconds: (seconds) =>
    set({ overlaySeconds: Number.isFinite(seconds) ? clamp(Math.round(seconds), 1, 3600) : 1 }),
  setLoopBounds: (start, end) => {
    const { audioFile } = get();
    const fallbackStart = get().loopStart;
    const fallbackEnd = get().loopEnd;
    const startValue = Number.isFinite(start) ? start : fallbackStart;
    const endValue = Number.isFinite(end) ? end : fallbackEnd;
    if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) return;

    const rawDuration = audioFile?.duration;
    const duration = Number.isFinite(rawDuration)
      ? Math.max(0, Number(rawDuration))
      : Math.max(endValue, startValue, 0.01);

    const safeStart = clamp(startValue, 0, duration);
    const safeEnd = clamp(endValue, safeStart + 0.01, duration || safeStart + 0.01);
    if (!Number.isFinite(safeStart) || !Number.isFinite(safeEnd)) return;

    set({ loopStart: Number(safeStart.toFixed(3)), loopEnd: Number(safeEnd.toFixed(3)) });
  },
  setAudioDuration: (duration) =>
    set((state) => {
      if (!Number.isFinite(duration) || duration <= 0) return state;
      const safeDuration = Number(duration);
      return {
        audioFile: state.audioFile ? { ...state.audioFile, duration: safeDuration } : undefined,
        loopEnd: safeDuration || state.loopEnd
      };
    }),
  setVolume: (volume) => set({ volume }),
  setCrossfade: (ms) => set({ crossfadeMs: Math.max(5, Number.isFinite(ms) ? Math.round(ms) : 5) }),
  toggleAutoCrossfade: (enabled) => set({ autoCrossfade: enabled }),
  toggleZeroCrossingSnap: (enabled) => set({ zeroCrossingSnap: enabled }),
  setOutputDir: (path) => set({ outputDir: path }),
  setStatus: (status, message, exportedPath) =>
    set({ status, statusMessage: message, lastExportPath: exportedPath ?? get().lastExportPath }),
  setExportDurationHours: (hours) => set({ exportDurationHours: hours }),
  setExportDurationMinutes: (minutes) => set({ exportDurationMinutes: minutes })
}));
