#!/usr/bin/env node
// db.mjs の純粋関数（ID生成・タイトル生成）を検証するスモークテスト（IndexedDB不要）。

import assert from 'node:assert/strict';
import { generateId, deriveTitle, formatFallbackTitle, displayTitle } from '../db.mjs';

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

test('generateId: conv-で始まりtimestampを含む', () => {
  const id = generateId(1735689600000, 0.123456);
  assert.ok(id.startsWith('conv-1735689600000-'));
});

test('generateId: 乱数部が異なれば別IDになる', () => {
  const a = generateId(1000, 0.1);
  const b = generateId(1000, 0.9);
  assert.notEqual(a, b);
});

test('deriveTitle: 空文字・nullはnullを返す', () => {
  assert.equal(deriveTitle(''), null);
  assert.equal(deriveTitle(null), null);
  assert.equal(deriveTitle('   '), null);
});

test('deriveTitle: 上限以下の文はそのまま', () => {
  assert.equal(deriveTitle('こんにちは'), 'こんにちは');
});

test('deriveTitle: 上限を超えたら省略記号付きで切る', () => {
  const text = 'あ'.repeat(30);
  const title = deriveTitle(text, 20);
  assert.equal(title, 'あ'.repeat(20) + '…');
});

test('deriveTitle: 前後の空白を除いてから判定する', () => {
  assert.equal(deriveTitle('  こんにちは  '), 'こんにちは');
});

test('formatFallbackTitle: YYYY/MM/DD HH:MM形式になる', () => {
  const d = new Date(2026, 8, 1, 9, 5); // 2026-09-01 09:05（ローカル時刻で構築）
  const result = formatFallbackTitle(d.getTime());
  assert.equal(result, '2026/09/01 09:05');
});

test('displayTitle: titleがあればそれを使う', () => {
  const conv = { title: 'こんにちは', createdAt: Date.now() };
  assert.equal(displayTitle(conv), 'こんにちは');
});

test('displayTitle: titleが空なら日時にフォールバックする', () => {
  const d = new Date(2026, 8, 1, 9, 5);
  const conv = { title: '', createdAt: d.getTime() };
  assert.equal(displayTitle(conv), '2026/09/01 09:05');
});

if (failures > 0) {
  console.error(`\n${failures}件失敗しました。`);
  process.exit(1);
} else {
  console.log('\n全テスト成功。');
  process.exit(0);
}
