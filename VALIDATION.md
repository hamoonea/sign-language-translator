# Sign Language Translator: validation status

## Current evidence boundary

The app uses an actual pretrained hand landmark detector, followed by an experimental static pose recognizer. It has no established real-signer accuracy, translation accuracy, or accessibility effectiveness result. Personal training samples are not an evaluation dataset.

Baseline checks completed on November 14, 2026, before the standalone layout revision:

- **24 automated tests passed:** 15 recognition/temporal tests and 9 import/storage tests. Synthetic landmarks cover clear supported shapes, upright orientation, unsupported poses, feature normalization, ambiguity rejection, repeated labels, and gaps. Data tests cover malformed imports, numeric limits, storage failures, and session integrity.
- **JavaScript syntax checks passed** for the application, vision loader, recognition engine, and data boundary.
- **Earlier browser UI verified:** desktop and 390px mobile layout; editing and explicitly saving a transcript; saved-session navigation; selecting a practice prompt; the custom-sign dialog; missing-camera feedback; and named accessible dialogs. These observations describe the earlier interface and do not establish verification of the simplified layout.
- **Asset verification:** official MediaPipe 0.10.21 runtime/WASM and the real Hand Landmarker model are present, pinned, and recorded with SHA-256 checksums in `vendor/asset-manifest.json`.
- **Actual model-inference check blocked:** the cloud QA browser has no physical camera and cannot create a WebGL context. The CPU model initialized before the image-upload path failed. MediaPipe requires WebGL for image input even with CPU neural inference. A specific compatibility check now reports this limitation before initialization.

No physical-camera signing session, held-out signer study, or successful browser inference was observed in this environment. The official two-hand reference photograph was prepared for a smoke test but produced no inference result because of the graphics limitation. Do not describe these checks as real-device or sign-recognition accuracy validation. Synthetic fixtures and browser controls do not substitute for that evidence.

## Standalone revision verification

The standalone revision uses the name **Sign Language Translator**. Its plain HTML, CSS, and JavaScript run without a framework, build step, account, or hosting service integration.

- All 24 automated tests and JavaScript syntax checks passed after file relocation and import/export renaming.
- The app was opened successfully from a hosting subdirectory (`/translator/`). Its relative styles and JavaScript loaded, navigation worked, and sign controls rendered.
- The new desktop and 390px mobile layouts were visually inspected.
- Editing text, explicitly saving text, opening saved text, and opening the sign-capture dialog were checked through the new interface.
- All referenced application element IDs exist and no duplicate IDs were found.
- Model/runtime files remain unchanged from the checksummed official downloads.

Camera capture and real-world sign recognition remain unverified for the hardware reasons described above. No new accuracy result is claimed.
