#!/usr/bin/env node
// settings-core.mjs の純粋関数を検証するスモークテスト（ブラウザ・マイク不要）。

import assert from 'node:assert/strict';
import {
  isValidApiKeyFormat,
  maskApiKey,
  savedKeyStatus,
  selectableMicDevices,
  micOptionLabel,
  resolveMicDeviceId,
  audioConstraints,
  waveBarHeight,
  typingChunkSize,
} from '../settings-core.mjs';

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

test('gsk_ で始まる十分な長さのキーは受け付ける', () => {
  assert.equal(isValidApiKeyFormat('gsk_abcdefghijklmn'), true);
});

test('前後の空白は無視して判定する（コピペで混入しやすい）', () => {
  assert.equal(isValidApiKeyFormat('  gsk_abcdefghijklmn  '), true);
});

test('接頭辞が違うキーは拒否する', () => {
  assert.equal(isValidApiKeyFormat('sk-abcdefghijklmn'), false);
});

test('短すぎる文字列と空値は拒否する', () => {
  assert.equal(isValidApiKeyFormat('gsk_'), false);
  assert.equal(isValidApiKeyFormat(''), false);
  assert.equal(isValidApiKeyFormat(null), false);
});

test('伏せ字は先頭4文字と末尾4文字だけを残す', () => {
  assert.equal(maskApiKey('gsk_1234567890abcd'), 'gsk_…abcd');
});

test('未設定なら伏せ字も空文字を返す', () => {
  assert.equal(maskApiKey(''), '');
  assert.equal(maskApiKey(null), '');
});

test('短い値でも全体を露出しない', () => {
  assert.equal(maskApiKey('gsk_12'), '****');
});

test('保存済みなら「保存済み」と伏せ字を返し、入力欄は出さない', () => {
  const status = savedKeyStatus('gsk_1234567890abcd');
  assert.equal(status.saved, true);
  assert.equal(status.label, '保存済み（gsk_…abcd）');
});

test('未設定なら未設定と返す', () => {
  for (const empty of ['', null, undefined, '   ']) {
    const status = savedKeyStatus(empty);
    assert.equal(status.saved, false, `${JSON.stringify(empty)} は未設定として扱う`);
    assert.equal(status.label, 'キーは未設定です');
  }
});

test('保存済みの表示にキー全体を含めない', () => {
  const key = 'gsk_1234567890abcd';
  assert.equal(savedKeyStatus(key).label.includes(key), false);
});

const DEVICES = [
  { kind: 'audioinput', deviceId: 'default', label: '既定 - 内蔵マイク' },
  { kind: 'audioinput', deviceId: 'communications', label: '通信用 - 内蔵マイク' },
  { kind: 'audioinput', deviceId: 'aaa', label: '内蔵マイク' },
  { kind: 'audioinput', deviceId: 'bbb', label: '' },
  { kind: 'audiooutput', deviceId: 'ccc', label: 'スピーカー' },
  { kind: 'videoinput', deviceId: 'ddd', label: 'カメラ' },
];

test('選択肢は audioinput のみ、default/communications の重複は除く', () => {
  const got = selectableMicDevices(DEVICES).map((d) => d.deviceId);
  assert.deepEqual(got, ['aaa', 'bbb']);
});

test('デバイス一覧が取れなくても落ちない', () => {
  assert.deepEqual(selectableMicDevices(null), []);
  assert.deepEqual(selectableMicDevices(undefined), []);
});

test('label が空のときは連番で表示する（許可前のiOSがこうなる）', () => {
  assert.equal(micOptionLabel({ label: '' }, 1), 'マイク 2');
  assert.equal(micOptionLabel({ label: '内蔵マイク' }, 0), '内蔵マイク');
});

test('保存済みIDが今も繋がっていればそのまま使う', () => {
  assert.equal(resolveMicDeviceId('aaa', DEVICES), 'aaa');
});

test('外されたマイクのIDは既定へ落とす（exact指定の失敗を防ぐ）', () => {
  assert.equal(resolveMicDeviceId('zzz', DEVICES), '');
  assert.equal(resolveMicDeviceId('', DEVICES), '');
});

test('deviceId 未指定なら制約に deviceId を含めない', () => {
  const c = audioConstraints('');
  assert.equal('deviceId' in c.audio, false);
  assert.equal(c.audio.noiseSuppression, true);
  assert.equal(c.audio.channelCount, 1);
});

test('deviceId 指定時は exact で固定する', () => {
  assert.deepEqual(audioConstraints('aaa').audio.deviceId, { exact: 'aaa' });
});

test('波形の高さは無音でも最小1本分を残す', () => {
  assert.equal(waveBarHeight(0, 36, 1), 1);
  assert.equal(waveBarHeight(-1, 36, 1), 1);
});

test('波形の高さは大音量でも枠内に収まる', () => {
  const h = waveBarHeight(5, 36, 1);
  assert.ok(h <= 36, `${h} が枠(36)を超えています`);
  assert.equal(h, 34);
});

test('波形の高さは音量に比例して伸びる', () => {
  assert.ok(waveBarHeight(0.02, 36, 1) < waveBarHeight(0.08, 36, 1));
});

test('短い文はゆっくり（1文字ずつ）流す', () => {
  assert.equal(typingChunkSize(10, 1000, 33), 1);
});

test('長文でも決めた時間内に出し切る（流れ続けない）', () => {
  const chunk = typingChunkSize(600, 1000, 33);
  const frames = Math.ceil(600 / chunk);
  assert.ok(frames * 33 <= 1000 + 33, `${frames * 33}ms かかっています`);
});

test('空文字では流す文字が無い', () => {
  assert.equal(typingChunkSize(0, 1000, 33), 0);
  assert.equal(typingChunkSize(-5, 1000, 33), 0);
});

if (failures > 0) {
  console.error(`\n${failures}件失敗しました`);
  process.exit(1);
}
console.log('\nsmoke-settings: 全件通過');
