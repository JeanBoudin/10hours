import { useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { OverlayCorner, OverlayFile, OVERLAY_MARGIN, OVERLAY_MAX_WIDTH, VisualFile } from '../state/useAppStore';

// Mêmes proportions que l'export 1920x1080, pour que l'aperçu corresponde à la vidéo.
const FRAME_WIDTH = 1920;
const FRAME_HEIGHT = 1080;

type Props = {
  visual?: VisualFile;
  overlay?: OverlayFile;
  overlayCorner: OverlayCorner;
};

const VisualPreview = ({ visual, overlay, overlayCorner }: Props) => {
  const [overlayNaturalWidth, setOverlayNaturalWidth] = useState(OVERLAY_MAX_WIDTH);

  if (!visual && !overlay) {
    return <div className="visual-placeholder">Sélectionnez une image ou une vidéo.</div>;
  }

  const marginX = `${(OVERLAY_MARGIN / FRAME_WIDTH) * 100}%`;
  const marginY = `${(OVERLAY_MARGIN / FRAME_HEIGHT) * 100}%`;
  const overlayStyle = {
    width: `${(Math.min(overlayNaturalWidth, OVERLAY_MAX_WIDTH) / FRAME_WIDTH) * 100}%`,
    [overlayCorner.startsWith('t') ? 'top' : 'bottom']: marginY,
    [overlayCorner.endsWith('l') ? 'left' : 'right']: marginX
  };

  return (
    <div className="visual-frame">
      {visual && (visual.kind === 'image' || visual.kind === 'gif') && (
        <img src={convertFileSrc(visual.path)} alt={visual.name} className="visual-media" />
      )}
      {visual && visual.kind === 'video' && (
        <video src={convertFileSrc(visual.path)} className="visual-media" muted loop autoPlay playsInline controls={false} />
      )}
      {overlay && (
        <img
          src={convertFileSrc(overlay.path)}
          alt="Commentaire en superposition"
          className="visual-overlay"
          style={overlayStyle}
          onLoad={(event) => setOverlayNaturalWidth(event.currentTarget.naturalWidth || OVERLAY_MAX_WIDTH)}
        />
      )}
      {visual && <div className="visual-caption">{visual.name}</div>}
    </div>
  );
};

export default VisualPreview;
