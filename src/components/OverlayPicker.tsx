import { useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { join, tempDir } from '@tauri-apps/api/path';
import { OverlayCorner, OverlayMode, OVERLAY_INTRO_SECONDS, useAppStore } from '../state/useAppStore';

const OVERLAY_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

const CORNERS: Array<{ id: OverlayCorner; label: string }> = [
  { id: 'tl', label: 'Haut gauche' },
  { id: 'tr', label: 'Haut droite' },
  { id: 'bl', label: 'Bas gauche' },
  { id: 'br', label: 'Bas droite' }
];

const MODES: Array<{ id: OverlayMode; label: string }> = [
  { id: 'intro', label: `${OVERLAY_INTRO_SECONDS} premières secondes (recommandé)` },
  { id: 'custom', label: 'Durée personnalisée' },
  { id: 'all', label: 'Toute la vidéo' }
];

const OverlayPicker = () => {
  const {
    overlayFile,
    overlayCorner,
    overlayMode,
    overlaySeconds,
    setOverlayFile,
    setOverlayCorner,
    setOverlayMode,
    setOverlaySeconds,
    setStatus
  } = useAppStore((state) => ({
    overlayFile: state.overlayFile,
    overlayCorner: state.overlayCorner,
    overlayMode: state.overlayMode,
    overlaySeconds: state.overlaySeconds,
    setOverlayFile: state.setOverlayFile,
    setOverlayCorner: state.setOverlayCorner,
    setOverlayMode: state.setOverlayMode,
    setOverlaySeconds: state.setOverlaySeconds,
    setStatus: state.setStatus
  }));

  // Cmd+V d'une capture d'écran: l'image est enregistrée dans le dossier temporaire pour FFmpeg.
  useEffect(() => {
    const handlePaste = async (event: ClipboardEvent) => {
      const image = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith('image/'));
      if (!image) return;
      event.preventDefault();
      try {
        const extension = image.type === 'image/jpeg' ? 'jpg' : 'png';
        const path = await join(await tempDir(), `loop-visualizer-commentaire-${Date.now()}.${extension}`);
        await writeFile(path, new Uint8Array(await image.arrayBuffer()));
        setOverlayFile({ path, name: 'Capture collée' });
        setStatus('idle', 'Capture du commentaire collée.');
      } catch (error) {
        console.error('Overlay paste error', error);
        setStatus('error', 'Impossible de coller la capture.');
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [setOverlayFile, setStatus]);

  const handlePickOverlay = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Images', extensions: OVERLAY_EXTENSIONS }]
      });
      const selectedPath = Array.isArray(selected) ? selected[0] : selected;
      if (typeof selectedPath === 'string') {
        const parts = selectedPath.split(/[/\\]/);
        setOverlayFile({ path: selectedPath, name: parts[parts.length - 1] || selectedPath });
        setStatus('idle', 'Capture du commentaire chargée.');
      }
    } catch (error) {
      console.error('Overlay dialog error', error);
      setStatus('error', 'Impossible d’ouvrir le sélecteur d’image.');
    }
  };

  return (
    <div className="overlay-picker">
      <h3>Commentaire en superposition</h3>
      <p className="hint">Capture d'écran du commentaire à afficher dans la vidéo. Optionnel.</p>
      <div className="picker-row">
        <button type="button" onClick={handlePickOverlay} className="secondary">Choisir la capture</button>
        <div className="file-label">{overlayFile ? overlayFile.name : 'Aucune capture'}</div>
        {overlayFile && (
          <button type="button" className="icon-button" aria-label="Retirer la capture" onClick={() => setOverlayFile(undefined)}>
            ×
          </button>
        )}
      </div>
      <p className="hint">Ou faites Cmd+Ctrl+Maj+4 puis Cmd+V ici pour coller une capture.</p>

      {overlayFile && (
        <>
          <fieldset>
            <legend>Position</legend>
            <div className="corner-grid">
              {CORNERS.map((corner) => (
                <button
                  key={corner.id}
                  type="button"
                  className={`corner-button${overlayCorner === corner.id ? ' selected' : ''}`}
                  aria-pressed={overlayCorner === corner.id}
                  onClick={() => setOverlayCorner(corner.id)}
                >
                  <span className={`corner-thumb ${corner.id}`} aria-hidden="true" />
                  {corner.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Affichage</legend>
            {MODES.map((mode) => (
              <label key={mode.id} className="checkbox">
                <input
                  type="radio"
                  name="overlay-mode"
                  checked={overlayMode === mode.id}
                  onChange={() => setOverlayMode(mode.id)}
                />
                {mode.label}
              </label>
            ))}
            {overlayMode === 'custom' && (
              <label className="overlay-seconds">
                Afficher pendant
                <input
                  type="number"
                  min={1}
                  max={3600}
                  step={1}
                  value={overlaySeconds}
                  onChange={(event) => setOverlaySeconds(Number(event.target.value))}
                />
                secondes
              </label>
            )}
          </fieldset>
        </>
      )}
    </div>
  );
};

export default OverlayPicker;
