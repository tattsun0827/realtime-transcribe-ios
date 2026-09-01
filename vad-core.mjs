// VAD（無音検出）とテキスト整形の純粋関数群。
// ブラウザ（type=module）とNode（テスト）の両方からimportして同じロジックを使う。
// 定数はACS（resources/app/renderer/app.js の非ハイブリッド下書きトラック）と同値。

export const SILENCE_RMS = 0.015; // この音量未満を無音とみなす
export const SILENCE_HOLD_MS = 500; // 無音がこの時間続いたら区切る
export const MIN_DRAFT_MS = 4000; // これより短い時点では無音検出しても切らない
export const MAX_DRAFT_MS = 15000; // 無音が来なくても強制的に区切る上限
export const MAX_DRAFT_QUEUE = 3; // 処理待ちキューの上限（超えたら古い方を破棄）
export const VOICE_PEAK_RMS = 0.03; // セグメント中にこの音量を一度も超えなければ「発話なし」とみなす
export const MAX_PARALLEL_SENDS = 3; // Groqへの同時送信数（順序はDOM上のプレースホルダーが保証する）

// Whisperが無音・雑音に対して生成しがちな定型句。セグメント全体がこれだけなら幻聴とみなして捨てる。
// 部分一致では消さない（本当にこう発話した場合を巻き込まないため、完全一致に近い判定に留める）
const HALLUCINATION_PHRASES = [
  'ご視聴ありがとうございました',
  'ご視聴ありがとうございます',
  'ご覧いただきありがとうございました',
  'チャンネル登録お願いします',
  'チャンネル登録よろしくお願いします',
  '最後までご視聴いただきありがとうございました',
  'おやすみなさい',
  'ありがとうございました',
  'エンディング',
  '字幕',
  '字幕視聴ありがとうございました',
  'Thank you for watching',
  'Thanks for watching',
  'you',
  'Bye',
];

// 現在の音量・無音継続の起点・経過時間から、録音セグメントを区切るべきかを判定する
export function shouldStopSegment({ rms, silenceStartedAt, now, elapsed }) {
  if (elapsed > MAX_DRAFT_MS) return { stop: true, reason: 'max_duration' };
  if (rms < SILENCE_RMS && silenceStartedAt !== null) {
    if (now - silenceStartedAt > SILENCE_HOLD_MS && elapsed > MIN_DRAFT_MS) {
      return { stop: true, reason: 'silence' };
    }
  }
  return { stop: false, reason: null };
}

// 無音継続の起点を更新する（音が戻ればリセット、無音ならその開始時刻を確定する）
export function nextSilenceStartedAt({ rms, silenceStartedAt, now }) {
  if (rms < SILENCE_RMS) {
    return silenceStartedAt === null ? now : silenceStartedAt;
  }
  return null;
}

// Groq応答テキストの軽い整形。意味を変える強い修正（言い換え・要約）はしない。
export function normalizeTranscript(text) {
  if (!text) return '';
  let t = text.trim();
  t = t.replace(/[ 　]{2,}/g, ' '); // 連続する空白を1つに
  t = t.replace(/([。、！？])\1+/g, '$1'); // 連続する同一句読点を1つに
  return t;
}

// セグメント全体がWhisperの定型的な幻聴かどうかを判定する。
// 記号と空白を除いた本体が定型句と完全一致する場合だけ true（部分一致では消さない）
export function isHallucination(text) {
  const core = (text || '').replace(/[\s。、！？!?.,…「」『』]/g, '');
  if (!core) return true;
  return HALLUCINATION_PHRASES.some((p) => core === p.replace(/[\s。、！？!?.,]/g, ''));
}

// 直前の確定テキストと同一（＝同じ音声が二重に認識された）かを判定する。
// 文脈promptを渡す方式では、無音セグメントで直前の文がそのまま返ることがある
export function isDuplicateOfPrevious(text, previousText) {
  if (!text || !previousText) return false;
  const norm = (s) => s.replace(/[\s。、！？!?.,]/g, '');
  return norm(text) === norm(previousText);
}
