import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Command } from '@tauri-apps/plugin-shell';
import { join } from '@tauri-apps/api/path';
import { useAppStore } from '../state/useAppStore';

const ExportPanel = () => {
  const {
    audioFile,
    visualFile,
    loopStart,
    loopEnd,
    crossfadeMs,
    setCrossfade,
    outputDir,
    setOutputDir,
    setStatus,
    status,
    statusMessage,
    enableMp3,
    toggleMp3,
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
    setCrossfade: state.setCrossfade,
    outputDir: state.outputDir,
    setOutputDir: state.setOutputDir,
    setStatus: state.setStatus,
    status: state.status,
    statusMessage: state.statusMessage,
    enableMp3: state.enableMp3,
    toggleMp3: state.toggleMp3,
    exportDurationHours: state.exportDurationHours,
    exportDurationMinutes: state.exportDurationMinutes,
    setExportDurationHours: state.setExportDurationHours,
    setExportDurationMinutes: state.setExportDurationMinutes
  }));

  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
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
        setStatus('idle', `Dossier sélectionné: ${directory}`);
      }
    } catch (error) {
      console.error('Directory dialog error', error);
      setStatus('error', 'Impossible de choisir un dossier.');
    }
  };

  const appendLog = (line: string) => setLogs((prev) => [line, ...prev].slice(0, 50));
  const updateProgressFromLine = (line: string, durationSeconds: number) => {
    if (!line || durationSeconds <= 0) return;
    if (line.startsWith('out_time_ms=')) {
      const value = Number(line.replace('out_time_ms=', ''));
      if (Number.isFinite(value)) {
        const ratio = Math.min(1, Math.max(0, value / (durationSeconds * 1_000_000)));
        setProgress(ratio);
      }
    } else if (line.startsWith('progress=end')) {
      setProgress(1);
    }
  };

  const runFfmpegWithProgress = async (args: string[], durationSeconds: number) => {
    if (!outputDir) {
      setStatus('error', 'Choisissez un dossier de sortie.');
      return { code: 1, stdout: '', stderr: 'No output directory' };
    }
    setProgress(0);
    let buffer = '';
    const command = Command.sidecar('ffmpeg', args, { cwd: outputDir });
    command.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      lines.forEach((line) => updateProgressFromLine(line, durationSeconds));
    });
    command.stderr.on('data', (line) => {
      if (line) appendLog(line);
    });
    try {
      await command.spawn();
      const result = await new Promise<{ code: number | null; signal: number | null }>((resolve, reject) => {
        command.on('close', resolve);
        command.on('error', reject);
      });
      if (result.code === 0) setProgress(1);
      return { code: result.code ?? 1, stdout: '', stderr: '' };
    } catch (error) {
      appendLog(String(error));
      return { code: 1, stdout: '', stderr: String(error) };
    }
  };

  const validateLoopWith = (audio: typeof audioFile, start: number, end: number) => {
    if (!audio) {
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

  const runExport = async (format: 'wav' | 'mp3') => {
    const state = useAppStore.getState();
    const currentAudio = audioFile ?? state.audioFile;
    const currentLoopStart = state.loopStart ?? loopStart;
    const currentLoopEnd = state.loopEnd ?? loopEnd;
    const currentCrossfadeMs = state.crossfadeMs ?? crossfadeMs;
    const currentOutputDir = state.outputDir ?? outputDir;
    if (!currentAudio) {
      setStatus('error', 'Sélectionnez un audio.');
      return;
    }
    if (!validateLoopWith(currentAudio, currentLoopStart, currentLoopEnd)) return;
    if (!currentOutputDir) {
      setStatus('error', 'Choisissez un dossier de sortie.');
      return;
    }
    setProgress(0);

    setStatus('exporting', `Export ${format.toUpperCase()} en cours...`);

    const segment = currentLoopEnd - currentLoopStart;
    const crossfadeSeconds = Math.min(segment / 2 - 0.01, currentCrossfadeMs / 1000);
    if (crossfadeSeconds <= 0) {
      setStatus('error', 'Le crossfade doit être plus court que la boucle.');
      return;
    }

    const filter = `[0:a]atrim=start=${currentLoopStart}:end=${currentLoopEnd},asetpts=PTS-STARTPTS,asplit=2[a0][a1];` +
      `[a0]afade=t=out:st=${(segment - crossfadeSeconds).toFixed(3)}:d=${crossfadeSeconds.toFixed(3)}[a0f];` +
      `[a1]atrim=start=${(segment - crossfadeSeconds).toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${crossfadeSeconds.toFixed(3)}[a1f];` +
      `[a0f][a1f]acrossfade=d=${crossfadeSeconds.toFixed(3)}:c1=tri:c2=tri[aout]`;

    const baseName = currentAudio.name.replace(/\.[^/.]+$/, '');
    const targetName = `${baseName}_loop.${format}`;
    const targetPath = await join(currentOutputDir, targetName);

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
      '-filter_complex',
      filter,
      '-map',
      '[aout]'
    ];
    if (format === 'wav') {
      args.push('-c:a', 'pcm_s24le');
    } else {
      args.push('-c:a', 'libmp3lame', '-b:a', '320k');
    }
    args.push(targetPath);

    try {
      appendLog(`ffmpeg ${args.join(' ')}`);
      const { code, stderr } = await runFfmpegWithProgress(args, segment);
      if (code === 0) {
        setStatus('success', `${format.toUpperCase()} exporté: ${targetName}`, targetPath);
      } else {
        if (stderr) appendLog(stderr);
        setStatus('error', `FFmpeg a retourné le code ${code}`);
      }
    } catch (error) {
      appendLog(String(error));
      setStatus('error', 'Export impossible. Vérifiez FFmpeg.');
    }
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
    if (!validateLoopWith(currentAudio, currentLoopStart, currentLoopEnd)) return;
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

    const sampleRate = 44100;
    const loopSamples = Math.max(1, Math.round(segment * sampleRate));
    const audioFilter =
      `[0:a]atrim=start=${currentLoopStart}:end=${currentLoopEnd},asetpts=PTS-STARTPTS,asplit=2[a0][a1];` +
      `[a0]afade=t=out:st=${(segment - crossfadeSeconds).toFixed(3)}:d=${crossfadeSeconds.toFixed(3)}[a0f];` +
      `[a1]atrim=start=${(segment - crossfadeSeconds).toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${crossfadeSeconds.toFixed(3)}[a1f];` +
      `[a0f][a1f]acrossfade=d=${crossfadeSeconds.toFixed(3)}:c1=tri:c2=tri[aLoopBase];` +
      `[aLoopBase]aresample=${sampleRate},aloop=loop=-1:size=${loopSamples}[aout]`;

    const baseName = currentAudio.name.replace(/\.[^/.]+$/, '');
    const videoName = `${baseName}_loop_${durationTag}.mp4`;
    const targetPath = await join(currentOutputDir, videoName);

    const visualArgs =
      currentVisual.kind === 'image'
        ? ['-loop', '1', '-framerate', '30', '-i', currentVisual.path]
        : ['-stream_loop', '-1', '-i', currentVisual.path];

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
      audioFilter,
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-map',
      '1:v:0',
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
      appendLog(`ffmpeg ${args.join(' ')}`);
      const { code, stderr } = await runFfmpegWithProgress(args, durationSeconds);
      if (code === 0) {
        setStatus('success', `MP4 exporté: ${videoName}`, targetPath);
      } else {
        if (stderr) appendLog(stderr);
        setStatus('error', `FFmpeg MP4 a échoué (code ${code}).`);
      }
    } catch (error) {
      appendLog(String(error));
      setStatus('error', 'Export MP4 impossible. Vérifiez FFmpeg.');
    }
  };

  return (
    <div className="export-panel">
      <h2>3. Export</h2>
      <label>
        Crossfade (ms)
        <input type="number" min={50} max={1000} step={10} value={crossfadeMs} onChange={(event) => setCrossfade(Number(event.target.value))} />
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
      <div className="export-buttons">
        <button type="button" onClick={() => runExport('wav')} disabled={status === 'exporting'} className="primary">Exporter WAV</button>
        <label className="checkbox">
          <input type="checkbox" checked={enableMp3} onChange={(event) => toggleMp3(event.target.checked)} /> Export MP3 aussi
        </label>
        <button type="button" onClick={() => runExport('mp3')} disabled={!enableMp3 || status === 'exporting'}>Exporter MP3</button>
      </div>
      {visualFile && (
        <button type="button" className="primary" disabled={status === 'exporting'} onClick={runExportMp4}>
          Exporter MP4 ({durationTag})
        </button>
      )}
      <div className={`status-banner ${status}`}>
        {statusMessage ?? 'Prêt'}
      </div>
      {status === 'exporting' && progress !== null && (
        <div className="progress-row">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <div className="progress-label">{Math.round(progress * 100)}%</div>
        </div>
      )}
      <details>
        <summary>Logs FFmpeg</summary>
        <pre className="logs">{logs.join('\n')}</pre>
      </details>
    </div>
  );
};

export default ExportPanel;
