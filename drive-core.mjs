// Googleドライブ保存の純粋関数群。ネットワークとブラウザAPIには触れない。
// 通信を伴う処理は drive.mjs 側にあり、ここはNodeのテストから直接検証できる部分だけを置く。

// 保存先フォルダの名前。ドライブのマイドライブ直下にこの名前で作る
export const DRIVE_FOLDER_NAME = 'リアルタイム文字起こし';

// 権限は drive.file（このアプリが作ったファイルだけを読み書きできる）に限定する。
// drive（全ファイル）を要求すると、本人の全資料へ触れる許可を求めることになるため使わない
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const FOLDER_MIME = 'application/vnd.google-apps.folder';

// GoogleのクライアントIDは「数字-英数字.apps.googleusercontent.com」の形。
// 秘密の値ではない（Webアプリでは公開される前提の識別子）ので、そのまま端末に保存してよい
export function isValidClientId(id) {
  return /^\d+-[A-Za-z0-9_.-]+\.apps\.googleusercontent\.com$/.test((id || '').trim());
}

// ファイル名に使えない文字を落とす。Windowsで開けなくなるのを避けるため、
// ドライブ側では通る文字（: * ? " < > |）もまとめて外す。
// 改行などの制御文字も、名前に混ざると一覧の見た目が壊れるので外す
export function sanitizeFileNamePart(text, maxChars = 40) {
  const cleaned = [...(text || '')]
    // 改行などの制御文字は名前に持ち込めない。消すと単語がくっつくので空白に置き換える
    .map((ch) => (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f ? ' ' : ch))
    .join('')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.length > maxChars ? cleaned.slice(0, maxChars) : cleaned;
}

const pad = (n) => String(n).padStart(2, '0');

// 「2026-09-02_1430_タイトル.txt」の形にする。
// 先頭を日時にするのは、ドライブの一覧が名前順でも時系列に並ぶようにするため
export function buildFileName(title, epochMs) {
  const d = new Date(epochMs);
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  const safe = sanitizeFileNamePart(title);
  return safe ? `${stamp}_${safe}.txt` : `${stamp}_文字起こし.txt`;
}

// フォルダ検索のクエリ。名前に ' や \ が入るとクエリが壊れるので逃がす
export function buildFolderQuery(name) {
  const escaped = String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `name='${escaped}' and mimeType='${FOLDER_MIME}' and trashed=false`;
}

// multipart/related のリクエスト本文を組み立てる（メタデータ＋本文を1回で送る形式）
export function buildMultipartBody(metadata, content, boundary) {
  if (!boundary) throw new Error('boundary が空です');
  // 本文の中に区切り文字列が現れると、そこでファイルが切れて壊れる
  if (String(content).includes(boundary) || JSON.stringify(metadata).includes(boundary)) {
    throw new Error('本文に区切り文字列が含まれています');
  }
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    String(content),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

// APIの失敗を、本人が次に何をすればよいか分かる日本語にする。
// 「エラーが起きました」だけだと、設定を直せばよいのか待てばよいのか判断できない
export function describeDriveError(status, detail = '') {
  if (status === 401) return 'Googleの許可が切れました。もう一度「保存する」を押してログインし直してください。';
  if (status === 403 && /rateLimit|userRateLimit|quota/i.test(detail)) {
    return 'Googleへの保存が短時間に多すぎます。少し待ってからもう一度お試しください。';
  }
  if (status === 403) return 'Googleドライブへの書き込みが許可されていません。設定でクライアントIDと許可した範囲をご確認ください。';
  if (status === 404) return '保存先のフォルダが見つかりませんでした。もう一度「保存する」を押すと作り直します。';
  if (status === 429) return 'Googleへの要求が多すぎます。少し待ってからもう一度お試しください。';
  if (status >= 500) return 'Google側が一時的に応答していません。少し待ってからもう一度お試しください。';
  return `保存できませんでした（${status}）${detail ? `: ${detail.slice(0, 120)}` : ''}`;
}

// 保存前の確認に出す1行。何が・どこへ増えるのかを、押す前に見せる
export function buildSavePreview({ folderName, fileName, charCount }) {
  return `${folderName} フォルダに「${fileName}」（${charCount}文字）を保存します`;
}
