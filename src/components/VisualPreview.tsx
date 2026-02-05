import { convertFileSrc } from '@tauri-apps/api/core';
import { VisualFile } from '../state/useAppStore';

type Props = {
  visual?: VisualFile;
};

const VisualPreview = ({ visual }: Props) => {
  if (!visual) {
    return <div className="visual-placeholder">Sélectionnez une image ou une vidéo.</div>;
  }

  const source = convertFileSrc(visual.path);

  return (
    <div className="visual-wrapper">
      {visual.kind === 'image' || visual.kind === 'gif' ? (
        <img src={source} alt={visual.name} className="visual-media" />
      ) : (
        <video src={source} className="visual-media" muted loop autoPlay playsInline controls={false} />
      )}
      <div className="visual-caption">{visual.name}</div>
    </div>
  );
};

export default VisualPreview;
