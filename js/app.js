import { BUILTIN_SIGNS, FEATURES_LENGTH, classifyHand, extractFeatures, TemporalStabilizer } from './recognition.js';
import { loadLocalData, saveSamples, saveSessions, parseSignImport, serializeSigns, validateSamples } from './data.js';
import { createVisionModel } from './vision.js';

const $ = id => document.getElementById(id);
const all = query => [...document.querySelectorAll(query)];
const video = $('camera-video');
const overlay = $('landmark-canvas');
const ctx = overlay.getContext('2d');
const teachCanvas = $('teach-canvas');
const teachCtx = teachCanvas.getContext('2d');
const transcript = $('transcript');
const builtinById = new Map(BUILTIN_SIGNS.map(sign => [sign.id, sign]));
const persisted = loadLocalData();
let samples = persisted.samples.filter(s => s.features.length === FEATURES_LENGTH && s.features.every(v => v >= 0 && v <= 20));
let sessions = persisted.sessions;
let view = 'translate';
let practiceId = 'L';
let mirrored = true;
let model = null;
let modelPromise = null;
let delegate = '';
let stream = null;
let running = false;
let starting = false;
let startGeneration = 0;
let frameId = 0;
let lastVideoTime = -1;
let lastFrameAt = 0;
let lastFrameReceivedAt = 0;
let fpsStart = 0;
let fpsFrames = 0;
let currentCandidate = null;
let currentRaw = null;
let currentFeatures = null;
let handsCount = 0;
let latestInferenceAt = 0;
let capture = null;
let captured = [];
let capturedLabel = '';
let noticeTimer;
let lastPracticeSuccess = '';
let speaking = false;
const stabilizer = new TemporalStabilizer({ holdMs: 900, releaseMs: 400 });
const connections = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];

function icon(name, className = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, className, onClick, iconName) {
  const node = element('button', className);
  node.type = 'button';
  if (iconName) node.append(icon(iconName));
  node.append(document.createTextNode(text));
  node.addEventListener('click', onClick);
  return node;
}

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => $('toast').classList.remove('visible'), 3800);
}

function alertMessage(message) {
  $('alert-text').textContent = message;
  $('app-alert').classList.remove('hidden');
}

function clearAlert() { $('app-alert').classList.add('hidden'); }

function confirmAction(title, message, actionLabel = 'Continue') {
  const dialog = $('confirm-dialog');
  $('confirm-title').textContent = title;
  $('confirm-message').textContent = message;
  $('confirm-accept').textContent = actionLabel;
  return new Promise(resolve => {
    let accepted = false;
    const accept = () => { accepted = true; dialog.close(); };
    const cancel = () => dialog.close();
    const done = () => {
      $('confirm-accept').removeEventListener('click', accept);
      $('confirm-cancel').removeEventListener('click', cancel);
      resolve(accepted);
    };
    $('confirm-accept').addEventListener('click', accept);
    $('confirm-cancel').addEventListener('click', cancel);
    dialog.addEventListener('close', done, { once: true });
    dialog.showModal();
  });
}

const viewMetadata = {
  translate: ['Translator', 'Translator', 'Use your camera to recognize supported static ASL hand shapes.'],
  practice: ['Practice', 'Practice signs', 'Choose a sign and hold the matching hand shape.'],
  library: ['My signs', 'My signs', 'Capture examples of a static hand shape and give it a text label.'],
  sessions: ['Saved text', 'Saved text', 'View text you saved in this browser.'],
};

function setView(next, updateHash = true) {
  if (!Object.hasOwn(viewMetadata, next)) next = 'translate';
  view = next;
  stabilizer.reset();
  const [title, heading, subtitle] = viewMetadata[next];
  $('breadcrumb-current').textContent = title;
  $('page-title').textContent = heading;
  $('page-subtitle').textContent = subtitle;
  $('workspace-view').classList.toggle('hidden', !['translate','practice'].includes(next));
  $('practice-banner').classList.toggle('hidden', next !== 'practice');
  $('library-view').classList.toggle('hidden', next !== 'library');
  $('sessions-view').classList.toggle('hidden', next !== 'sessions');
  $('transcript-heading').textContent = next === 'practice' ? 'Practice notes' : 'Recognized text';
  all('[data-view]').forEach(nav => {
    const selected = nav.dataset.view === next;
    nav.classList.toggle('active', selected);
    if (selected) nav.setAttribute('aria-current', 'page'); else nav.removeAttribute('aria-current');
  });
  if (next === 'library') renderLibrary();
  if (next === 'sessions') renderSessions();
  if (updateHash) history.replaceState(null, '', '#' + next);
}

function renderStarters() {
  $('starter-signs').replaceChildren();
  $('practice-select').replaceChildren();
  for (const sign of BUILTIN_SIGNS) {
    const card = element('button', 'sign-card');
    card.type = 'button';
    card.dataset.label = sign.id;
    card.title = sign.tip;
    card.setAttribute('aria-label', 'Practice ' + sign.label + '. ' + sign.tip);
    const top = element('div', 'sign-card-top');
    top.append(element('span', 'sign-letter', sign.id), icon('arrow'));
    card.append(top, element('span', 'sign-card-label', sign.id === 'ILY' ? 'I love you' : 'Letter ' + sign.id));
    const shortTips = { I:'Pinky up', L:'Index + thumb', U:'Two together', V:'Two apart', W:'Three fingers', Y:'Thumb + pinky', ILY:'Three extended' };
    card.append(element('span', 'sign-card-tip', shortTips[sign.id]));
    card.addEventListener('click', () => { setPractice(sign.id); setView('practice'); $('practice-banner').scrollIntoView({block:'start',behavior:'smooth'}); });
    $('starter-signs').append(card);
    const option = element('option', '', sign.id === 'ILY' ? 'I love you' : 'Letter ' + sign.id);
    option.value = sign.id;
    $('practice-select').append(option);
  }
  setPractice(practiceId);
}

function setPractice(id) {
  const sign = builtinById.get(id);
  if (!sign) return;
  practiceId = id;
  lastPracticeSuccess = '';
  stabilizer.reset();
  $('practice-select').value = id;
  $('practice-letter').textContent = id;
  $('practice-letter').style.fontSize = id === 'ILY' ? '27px' : '';
  $('practice-heading').textContent = 'Let’s sign ' + sign.label;
  $('practice-description').textContent = sign.tip;
  $('practice-result').textContent = 'Hold the shape until the progress bar fills.';
  $('practice-result').classList.remove('success');
}

async function ensureModel() {
  if (model) return model;
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    const loaded = await createVisionModel();
    model = loaded.model;
    delegate = loaded.delegate;
    return model;
  })();
  try { return await modelPromise; }
  finally { modelPromise = null; }
}

function cameraError(error, stage) {
  if (error?.name === 'UnsupportedGraphicsError') return error.message;
  if (stage === 'model') return 'Hand tracking could not load. Make sure the vendor folder is next to index.html, then reload the page from localhost or your HTTPS server.';
  const messages = {
    NotAllowedError: 'Camera access was not allowed. Open Sign Language Translator in its own browser tab, allow camera access in the address bar, and try again.',
    NotFoundError: 'No camera was found. Connect a camera or use a device with a camera, then try again.',
    NotReadableError: 'Your camera is unavailable. Close other apps using it, check your system camera permission, and try again.',
    OverconstrainedError: 'The camera could not use these settings. Try another camera or browser.',
    SecurityError: 'This browser is blocking the camera. Open the app through localhost or an HTTPS server in its own tab.',
    AbortError: 'The camera was interrupted. Please try again.',
  };
  return messages[error?.name] || 'The camera could not start. Use an up-to-date browser and open the secure app link in its own tab.';
}

async function startCamera() {
  if (running || starting) return;
  clearAlert();
  if (location.protocol === 'file:') {
    alertMessage('Run python3 -m http.server 8000 in this folder, then open http://localhost:8000. Camera tracking cannot load its model directly from a file URL.');
    return;
  }
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    alertMessage('Camera access needs HTTPS or localhost. For local use, run python3 -m http.server 8000 in this folder, then open http://localhost:8000.');
    return;
  }
  starting = true;
  const generation = ++startGeneration;
  $('start-camera').disabled = true;
  $('camera-placeholder').classList.add('hidden');
  $('camera-loading').classList.remove('hidden');
  $('stop-camera').classList.remove('hidden');
  $('global-camera-stop').classList.remove('hidden');
  $('loading-message').textContent = 'Allow camera access to continue…';
  $('engine-state').textContent = 'Waiting for permission';
  let stage = 'camera';
  try {
    const acquired = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } },
    });
    if (generation !== startGeneration) { acquired.getTracks().forEach(track => track.stop()); return; }
    stream = acquired;
    video.srcObject = stream;
    await video.play();
    if (generation !== startGeneration) return;
    stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
      if (running || starting) { stopCamera(); alertMessage('The camera connection ended. Reconnect it and enable the camera again.'); }
    }, { once: true }));
    $('camera-stage').classList.add('live');
    $('camera-tag').replaceChildren(element('span','dot'),document.createTextNode('Camera on'));
    $('loading-message').textContent = 'Loading on-device hand tracking…';
    $('engine-state').textContent = 'Loading vision model';
    stage = 'model';
    await ensureModel();
    if (generation !== startGeneration) return;
    running = true;
    starting = false;
    lastVideoTime = -1;
    lastFrameAt = 0;
    lastFrameReceivedAt = performance.now();
    fpsStart = performance.now();
    fpsFrames = 0;
    stabilizer.reset();
    $('camera-loading').classList.add('hidden');
    $('live-hint').classList.remove('hidden');
    $('engine-state').textContent = 'Vision ready · ' + delegate;
    $('start-camera').disabled = false;
    frameId = requestAnimationFrame(processFrame);
  } catch (error) {
    if (generation !== startGeneration) return;
    stopCamera();
    alertMessage(cameraError(error, stage));
  }
}

function stopCamera() {
  ++startGeneration;
  running = false;
  starting = false;
  cancelAnimationFrame(frameId);
  frameId = 0;
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  video.pause();
  video.srcObject = null;
  currentCandidate = null;
  currentRaw = null;
  currentFeatures = null;
  handsCount = 0;
  if (capture) stopCapture('Camera stopped. Enable it again before capturing examples.');
  stabilizer.reset();
  ctx.clearRect(0,0,overlay.width,overlay.height);
  teachCtx.clearRect(0,0,teachCanvas.width,teachCanvas.height);
  $('camera-stage').classList.remove('live');
  $('camera-tag').replaceChildren(element('span','dot'),document.createTextNode('Camera off'));
  $('camera-placeholder').classList.remove('hidden');
  $('camera-loading').classList.add('hidden');
  $('live-hint').classList.add('hidden');
  $('stop-camera').classList.add('hidden');
  $('global-camera-stop').classList.add('hidden');
  $('start-camera').disabled = false;
  $('fps-label').textContent = '— fps';
  $('engine-state').textContent = 'Ready when you are';
  $('teach-tracking-status').textContent = 'Start your camera in Translator first.';
  updateRecognitionUI(null, {progress:0,committed:null}, 0);
}

function drawHand(canvas, context, raw, { preview = false } = {}) {
  const width = preview ? 480 : Math.max(1,video.videoWidth);
  const height = preview ? 300 : Math.max(1,video.videoHeight);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  context.clearRect(0,0,width,height);
  if (!raw) return;
  const ratio = video.videoWidth / video.videoHeight || width / height;
  const drawWidth = preview ? Math.min(width, height * ratio) : width;
  const drawHeight = preview ? drawWidth / ratio : height;
  const point = p => [p.x * drawWidth + (width-drawWidth)/2, p.y * drawHeight + (height-drawHeight)/2];
  context.lineCap = 'round';
  context.lineWidth = preview ? 2.1 : Math.max(1.8,width/350);
  context.strokeStyle = '#bdea9c';
  context.shadowBlur = 6;
  context.shadowColor = '#b7eb9255';
  for (const [a,b] of connections) {
    const p = point(raw[a]), q = point(raw[b]);
    context.beginPath(); context.moveTo(...p); context.lineTo(...q); context.stroke();
  }
  raw.forEach((landmark,index) => {
    context.beginPath();
    context.fillStyle = [4,8,12,16,20].includes(index) ? '#fff6c7' : '#d9f9bd';
    context.arc(...point(landmark),preview ? 3.5 : Math.max(3.2,width/230),0,Math.PI*2);
    context.fill();
  });
  context.shadowBlur = 0;
}

function processFrame(now) {
  if (!running) return;
  frameId = requestAnimationFrame(processFrame);
  if (document.hidden) { stabilizer.reset(); return; }
  // At most 20 inference frames per second; never reuse a decoded frame.
  if (now - lastFrameAt < 50) return;
  if (capture && now - capture.start > 25000) stopCapture('Capture timed out. Keep one hand visible and try again.');
  if (video.readyState < 2 || video.currentTime === lastVideoTime) {
    if (now - lastFrameReceivedAt > 700) {
      currentCandidate = null; currentRaw = null; currentFeatures = null; handsCount = 0;
      ctx.clearRect(0,0,overlay.width,overlay.height);
      updateRecognitionUI(null, stabilizer.update(null,now), 0);
      $('live-hint').textContent = 'Camera paused — waiting for a fresh frame';
    }
    return;
  }
  lastFrameAt = now;
  lastFrameReceivedAt = now;
  lastVideoTime = video.currentTime;
  let result;
  try { result = model.detectForVideo(video, now); }
  catch {
    stopCamera();
    try { model?.close(); } catch { /* released model */ }
    model = null;
    alertMessage('Hand tracking was interrupted. Enable the camera to reload the model.');
    return;
  }
  fpsFrames++;
  if (now - fpsStart >= 1100) {
    $('fps-label').textContent = Math.round(fpsFrames*1000/(now-fpsStart)) + ' fps';
    fpsFrames = 0; fpsStart = now;
  }
  handsCount = result.landmarks?.length || 0;
  currentRaw = handsCount === 1 ? result.landmarks[0] : null;
  const isotropic = currentRaw?.map(p => ({x:p.x,y:p.y*video.videoHeight/video.videoWidth,z:p.z}));
  currentFeatures = isotropic ? extractFeatures(isotropic) : null;
  currentCandidate = isotropic ? classifyHand(isotropic, view === 'practice' ? [] : samples) : null;
  latestInferenceAt = now;
  drawHand(overlay, ctx, $('show-landmarks').checked ? currentRaw : null);
  let stabilized;
  const modalOpen = document.querySelector('dialog[open]') !== null;
  if (modalOpen || !['translate','practice'].includes(view)) {
    stabilizer.reset();
    stabilized = { candidate:currentCandidate,progress:0,committed:null };
  } else stabilized = stabilizer.update(currentCandidate, now);
  updateRecognitionUI(currentCandidate, stabilized, handsCount);
  if (stabilized.committed) {
    if (view === 'practice') {
      if (stabilized.committed.label === practiceId && stabilized.committed.source === 'builtin') {
        lastPracticeSuccess = practiceId;
        $('practice-result').textContent = 'Sign matched. Choose Next sign to continue.';
        $('practice-result').classList.add('success');
        toast('Matched ' + builtinById.get(practiceId).label + '!');
      }
    } else if ($('auto-add').checked) appendCandidate(stabilized.committed);
  }
  if ($('teach-dialog').open) {
    drawHand(teachCanvas, teachCtx, currentRaw, {preview:true});
    $('teach-tracking-status').textContent = handsCount > 1 ? 'Keep only one hand in view.' : currentFeatures ? 'Hand tracked. Keep your pose steady.' : 'Bring one hand into view, palm facing the camera.';
    if (capture) updateCapture(now);
  }
}

function updateRecognitionUI(candidate, stable, count) {
  const label = candidate?.label || '—';
  $('sign-symbol').textContent = label;
  $('sign-symbol').classList.toggle('long', label.length > 2);
  $('sign-name').textContent = candidate ? (candidate.source === 'builtin' ? (builtinById.get(label)?.label === label ? 'Letter ' + label : builtinById.get(label)?.label) : label) : count > 1 ? 'One hand at a time' : count === 1 ? 'Try a starter hand shape' : 'Waiting for a hand';
  $('sign-source').textContent = candidate ? candidate.source === 'builtin' ? 'Starter hand-shape rule' : 'Your personal examples' : running ? count === 1 ? 'Uncertain or unsupported pose' : 'Keep your palm toward the camera' : 'Start your camera to begin';
  $('match-value').textContent = candidate ? Math.round(candidate.score*100) + '% shape match' : '—';
  const progress = Math.round((stable.progress || 0)*100);
  $('hold-fill').style.width = progress + '%';
  $('hold-progress').setAttribute('aria-valuenow', String(progress));
  if (candidate && progress === 100) {
    $('hold-caption').textContent = view === 'practice' ? 'Shape held — relax to try again' : $('auto-add').checked ? 'Added — relax before repeating' : 'Ready — choose Add sign';
  } else $('hold-caption').textContent = candidate ? view === 'practice' ? 'Hold to match the practice sign' : $('auto-add').checked ? 'Hold steady to add…' : 'Choose Add sign when ready' : 'Hold a sign to add it';
  $('add-sign').disabled = !candidate || !running || capture !== null;
  $('live-hint').textContent = count > 1 ? 'Two hands found — use one hand for this version' : count === 0 ? 'Bring one hand into view, palm forward' : candidate ? progress === 100 ? 'Relax your hand before repeating a sign' : 'Hold steady · ' + (candidate.source === 'builtin' ? builtinById.get(label)?.label : label) : 'Pose not recognized · try I, L, U, V, W, Y, or ILY';
  if (view === 'practice' && candidate && candidate.label !== practiceId && lastPracticeSuccess !== practiceId) {
    $('practice-result').textContent = 'Detected ' + candidate.label + '. Aim for ' + builtinById.get(practiceId).label + '.';
  }
}

function updateTranscriptUI() {
  const hasText = transcript.value.trim().length > 0;
  $('character-count').textContent = Array.from(transcript.value).length + ' characters';
  for (const id of ['copy-text','download-text','save-session']) $(id).disabled = !hasText;
  $('speak-text').disabled = (!hasText && !speaking) || !('speechSynthesis' in window);
  $('backspace').disabled = transcript.value.length === 0;
  $('clear-transcript').disabled = transcript.value.length === 0;
}

function insertText(text) {
  if (transcript.value.length + text.length > 5000) { toast('This transcript is full. Save it and start a new one.'); return; }
  const active = document.activeElement === transcript;
  const start = active ? transcript.selectionStart : transcript.value.length;
  const end = active ? transcript.selectionEnd : transcript.value.length;
  transcript.setRangeText(text, start, end, 'end');
  updateTranscriptUI();
}

function appendCandidate(candidate) {
  if (!candidate) return;
  const label = candidate.source === 'builtin' && candidate.label === 'ILY' ? 'I love you' : candidate.label;
  const phrase = Array.from(label).length > 1;
  insertText((phrase && transcript.value && !/\s$/.test(transcript.value) ? ' ' : '') + label + (phrase ? ' ' : ''));
}

function deleteCharacter() {
  const text = transcript.value;
  if (!text) return;
  const start = transcript.selectionStart, end = transcript.selectionEnd;
  if (document.activeElement === transcript && start !== end) transcript.setRangeText('',start,end,'end');
  else {
    const characters = Array.from(text);
    characters.pop();
    transcript.value = characters.join('');
  }
  updateTranscriptUI();
}

function downloadText(text, filename, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], {type});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to your clipboard.'); }
  catch { toast('Clipboard unavailable. Select the text and copy it using your keyboard.'); }
}

function readAloud() {
  if (!('speechSynthesis' in window)) return;
  if (speaking) { speechSynthesis.cancel(); setSpeaking(false); return; }
  if (!transcript.value.trim()) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(transcript.value);
  utterance.lang = 'en-US';
  const localVoice = speechSynthesis.getVoices().find(v => v.localService && v.lang.startsWith('en'));
  if (localVoice) utterance.voice = localVoice;
  utterance.onend = () => setSpeaking(false);
  utterance.onerror = event => {
    setSpeaking(false);
    if (!['canceled','interrupted'].includes(event.error)) toast('Read aloud is unavailable in this browser.');
  };
  setSpeaking(true);
  speechSynthesis.speak(utterance);
}

function setSpeaking(value) {
  speaking = value;
  $('speak-text').replaceChildren(icon('speaker'),document.createTextNode(value ? 'Stop reading' : 'Read aloud'));
  updateTranscriptUI();
}

function renderLibrary() {
  const groups = new Map();
  samples.forEach(sample => groups.set(sample.label,(groups.get(sample.label)||0)+1));
  $('library-count').textContent = groups.size;
  $('custom-signs').replaceChildren();
  $('sample-summary').textContent = groups.size ? groups.size + ' signs · ' + samples.length + ' examples' : 'No examples yet';
  $('export-signs').disabled = samples.length === 0;
  if (!groups.size) {
    const empty = element('div','empty-state');
    const emblem = element('span','empty-icon'); emblem.append(icon('hand'));
    empty.append(emblem,element('h3','','No saved signs'),element('p','','Capture 24 examples of a static hand shape and save a label for it. Imported signs need at least five examples each.'),button('Teach a sign','primary-button',() => openTeach(),'plus'));
    $('custom-signs').append(empty); return;
  }
  for (const [label,count] of groups) {
    const card = element('article','custom-card');
    card.append(element('span','mini-label','PERSONAL HAND SHAPE'),element('h3','custom-label',label),element('p','',count + ' examples · stored on this device'));
    const actions = element('div','custom-card-buttons');
    actions.append(button('Add examples','secondary-button',() => openTeach(label),'plus'));
    const remove = button('','icon-button delete-sign',async () => {
      if (!await confirmAction('Delete this sign?', 'Remove all saved examples for “' + label + '” from this browser?', 'Delete sign')) return;
      try { samples = saveSamples(samples.filter(s => s.label !== label)); renderLibrary(); toast('Sign deleted.'); }
      catch (error) { alertMessage(error.message); }
    },'close');
    remove.setAttribute('aria-label','Delete sign ' + label);
    actions.append(remove); card.append(actions); $('custom-signs').append(card);
  }
}

function openTeach(label = '') {
  captured = []; capturedLabel = ''; capture = null;
  $('sign-label').value = label;
  $('sign-label').disabled = false;
  $('capture-count').textContent = '0 / 24 examples';
  $('capture-fill').style.width = '0%';
  $('capture-instruction').textContent = running ? 'Keep one pose and vary your angle slightly while collecting examples.' : 'Start your camera in Translator, then return here to capture your sign.';
  $('capture-examples').replaceChildren(icon('camera'),document.createTextNode(running ? 'Capture examples' : 'Start camera first'));
  $('capture-examples').disabled = false;
  $('save-sign').disabled = true;
  $('teach-tracking-status').textContent = running ? 'Bring one hand into view.' : 'Start your camera in Translator first.';
  teachCtx.clearRect(0,0,teachCanvas.width,teachCanvas.height);
  stabilizer.reset();
  $('teach-dialog').showModal();
}

function beginCapture() {
  if (!running) {
    $('teach-dialog').close();
    setView('translate');
    startCamera();
    toast('After the camera starts, return to My signs to teach your pose.');
    return;
  }
  if (capture) { stopCapture('Capture paused. You can start again.'); return; }
  let label;
  try { label = validateSamples([{label:$('sign-label').value,features:Array(FEATURES_LENGTH).fill(0)}])[0].label; }
  catch { $('capture-instruction').textContent = 'Enter a label of 1–24 characters first.'; $('sign-label').focus(); return; }
  captured = []; capturedLabel = label;
  $('sign-label').value = label;
  $('sign-label').disabled = true;
  $('save-sign').disabled = true;
  $('capture-count').textContent = '0 / 24 examples';
  $('capture-fill').style.width = '0%';
  capture = { start:performance.now(), last:0, readyAt:performance.now()+1800 };
  $('capture-examples').replaceChildren(icon('close'),document.createTextNode('Cancel capture'));
  $('capture-instruction').textContent = 'Get into your pose. Capture begins in 2 seconds…';
  stabilizer.reset();
}

function updateCapture(now) {
  if (!capture) return;
  if (now - capture.start > 25000) { stopCapture('Capture timed out. Keep one hand visible and try again.'); return; }
  if (now < capture.readyAt) return;
  if (!currentFeatures || handsCount !== 1) { $('capture-instruction').textContent = 'Capture paused — show one clear hand to continue.'; return; }
  if (now - capture.last < 150) return;
  capture.last = now;
  captured.push({label:capturedLabel,features:[...currentFeatures]});
  $('capture-count').textContent = captured.length + ' / 24 examples';
  $('capture-fill').style.width = Math.round(captured.length/24*100) + '%';
  $('capture-instruction').textContent = 'Capturing your pose… vary the angle slightly, keeping the same hand shape.';
  if (captured.length === 24) {
    capture = null;
    $('sign-label').disabled = false;
    $('save-sign').disabled = false;
    $('capture-examples').replaceChildren(icon('reset'),document.createTextNode('Capture again'));
    $('capture-instruction').textContent = '24 examples captured. Save your sign, then try it in Translator.';
  }
}

function stopCapture(message) {
  capture = null;
  captured = [];
  capturedLabel = '';
  $('sign-label').disabled = false;
  $('save-sign').disabled = true;
  $('capture-count').textContent = '0 / 24 examples';
  $('capture-fill').style.width = '0%';
  $('capture-examples').replaceChildren(icon('camera'),document.createTextNode('Capture examples'));
  if (message) $('capture-instruction').textContent = message;
}

function saveCapturedSign() {
  if (captured.length < 24) return;
  try {
    const sanitized = validateSamples(captured.map(sample => ({...sample,label:$('sign-label').value})));
    const label = sanitized[0].label;
    const existing = samples.filter(s => s.label === label);
    const updated = [...samples.filter(s => s.label !== label),...existing.slice(-96),...sanitized];
    samples = saveSamples(updated);
    $('teach-dialog').close();
    renderLibrary();
    toast('Saved “' + label + '”. Try it in Translator.');
  } catch (error) { $('capture-instruction').textContent = error.message; }
}

async function importSigns(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size >= 10*1024*1024) throw new Error('Choose a sign file smaller than 10 MiB.');
    const imported = parseSignImport(await file.text());
    if (!imported.length) throw new Error('This file has no sign examples.');
    if (imported.some(sample => sample.features.length !== FEATURES_LENGTH || sample.features.some(v => v < 0 || v > 20))) {
      throw new Error('These examples use an incompatible feature format. Export a file from this version of Sign Language Translator.');
    }
    const counts = new Map(); imported.forEach(s => counts.set(s.label,(counts.get(s.label)||0)+1));
    if ([...counts.values()].some(count => count < 5)) throw new Error('Each imported sign needs at least five examples.');
    if (!await confirmAction('Import your signs?', 'Add ' + imported.length + ' examples for ' + counts.size + ' signs to this browser? Existing examples will be kept.', 'Import signs')) return;
    samples = saveSamples([...samples,...imported]);
    renderLibrary();
    toast('Your signs are ready to use.');
  } catch (error) { alertMessage(error.message); }
}

function renderSessions() {
  $('session-list').replaceChildren();
  if (!sessions.length) {
    const empty = element('div','empty-state');
    const emblem = element('span','empty-icon');emblem.append(icon('clock'));
    empty.append(emblem,element('h3','','No saved text'),element('p','','Use the save button below your transcript to keep a session here. Nothing is saved automatically.'),button('Back to translator','primary-button',() => setView('translate'),'arrow'));
    $('session-list').append(empty);return;
  }
  for (const session of sessions) {
    const card = element('article','session-card');
    const time = element('time','',new Date(session.createdAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}));
    time.dateTime = session.createdAt;
    card.append(time,element('p','',session.text));
    const actions = element('div','session-actions');
    actions.append(button('Open text','secondary-button',async () => {
      if (transcript.value.trim() && transcript.value !== session.text && !await confirmAction('Open this session?', 'Replace the current unsaved transcript with this saved text?', 'Open session')) return;
      transcript.value = session.text; updateTranscriptUI(); setView('translate');
    },'arrow'),button('Copy','secondary-button',() => copyText(session.text),'copy'),button('Download','secondary-button',() => downloadText(session.text,'sign-language-translator-session.txt'),'download'));
    const remove = button('','icon-button',async () => {
      if (!await confirmAction('Delete saved session?', 'Remove this saved text from this browser?', 'Delete session')) return;
      try { sessions = saveSessions(sessions.filter(s => s.id !== session.id));renderSessions();toast('Session deleted.'); }
      catch(error) {alertMessage(error.message);}
    },'close');
    remove.setAttribute('aria-label','Delete session from ' + time.textContent);
    actions.append(remove);card.append(actions);$('session-list').append(card);
  }
}

async function saveSession() {
  const text = transcript.value;
  if (!text.trim()) return;
  if (sessions[0]?.text === text) {toast('This text is already saved.');return;}
  if (sessions.length >= 30) {alertMessage('You have 30 saved sessions. Download and remove an older session before saving another.');return;}
  try {
    sessions = saveSessions([{id:crypto.randomUUID(),createdAt:new Date().toISOString(),text},...sessions]);
    toast('Session saved on this device.');
  } catch (error) {alertMessage(error.message);}
}

// All user-provided labels and transcript contents enter the page as text.
all('[data-view]').forEach(nav => nav.addEventListener('click',() => setView(nav.dataset.view)));
all('[data-open-about]').forEach(node => node.addEventListener('click',() => $('about-dialog').showModal()));
all('[data-close-dialog]').forEach(node => node.addEventListener('click',() => node.closest('dialog').close()));
all('dialog').forEach(dialog => dialog.addEventListener('close',() => stabilizer.reset()));
$('teach-dialog').addEventListener('close',() => stopCapture());
$('dismiss-alert').addEventListener('click',clearAlert);
$('start-camera').addEventListener('click',startCamera);
$('stop-camera').addEventListener('click',stopCamera);
$('global-camera-stop').addEventListener('click',stopCamera);
$('mirror-button').addEventListener('click',() => {
  mirrored = !mirrored;
  updateMirror();
});
function updateMirror() {
  const transform = mirrored ? 'scaleX(-1)' : 'none';
  video.style.transform = transform; overlay.style.transform = transform; teachCanvas.style.transform = transform;
  $('mirror-button').setAttribute('aria-pressed',String(mirrored));
  $('mirror-button').setAttribute('aria-label',mirrored ? 'Turn off mirrored camera preview' : 'Turn on mirrored camera preview');
}
$('show-landmarks').addEventListener('change',() => {if (!$('show-landmarks').checked) ctx.clearRect(0,0,overlay.width,overlay.height);});
$('auto-add').addEventListener('change',() => stabilizer.reset());
$('add-sign').addEventListener('click',() => {
  if (running && currentCandidate && performance.now()-latestInferenceAt<350) {
    appendCandidate(currentCandidate);
    stabilizer.latchedLabel = currentCandidate.label;
    toast('Sign added.');
  }
});
$('add-space').addEventListener('click',() => {if (!/\s$/.test(transcript.value)) insertText(' ');});
$('backspace').addEventListener('click',deleteCharacter);
$('clear-transcript').addEventListener('click',async () => {
  if (transcript.value && await confirmAction('Clear your transcript?', 'This clears the text in the editor. Saved sessions remain available.', 'Clear text')) {
    transcript.value = '';updateTranscriptUI();stabilizer.reset();
  }
});
transcript.addEventListener('input',updateTranscriptUI);
$('copy-text').addEventListener('click',() => copyText(transcript.value));
$('download-text').addEventListener('click',() => downloadText(transcript.value,'sign-language-translator-transcript.txt'));
$('speak-text').addEventListener('click',readAloud);
$('save-session').addEventListener('click',saveSession);
$('show-practice').addEventListener('click',() => setView('practice'));
$('practice-select').addEventListener('change',event => setPractice(event.target.value));
$('next-practice').addEventListener('click',() => setPractice(BUILTIN_SIGNS[(BUILTIN_SIGNS.findIndex(sign => sign.id === practiceId)+1)%BUILTIN_SIGNS.length].id));
$('new-sign').addEventListener('click',() => openTeach());
$('capture-examples').addEventListener('click',beginCapture);
$('save-sign').addEventListener('click',saveCapturedSign);
$('export-signs').addEventListener('click',() => {
  try {downloadText(serializeSigns(samples),'sign-language-translator-signs.json','application/json');toast('Sign examples exported.');}
  catch (error) {alertMessage(error.message);}
});
$('import-signs').addEventListener('click',() => $('import-file').click());
$('import-file').addEventListener('change',importSigns);
window.addEventListener('hashchange',() => setView(location.hash.slice(1),false));
document.addEventListener('visibilitychange',() => {
  if (document.hidden) {
    stabilizer.reset();
    currentCandidate = null;
    if (capture) stopCapture('Capture paused because this tab was hidden. Start again when you’re ready.');
  }
});
window.addEventListener('pagehide',() => {
  stopCamera();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  try {model?.close();} catch { /* already released */ }
  model = null;
});

renderStarters();renderLibrary();renderSessions();updateTranscriptUI();updateMirror();
setView(location.hash.slice(1) || 'translate',false);
if (persisted.warnings.length) alertMessage(persisted.warnings.join(' ') + ' You can still use live recognition.');
if (samples.length !== persisted.samples.length) alertMessage('Some saved sign examples use an incompatible format and were not loaded.');
if (!('speechSynthesis' in window)) $('speak-text').title = 'Read aloud is not supported in this browser.';
