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
  volume: number;
  outputDir?: string;
  status: ExportStatus;
  statusMessage?: string;
  enableMp3: boolean;
  lastExportPath?: string;
  exportDurationHours: number;
  exportDurationMinutes: number;
  setAudioFile: (file?: AudioFile) => void;
  setVisualFile: (file?: VisualFile) => void;
  setLoopBounds: (start: number, end: number) => void;
  setAudioDuration: (duration: number) => void;
  setVolume: (volume: number) => void;
  setCrossfade: (ms: number) => void;
  setOutputDir: (path: string) => void;
  setStatus: (status: ExportStatus, message?: string, exportedPath?: string) => void;
  toggleMp3: (enabled: boolean) => void;
  setExportDurationHours: (hours: number) => void;
  setExportDurationMinutes: (minutes: number) => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const useAppStore = create<AppState>((set, get) => ({
  loopStart: 0,
  loopEnd: 0,
  crossfadeMs: 150,
  volume: 0.8,
  status: 'idle',
  enableMp3: false,
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
    const duration = audioFile?.duration ?? end;
    const safeStart = clamp(start, 0, duration);
    const safeEnd = clamp(end, safeStart + 0.01, duration || safeStart + 0.01);
    set({ loopStart: Number(safeStart.toFixed(3)), loopEnd: Number(safeEnd.toFixed(3)) });
  },
  setAudioDuration: (duration) =>
    set((state) => ({
      audioFile: state.audioFile ? { ...state.audioFile, duration } : undefined,
      loopEnd: duration || state.loopEnd
    })),
  setVolume: (volume) => set({ volume }),
  setCrossfade: (ms) => set({ crossfadeMs: ms }),
  setOutputDir: (path) => set({ outputDir: path }),
  setStatus: (status, message, exportedPath) =>
    set({ status, statusMessage: message, lastExportPath: exportedPath ?? get().lastExportPath }),
  toggleMp3: (enabled) => set({ enableMp3: enabled }),
  setExportDurationHours: (hours) => set({ exportDurationHours: hours }),
  setExportDurationMinutes: (minutes) => set({ exportDurationMinutes: minutes })
}));
