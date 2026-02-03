import { open } from '@tauri-apps/plugin-dialog';
import { basename } from '@tauri-apps/api/path';
import { useAppStore } from '../state/useAppStore';

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'ogg', 'flac'];
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm'];

const FilePicker = () => {
  const { setAudioFile, setVisualFile, audioFile, visualFile, setStatus } = useAppStore((state) => ({
    setAudioFile: state.setAudioFile,
    setVisualFile: state.setVisualFile,
    audioFile: state.audioFile,
    visualFile: state.visualFile,
    setStatus: state.setStatus
  }));

  const handlePickAudio = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }]
      });

      if (typeof selected === 'string') {
        const name = await basename(selected);
        setAudioFile({ path: selected, name });
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

      if (typeof selected === 'string') {
        const extension = selected.split('.').pop()?.toLowerCase() ?? '';
        const name = await basename(selected);
        if (IMAGE_EXTENSIONS.includes(extension)) {
          setVisualFile({ path: selected, name, kind: 'image' });
          setStatus('idle', 'Image chargée.');
        } else if (VIDEO_EXTENSIONS.includes(extension)) {
          setVisualFile({ path: selected, name, kind: 'video' });
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
        <button type="button" onClick={handlePickVisual} className="secondary">Choisir une image ou vidéo</button>
        <div className="file-label">{visualFile ? visualFile.name : 'Aucun visuel'}</div>
      </div>
      <p className="hint">Formats supportés audio: {AUDIO_EXTENSIONS.join(', ')} | visuel: {IMAGE_EXTENSIONS.join(', ')} / {VIDEO_EXTENSIONS.join(', ')}</p>
    </div>
  );
};

export default FilePicker;
