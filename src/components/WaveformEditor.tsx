import { useCallback, useEffect, useMemo, useRef, ChangeEvent } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useAppStore } from '../state/useAppStore';

const ZERO_CROSSING_SEARCH_MS = 12;
const MIN_LOOP_SECONDS = 0.01;
const MIN_CROSSFADE_MS = 5;
const MAX_CROSSFADE_MS = 1000;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const findNearestZeroCrossing = (channel: Float32Array, sampleRate: number, targetSec: number) => {
  if (!channel.length || sampleRate <= 0) return targetSec;

  const centerIndex = clamp(Math.round(targetSec * sampleRate), 1, Math.max(1, channel.length - 2));
  const radius = Math.max(1, Math.round((ZERO_CROSSING_SEARCH_MS / 1000) * sampleRate));
  const rangeStart = Math.max(1, centerIndex - radius);
  const rangeEnd = Math.min(channel.length - 1, centerIndex + radius);

  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = rangeStart; i <= rangeEnd; i += 1) {
    const prev = channel[i - 1];
    const curr = channel[i];
    const hasCrossing = (prev <= 0 && curr >= 0) || (prev >= 0 && curr <= 0);
    if (!hasCrossing) continue;
    const distance = Math.abs(i - centerIndex);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
      if (distance === 0) break;
    }
  }

  if (bestIndex < 0) {
    let lowestAmplitude = Number.POSITIVE_INFINITY;
    for (let i = rangeStart; i <= rangeEnd; i += 1) {
      const amplitude = Math.abs(channel[i]);
      if (amplitude < lowestAmplitude) {
        lowestAmplitude = amplitude;
        bestIndex = i;
      }
    }
  }

  return (bestIndex >= 0 ? bestIndex : centerIndex) / sampleRate;
};

const getRecommendedCrossfadeMs = (segmentSeconds: number) => {
  if (!Number.isFinite(segmentSeconds) || segmentSeconds <= 0) return MIN_CROSSFADE_MS;
  const maxAllowed = Math.floor((segmentSeconds / 2 - MIN_LOOP_SECONDS) * 1000);
  const safeMax = Math.max(1, Math.min(MAX_CROSSFADE_MS, maxAllowed));
  const target = Math.round(segmentSeconds * 1000 * 0.08);
  const safeMin = Math.min(MIN_CROSSFADE_MS, safeMax);
  return clamp(target, safeMin, safeMax);
};

type SnapMode = 'none' | 'start' | 'end' | 'both';

const WaveformEditor = () => {
  const {
    audioFile,
    loopStart,
    loopEnd,
    setLoopBounds,
    setAudioDuration,
    crossfadeMs,
    autoCrossfade,
    setCrossfade,
    zeroCrossingSnap,
    toggleZeroCrossingSnap,
    volume,
    setVolume,
    setStatus
  } = useAppStore((state) => ({
    audioFile: state.audioFile,
    loopStart: state.loopStart,
    loopEnd: state.loopEnd,
    setLoopBounds: state.setLoopBounds,
    setAudioDuration: state.setAudioDuration,
    crossfadeMs: state.crossfadeMs,
    autoCrossfade: state.autoCrossfade,
    setCrossfade: state.setCrossfade,
    zeroCrossingSnap: state.zeroCrossingSnap,
    toggleZeroCrossingSnap: state.toggleZeroCrossingSnap,
    volume: state.volume,
    setVolume: state.setVolume,
    setStatus: state.setStatus
  }));

  const containerRef = useRef<HTMLDivElement | null>(null);
  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const regionRef = useRef<any>(null);
  const decodedAudioRef = useRef<AudioBuffer | null>(null);

  const hasAudio = Boolean(audioFile);
  const loopDuration = useMemo(() => {
    const safeStart = Number.isFinite(loopStart) ? loopStart : 0;
    const safeEnd = Number.isFinite(loopEnd) ? loopEnd : safeStart;
    return Math.max(safeEnd - safeStart, 0).toFixed(2);
  }, [loopStart, loopEnd]);

  const applySnappedLoopBounds = useCallback(
    (start: number, end: number, mode: SnapMode = 'both') => {
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        const state = useAppStore.getState();
        return { start: state.loopStart, end: state.loopEnd };
      }

      let snappedStart = start;
      let snappedEnd = end;
      const decoded = decodedAudioRef.current;
      if (zeroCrossingSnap && decoded && decoded.numberOfChannels > 0 && decoded.length > 2 && mode !== 'none') {
        const channel = decoded.getChannelData(0);
        if (mode === 'start' || mode === 'both') {
          snappedStart = findNearestZeroCrossing(channel, decoded.sampleRate, start);
        }
        if (mode === 'end' || mode === 'both') {
          snappedEnd = findNearestZeroCrossing(channel, decoded.sampleRate, end);
        }
      }

      if (snappedEnd - snappedStart < MIN_LOOP_SECONDS) {
        setLoopBounds(start, end);
      } else {
        setLoopBounds(snappedStart, snappedEnd);
      }
      const state = useAppStore.getState();
      return { start: state.loopStart, end: state.loopEnd };
    },
    [setLoopBounds, zeroCrossingSnap]
  );

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

    waveSurfer.on('error', (err) => {
      setStatus('error', `Impossible de charger l'audio: ${String(err)}`);
    });

    waveSurfer.on('ready', () => {
      decodedAudioRef.current = waveSurfer.getDecodedData() ?? null;
      const duration = waveSurfer.getDuration();
      if (!Number.isFinite(duration) || duration <= 0) return;
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
        regionRef.current.on('update-end', (side?: 'start' | 'end') => {
          const currentRegion = regionRef.current;
          if (!currentRegion) return;
          const regionStart = Number(currentRegion.start);
          const regionEnd = Number(currentRegion.end);
          if (!Number.isFinite(regionStart) || !Number.isFinite(regionEnd)) return;

          const state = useAppStore.getState();
          const prevDuration = state.loopEnd - state.loopStart;
          const nextDuration = regionEnd - regionStart;
          const deltaStart = regionStart - state.loopStart;
          const deltaEnd = regionEnd - state.loopEnd;
          const movedAsBlock = Math.abs(deltaStart - deltaEnd) < 0.015 && Math.abs(nextDuration - prevDuration) < 0.015;

          let mode: SnapMode = 'both';
          if (side === 'start') {
            mode = 'start';
          } else if (side === 'end') {
            mode = 'end';
          } else if (movedAsBlock) {
            mode = 'none';
          } else if (Math.abs(deltaStart) > Math.abs(deltaEnd)) {
            mode = 'start';
          } else if (Math.abs(deltaEnd) > Math.abs(deltaStart)) {
            mode = 'end';
          }
          applySnappedLoopBounds(regionStart, regionEnd, mode);
        });
      }
    });

    waveSurfer.setVolume(volume);
    waveSurferRef.current = waveSurfer;

    return () => {
      regions?.destroy?.();
      waveSurfer.destroy();
      waveSurferRef.current = null;
      regionRef.current = null;
      decodedAudioRef.current = null;
    };
  }, [audioFile?.path, applySnappedLoopBounds, setAudioDuration, setLoopBounds, volume]);

  useEffect(() => {
    if (regionRef.current) {
      if (typeof regionRef.current.setOptions === 'function') {
        regionRef.current.setOptions({ start: loopStart, end: loopEnd });
      } else if (typeof regionRef.current.update === 'function') {
        regionRef.current.update({ start: loopStart, end: loopEnd });
      }
    }
  }, [loopStart, loopEnd]);

  useEffect(() => {
    if (!autoCrossfade) return;
    const segment = loopEnd - loopStart;
    if (segment <= 0) return;
    const recommended = getRecommendedCrossfadeMs(segment);
    if (recommended !== crossfadeMs) {
      setCrossfade(recommended);
    }
  }, [autoCrossfade, crossfadeMs, loopEnd, loopStart, setCrossfade]);

  const playLoop = useCallback(() => {
    const waveSurfer = waveSurferRef.current;
    if (!waveSurfer) return;
    const safeStart = Number.isFinite(loopStart) ? loopStart : 0;
    const safeEnd = Number.isFinite(loopEnd) ? loopEnd : safeStart;
    if (safeEnd <= safeStart) return;
    waveSurfer.play(safeStart, safeEnd);
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
    if (!Number.isFinite(numeric)) return;
    const safeStart = Number.isFinite(loopStart) ? loopStart : 0;
    const safeEnd = Number.isFinite(loopEnd) ? loopEnd : safeStart + MIN_LOOP_SECONDS;
    if (target === 'start') {
      applySnappedLoopBounds(numeric, safeEnd, 'start');
    } else {
      applySnappedLoopBounds(safeStart, numeric, 'end');
    }
  };

  const handleAutoLoop = useCallback(() => {
    const waveSurfer = waveSurferRef.current;
    const decoded = waveSurfer?.getDecodedData() ?? decodedAudioRef.current;
    if (!decoded) {
      setStatus('error', 'Audio pas encore prêt pour l’analyse.');
      return;
    }
    decodedAudioRef.current = decoded;

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
      applySnappedLoopBounds(0, decoded.duration, 'both');
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
      applySnappedLoopBounds(0, decoded.duration, 'both');
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

    const snapped = applySnappedLoopBounds(startSec, endSec, 'both');
    setStatus('idle', `Auto loop: ${snapped.start.toFixed(2)}s → ${snapped.end.toFixed(2)}s`);
  }, [applySnappedLoopBounds, setStatus]);

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
        <label className="checkbox">
          <input type="checkbox" checked={zeroCrossingSnap} onChange={(event) => toggleZeroCrossingSnap(event.target.checked)} />
          Snap zéro-crossing
        </label>
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
