// Googleドライブへの保存（通信を伴う部分）。純粋な組み立ては drive-core.mjs にある。
//
// サーバーを持たない静的ページなので、Googleの「トークンクライアント」方式を使う。
// 本人がその場でログイン・許可し、返ってきたアクセストークンでドライブAPIを直接叩く。
// トークンはメモリにだけ置く（localStorageへ保存しない。端末を触れる人に持ち出されないため）。

import {
  DRIVE_FOLDER_NAME,
  DRIVE_SCOPE,
  FOLDER_MIME,
  buildFolderQuery,
  buildMultipartBody,
  describeDriveError,
} from './drive-core.mjs';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const FILES_API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';

let gisPromise = null;
let tokenClient = null;
let tokenClientId = null;
let cachedToken = null; // { token, expiresAt }
let cachedFolderId = null;

// Googleのスクリプトを1回だけ読み込む。読めない（回線が無い・ブロックされた）場合は分かる文言で止める
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = GIS_SRC;
    el.async = true;
    el.onload = () => (window.google?.accounts?.oauth2 ? resolve() : reject(new Error('Googleのログイン機能を読み込めませんでした')));
    el.onerror = () => {
      gisPromise = null; // 次回押したときに読み直せるようにする
      reject(new Error('Googleへ接続できませんでした。通信状況をご確認ください。'));
    };
    document.head.appendChild(el);
  });
  return gisPromise;
}

// アクセストークンを得る。有効なものが残っていれば使い回す（毎回ログイン画面が出るのを避ける）
async function getAccessToken(clientId) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  await loadGis();
  if (!tokenClient || tokenClientId !== clientId) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: () => {}, // 実際の受け取りは requestAccessToken 呼び出しごとに差し替える
    });
    tokenClientId = clientId;
  }
  return new Promise((resolve, reject) => {
    tokenClient.callback = (res) => {
      if (res.error) {
        reject(new Error(res.error === 'access_denied' ? 'Googleの許可が得られませんでした。' : `Googleのログインに失敗しました（${res.error}）`));
        return;
      }
      cachedToken = { token: res.access_token, expiresAt: Date.now() + Number(res.expires_in || 3600) * 1000 };
      resolve(res.access_token);
    };
    tokenClient.error_callback = (err) => {
      // ポップアップが閉じられた・ブロックされた場合もここに来る
      const type = err?.type || '';
      if (type === 'popup_closed') reject(new Error('Googleのログイン画面が閉じられました。'));
      else if (type === 'popup_failed_to_open') reject(new Error('Googleのログイン画面を開けませんでした。ブラウザのポップアップ設定をご確認ください。'));
      else reject(new Error('Googleのログインを開始できませんでした。'));
    };
    // 許可済みなら画面を出さずに通す。初回だけ同意画面が出る
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

async function driveFetch(url, options, token) {
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    if (res.status === 401) cachedToken = null; // 期限切れなら次回は取り直す
    throw new Error(describeDriveError(res.status, detail));
  }
  return res.json();
}

// 保存先フォルダを探し、無ければ作る。
// drive.file 権限では「このアプリが作ったもの」しか見えないため、
// 本人が手で同名フォルダを作っていてもそれは見つからず、アプリ用のフォルダを別に作る
async function findOrCreateFolder(token, name) {
  if (cachedFolderId) return cachedFolderId;
  const q = encodeURIComponent(buildFolderQuery(name));
  const found = await driveFetch(`${FILES_API}?q=${q}&fields=files(id,name)&spaces=drive&pageSize=1`, { method: 'GET' }, token);
  if (found.files?.length) {
    cachedFolderId = found.files[0].id;
    return cachedFolderId;
  }
  const created = await driveFetch(
    `${FILES_API}?fields=id`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER_MIME }) },
    token
  );
  cachedFolderId = created.id;
  return cachedFolderId;
}

// 会話1件をテキストファイルとしてドライブへ上げる。
// 呼び出し側（app.js）は結果の webViewLink をそのまま案内に使える
export async function saveTextToDrive({ clientId, fileName, text, folderName = DRIVE_FOLDER_NAME, onStatus = () => {} }) {
  onStatus('Googleに接続しています…');
  const token = await getAccessToken(clientId);

  onStatus('保存先フォルダを確認しています…');
  const folderId = await findOrCreateFolder(token, folderName);

  onStatus('保存しています…');
  const boundary = `rt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const body = buildMultipartBody({ name: fileName, parents: [folderId], mimeType: 'text/plain' }, text, boundary);
  const uploaded = await driveFetch(
    `${UPLOAD_API}?uploadType=multipart&fields=id,name,webViewLink`,
    { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body },
    token
  );
  return { id: uploaded.id, name: uploaded.name, link: uploaded.webViewLink, folderName };
}

// 「別のアカウントで入り直したい」「もう繋がなくてよい」ときの後始末。
// トークンをGoogle側でも失効させ、こちら側の記憶も消す
export function disconnectDrive() {
  const token = cachedToken?.token;
  cachedToken = null;
  cachedFolderId = null;
  if (token && window.google?.accounts?.oauth2) {
    try { window.google.accounts.oauth2.revoke(token, () => {}); } catch { /* 失効に失敗してもこちらの記憶は消えている */ }
  }
}

// Googleのスクリプトを先に読み込んでおく。
// 保存ボタンを押してから読み込むと、待っている間にiOSが「利用者の操作」と見なさなくなり、
// ログイン画面がポップアップブロックで開けないことがある
export function warmUpDrive() {
  loadGis().catch(() => { /* 通信が無いときは保存を押した時点で改めて案内する */ });
}

// 設定画面の表示用。いま繋がっているかどうかだけを返す
export function isDriveConnected() {
  return Boolean(cachedToken && cachedToken.expiresAt > Date.now());
}
