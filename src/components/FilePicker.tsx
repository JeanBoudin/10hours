import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useAppStore } from '../state/useAppStore';

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'ogg', 'flac'];
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm'];

const FilePicker = () => {
  const { setAudioFile, setVisualFile, audioFile, visualFile, setStatus, setAudioDuration, setLoopBounds } = useAppStore((state) => ({
    setAudioFile: state.setAudioFile,
    setVisualFile: state.setVisualFile,
    audioFile: state.audioFile,
    visualFile: state.visualFile,
    setStatus: state.setStatus,
    setAudioDuration: state.setAudioDuration,
    setLoopBounds: state.setLoopBounds
  }));

  const getFileName = (fullPath: string) => {
    const parts = fullPath.split(/[/\\\\]/);
    return parts[parts.length - 1] || fullPath;
  };

  const preloadAudioDuration = (path: string) => {
    try {
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.src = convertFileSrc(path);
      const cleanup = () => {
        audio.removeEventListener('loadedmetadata', onLoaded);
        audio.removeEventListener('error', onError);
      };
      const onLoaded = () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          setAudioDuration(audio.duration);
          setLoopBounds(0, audio.duration);
        }
        cleanup();
      };
      const onError = () => cleanup();
      audio.addEventListener('loadedmetadata', onLoaded);
      audio.addEventListener('error', onError);
    } catch {
      // Ignore metadata preload failures; WaveSurfer will handle duration when possible.
    }
  };

  const handlePickAudio = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }]
      });

      const selectedPath = Array.isArray(selected) ? selected[0] : selected;
      if (typeof selectedPath === 'string') {
        const name = getFileName(selectedPath);
        setAudioFile({ path: selectedPath, name });
        preloadAudioDuration(selectedPath);
        setStatus('idle', 'Audio sélectionné.');
      }
    } catch (error) {
      console.error('Audio dialog error', error);
      setStatus('error', 'Impossible d’ouvrir le sélecteur audio.');
    }
  };

  const handlePickVisual = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: 'Images', extensions: IMAGE_EXTENSIONS },
          { name: 'Vidéos', extensions: VIDEO_EXTENSIONS }
        ]
      });

      const selectedPath = Array.isArray(selected) ? selected[0] : selected;
      if (typeof selectedPath === 'string') {
        const extension = selectedPath.split('.').pop()?.toLowerCase() ?? '';
        const name = getFileName(selectedPath);
        if (IMAGE_EXTENSIONS.includes(extension)) {
          const kind = extension === 'gif' ? 'gif' : 'image';
          setVisualFile({ path: selectedPath, name, kind });
          setStatus('idle', extension === 'gif' ? 'GIF chargé.' : 'Image chargée.');
        } else if (VIDEO_EXTENSIONS.includes(extension)) {
          setVisualFile({ path: selectedPath, name, kind: 'video' });
          setStatus('idle', 'Vidéo chargée.');
        } else {
          setStatus('error', 'Extension visuelle non supportée.');
        }
      }
    } catch (error) {
      console.error('Visual dialog error', error);
      setStatus('error', 'Impossible d’ouvrir le sélecteur visuel.');
    }
  };

  return (
    <div>
      <h2>1. Fichiers</h2>
      <div className="picker-row">
        <button type="button" onClick={handlePickAudio} className="primary">Choisir un fichier audio</button>
        <div className="file-label">{audioFile ? audioFile.name : 'Aucun audio'}</div>
      </div>
      <div className="picker-row">
        <button type="button" onClick={handlePickVisual} className="secondary">Choisir une image, un GIF ou une vidéo</button>
        <div className="file-label">{visualFile ? visualFile.name : 'Aucun visuel'}</div>
      </div>
      <p className="hint">Formats supportés audio: {AUDIO_EXTENSIONS.join(', ')} | visuel: {IMAGE_EXTENSIONS.join(', ')} / {VIDEO_EXTENSIONS.join(', ')}</p>
    </div>
  );
};

export default FilePicker;
