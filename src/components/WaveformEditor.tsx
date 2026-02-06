import { useCallback, useEffect, useMemo, useRef, ChangeEvent } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useAppStore } from '../state/useAppStore';

const WaveformEditor = () => {
  const {
    audioFile,
    loopStart,
    loopEnd,
    setLoopBounds,
    setAudioDuration,
    volume,
    setVolume,
    setStatus
  } = useAppStore((state) => ({
    audioFile: state.audioFile,
    loopStart: state.loopStart,
    loopEnd: state.loopEnd,
    setLoopBounds: state.setLoopBounds,
    setAudioDuration: state.setAudioDuration,
    volume: state.volume,
    setVolume: state.setVolume,
    setStatus: state.setStatus
  }));

  const containerRef = useRef<HTMLDivElement | null>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const regionRef = useRef<any>(null);

  const hasAudio = Boolean(audioFile);
  const loopDuration = useMemo(() => Math.max(loopEnd - loopStart, 0).toFixed(2), [loopStart, loopEnd]);

  useEffect(() => {
    if (!containerRef.current || !audioFile) {
      return;
    }

    const waveSurfer = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#94a3b8',
      progressColor: '#06b6d4',
      cursorColor: '#0ea5e9',
      height: 150,
      barWidth: 2,
      normalize: true,
      url: convertFileSrc(audioFile.path)
    });

    const regions = waveSurfer.registerPlugin(RegionsPlugin.create());

    waveSurfer.on('ready', () => {
      const duration = waveSurfer.getDuration();
      setAudioDuration(duration);
      setLoopBounds(0, duration);
      if (!regionRef.current) {
        regionRef.current = regions.addRegion({
          id: 'loop-region',
          drag: true,
          resize: true,
          start: 0,
          end: duration,
          loop: true,
          color: 'rgba(14,165,233,0.15)'
        });
        regionRef.current.on('update-end', (region: { start: number; end: number }) =>
          setLoopBounds(region.start, region.end)
        );
      }
    });

    waveSurfer.setVolume(volume);
    waveSurferRef.current = waveSurfer;

    return () => {
      regions?.destroy?.();
      waveSurfer.destroy();
      waveSurferRef.current = null;
      regionRef.current = null;
    };
  }, [audioFile?.path, setAudioDuration, setLoopBounds, volume]);

  useEffect(() => {
    if (regionRef.current) {
      if (typeof regionRef.current.setOptions === 'function') {
        regionRef.current.setOptions({ start: loopStart, end: loopEnd });
      } else if (typeof regionRef.current.update === 'function') {
        regionRef.current.update({ start: loopStart, end: loopEnd });
      }
    }
  }, [loopStart, loopEnd]);

  const playLoop = useCallback(() => {
    const waveSurfer = waveSurferRef.current;
    if (!waveSurfer) return;
    waveSurfer.play(loopStart, loopEnd);
  }, [loopStart, loopEnd]);

  const pause = () => waveSurferRef.current?.pause();
  const stop = () => waveSurferRef.current?.stop();

  const handleVolumeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    setVolume(value);
    waveSurferRef.current?.setVolume(value);
  };

  const handleLoopInput = (event: ChangeEvent<HTMLInputElement>, target: 'start' | 'end') => {
    const numeric = Number(event.target.value);
    if (Number.isNaN(numeric)) return;
    if (target === 'start') {
      setLoopBounds(numeric, loopEnd);
    } else {
      setLoopBounds(loopStart, numeric);
    }
  };

  const handleAutoLoop = useCallback(() => {
    const waveSurfer = waveSurferRef.current;
    const decoded = waveSurfer?.getDecodedData();
    if (!decoded) {
      setStatus('error', 'Audio pas encore prêt pour l’analyse.');
      return;
    }

    const channel = decoded.getChannelData(0);
    const sampleRate = decoded.sampleRate;
    const windowSize = 2048;
    const hop = 1024;
    const rms: number[] = [];
    for (let i = 0; i + windowSize <= channel.length; i += hop) {
      let sum = 0;
      for (let j = 0; j < windowSize; j += 1) {
        const v = channel[i + j];
        sum += v * v;
      }
      rms.push(Math.sqrt(sum / windowSize));
    }

    const maxRms = Math.max(...rms);
    if (!Number.isFinite(maxRms) || maxRms <= 0) {
      setLoopBounds(0, decoded.duration);
      setStatus('idle', 'Auto loop: silence détecté, boucle complète appliquée.');
      return;
    }

    const threshold = maxRms * 0.08;
    const segments: Array<{ start: number; end: number; score: number }> = [];
    let currentStart = -1;
    let energySum = 0;
    for (let i = 0; i < rms.length; i += 1) {
      const value = rms[i];
      if (value >= threshold) {
        if (currentStart < 0) currentStart = i;
        energySum += value;
      } else if (currentStart >= 0) {
        const length = i - currentStart;
        const score = length * (energySum / Math.max(length, 1));
        segments.push({ start: currentStart, end: i - 1, score });
        currentStart = -1;
        energySum = 0;
      }
    }
    if (currentStart >= 0) {
      const length = rms.length - currentStart;
      const score = length * (energySum / Math.max(length, 1));
      segments.push({ start: currentStart, end: rms.length - 1, score });
    }

    if (segments.length === 0) {
      setLoopBounds(0, decoded.duration);
      setStatus('idle', 'Auto loop: aucune zone détectée, boucle complète appliquée.');
      return;
    }

    const best = segments.reduce((prev, next) => (next.score > prev.score ? next : prev));
    const paddingSeconds = 0.03;
    let startSec = (best.start * hop) / sampleRate;
    let endSec = ((best.end * hop) + windowSize) / sampleRate;
    if (endSec - startSec > paddingSeconds * 2) {
      startSec += paddingSeconds;
      endSec -= paddingSeconds;
    }
    if (endSec - startSec < 0.25) {
      startSec = 0;
      endSec = decoded.duration;
    }

    setLoopBounds(startSec, endSec);
    setStatus('idle', `Auto loop: ${startSec.toFixed(2)}s → ${endSec.toFixed(2)}s`);
  }, [setLoopBounds, setStatus]);

  if (!hasAudio) {
    return <div className="waveform-placeholder">Sélectionnez un fichier audio pour afficher le waveform.</div>;
  }

  return (
    <div>
      <h2>2. Prévisualisation & boucle</h2>
      <div ref={containerRef} className="waveform-container" />
      <div className="loop-inputs">
        <label>
          Début (sec)
          <input type="number" step="0.01" value={loopStart} onChange={(event) => handleLoopInput(event, 'start')} />
        </label>
        <label>
          Fin (sec)
          <input type="number" step="0.01" value={loopEnd} onChange={(event) => handleLoopInput(event, 'end')} />
        </label>
        <span>Durée: {loopDuration}s</span>
        <button type="button" onClick={handleAutoLoop} className="secondary">Auto loop</button>
      </div>
      <div className="transport">
        <button type="button" onClick={playLoop} className="primary">Play loop</button>
        <button type="button" onClick={pause}>Pause</button>
        <button type="button" onClick={stop}>Stop</button>
        <label className="volume-control">
          Volume
          <input type="range" min="0" max="1" step="0.01" value={volume} onChange={handleVolumeChange} />
        </label>
      </div>
    </div>
  );
};

export default WaveformEditor;
