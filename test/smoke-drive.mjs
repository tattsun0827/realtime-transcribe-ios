#!/usr/bin/env node
// drive-core.mjs の純粋関数を検証するスモークテスト（ブラウザ・Google接続不要）。
// ここで守りたいのは「壊れたファイル名・壊れたクエリ・壊れた本文をGoogleへ送らない」こと。

import assert from 'node:assert/strict';
import {
  DRIVE_FOLDER_NAME,
  DRIVE_SCOPE,
  FOLDER_MIME,
  isValidClientId,
  sanitizeFileNamePart,
  buildFileName,
  buildFolderQuery,
  buildMultipartBody,
  describeDriveError,
  buildSavePreview,
} from '../drive-core.mjs';

let failures = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`[OK] ${name}`);
  } catch (err) {
    failures++;
    console.error(`[FAIL] ${name}: ${err.message}`);
  }
}

test('権限は drive.file に限定している（全ファイルを要求しない）', () => {
  assert.equal(DRIVE_SCOPE, 'https://www.googleapis.com/auth/drive.file');
});

test('正しい形のクライアントIDを受け付ける', () => {
  assert.equal(isValidClientId('123456789012-abcDEF_ghi.apps.googleusercontent.com'), true);
});

test('形の違うクライアントIDは弾く', () => {
  assert.equal(isValidClientId('gsk_abcdefghijklmn'), false);
  assert.equal(isValidClientId('123456789012-abc.example.com'), false);
  assert.equal(isValidClientId(''), false);
  assert.equal(isValidClientId(null), false);
});

test('前後の空白があっても受け付ける（貼り付けで混ざりやすい）', () => {
  assert.equal(isValidClientId('  123-abc.apps.googleusercontent.com  '), true);
});

test('ファイル名に使えない文字を落とす', () => {
  assert.equal(sanitizeFileNamePart('打合せ/A:B*C?D"E<F>G|H'), '打合せABCDEFGH');
});

test('改行やタブはファイル名に持ち込まない', () => {
  assert.equal(sanitizeFileNamePart('前半\n後半\t続き'), '前半 後半 続き');
});

test('長すぎるタイトルは切り詰める', () => {
  assert.equal(sanitizeFileNamePart('あ'.repeat(80)).length, 40);
});

test('ファイル名は日時で始まる（名前順で時系列に並ぶ）', () => {
  const t = new Date(2026, 8, 2, 14, 30).getTime();
  assert.equal(buildFileName('打合せメモ', t), '2026-09-02_1430_打合せメモ.txt');
});

test('タイトルが空でもファイル名になる', () => {
  const t = new Date(2026, 8, 2, 9, 5).getTime();
  assert.equal(buildFileName('', t), '2026-09-02_0905_文字起こし.txt');
});

test('タイトルが記号だけでもファイル名になる', () => {
  const t = new Date(2026, 8, 2, 9, 5).getTime();
  assert.equal(buildFileName('///', t), '2026-09-02_0905_文字起こし.txt');
});

test('フォルダ検索のクエリはフォルダ種別と未削除で絞る', () => {
  const q = buildFolderQuery(DRIVE_FOLDER_NAME);
  assert.ok(q.includes(`mimeType='${FOLDER_MIME}'`));
  assert.ok(q.includes('trashed=false'));
  assert.ok(q.includes(`name='${DRIVE_FOLDER_NAME}'`));
});

test("フォルダ名の ' はクエリを壊さないよう逃がす", () => {
  assert.ok(buildFolderQuery("it's").startsWith("name='it\\'s'"));
});

test('multipart本文はメタデータと本文を区切り文字で挟む', () => {
  const body = buildMultipartBody({ name: 'a.txt' }, 'ほんぶん', 'BOUND');
  assert.ok(body.startsWith('--BOUND\r\n'));
  assert.ok(body.includes('{"name":"a.txt"}'));
  assert.ok(body.includes('Content-Type: text/plain; charset=UTF-8'));
  assert.ok(body.includes('ほんぶん'));
  assert.ok(body.trimEnd().endsWith('--BOUND--'));
});

test('本文に区切り文字が混ざる場合は送らずに止める', () => {
  assert.throws(() => buildMultipartBody({ name: 'a.txt' }, 'これは BOUND を含む', 'BOUND'));
});

test('区切り文字が空なら止める', () => {
  assert.throws(() => buildMultipartBody({ name: 'a.txt' }, 'x', ''));
});

test('401は「ログインし直す」と伝える', () => {
  assert.match(describeDriveError(401), /ログイン/);
});

test('429と503は「待つ」と伝える', () => {
  assert.match(describeDriveError(429), /待って/);
  assert.match(describeDriveError(503), /待って/);
});

test('403の回数超過は、権限不足と区別して伝える', () => {
  assert.match(describeDriveError(403, '{"reason":"userRateLimitExceeded"}'), /多すぎます/);
  assert.match(describeDriveError(403, '{"reason":"insufficientPermissions"}'), /許可されていません/);
});

test('確認文には保存先・ファイル名・文字数が入る', () => {
  const line = buildSavePreview({ folderName: DRIVE_FOLDER_NAME, fileName: 'a.txt', charCount: 120 });
  assert.ok(line.includes(DRIVE_FOLDER_NAME));
  assert.ok(line.includes('a.txt'));
  assert.ok(line.includes('120'));
});

console.log('');
if (failures > 0) {
  console.error(`${failures}件失敗しました`);
  process.exit(1);
}
console.log('すべて通過しました');
