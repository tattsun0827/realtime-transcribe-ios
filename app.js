'use strict';

import {
  MAX_DRAFT_QUEUE,
  MAX_PARALLEL_SENDS,
  VOICE_PEAK_RMS,
  shouldStopSegment,
  nextSilenceStartedAt,
  normalizeTranscript,
  isHallucination,
  isDuplicateOfPrevious,
} from './vad-core.mjs';
import {
  WAVE_SAMPLES,
  isValidApiKeyFormat,
  maskApiKey,
  selectableMicDevices,
  micOptionLabel,
  resolveMicDeviceId,
  audioConstraints,
  waveBarHeight,
  typingChunkSize,
} from './settings-core.mjs';
import { createConversation, appendSegment, listConversations, getConversation, displayTitle } from './db.mjs';

const STORAGE_KEY_API = 'rt_groq_api_key';
const STORAGE_KEY_FONT_SIZE = 'rt_font_size';
const STORAGE_KEY_MIC = 'rt_mic_device_id';
const WAVE_ACCENT = '#4f8cff'; // 送信対象の音量（style.css の --accent と同色）
const WAVE_QUIET = '#3a4150'; // 送信されない小さい音
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODEL = 'whisper-large-v3';
const PROMPT_CONTEXT_CHARS = 200; // Groqのpromptに渡す直前確定テキストの上限（ハルシネーション対策）
const FONT_SIZES = [16, 18, 20, 24, 28, 32, 36, 42, 48, 56, 64]; // px段階
const DEFAULT_FONT_SIZE = 20;
const TYPE_TOTAL_MS = 900; // 1セグメントを流し切るまでの上限。長文でもここで出し切る
const TYPE_FRAME_MS = 33; // 流し込みの間隔（およそ30fps）

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
const fontSmallerBtn = document.getElementById('font-smaller-btn');
const fontLargerBtn = document.getElementById('font-larger-btn');
const fontSizeLabel = document.getElementById('font-size-label');
const listScreen = document.getElementById('list-screen');
const detailScreen = document.getElementById('detail-screen');
const backFromListBtn = document.getElementById('back-from-list-btn');
const backFromDetailBtn = document.getElementById('back-from-detail-btn');
const conversationListEl = document.getElementById('conversation-list');
const detailTitleEl = document.getElementById('detail-title');
const detailTextEl = document.getElementById('detail-text');
const copyDetailBtn = document.getElementById('copy-detail-btn');
const shareDetailBtn = document.getElementById('share-detail-btn');
const micMonitor = document.getElementById('mic-monitor');
const mainWaveCanvas = document.getElementById('main-wave');
const micNameEl = document.getElementById('mic-name');
const micBusyEl = document.getElementById('mic-busy');
const micPickEl = document.getElementById('mic-pick');
const settingsScreen = document.getElementById('settings-screen');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const closeSettingsFooterBtn = document.getElementById('close-settings-footer-btn');
const keyStatusEl = document.getElementById('key-status');
const settingsKeyInput = document.getElementById('settings-key-input');
const settingsKeyReveal = document.getElementById('settings-key-reveal');
const settingsSaveKeyBtn = document.getElementById('settings-save-key-btn');
const settingsKeyMsg = document.getElementById('settings-key-msg');
const micSelect = document.getElementById('mic-select');
const micNote = document.getElementById('mic-note');
const micTestBtn = document.getElementById('mic-test-btn');
const settingsWaveCanvas = document.getElementById('settings-wave');
const settingsMicHint = document.getElementById('settings-mic-hint');
const settingsPickEl = document.getElementById('settings-pick');

let mediaStream = null;
let audioContext = null;
let analyser = null;
let dataArray = null;
let recording = false;
let starting = false; // startRecording()の実行中フラグ。マイク許可待ちの連打で二重に走らせない
let recordingStartMs = 0;
let draftTimer = null; // VAD監視ループのタイマー
// 区切りの「世代」。停止・復旧のたびに増やし、古いセグメントの監視ループとonstopを無効化する。
// これが無いと、復旧のたびに監視ループが増殖して同じ音声を二重に送ってしまう
let segmentGeneration = 0;
let lastWatchTickMs = 0; // 監視ループが最後に生きていた時刻（番犬の判定に使う）
let watchdogTimer = null;
let draftQueue = []; // { blob, placeholder, conversationId } の処理待ちキュー
let draftInFlight = 0; // Groqへ送信中の件数
let contextText = ''; // 直前の確定テキスト（Groqのpromptへ渡す文脈）
let rateLimited = false; // 429検出後は以降の自動送信を止める（1回だけ告知）
let currentConversation = null; // 録音中の会話レコード（{id, ...}）。確定セグメントを都度追記する
let wakeLock = null; // 録音中の画面消灯を防ぐWake Lockセンチネル
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

// 5画面のうち1つだけを表示する
const SCREENS = { setup: setupScreen, main: mainScreen, list: listScreen, detail: detailScreen, settings: settingsScreen };
function showScreen(name) {
  for (const key of Object.keys(SCREENS)) {
    SCREENS[key].hidden = key !== name;
  }
}

// キーの有無で初期画面を出し分ける
function initScreen() {
  showScreen(loadApiKey() ? 'main' : 'setup');
}

saveKeyBtn.addEventListener('click', () => {
  const value = apiKeyInput.value.trim();
  if (!isValidApiKeyFormat(value)) {
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

// 音量の履歴を流れる波形として描く（ACSの入力モニターと同じ見せ方）。
// 「開始したのに拾えていない」を目で気づけるようにするための装置なので、
// 送信対象になる音量（VOICE_PEAK_RMS以上）だけを色で立たせる。
// canvasの内部解像度は実表示サイズ×DPRに合わせる。属性値のままだと横に伸びてぼやける
function createWaveRenderer(canvas) {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  const history = [];

  function draw() {
    if (!ctx) return; // canvas 2Dが無い環境（テスト用の最小DOM等）では描画だけ黙って省く
    const wantW = Math.round((canvas.clientWidth || 240) * dpr);
    const wantH = Math.round((canvas.clientHeight || 36) * dpr);
    if (wantW > 0 && canvas.width !== wantW) canvas.width = wantW;
    if (wantH > 0 && canvas.height !== wantH) canvas.height = wantH;
    const w = canvas.width;
    const h = canvas.height;
    const step = w / WAVE_SAMPLES;
    ctx.clearRect(0, 0, w, h);
    history.forEach((rms, i) => {
      const bh = waveBarHeight(rms, h, dpr);
      ctx.fillStyle = rms >= VOICE_PEAK_RMS ? WAVE_ACCENT : WAVE_QUIET;
      ctx.fillRect(i * step, (h - bh) / 2, Math.max(dpr, step - dpr), bh);
    });
  }

  return {
    push(rms) {
      history.push(rms);
      if (history.length > WAVE_SAMPLES) history.shift();
      draw();
    },
    // 履歴を無音で埋め直す。左端から少しずつ伸びる描き方だと「壊れている」ように見えるので、
    // 最初から全幅に無音の基線を出しておく
    clear() {
      history.length = 0;
      for (let i = 0; i < WAVE_SAMPLES; i++) history.push(0);
      draw();
    },
  };
}

const mainWave = createWaveRenderer(mainWaveCanvas);
const settingsWave = createWaveRenderer(settingsWaveCanvas);

// 録音中の入力モニターを更新する（波形＋「🔊 拾っています」）
function updateMicMonitor(rms) {
  mainWave.push(rms);
  micPickEl.classList.toggle('on', rms >= VOICE_PEAK_RMS);
}

// 表示順を保つための空の器をDOMへ置き、その要素を返す。
// 文字は入れない。「認識中…」が本文に並ぶと読みづらいので、変換の進行は入力モニターの帯で示す
function addDraftPlaceholder() {
  const span = document.createElement('span');
  span.className = 'seg-draft';
  transcriptEl.appendChild(span);
  return span;
}

// 確定テキストを1フレームずつ流し込む。4〜15秒ぶんの文章が一度に現れると
// 「止まっていて、たまに塊で出る」ように見えるため、喋る速さに近づけて流す
function typeInto(el, text) {
  const chunk = typingChunkSize(text.length, TYPE_TOTAL_MS, TYPE_FRAME_MS);
  let shown = 0;
  const step = () => {
    shown = Math.min(text.length, shown + chunk);
    el.textContent = shown < text.length ? text.slice(0, shown) : text + ' ';
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
    if (shown < text.length) setTimeout(step, TYPE_FRAME_MS);
  };
  step();
}

// draftプレースホルダーを確定テキストへ置き換える（空文字なら要素ごと消す＝無音だった扱い）
// 保存(DB)にも表示と同じ正規化後テキストを使うため、確定テキストをそのまま返す
function resolveDraftPlaceholder(placeholder, rawText) {
  const text = normalizeTranscript(rawText);
  if (!text) {
    placeholder.remove();
    return '';
  }
  placeholder.className = 'seg-confirmed';
  typeInto(placeholder, text);
  return text;
}

// 変換の進行を入力モニターの帯に出す（本文には出さない）。
// 録音を止めた直後もまだ変換中の分が残っているので、出し切るまでモニターは消さない
function updateBusyIndicator() {
  const busy = draftInFlight + draftQueue.length > 0;
  micBusyEl.hidden = !busy;
  micMonitor.hidden = !recording && !busy;
}

// 処理待ちキューを最大MAX_PARALLEL_SENDS本まで並列で流す。
// 表示順は「送信前にプレースホルダーをDOMへ挿入済み」であることが保証するため、
// 応答が前後しても文章の順番は崩れない（直列にすると混雑時にキュー溢れで音声を落とす）
function pumpDraftQueue() {
  while (draftInFlight < MAX_PARALLEL_SENDS && draftQueue.length) {
    const { blob, placeholder, conversationId } = draftQueue.shift();
    draftInFlight++;
    updateBusyIndicator();
    sendChunkToGroq(blob, placeholder, conversationId)
      .catch((err) => console.error('[groq] unexpected', err))
      .finally(() => {
        draftInFlight--;
        updateBusyIndicator();
        pumpDraftQueue();
      });
  }
  updateBusyIndicator();
}

// 1チャンクをGroqへ送信し、結果でplaceholderを置き換える。文脈(prompt)を引き継ぐ
// conversationIdはキュー投入時点（録音中）の会話を指す。stopRecording()がcurrentConversationを
// nullに戻した後でも、停止直前に積まれたチャンクは自分のIDを保持したまま正しく保存できる
async function sendChunkToGroq(blob, placeholder, conversationId) {
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
  form.append('temperature', '0'); // 出力を決定的にして幻聴（創作）を抑える
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
    if (res.status === 401) {
      // キーが無効なら以降のチャンクも必ず失敗する。同じエラーを出し続けず録音ごと止める
      rateLimited = true;
      placeholder.remove();
      mainError.textContent = 'APIキーが無効です。⚙ボタンからキーを入れ直してください';
      mainError.hidden = false;
      stopRecording();
      return;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Groq API エラー (${res.status}): ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const candidate = normalizeTranscript(data.text || '');

    // 幻聴（無音時の定型句）と、文脈promptに引きずられた直前文の再出力を捨てる
    if (isHallucination(candidate) || isDuplicateOfPrevious(candidate, contextText)) {
      console.log('[groq] drop suspicious text', { candidate });
      placeholder.remove();
      return;
    }

    const confirmedText = resolveDraftPlaceholder(placeholder, candidate);
    if (confirmedText) {
      contextText = confirmedText;
      if (conversationId) {
        appendSegment(conversationId, confirmedText).catch((err) => {
          console.error('[db] appendSegment failed', err);
        });
      }
    }
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
  const gen = segmentGeneration; // この区切りが属する世代。世代が進んだら自分は黙って退場する
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
  let peakRms = 0; // このセグメント中の最大音量（発話が含まれたかの判定に使う）

  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  rec.onstop = () => {
    activeRecorders.delete(rec);
    if (recording && gen === segmentGeneration) recordDraftSegment();
    const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
    if (blob.size < 3000) return; // ほぼ無音のセグメントは送らない
    // 音声区間ゲート: セグメント中に一度も発話音量へ達していなければ送らない。
    // 無音をWhisperへ送ると「ご視聴ありがとうございました」等の幻聴を生むうえ、
    // 無料枠で先に尽きるのは1日あたりのリクエスト回数(RPD)なので実質的な浪費になる
    if (peakRms < VOICE_PEAK_RMS) {
      console.log('[vad] skip silent segment', { peakRms: peakRms.toFixed(4) });
      return;
    }
    const placeholder = addDraftPlaceholder();
    // 会話IDはキュー投入時点で確定させる。停止後に応答が返っても保存先を見失わない
    draftQueue.push({ blob, placeholder, conversationId: currentConversation ? currentConversation.id : null });
    if (draftQueue.length > MAX_DRAFT_QUEUE) {
      const dropped = draftQueue.shift();
      dropped.placeholder.remove();
    }
    pumpDraftQueue();
  };

  rec.start();

  const watch = () => {
    if (!recording || gen !== segmentGeneration || rec.state !== 'recording') return;
    const now = performance.now();
    lastWatchTickMs = now; // 番犬へ「まだ生きている」と知らせる
    const elapsed = now - recordingStartMs - segmentStartMs;
    const rms = getVolume();
    if (rms > peakRms) peakRms = rms;
    updateMicMonitor(rms);
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

// AudioContextが止まっていると音量が常に0になり、発話が含まれていても「無音セグメント」として
// 全部捨てられ、一文字も出ないまま録音だけが続く。iOSはawaitを挟むとユーザー操作の権利が切れて
// suspendedのまま生まれ、タブを離れるとinterruptedになるため、要所ごとに起こし直す
async function resumeAudioContext() {
  if (!audioContext || audioContext.state === 'running') return;
  try {
    await audioContext.resume();
  } catch (err) {
    console.warn('[audio] resume failed', err);
  }
}

// 監視ループの番犬。iOSの中断などでMediaRecorderがpausedになると監視ループは静かに終わり、
// 「録音中の表示のまま何も出ない」状態で固まる。2秒ごとに生存を確かめ、途切れていたら区切り直す
function startWatchdog() {
  stopWatchdog();
  lastWatchTickMs = performance.now();
  watchdogTimer = setInterval(() => {
    if (!recording) return;
    resumeAudioContext();
    if (performance.now() - lastWatchTickMs < 3000) return;
    console.warn('[rec] 監視が途切れたため区切りを取り直します');
    segmentGeneration++; // 古い監視ループとonstopを無効化してから作り直す（二重起動の防止）
    activeRecorders.forEach((r) => {
      try { if (r.state !== 'inactive') r.stop(); } catch { /* 無視 */ }
    });
    activeRecorders.clear();
    lastWatchTickMs = performance.now();
    recordDraftSegment();
  }, 2000);
}

function stopWatchdog() {
  clearInterval(watchdogTimer);
  watchdogTimer = null;
}

// 録音中に画面が消えると録音も止まるため、Wake Lockで画面を点けたままにする。
// 非対応（古いiOS等）でも例外にせず、単に何もしない
async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (err) {
    console.warn('[wakelock] failed', err);
  }
}

function releaseWakeLock() {
  if (!wakeLock) return;
  wakeLock.release().catch(() => { /* 無視 */ });
  wakeLock = null;
}

// 設定で選ばれたマイクのdeviceIdを取り出す（未設定・保存不可なら空文字＝既定のマイク）
function loadMicDeviceId() {
  try {
    return localStorage.getItem(STORAGE_KEY_MIC) || '';
  } catch {
    return '';
  }
}

// 指定のマイクでストリームを開く。選んだマイクが外れている等で開けなければ既定のマイクへ落とす
// （exact指定のまま失敗させると、録音そのものが始められなくなるため）
async function openMicStream(deviceId) {
  try {
    return await navigator.mediaDevices.getUserMedia(audioConstraints(deviceId));
  } catch (err) {
    if (!deviceId) throw err;
    console.warn('[mic] 指定マイクを開けないため既定のマイクで開きます', err);
    return navigator.mediaDevices.getUserMedia(audioConstraints(''));
  }
}

// 実際に開いたマイクの名前を返す（許可前は空になるので、その時は「マイク」とだけ表示する）
function streamMicLabel(stream) {
  const track = stream && stream.getAudioTracks ? stream.getAudioTracks()[0] : null;
  return (track && track.label) || 'マイク';
}

async function startRecording() {
  // 入力元は設定で選べる。制約（ノイズ抑制等）は audioConstraints() が持つ
  mediaStream = await openMicStream(loadMicDeviceId());
  micNameEl.textContent = streamMicLabel(mediaStream);

  audioContext = new AudioContext();
  await resumeAudioContext(); // suspendedのまま進むと全セグメントが無音扱いで捨てられる
  const source = audioContext.createMediaStreamSource(mediaStream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  dataArray = new Float32Array(analyser.fftSize);
  source.connect(analyser);

  recordingStartMs = performance.now();
  contextText = '';
  draftQueue = [];
  draftInFlight = 0;
  rateLimited = false;
  recording = true;
  segmentGeneration++; // 前回の録音に属する監視ループが残っていても、ここで確実に無効化する
  currentConversation = await createConversation();
  micMonitor.hidden = false;
  mainWave.clear();
  await acquireWakeLock();
  updateRecordButton();
  startWatchdog();
  recordDraftSegment();
  console.log('[rec] started (VAD mode)', { mimeType: pickMimeType(), conversationId: currentConversation.id });
}

// 音声まわりの後始末。停止ボタンから呼ぶ。teardownの順番が重要:
// 先にMediaRecorderを明示的に止めてから、AudioContext.close()する
// （逆順だとcloseの自動停止でonstopが来ず最後のチャンクを失う）
function stopRecording() {
  recording = false; // 先に落としてonstopからの再入（次セグメント開始）を防ぐ
  segmentGeneration++; // 生き残っている監視ループ・onstopをまとめて無効化する
  stopWatchdog();
  starting = false;
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
  currentConversation = null; // 保存先は録音中のみ有効。停止後に届く最後のチャンクはキューが保持したIDで保存される
  releaseWakeLock();
  micPickEl.classList.remove('on');
  mainWave.clear();
  updateBusyIndicator(); // 変換待ちが残っていればモニターを残し、無ければここで消える
  updateRecordButton();
  console.log('[rec] stopped');
}

// iOSでタブを離れるとWake Lockは自動解放され、AudioContextも中断される。
// 戻ってきて録音中なら両方とも取り直す（AudioContextを起こし忘れると以降ずっと無音扱いになる）
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !recording) return;
  if (!wakeLock) acquireWakeLock();
  resumeAudioContext();
});

function updateRecordButton() {
  recordBtn.classList.toggle('recording', recording);
  if (starting && !recording) {
    recordBtnLabel.textContent = 'マイクを準備中…';
    return;
  }
  recordBtnLabel.textContent = recording ? '録音停止' : '録音開始';
}

recordBtn.addEventListener('click', () => {
  // マイク許可のダイアログが出ている間の連打を無視する。ここを素通りさせると
  // ストリーム・AudioContext・監視ループが二重に走り、同じ声が2回文字になる
  if (starting) return;
  if (recording) {
    stopRecording();
    return;
  }
  mainError.hidden = true;
  starting = true;
  updateRecordButton();
  startRecording()
    .catch((err) => {
      mainError.textContent = `マイクを開始できませんでした: ${err.message}`;
      mainError.hidden = false;
      console.error('[rec] start failed', err);
      stopRecording(); // 途中まで開いたマイク・AudioContextを掴んだままにしない
    })
    .finally(() => {
      starting = false;
      updateRecordButton();
    });
});

// ---- 設定画面 ----
// キーは「削除して入力し直す」のではなく、この画面で新しい値を上書き保存する。
// 削除方式は、入れ直しに失敗すると使えない状態のまま取り残されるので採らない。

let micTestStream = null; // マイクテスト中のストリーム（テスト停止・画面を閉じた時に必ず止める）
let micTestContext = null;
let micTestAnalyser = null;
let micTestData = null;
let micTestTimer = null;

// 保存済みキーの有無を伏せ字で示す
function renderKeyStatus() {
  const masked = maskApiKey(loadApiKey());
  keyStatusEl.textContent = masked ? `現在のキー: ${masked}` : 'キーは未設定です';
  keyStatusEl.classList.toggle('unset', !masked);
}

// 接続中のマイクを選択肢に並べる。名前はマイクの使用を許可するまで空で返るため、その旨を案内する
async function renderMicDevices() {
  const saved = loadMicDeviceId();
  micSelect.textContent = '';
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = '既定のマイク';
  micSelect.appendChild(defaultOption);

  let devices = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch (err) {
    console.warn('[mic] enumerateDevices failed', err);
    micNote.textContent = 'マイクの一覧を取得できませんでした。「既定のマイク」で録音できます。';
    return;
  }

  const inputs = selectableMicDevices(devices);
  inputs.forEach((d, i) => {
    const option = document.createElement('option');
    option.value = d.deviceId;
    option.textContent = micOptionLabel(d, i);
    micSelect.appendChild(option);
  });

  // 外したマイクのIDが残っていると exact 指定で録音が始められないので、その場で既定へ戻す
  const resolved = resolveMicDeviceId(saved, devices);
  if (resolved !== saved) saveMicDeviceId(resolved);
  micSelect.value = resolved;

  if (!inputs.length) {
    micNote.textContent = 'マイクが見つかりません。端末に接続してから「マイクをテスト」を押してください。';
  } else if (inputs.some((d) => !d.label)) {
    micNote.textContent = 'マイクの名前は、「マイクをテスト」で使用を許可すると表示されます。';
  } else {
    micNote.textContent = `接続中のマイク: ${inputs.length}台`;
  }
}

function saveMicDeviceId(deviceId) {
  try {
    localStorage.setItem(STORAGE_KEY_MIC, deviceId);
  } catch { /* 保存できなくても既定のマイクで動く */ }
}

// マイクテストを止めて後始末する。画面を閉じる時にも必ず通す（マイクを掴んだままにしない）
function stopMicTest() {
  clearTimeout(micTestTimer);
  micTestTimer = null;
  if (micTestStream) {
    micTestStream.getTracks().forEach((t) => t.stop());
    micTestStream = null;
  }
  if (micTestContext) {
    try { micTestContext.close(); } catch { /* 無視 */ }
    micTestContext = null;
  }
  micTestAnalyser = null;
  micTestData = null;
  settingsWave.clear();
  settingsPickEl.classList.remove('on');
  micTestBtn.textContent = 'マイクをテスト';
  settingsMicHint.textContent = 'テストを押すと、ここに波形が出ます';
}

async function startMicTest() {
  micTestStream = await openMicStream(micSelect.value);
  micTestContext = new AudioContext();
  const source = micTestContext.createMediaStreamSource(micTestStream);
  micTestAnalyser = micTestContext.createAnalyser();
  micTestAnalyser.fftSize = 512;
  micTestData = new Float32Array(micTestAnalyser.fftSize);
  source.connect(micTestAnalyser);
  micTestBtn.textContent = 'テストを停止';
  settingsMicHint.textContent = streamMicLabel(micTestStream);
  settingsWave.clear();
  // 許可した直後は名前が取れるようになるので、一覧を作り直す
  await renderMicDevices();
  micSelect.value = loadMicDeviceId();

  const tick = () => {
    if (!micTestAnalyser || !micTestData) return;
    micTestAnalyser.getFloatTimeDomainData(micTestData);
    let sum = 0;
    for (let i = 0; i < micTestData.length; i++) sum += micTestData[i] * micTestData[i];
    const rms = Math.sqrt(sum / micTestData.length);
    settingsWave.push(rms);
    settingsPickEl.classList.toggle('on', rms >= VOICE_PEAK_RMS);
    micTestTimer = setTimeout(tick, 100);
  };
  tick();
}

async function openSettings() {
  renderKeyStatus();
  settingsKeyInput.value = '';
  settingsKeyMsg.hidden = true;
  showScreen('settings');
  await renderMicDevices();
}

function closeSettings() {
  stopMicTest();
  showScreen('main');
}

openSettingsBtn.addEventListener('click', () => {
  openSettings().catch((err) => console.error('[settings] open failed', err));
});

closeSettingsBtn.addEventListener('click', closeSettings);
closeSettingsFooterBtn.addEventListener('click', closeSettings);

settingsKeyReveal.addEventListener('change', () => {
  settingsKeyInput.type = settingsKeyReveal.checked ? 'text' : 'password';
});

settingsSaveKeyBtn.addEventListener('click', () => {
  const value = settingsKeyInput.value.trim();
  settingsKeyMsg.hidden = false;
  if (!isValidApiKeyFormat(value)) {
    settingsKeyMsg.textContent = 'キーの形式が正しくないようです（gsk_ から始まる文字列です）';
    settingsKeyMsg.className = 'settings-msg error';
    return;
  }
  saveApiKey(value);
  rateLimited = false; // 無効キーで止めていた場合、新しいキーで再開できるようにする
  mainError.hidden = true;
  settingsKeyInput.value = '';
  settingsKeyReveal.checked = false;
  settingsKeyInput.type = 'password';
  settingsKeyMsg.textContent = 'キーを保存しました';
  settingsKeyMsg.className = 'settings-msg ok';
  renderKeyStatus();
});

micSelect.addEventListener('change', () => {
  saveMicDeviceId(micSelect.value);
  if (micTestStream) {
    // テスト中に切り替えたら、新しいマイクで開き直して即座に確かめられるようにする
    stopMicTest();
    startMicTest().catch((err) => {
      settingsMicHint.textContent = `このマイクを開けませんでした: ${err.message}`;
      stopMicTest();
    });
  }
});

micTestBtn.addEventListener('click', () => {
  if (micTestStream) {
    stopMicTest();
    return;
  }
  startMicTest().catch((err) => {
    console.error('[mic] test failed', err);
    stopMicTest();
    settingsMicHint.textContent = `マイクを開けませんでした: ${err.message}`;
  });
});

// 会話の全文を1つの文字列にする（コピー・共有・詳細表示で共用）
function conversationToText(conv) {
  return conv.segments.map((s) => s.text).join(' ');
}

// 会話一覧を描画する
async function renderConversationList() {
  conversationListEl.textContent = '';
  let rows;
  try {
    rows = await listConversations();
  } catch (err) {
    console.error('[db] list failed', err);
    const p = document.createElement('p');
    p.className = 'conversation-empty';
    p.textContent = '会話を読み込めませんでした';
    conversationListEl.appendChild(p);
    return;
  }
  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'conversation-empty';
    p.textContent = 'まだ保存された会話はありません。録音すると自動で保存されます。';
    conversationListEl.appendChild(p);
    return;
  }
  for (const conv of rows) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'conversation-item';
    const title = document.createElement('div');
    title.className = 'conversation-item-title';
    title.textContent = displayTitle(conv);
    const meta = document.createElement('div');
    meta.className = 'conversation-item-meta';
    const d = new Date(conv.createdAt);
    const pad = (n) => String(n).padStart(2, '0');
    meta.textContent = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} ・ ${conv.segments.length}件`;
    item.append(title, meta);
    item.addEventListener('click', () => openConversationDetail(conv.id));
    conversationListEl.appendChild(item);
  }
}

// 会話詳細を開く
async function openConversationDetail(id) {
  const conv = await getConversation(id);
  if (!conv) return;
  detailTitleEl.textContent = displayTitle(conv);
  detailTextEl.textContent = conversationToText(conv) || '(内容がありません)';
  detailTextEl.style.setProperty('--font-size', currentFontSize + 'px');
  showScreen('detail');
}

openListBtn.addEventListener('click', async () => {
  showScreen('list');
  await renderConversationList();
});

backFromListBtn.addEventListener('click', () => showScreen('main'));
backFromDetailBtn.addEventListener('click', async () => {
  showScreen('list');
  await renderConversationList();
});

copyDetailBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(detailTextEl.textContent || '');
    copyDetailBtn.textContent = '✅ コピーしました';
  } catch {
    copyDetailBtn.textContent = '⛔ コピーできませんでした';
  }
  setTimeout(() => (copyDetailBtn.textContent = '📋 コピー'), 1500);
});

// 共有はiOS Safariのみ対応（非対応環境ではボタン自体を出さない）
if (navigator.share) {
  shareDetailBtn.hidden = false;
  shareDetailBtn.addEventListener('click', async () => {
    try {
      await navigator.share({ title: detailTitleEl.textContent, text: detailTextEl.textContent || '' });
    } catch { /* ユーザーがキャンセルした場合も来るので無視 */ }
  });
}

// 保存済みの文字サイズを取得する（無ければ既定値）
function loadFontSize() {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY_FONT_SIZE));
    if (FONT_SIZES.includes(saved)) return saved;
  } catch { /* 無視 */ }
  return DEFAULT_FONT_SIZE;
}

// 文字サイズを表示エリア（メイン・詳細の両方）に反映し、ラベル表示とlocalStorage保存を行う
function applyFontSize(px) {
  transcriptEl.style.setProperty('--font-size', px + 'px');
  detailTextEl.style.setProperty('--font-size', px + 'px');
  fontSizeLabel.textContent = px + 'px';
  try {
    localStorage.setItem(STORAGE_KEY_FONT_SIZE, String(px));
  } catch { /* 無視 */ }
}

let currentFontSize = loadFontSize();
applyFontSize(currentFontSize);

fontSmallerBtn.addEventListener('click', () => {
  const idx = FONT_SIZES.indexOf(currentFontSize);
  if (idx <= 0) return;
  currentFontSize = FONT_SIZES[idx - 1];
  applyFontSize(currentFontSize);
});

fontLargerBtn.addEventListener('click', () => {
  const idx = FONT_SIZES.indexOf(currentFontSize);
  if (idx === -1 || idx >= FONT_SIZES.length - 1) return;
  currentFontSize = FONT_SIZES[idx + 1];
  applyFontSize(currentFontSize);
});

initScreen();
