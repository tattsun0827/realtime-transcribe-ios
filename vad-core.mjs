// VAD（無音検出）とテキスト整形の純粋関数群。
// ブラウザ（type=module）とNode（テスト）の両方からimportして同じロジックを使う。
// 定数はACS（resources/app/renderer/app.js の非ハイブリッド下書きトラック）と同値。

export const SILENCE_RMS = 0.015; // この音量未満を無音とみなす
export const SILENCE_HOLD_MS = 500; // 無音がこの時間続いたら区切る
export const MIN_DRAFT_MS = 4000; // これより短い時点では無音検出しても切らない
export const MAX_DRAFT_MS = 15000; // 無音が来なくても強制的に区切る上限
export const MAX_DRAFT_QUEUE = 3; // 処理待ちキューの上限（超えたら古い方を破棄）

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
