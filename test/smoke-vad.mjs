#!/usr/bin/env node
// vad-core.mjs の純粋関数を検証するスモークテスト（ブラウザ・マイク不要）。

import assert from 'node:assert/strict';
import {
  SILENCE_RMS,
  shouldStopSegment,
  nextSilenceStartedAt,
  normalizeTranscript,
} from '../vad-core.mjs';

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

test('無音継続がSILENCE_HOLD_MS未満なら区切らない', () => {
  const r = shouldStopSegment({ rms: 0, silenceStartedAt: 1000, now: 1300, elapsed: 5000 });
  assert.equal(r.stop, false);
});

test('無音継続がSILENCE_HOLD_MSを超えかつMIN_DRAFT_MS経過後なら区切る', () => {
  const r = shouldStopSegment({ rms: 0, silenceStartedAt: 1000, now: 1600, elapsed: 5000 });
  assert.equal(r.stop, true);
  assert.equal(r.reason, 'silence');
});

test('MIN_DRAFT_MS未満なら無音が続いても区切らない', () => {
  const r = shouldStopSegment({ rms: 0, silenceStartedAt: 0, now: 700, elapsed: 3000 });
  assert.equal(r.stop, false);
});

test('MAX_DRAFT_MSを超えたら無音でなくても強制的に区切る', () => {
  const r = shouldStopSegment({ rms: 0.5, silenceStartedAt: null, now: 20000, elapsed: 16000 });
  assert.equal(r.stop, true);
  assert.equal(r.reason, 'max_duration');
});

test('音量がSILENCE_RMS以上なら区切らない', () => {
  const r = shouldStopSegment({ rms: SILENCE_RMS + 0.01, silenceStartedAt: 1000, now: 1600, elapsed: 5000 });
  assert.equal(r.stop, false);
});

test('nextSilenceStartedAt: 無音開始時にnowを起点として確定する', () => {
  const r = nextSilenceStartedAt({ rms: 0, silenceStartedAt: null, now: 1234 });
  assert.equal(r, 1234);
});

test('nextSilenceStartedAt: 無音が続く間は起点を維持する', () => {
  const r = nextSilenceStartedAt({ rms: 0, silenceStartedAt: 1000, now: 1500 });
  assert.equal(r, 1000);
});

test('nextSilenceStartedAt: 音が戻ったらnullにリセットする', () => {
  const r = nextSilenceStartedAt({ rms: 0.5, silenceStartedAt: 1000, now: 1500 });
  assert.equal(r, null);
});

test('normalizeTranscript: 空文字はそのまま空文字', () => {
  assert.equal(normalizeTranscript(''), '');
  assert.equal(normalizeTranscript(null), '');
});

test('normalizeTranscript: 前後の空白を除去する', () => {
  assert.equal(normalizeTranscript('  こんにちは  '), 'こんにちは');
});

test('normalizeTranscript: 連続する句読点を1つに畳む', () => {
  assert.equal(normalizeTranscript('そうですね。。。'), 'そうですね。');
  assert.equal(normalizeTranscript('本当に、、大丈夫？？'), '本当に、大丈夫？');
});

test('normalizeTranscript: 通常の文はそのまま保持する', () => {
  const text = '今日は天気がいいので、散歩に行きました。';
  assert.equal(normalizeTranscript(text), text);
});

if (failures > 0) {
  console.error(`\n${failures}件失敗しました。`);
  process.exit(1);
} else {
  console.log('\n全テスト成功。');
  process.exit(0);
}
