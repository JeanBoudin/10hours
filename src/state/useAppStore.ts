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

type ExportStatus = 'idle' | 'exporting' | 'success' | 'error';

interface AppState {
  audioFile?: AudioFile;
  visualFile?: VisualFile;
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
