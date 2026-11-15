# Sign Language Translator

A plain HTML, CSS, and JavaScript app with a simple early-2000s layout. It uses a camera to recognize selected static ASL hand shapes and personal poses.

## Run locally

Unzip the folder, open a terminal in it, and run:

```sh
python3 -m http.server 8000
```

On Windows, use `py -m http.server 8000` if Python is installed through the Windows launcher.

Open **http://localhost:8000**. No package installation, account, or build step is required.

Double-clicking `index.html` can display the page, but browser modules and model loading need the local server. Camera access requires localhost or HTTPS and a browser with WebGL graphics support.

## Use

1. Select **Start camera** and allow camera access.
2. Show one upright hand, palm toward the camera, in good lighting.
3. Try **I, L, U, V, W, Y**, or **ILY** (the “I love you” hand shape).
4. Hold steadily to add text. Relax your hand before repeating a letter.
5. Use practice prompts, or capture 24 examples to teach a personal static pose.

You can edit, copy, download, read aloud, or save transcripts. Export and import personal examples using the app’s JSON format (`sign-language-translator-signs`).

## Files and hosting

- `index.html` — page and controls
- `style.css` — layout and appearance
- `js/` — camera, recognition, and data handling
- `vendor/` — local MediaPipe runtime, model, and license notices
- `tests/` — optional Node.js tests; run `npm test`

Upload the complete folder to a static HTTPS host. Relative asset paths support hosting within a subdirectory. Keep the `vendor/` files and notices with the app.

## Limits and privacy

This version handles isolated static hand shapes, not full ASL conversations. Shape-match scores are similarity measures, not measured accuracy. See `VALIDATION.md` for testing limits.

Video is processed locally without recording or uploading. Examples and explicitly saved sessions stay in this browser. Export them before clearing browser data. Optional speech playback uses the browser’s speech service, which may process text remotely.
