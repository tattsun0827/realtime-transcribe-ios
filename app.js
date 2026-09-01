'use strict';

const STORAGE_KEY_API = 'rt_groq_api_key';
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODEL = 'whisper-large-v3';

const setupScreen = document.getElementById('setup-screen');
const mainScreen = document.getElementById('main-screen');
const apiKeyInput = document.getElementById('api-key-input');
const saveKeyBtn = document.getElementById('save-key-btn');
const setupError = document.getElementById('setup-error');
const recordBtn = document.getElementById('record-btn');
const recordBtnLabel = document.getElementById('record-btn-label');
const transcriptEl = document.getElementById('transcript');
const mainError = document.getElementById('main-error');

let mediaStream = null;
let recorder = null;
let recording = false;

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

async function startRecording() {
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  const chunks = [];
  recorder = mimeType
    ? new MediaRecorder(mediaStream, { mimeType })
    : new MediaRecorder(mediaStream);

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.onstop = async () => {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    await sendToGroq(blob);
  };

  recorder.start();
  recording = true;
  updateRecordButton();
  console.log('[rec] started', { mimeType: recorder.mimeType });
}

function stopRecording() {
  if (recorder && recorder.state !== 'inactive') {
    recorder.stop();
  }
  recording = false;
  updateRecordButton();
  console.log('[rec] stopped');
}

function updateRecordButton() {
  recordBtn.classList.toggle('recording', recording);
  recordBtnLabel.textContent = recording ? '録音停止' : '録音開始';
}

// 拡張子をmimeTypeから決める（Groq側がファイル名の拡張子で形式を判定するため）
function extFromMimeType(mimeType) {
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('webm')) return 'webm';
  return 'wav';
}

// 音声blobをGroqへ送り、結果を確定テキストとして表示する
async function sendToGroq(blob) {
  const apiKey = loadApiKey();
  const ext = extFromMimeType(blob.type);
  const form = new FormData();
  form.append('file', blob, `audio.${ext}`);
  form.append('model', GROQ_MODEL);
  form.append('language', 'ja');

  // dry-run相当の確認ログ（APIキー本体は絶対に出さない）
  console.log('[groq] POST', GROQ_ENDPOINT, {
    model: GROQ_MODEL,
    language: 'ja',
    fileSize: blob.size,
    fileType: blob.type,
    authHeader: 'Bearer ***',
  });

  mainError.hidden = true;
  recordBtnLabel.textContent = '処理中…';

  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Groq API エラー (${res.status}): ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    appendConfirmedText(data.text || '');
    console.log('[groq] ok', { length: (data.text || '').length });
  } catch (err) {
    mainError.textContent = `文字起こしに失敗しました: ${err.message}`;
    mainError.hidden = false;
    console.error('[groq] failed', err);
  } finally {
    updateRecordButton();
  }
}

// 確定テキストを表示エリアへ追記し、最新行までスクロールする
function appendConfirmedText(text) {
  if (!text) return;
  const span = document.createElement('span');
  span.className = 'seg-confirmed';
  span.textContent = text + ' ';
  transcriptEl.appendChild(span);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

recordBtn.addEventListener('click', () => {
  if (recording) {
    stopRecording();
    return;
  }
  startRecording().catch((err) => {
    mainError.textContent = `マイクを開始できませんでした: ${err.message}`;
    mainError.hidden = false;
    console.error('[rec] start failed', err);
  });
});

initScreen();
