# Loop Visualizer (Tauri v2 + React + TypeScript)

Application macOS permettant de boucler proprement un segment audio tout en affichant un visuel (image/vidéo) et en exportant le résultat en WAV (MP3 optionnel) via un binaire FFmpeg embarqué (sidecar). Entièrement hors-ligne.

## Fonctionnalités livrées
- Sélection de fichiers via `@tauri-apps/plugin-dialog` (audio + visuel + dossier de sortie).
- Prévisualisation du visuel (image responsive ou vidéo silencieuse en boucle) en plein panneau.
- Waveform interactif (wavesurfer.js + plugin Regions) avec définition de `loopStart` / `loopEnd`, lecture en boucle, transport Play/Pause/Stop et contrôle de volume WebAudio.
- Export FFmpeg sidecar (`@tauri-apps/plugin-shell`) vers WAV obligatoire + MP3 optionnel, avec crossfade automatique pour supprimer les clics.
- Export MP4: durée configurable (en minutes), fixe ou vidéo bouclée en arrière-plan, audio loopé lissé automatiquement.
- Gestion d’état centralisée (Zustand) et logs FFmpeg accessibles depuis l’UI.

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

## Commande FFmpeg audio
Pour un segment `[loopStart, loopEnd]` et un crossfade `X` (en secondes), la commande construite est:
```
ffmpeg -y \
  -i <audio_source> \
  -filter_complex "[0:a]atrim=start=loopStart:end=loopEnd,asetpts=PTS-STARTPTS,asplit=2[a0][a1];
                  [a0]afade=t=out:st=segment-X:d=X[a0f];
                  [a1]atrim=start=segment-X,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=X[a1f];
                  [a0f][a1f]acrossfade=d=X:c1=tri:c2=tri[aout]" \
  -map [aout] \
  -c:a pcm_s24le \
  <sortie.wav>
```
- `segment = loopEnd - loopStart`.
- L’export MP3 remplace la ligne codec par `-c:a libmp3lame -b:a 320k`.
- Les chemins sont passés tels quels à FFmpeg; Tauri gère les espaces.

Ce pipeline extrait le segment, applique un fondu de sortie sur les dernières `X` secondes, un fondu d’entrée sur les premières `X` secondes, puis fusionne les deux via `acrossfade` pour obtenir une boucle parfaitement lissée.

## Commande FFmpeg MP4
Pour produire une vidéo d’une durée donnée (`durée = minutes × 60`), le bouton “Exporter MP4” construit:
```
ffmpeg -y \
  -i <audio_source> \
  [-loop 1 -framerate 30 | -stream_loop -1] -i <visual_source> \
  -filter_complex "
    [0:a]atrim=start=loopStart:end=loopEnd,asetpts=PTS-STARTPTS,asplit=2[a0][a1];
    [a0]afade=t=out:st=segment-X:d=X[a0f];
    [a1]atrim=start=segment-X,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=X[a1f];
    [a0f][a1f]acrossfade=d=X:c1=tri:c2=tri[aLoop];
    [aLoop]aloop=loop=-1:size=0[aout]
  " \
  -map 1:v:0 -map [aout] \
  -t <durée_en_secondes> \
  -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p \
  -c:a aac -b:a 320k \
  -shortest \
  <sortie.mp4>
```
- Si le visuel est une image: `-loop 1 -framerate 30 -i image`.
- Si le visuel est une vidéo: `-stream_loop -1 -i video` afin de la répéter pendant toute la durée requise.

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
