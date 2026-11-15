/** Shared real-model loader. All model/runtime assets are served by this site. */
export async function createVisionModel() {
  // MediaPipe's image upload needs WebGL even with the CPU inference delegate.
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2') || probe.getContext('webgl');
  if (!gl) {
    const error = new Error('Hand tracking needs WebGL graphics support. Open this app in a current browser with graphics acceleration available.');
    error.name = 'UnsupportedGraphicsError';
    throw error;
  }
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  const runtimeUrl = new URL('../vendor/mediapipe/vision_bundle.mjs', import.meta.url);
  const { FilesetResolver, HandLandmarker } = await import(runtimeUrl.href);
  const fileset = await FilesetResolver.forVisionTasks(new URL('../vendor/mediapipe/wasm', import.meta.url).href);
  const options = {
    baseOptions: { modelAssetPath: new URL('../vendor/hand_landmarker.task', import.meta.url).href, delegate: 'GPU' },
    runningMode: 'VIDEO', numHands: 2,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
  };
  try {
    return { model: await HandLandmarker.createFromOptions(fileset, options), delegate: 'GPU' };
  } catch {
    return {
      model: await HandLandmarker.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } }),
      delegate: 'CPU',
    };
  }
}
