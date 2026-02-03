import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Command } from '@tauri-apps/plugin-shell';
import { basename, join } from '@tauri-apps/api/path';
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
    exportDurationMinutes,
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
    exportDurationMinutes: state.exportDurationMinutes,
    setExportDurationMinutes: state.setExportDurationMinutes
  }));

  const [logs, setLogs] = useState<string[]>([]);

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

  const validateLoop = () => {
    if (!audioFile) {
      setStatus('error', 'Sélectionnez un audio.');
      return false;
    }
    const segment = loopEnd - loopStart;
    if (segment <= 0) {
      setStatus('error', 'Loop invalide. Ajustez les bornes.');
      return false;
    }
    return true;
  };

  const runExport = async (format: 'wav' | 'mp3') => {
    if (!validateLoop() || !audioFile) return;
    if (!outputDir) {
      setStatus('error', 'Choisissez un dossier de sortie.');
      return;
    }

    setStatus('exporting', `Export ${format.toUpperCase()} en cours...`);

    const segment = loopEnd - loopStart;
    const crossfadeSeconds = Math.min(segment / 2 - 0.01, crossfadeMs / 1000);
    if (crossfadeSeconds <= 0) {
      setStatus('error', 'Le crossfade doit être plus court que la boucle.');
      return;
    }

    const filter = `[0:a]atrim=start=${loopStart}:end=${loopEnd},asetpts=PTS-STARTPTS,asplit=2[a0][a1];` +
      `[a0]afade=t=out:st=${(segment - crossfadeSeconds).toFixed(3)}:d=${crossfadeSeconds.toFixed(3)}[a0f];` +
      `[a1]atrim=start=${(segment - crossfadeSeconds).toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${crossfadeSeconds.toFixed(3)}[a1f];` +
      `[a0f][a1f]acrossfade=d=${crossfadeSeconds.toFixed(3)}:c1=tri:c2=tri[aout]`;

    const baseName = (await basename(audioFile.path)).replace(/\.[^/.]+$/, '');
    const targetName = `${baseName}_loop.${format}`;
    const targetPath = await join(outputDir, targetName);

    const args = ['-y', '-i', audioFile.path, '-filter_complex', filter, '-map', '[aout]'];
    if (format === 'wav') {
      args.push('-c:a', 'pcm_s24le');
    } else {
      args.push('-c:a', 'libmp3lame', '-b:a', '320k');
    }
    args.push(targetPath);

    try {
      appendLog(`ffmpeg ${args.join(' ')}`);
      const command = Command.sidecar('ffmpeg', args, { cwd: outputDir });
      const { code, stdout, stderr } = await command.execute();
      appendLog(stdout);
      if (code === 0) {
        setStatus('success', `${format.toUpperCase()} exporté: ${targetName}`, targetPath);
      } else {
        appendLog(stderr);
        setStatus('error', `FFmpeg a retourné le code ${code}`);
      }
    } catch (error) {
      appendLog(String(error));
      setStatus('error', 'Export impossible. Vérifiez FFmpeg.');
    }
  };

  const runExportMp4 = async () => {
    if (!validateLoop() || !audioFile || !visualFile) {
      setStatus('error', 'Audio et visuel nécessaires pour exporter en MP4.');
      return;
    }
    if (!outputDir) {
      setStatus('error', 'Choisissez un dossier de sortie.');
      return;
    }
    if (!exportDurationMinutes || exportDurationMinutes <= 0) {
      setStatus('error', 'Durée vidéo invalide.');
      return;
    }

    const durationSeconds = Math.max(1, Math.round(exportDurationMinutes * 60));
    const segment = loopEnd - loopStart;
    const crossfadeSeconds = Math.min(segment / 2 - 0.01, crossfadeMs / 1000);
    if (crossfadeSeconds <= 0) {
      setStatus('error', 'Le crossfade doit être plus court que la boucle.');
      return;
    }

    const sampleRate = 44100;
    const loopSamples = Math.max(1, Math.round(segment * sampleRate));
    const audioFilter =
      `[0:a]atrim=start=${loopStart}:end=${loopEnd},asetpts=PTS-STARTPTS,asplit=2[a0][a1];` +
      `[a0]afade=t=out:st=${(segment - crossfadeSeconds).toFixed(3)}:d=${crossfadeSeconds.toFixed(3)}[a0f];` +
      `[a1]atrim=start=${(segment - crossfadeSeconds).toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${crossfadeSeconds.toFixed(3)}[a1f];` +
      `[a0f][a1f]acrossfade=d=${crossfadeSeconds.toFixed(3)}:c1=tri:c2=tri[aLoopBase];` +
      `[aLoopBase]aresample=${sampleRate},aloop=loop=-1:size=${loopSamples}[aout]`;

    const baseName = (await basename(audioFile.path)).replace(/\.[^/.]+$/, '');
    const videoName = `${baseName}_loop_${exportDurationMinutes}m.mp4`;
    const targetPath = await join(outputDir, videoName);

    const visualArgs =
      visualFile.kind === 'image'
        ? ['-loop', '1', '-framerate', '30', '-i', visualFile.path]
        : ['-stream_loop', '-1', '-i', visualFile.path];

    const args = [
      '-y',
      '-i',
      audioFile.path,
      ...visualArgs,
      '-filter_complex',
      audioFilter,
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
      setStatus('exporting', `Export MP4 (${exportDurationMinutes} min) en cours...`);
      appendLog(`ffmpeg ${args.join(' ')}`);
      const command = Command.sidecar('ffmpeg', args, { cwd: outputDir });
      const { code, stdout, stderr } = await command.execute();
      appendLog(stdout);
      if (code === 0) {
        setStatus('success', `MP4 exporté: ${videoName}`, targetPath);
      } else {
        appendLog(stderr);
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
      <label>
        Durée export vidéo (minutes)
        <input
          type="number"
          min={1}
          max={600}
          step={1}
          value={exportDurationMinutes}
          onChange={(event) => setExportDurationMinutes(Number(event.target.value))}
        />
      </label>
      <div className="export-buttons">
        <button type="button" onClick={() => runExport('wav')} disabled={status === 'exporting'} className="primary">Exporter WAV</button>
        <label className="checkbox">
          <input type="checkbox" checked={enableMp3} onChange={(event) => toggleMp3(event.target.checked)} /> Export MP3 aussi
        </label>
        <button type="button" onClick={() => runExport('mp3')} disabled={!enableMp3 || status === 'exporting'}>Exporter MP3</button>
      </div>
      {visualFile && (
        <button type="button" className="primary" disabled={status === 'exporting'} onClick={runExportMp4}>
          Exporter MP4 ({exportDurationMinutes} min)
        </button>
      )}
      <div className={`status-banner ${status}`}>
        {statusMessage ?? 'Prêt'}
      </div>
      <details>
        <summary>Logs FFmpeg</summary>
        <pre className="logs">{logs.join('\n')}</pre>
      </details>
    </div>
  );
};

export default ExportPanel;
