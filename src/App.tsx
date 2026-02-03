import FilePicker from './components/FilePicker';
import VisualPreview from './components/VisualPreview';
import WaveformEditor from './components/WaveformEditor';
import ExportPanel from './components/ExportPanel';
import { useAppStore } from './state/useAppStore';

const App = () => {
  const { audioFile, visualFile } = useAppStore((state) => ({
    audioFile: state.audioFile,
    visualFile: state.visualFile
  }));

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>Loop Visualizer</h1>
          <p>Prévisualisez, bouclez et exportez vos segments audio hors-ligne.</p>
        </div>
        <div className="status-chip">
          {audioFile ? `Audio: ${audioFile.name}` : 'Audio non sélectionné'}
        </div>
      </header>
      <main className="main-grid">
        <section className="panel file-panel">
          <FilePicker />
          <ExportPanel />
        </section>
        <section className="panel visual-panel">
          <VisualPreview visual={visualFile} />
        </section>
        <section className="panel waveform-panel">
          <WaveformEditor />
        </section>
      </main>
    </div>
  );
};

export default App;
