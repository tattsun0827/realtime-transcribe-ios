'use strict';

import { MAX_DRAFT_QUEUE, shouldStopSegment, nextSilenceStartedAt, normalizeTranscript } from './vad-core.mjs';

const STORAGE_KEY_API = 'rt_groq_api_key';
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODEL = 'whisper-large-v3';
const PROMPT_CONTEXT_CHARS = 200; // Groqのpromptに渡す直前確定テキストの上限（ハルシネーション対策）

const setupScreen = document.getElementById('setup-screen');
const mainScreen = document.getElementById('main-screen');
const apiKeyInput = document.getElementById('api-key-input');
const saveKeyBtn = document.getElementById('save-key-btn');
const setupError = document.getElementById('setup-error');
const recordBtn = document.getElementById('record-btn');
const recordBtnLabel = document.getElementById('record-btn-label');
const transcriptEl = document.getElementById('transcript');
const mainError = document.getElementById('main-error');
const openSettingsBtn = document.getElementById('open-settings-btn');
const openListBtn = document.getElementById('open-list-btn');

let mediaStream = null;
let audioContext = null;
let analyser = null;
let dataArray = null;
let recording = false;
let recordingStartMs = 0;
let draftTimer = null; // VAD監視ループのタイマー
let draftQueue = []; // { blob, placeholder } の処理待ちキュー
let draftBusy = false;
let contextText = ''; // 直前の確定テキスト（Groqのpromptへ渡す文脈）
let rateLimited = false; // 429検出後は以降の自動送信を止める（1回だけ告知）
const activeRecorders = new Set();

// localStorageからAPIキーを取得する（無ければnull）
function loadApiKey() {
  try {
    return localStorage.getItem(STORAGE_KEY_API);
  } catch {
    return null;
  }
}

// APIキーをlocalStorageへ保存する
function saveApiKey(key) {
  localStorage.setItem(STORAGE_KEY_API, key);
}

// キーの有無で初期画面を出し分ける
function initScreen() {
  const key = loadApiKey();
  setupScreen.hidden = !!key;
  mainScreen.hidden = !key;
}

saveKeyBtn.addEventListener('click', () => {
  const value = apiKeyInput.value.trim();
  if (!value.startsWith('gsk_')) {
    setupError.textContent = 'キーの形式が正しくないようです（gsk_ から始まる文字列です）';
    setupError.hidden = false;
    return;
  }
  saveApiKey(value);
  setupError.hidden = true;
  initScreen();
});

// このブラウザで録音に使えるmimeTypeを選ぶ（iOSはaudio/mp4のみ対応）
function pickMimeType() {
  const candidates = ['audio/mp4', 'audio/webm'];
  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

// 拡張子をmimeTypeから決める（Groq側がファイル名の拡張子で形式を判定するため）
function extFromMimeType(mimeType) {
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('webm')) return 'webm';
  return 'wav';
}

// ミックス後の音声からRMS音量を取得する（AudioContext停止後は0=無音扱い）
function getVolume() {
  if (!analyser || !dataArray) return 0;
  analyser.getFloatTimeDomainData(dataArray);
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i];
  return Math.sqrt(sum / dataArray.length);
}

// 「認識中…」のグレー表示を追加し、その要素を返す（Groq応答が来たら確定テキストに置き換える）
function addDraftPlaceholder() {
  const span = document.createElement('span');
  span.className = 'seg-draft';
  span.textContent = '認識中… ';
  transcriptEl.appendChild(span);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
  return span;
}

// draftプレースホルダーを確定テキストへ置き換える（空文字なら要素ごと消す＝無音だった扱い）
function resolveDraftPlaceholder(placeholder, rawText) {
  const text = normalizeTranscript(rawText);
  if (!text) {
    placeholder.remove();
    return;
  }
  placeholder.className = 'seg-confirmed';
  placeholder.textContent = text + ' ';
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

// 処理待ちキューを直列で処理する（同時送信すると応答順が入れ替わり表示順が崩れるため）
async function processDraftQueue() {
  if (draftBusy || !draftQueue.length) return;
  draftBusy = true;
  const { blob, placeholder } = draftQueue.shift();
  try {
    await sendChunkToGroq(blob, placeholder);
  } finally {
    draftBusy = false;
    if (draftQueue.length) processDraftQueue();
  }
}

// 1チャンクをGroqへ送信し、結果でplaceholderを置き換える。文脈(prompt)を引き継ぐ
async function sendChunkToGroq(blob, placeholder) {
  if (rateLimited) {
    placeholder.remove();
    return;
  }
  const apiKey = loadApiKey();
  const ext = extFromMimeType(blob.type);
  const form = new FormData();
  form.append('file', blob, `audio.${ext}`);
  form.append('model', GROQ_MODEL);
  form.append('language', 'ja');
  if (contextText) form.append('prompt', contextText.slice(-PROMPT_CONTEXT_CHARS));

  console.log('[groq] POST chunk', {
    fileSize: blob.size,
    fileType: blob.type,
    hasContext: Boolean(contextText),
    authHeader: 'Bearer ***',
  });

  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (res.status === 429) {
      rateLimited = true;
      placeholder.remove();
      mainError.textContent = 'Groqの利用上限に達しました。しばらく待ってから録音し直してください';
      mainError.hidden = false;
      stopRecording();
      return;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Groq API エラー (${res.status}): ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    resolveDraftPlaceholder(placeholder, data.text || '');
    if (data.text) contextText = data.text;
  } catch (err) {
    placeholder.remove();
    mainError.textContent = `文字起こしに失敗しました: ${err.message}`;
    mainError.hidden = false;
    console.error('[groq] chunk failed', err);
  }
}

// VADで無音を検知するたびに録音を区切り、次のセグメントを即座に開始する（ギャップ最小化）
function recordDraftSegment() {
  if (!recording || !mediaStream) return;
  const mimeType = pickMimeType();
  let rec;
  try {
    rec = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
  } catch (err) {
    mainError.textContent = `録音を開始できませんでした: ${err.message}`;
    mainError.hidden = false;
    return;
  }
  activeRecorders.add(rec);
  const chunks = [];
  const segmentStartMs = performance.now() - recordingStartMs;
  let silenceStartedAt = null;

  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  rec.onstop = () => {
    activeRecorders.delete(rec);
    if (recording) recordDraftSegment();
    const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
    if (blob.size < 3000) return; // ほぼ無音のセグメントは送らない
    const placeholder = addDraftPlaceholder();
    draftQueue.push({ blob, placeholder });
    if (draftQueue.length > MAX_DRAFT_QUEUE) {
      const dropped = draftQueue.shift();
      dropped.placeholder.remove();
    }
    processDraftQueue();
  };

  rec.start();

  const watch = () => {
    if (!recording || rec.state !== 'recording') return;
    const now = performance.now();
    const elapsed = now - recordingStartMs - segmentStartMs;
    const rms = getVolume();
    const decision = shouldStopSegment({ rms, silenceStartedAt, now, elapsed });
    silenceStartedAt = nextSilenceStartedAt({ rms, silenceStartedAt, now });
    if (decision.stop) {
      try { rec.stop(); } catch { /* 無視 */ }
      return;
    }
    draftTimer = setTimeout(watch, 100);
  };
  watch();
}

async function startRecording() {
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(mediaStream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  dataArray = new Float32Array(analyser.fftSize);
  source.connect(analyser);

  recordingStartMs = performance.now();
  contextText = '';
  draftQueue = [];
  draftBusy = false;
  rateLimited = false;
  recording = true;
  updateRecordButton();
  recordDraftSegment();
  console.log('[rec] started (VAD mode)', { mimeType: pickMimeType() });
}

// 音声まわりの後始末。停止ボタンから呼ぶ。teardownの順番が重要:
// 先にMediaRecorderを明示的に止めてから、AudioContext.close()する
// （逆順だとcloseの自動停止でonstopが来ず最後のチャンクを失う）
function stopRecording() {
  recording = false; // 先に落としてonstopからの再入（次セグメント開始）を防ぐ
  activeRecorders.forEach((r) => {
    try { if (r.state !== 'inactive') r.stop(); } catch { /* 無視 */ }
  });
  activeRecorders.clear();
  clearTimeout(draftTimer);
  draftTimer = null;
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  if (audioContext) {
    try { audioContext.close(); } catch { /* 無視 */ }
    audioContext = null;
  }
  analyser = null;
  dataArray = null;
  updateRecordButton();
  console.log('[rec] stopped');
}

function updateRecordButton() {
  recordBtn.classList.toggle('recording', recording);
  recordBtnLabel.textContent = recording ? '録音停止' : '録音開始';
}

recordBtn.addEventListener('click', () => {
  if (recording) {
    stopRecording();
    return;
  }
  mainError.hidden = true;
  startRecording().catch((err) => {
    mainError.textContent = `マイクを開始できませんでした: ${err.message}`;
    mainError.hidden = false;
    console.error('[rec] start failed', err);
  });
});

// APIキーの再設定（本格的な設定画面はStep4以降。今はキー変更のみ）
openSettingsBtn.addEventListener('click', () => {
  const ok = confirm('Groq APIキーを削除して入力し直しますか？');
  if (!ok) return;
  try {
    localStorage.removeItem(STORAGE_KEY_API);
  } catch { /* 無視 */ }
  apiKeyInput.value = '';
  initScreen();
});

// 会話一覧はStep4で実装予定。今は未実装であることを明示する
openListBtn.addEventListener('click', () => {
  alert('会話の保存・一覧はまだ実装していません（次のStepで追加予定です）');
});

initScreen();
