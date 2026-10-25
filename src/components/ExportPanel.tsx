import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Command } from '@tauri-apps/plugin-shell';
import { join } from '@tauri-apps/api/path';
import { useAppStore } from '../state/useAppStore';

const SAMPLE_RATE = 44100;
const VIDEO_WIDTH = 1920;
const VIDEO_HEIGHT = 1080;
const VIDEO_FPS = 30;

const ExportPanel = () => {
  const {
    audioFile,
    visualFile,
    loopStart,
    loopEnd,
    crossfadeMs,
    autoCrossfade,
    setCrossfade,
    toggleAutoCrossfade,
    outputDir,
    setOutputDir,
    setStatus,
    status,
    statusMessage,
    exportDurationHours,
    exportDurationMinutes,
    setExportDurationHours,
    setExportDurationMinutes
  } = useAppStore((state) => ({
    audioFile: state.audioFile,
    visualFile: state.visualFile,
    loopStart: state.loopStart,
    loopEnd: state.loopEnd,
    crossfadeMs: state.crossfadeMs,
    autoCrossfade: state.autoCrossfade,
    setCrossfade: state.setCrossfade,
    toggleAutoCrossfade: state.toggleAutoCrossfade,
    outputDir: state.outputDir,
    setOutputDir: state.setOutputDir,
    setStatus: state.setStatus,
    status: state.status,
    statusMessage: state.statusMessage,
    exportDurationHours: state.exportDurationHours,
    exportDurationMinutes: state.exportDurationMinutes,
    setExportDurationHours: state.setExportDurationHours,
    setExportDurationMinutes: state.setExportDurationMinutes
  }));

  const [progress, setProgress] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const totalMinutes = exportDurationHours * 60 + exportDurationMinutes;
  const durationTag =
    exportDurationHours > 0
      ? exportDurationMinutes > 0
        ? `${exportDurationHours}h${exportDurationMinutes}m`
        : `${exportDurationHours}h`
      : `${exportDurationMinutes}m`;

  const chooseDirectory = async () => {
    try {
      const directory = await open({ directory: true, multiple: false });
      if (typeof directory === 'string') {
        setOutputDir(directory);
        setStatus('idle', 'Dossier de sortie sélectionné.');
      }
    } catch (error) {
      console.error('Directory dialog error', error);
      setStatus('error', 'Impossible de choisir un dossier.');
    }
  };

  const formatDuration = (seconds: number) => {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  };

  const updateProgressFromLine = (line: string, durationSeconds: number) => {
    if (!line || durationSeconds <= 0) return;
    if (line.startsWith('out_time_ms=')) {
      const value = Number(line.replace('out_time_ms=', ''));
      if (Number.isFinite(value)) {
        const currentSeconds = value / 1_000_000;
        const ratio = Math.min(1, Math.max(0, currentSeconds / durationSeconds));
        setProgress(ratio);
        setRemainingSeconds(Math.max(0, durationSeconds - currentSeconds));
      }
    } else if (line.startsWith('progress=end')) {
      setProgress(1);
      setRemainingSeconds(0);
    }
  };

  const runFfmpegWithProgress = async (args: string[], durationSeconds: number, directory: string) => {
    setProgress(0);
    setRemainingSeconds(durationSeconds);
    let buffer = '';
    let stderrBuffer = '';
    const command = Command.sidecar('ffmpeg', args, { cwd: directory });
    command.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      lines.forEach((line) => updateProgressFromLine(line, durationSeconds));
    });
    command.stderr.on('data', (line) => {
      if (line) stderrBuffer = `${stderrBuffer}\n${line}`.trim();
    });
    try {
      await command.spawn();
      const result = await new Promise<{ code: number | null; signal: number | null }>((resolve, reject) => {
        command.on('close', resolve);
        command.on('error', reject);
      });
      if (result.code === 0) setProgress(1);
      return { code: result.code ?? 1, stderr: stderrBuffer };
    } catch (error) {
      return { code: 1, stderr: `${stderrBuffer}\n${String(error)}`.trim() };
    }
  };

  const validateLoopWith = (audioPath: string | undefined, start: number, end: number) => {
    if (!audioPath) {
      setStatus('error', 'Sélectionnez un audio.');
      return false;
    }
    const segment = end - start;
    if (segment <= 0) {
      setStatus('error', 'Loop invalide. Ajustez les bornes.');
      return false;
    }
    return true;
  };

  const runExportMp4 = async () => {
    const state = useAppStore.getState();
    const currentAudio = audioFile ?? state.audioFile;
    const currentVisual = visualFile ?? state.visualFile;
    const currentLoopStart = state.loopStart ?? loopStart;
    const currentLoopEnd = state.loopEnd ?? loopEnd;
    const currentCrossfadeMs = state.crossfadeMs ?? crossfadeMs;
    const currentOutputDir = state.outputDir ?? outputDir;
    if (!currentAudio || !currentVisual) {
      setStatus('error', 'Audio et visuel nécessaires pour exporter en MP4.');
      return;
    }
    if (!validateLoopWith(currentAudio.path, currentLoopStart, currentLoopEnd)) return;
    if (!currentOutputDir) {
      setStatus('error', 'Choisissez un dossier de sortie.');
      return;
    }
    if (!totalMinutes || totalMinutes <= 0) {
      setStatus('error', 'Durée vidéo invalide.');
      return;
    }
    setProgress(0);

    const durationSeconds = Math.max(1, Math.round(totalMinutes * 60));
    const segment = currentLoopEnd - currentLoopStart;
    const crossfadeSeconds = Math.min(segment / 2 - 0.01, currentCrossfadeMs / 1000);
    if (crossfadeSeconds <= 0) {
      setStatus('error', 'Le crossfade doit être plus court que la boucle.');
      return;
    }

    // Boucle sans couture: le corps [start+X, end] finit en fondu sortant pendant que la tête [start, start+X]
    // entre en fondu, si bien que la fin de la boucle enchaîne exactement sur son début. Tout est en échantillons.
    const startSample = Math.round(currentLoopStart * SAMPLE_RATE);
    const endSample = Math.round(currentLoopEnd * SAMPLE_RATE);
    const fadeSamples = Math.max(1, Math.round(crossfadeSeconds * SAMPLE_RATE));
    const loopSamples = endSample - startSample - fadeSamples;
    const audioFilter =
      `[0:a]aresample=${SAMPLE_RATE},atrim=start_sample=${startSample}:end_sample=${endSample},asetpts=PTS-STARTPTS,asplit=2[a0][a1];` +
      `[a0]atrim=start_sample=${fadeSamples},asetpts=PTS-STARTPTS,` +
      `afade=t=out:start_sample=${loopSamples - fadeSamples}:nb_samples=${fadeSamples}[aBody];` +
      `[a1]atrim=end_sample=${fadeSamples},asetpts=PTS-STARTPTS,afade=t=in:start_sample=0:nb_samples=${fadeSamples},` +
      `adelay=delays=${loopSamples - fadeSamples}S:all=1[aHead];` +
      `[aBody][aHead]amix=inputs=2:duration=longest:normalize=0[aLoopBase];` +
      `[aLoopBase]aloop=loop=-1:size=${loopSamples}[aout]`;

    const baseName = currentAudio.name.replace(/\.[^/.]+$/, '');
    const videoName = `${baseName}_loop_${durationTag}.mp4`;
    const targetPath = await join(currentOutputDir, videoName);

    const visualArgs =
      currentVisual.kind === 'image'
        ? ['-loop', '1', '-framerate', String(VIDEO_FPS), '-i', currentVisual.path]
        : ['-stream_loop', '-1', '-i', currentVisual.path];

    // Le fond noir fixe la taille de sortie: le visuel y est centré sans déformation (bandes noires si besoin).
    const videoFilter =
      `[1:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=decrease,format=rgba[fg];` +
      `color=c=black:s=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:r=${VIDEO_FPS}[bg];` +
      `[bg][fg]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1,format=yuv420p[vout]`;

    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-progress',
      'pipe:1',
      '-nostats',
      '-i',
      currentAudio.path,
      ...visualArgs,
      '-filter_complex',
      `${audioFilter};${videoFilter}`,
      '-map',
      '[vout]',
      '-map',
      '[aout]',
      '-t',
      durationSeconds.toString(),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '320k',
      targetPath
    ];

    try {
      setStatus('exporting', `Export MP4 (${durationTag}) en cours...`);
      const { code, stderr } = await runFfmpegWithProgress(args, durationSeconds, currentOutputDir);
      if (code === 0) {
        setStatus('success', `MP4 exporté: ${videoName}`, targetPath);
      } else {
        if (stderr) console.error('FFmpeg MP4 error:', stderr);
        setStatus('error', `FFmpeg MP4 a échoué (code ${code}).`);
      }
    } catch (error) {
      console.error('Export MP4 error:', error);
      setStatus('error', 'Export MP4 impossible. Vérifiez FFmpeg.');
    }
  };

  return (
    <div className="export-panel">
      <h2>3. Export vidéo</h2>
      <label>
        Crossfade (ms){autoCrossfade ? ' auto' : ''}
        <input
          type="number"
          min={5}
          max={1000}
          step={5}
          value={crossfadeMs}
          disabled={autoCrossfade}
          onChange={(event) => setCrossfade(Number(event.target.value))}
        />
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={autoCrossfade} onChange={(event) => toggleAutoCrossfade(event.target.checked)} />
        Ajustement automatique du crossfade
      </label>
      <div className="picker-row">
        <button type="button" onClick={chooseDirectory} className="secondary">Choisir dossier de sortie</button>
        <div className="file-label">{outputDir ?? 'Non défini'}</div>
      </div>
      <div className="duration-title">Durée export vidéo</div>
      <div className="duration-row">
        <label className="duration-field">
          Heures
          <input
            type="number"
            min={0}
            max={999}
            step={1}
            value={exportDurationHours}
            onChange={(event) => {
              const value = Number(event.target.value);
              setExportDurationHours(Number.isFinite(value) ? Math.max(0, value) : 0);
            }}
          />
        </label>
        <label className="duration-field">
          Minutes
          <input
            type="number"
            min={0}
            max={59}
            step={1}
            value={exportDurationMinutes}
            onChange={(event) => {
              const value = Number(event.target.value);
              const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(59, value)) : 0;
              setExportDurationMinutes(safeValue);
            }}
          />
        </label>
      </div>
      {visualFile && (
        <button type="button" className="primary" disabled={status === 'exporting'} onClick={runExportMp4}>
          Exporter MP4 ({durationTag})
        </button>
      )}
      {!visualFile && (
        <p className="hint">Ajoutez un visuel pour activer l'export MP4.</p>
      )}
      <div className={`status-banner ${status}`}>
        {statusMessage ?? 'Prêt'}
      </div>
      {status === 'exporting' && progress !== null && (
        <div className="progress-row">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <div className="progress-meta">
            <div className="progress-label">{Math.round(progress * 100)}%</div>
            {remainingSeconds !== null && (
              <div className="progress-remaining">Restant: {formatDuration(remainingSeconds)}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ExportPanel;
