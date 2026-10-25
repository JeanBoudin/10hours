# Loop Visualizer (Tauri v2 + React + TypeScript)

Application macOS permettant de boucler proprement un segment audio tout en affichant un visuel (image/vidéo) et en exportant le résultat en vidéo MP4 via un binaire FFmpeg embarqué (sidecar). Entièrement hors-ligne.

## Fonctionnalités livrées
- Sélection de fichiers via `@tauri-apps/plugin-dialog` (audio + visuel + dossier de sortie).
- Prévisualisation du visuel (image responsive ou vidéo silencieuse en boucle) en plein panneau.
- Waveform interactif (wavesurfer.js + plugin Regions) avec définition de `loopStart` / `loopEnd`, lecture en boucle, transport Play/Pause/Stop et contrôle de volume WebAudio.
- Export MP4 1080p via le FFmpeg sidecar (`@tauri-apps/plugin-shell`): durée configurable (heures + minutes), image fixe ou vidéo bouclée en arrière-plan, audio bouclé avec crossfade pour supprimer le clic au raccord.
- Gestion d’état centralisée (Zustand), progression et temps restant de l’export affichés dans l’UI.

## Arborescence
```
.
├── index.html
├── package.json
├── src
│   ├── App.tsx
│   ├── components
│   │   ├── ExportPanel.tsx
│   │   ├── FilePicker.tsx
│   │   ├── VisualPreview.tsx
│   │   └── WaveformEditor.tsx
│   ├── main.tsx
│   ├── state
│   │   └── useAppStore.ts
│   ├── styles.css
│   └── types
│       └── wavesurfer.d.ts
├── src-tauri
│   ├── bin/
│   ├── build.rs
│   ├── Cargo.toml
│   ├── src
│   │   └── main.rs
│   └── tauri.conf.json
├── tsconfig.json
├── tsconfig.node.json
└── vite.config.ts
```

## Pré-requis
- macOS 13+ (Intel ou Apple Silicon).
- Node.js 18+ et npm (ou pnpm/yarn) pour le front.
- Rust toolchain stable + `cargo` pour builder Tauri.
- FFmpeg binaire macOS (universel de préférence) copié localement (voir ci-dessous).

## Installation & lancement en dev
```bash
# Installer les dépendances JS
npm install

# Lancer le front + Tauri (dans deux terminaux ou via cargo tauri)
npm run dev # lance Vite
# puis dans un autre terminal
cd src-tauri
cargo tauri dev
```
> Astuce: `TAURI_DEV_WATCHER=1 cargo tauri dev` recharge automatiquement après modifications Rust.

## Build production
```bash
npm run build
cd src-tauri
cargo tauri build
```
Cela produit un `.app` / `.dmg` dans `src-tauri/target/release/bundle` (FFmpeg est embarqué via `bundle.externalBin`).

## FFmpeg sidecar (obligatoire)
1. Téléchargez un binaire FFmpeg macOS universel (ex: `brew install ffmpeg` puis `lipo -create` si besoin).
2. Copiez-le deux fois (ou créez des builds séparés) sous:
   - `src-tauri/ffmpeg-aarch64-apple-darwin`
   - `src-tauri/ffmpeg-x86_64-apple-darwin`
   ```bash
   cp /path/to/ffmpeg src-tauri/ffmpeg-aarch64-apple-darwin
   cp /path/to/ffmpeg src-tauri/ffmpeg-x86_64-apple-darwin
   chmod +x src-tauri/ffmpeg-*
   ```
   (Les fichiers actuellement présents ne sont que des placeholders qui affichent un message d’erreur.)
3. `tauri.conf.json` référence ce binaire via `bundle.externalBin = ["ffmpeg"]`. Le CLI ajoute automatiquement le suffixe `-<target>` (par ex. `ffmpeg-aarch64-apple-darwin`), d’où l’obligation de fournir les deux variantes.
   - `app.sidecar[0].id = "ffmpeg"` + `path = "../bin/macos-universal/ffmpeg"` pour `Command.sidecar('ffmpeg', ...)` côté front.
   - `bundle.externalBin` pour embarquer FFmpeg lors du packaging.

Vous pouvez shipper plusieurs variantes (Intel/ARM) en dupliquant les sous-dossiers `bin` et en ajustant `path`/`externalBin` si besoin.

## Commande FFmpeg MP4
Pour un segment `[loopStart, loopEnd]` et un crossfade `X`, tout est converti en échantillons à 44,1 kHz
(`L = loopStart`, `E = loopEnd`, `N = E - L - X` = longueur de la boucle):
```
ffmpeg -y \
  -i <audio_source> \
  [-loop 1 -framerate 30 | -stream_loop -1] -i <visual_source> \
  -filter_complex "
    [0:a]aresample=44100,atrim=start_sample=L:end_sample=E,asetpts=PTS-STARTPTS,asplit=2[a0][a1];
    [a0]atrim=start_sample=X,asetpts=PTS-STARTPTS,afade=t=out:start_sample=N-X:nb_samples=X[aBody];
    [a1]atrim=end_sample=X,asetpts=PTS-STARTPTS,afade=t=in:start_sample=0:nb_samples=X,adelay=delays=(N-X)S:all=1[aHead];
    [aBody][aHead]amix=inputs=2:duration=longest:normalize=0[aLoopBase];
    [aLoopBase]aloop=loop=-1:size=N[aout];
    [1:v]scale=1920:1080:force_original_aspect_ratio=decrease,format=rgba[fg];
    color=c=black:s=1920x1080:r=30[bg];
    [bg][fg]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1,format=yuv420p[vout]
  " \
  -map [vout] -map [aout] \
  -t <durée_en_secondes> \
  -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p \
  -c:a aac -b:a 320k \
  <sortie.mp4>
```
- Audio: le corps de la boucle `[L+X, E]` se termine en fondu sortant pendant que la tête `[L, L+X]` entre en fondu.
  La fin de la boucle enchaîne donc exactement sur son début, sans clic.
- Vidéo: sortie 1920x1080 à 30 i/s, visuel centré sans déformation sur fond noir (transparence comprise).
- Si le visuel est une image: `-loop 1 -framerate 30 -i image`; si c'est une vidéo ou un GIF: `-stream_loop -1 -i video`.

## Sécurité & validation
- Les extensions autorisées sont validées côté front (audio: mp3/wav/m4a/ogg/flac ; visuel: png/jpg/webp/mp4/mov/webm).
- Chaque export vérifie la présence des fichiers, du dossier de sortie et de bornes cohérentes/de crossfade.
- Les logs FFmpeg restent consultables dans l’UI.

## Vérifications conseillées
- `npm run build` pour vérifier que le front compile correctement.
- `cargo clippy --all-targets` pour détecter d’éventuels warnings Rust.
- `cargo tauri build` pour valider l’intégration complète (FFmpeg requis).
- Un simple `src-tauri/icons/icon.png` (fourni ici comme placeholder 64x64 blanc) suffit pour dev; remplacez-le par votre design avant packaging.
# 10hours
