# MediaPipe assets

Sign Language Translator serves these unmodified third-party runtime and model files from its own origin. The application does not need a runtime request to a CDN or model provider.

## Versions and sources

- JavaScript/WebAssembly package: `@mediapipe/tasks-vision` **0.10.21**, obtained from `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/`.
- Model: Google MediaPipe Hand Landmarker (full), float16, version 1, from `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`.
- `asset-manifest.json` records exact download URLs, file sizes and SHA-256 digests. Retrieved on 2026-11-14.
- Both the SIMD and non-SIMD WebAssembly runtimes are included. `FilesetResolver` selects the supported runtime.

## License and documentation

The package declares Apache-2.0. The full upstream license is preserved in `mediapipe/LICENSE`, from the `v0.10.21` MediaPipe release.

The hand tracking model card linked by Google's Hand Landmarker documentation also states Apache License, Version 2.0:

- Official task guide: https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker
- Official source: https://github.com/google-ai-edge/mediapipe
- Model card: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Hand%20Tracking%20(Lite_Full)%20with%20Fairness%20Oct%202021.pdf

The pretrained model predicts hand landmarks. It does not translate ASL, classify letters, or validate the app's subsequent shape classification. Sign Language Translator's shape classifier is separate application code. No app-level real-world accuracy is inferred from Google's landmark-model evaluations.

## Loading

Use `mediapipe/vision_bundle.mjs`, `mediapipe/wasm` as the `FilesetResolver.forVisionTasks` base directory, and `hand_landmarker.task` as `baseOptions.modelAssetPath`. Keep package and WebAssembly versions matched.

Asset byte integrity and exported API signatures have been verified. This provenance file does not claim end-to-end live-camera or real-signer validation.
