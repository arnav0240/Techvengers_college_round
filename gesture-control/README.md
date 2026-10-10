# Gesture Control

Desktop app (Electron + TypeScript + Vite) that controls a Chromium browser with hand gestures via webcam.

## Structure

```
gesture-control/
├── src/
│   ├── vision/
│   │   ├── camera.ts
│   │   └── hand-landmarker.ts
│   ├── gestures/
│   │   └── gesture-detector.ts
│   ├── browser/
│   │   └── cdp-client.ts
│   ├── controller/
│   │   └── gesture-controller.ts
│   ├── renderer.ts
│   ├── main.ts
│   └── preload.ts
├── package.json
└── README.md
```

## Current stage

- [x] Stage 1 — project inspection
- [x] Stage 2 — webcam preview (`npm start`, allow camera)
- [ ] Stage 3 — MediaPipe Hand Landmarker
- [ ] Stage 4 — gesture detection (scroll up/down, stop)
- [ ] Stage 5 — CDP browser connection + manual scroll test
- [ ] Stage 6 — gesture-controlled scrolling

## Run

```bash
cd gesture-control
npm install
npm start
```
