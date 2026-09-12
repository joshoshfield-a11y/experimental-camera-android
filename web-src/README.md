# Experimental Camera — v0.1

A browser-based experimental vision camera prototype.

## Included
- Live front-camera capture at up to 1920×1080 / 60fps where supported.
- Camera start/stop and horizontal flip.
- MediaPipe face landmark tracking (up to 4 faces).
- MediaPipe object detection (up to 12 detections).
- Face/object/everything target modes.
- Live edge, threshold, RGB split, noise, scanline and aberration effects.
- Experimental geometry-control parameters: displacement, turbulence, twist, bulge, pinch, chaos.
- 60fps WebM recording from the processed canvas.
- Responsive dark laboratory-style UI.

## Run

```bash
npm install
npm run dev
```

Open the Vite URL in a modern Chromium/Firefox/Safari browser and grant camera permission.

## Architecture note

The vision layer is deliberately separated from the compositor. The next upgrade is to move the compositor into WebGL2/WebGPU render passes and turn the face/object detections into actual deformable meshes rather than the v0.1 landmark/contour visualization. That lets the app add temporal feedback, optical-flow forces, mesh subdivision and recursive deformation without redesigning the UI.
