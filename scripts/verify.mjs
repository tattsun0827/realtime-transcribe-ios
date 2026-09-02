#!/usr/bin/env node
// このアプリで実際に起きた壊れ方を、機械的に検出する検査スクリプト。
//
// なぜ必要か: 開発中、index.html にボタンを置いたのに app.js のイベント登録を忘れる事故が
// 3回連続で起きた（⚙設定・☰会話一覧・A−/A＋文字サイズ）。いずれも「画面には出ているが
// 押しても無反応」という、テストでは落ちずユーザーだけが気づく壊れ方だった。
// 人の目視より安く確実に防げるので、変更のたびにこれを通す。
//
// 使い方: node scripts/verify.mjs

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(join(root, name), 'utf8');

let failures = 0;
let warnings = 0;

function fail(msg, detail) {
  failures++;
  console.error(`[FAIL] ${msg}`);
  if (detail) console.error(`       ${detail}`);
}
function warn(msg) {
  warnings++;
  console.warn(`[WARN] ${msg}`);
}
function ok(msg) {
  console.log(`[OK] ${msg}`);
}

const html = read('index.html');
const js = read('app.js');
const css = read('style.css');

// --- 検査1: HTMLのbuttonに、JS側のクリック処理があるか ---
// 「画面には出ているが押しても無反応」を防ぐ。このアプリで3回起きた事故がこれ。
const buttonIds = [...html.matchAll(/<button[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
const unwired = buttonIds.filter((id) => {
  // 変数へ代入してからリスナーを付ける書き方（const x = getElementById(id); x.addEventListener）と、
  // 直接 addEventListener する書き方の両方を許容する
  const varMatch = js.match(new RegExp(`const\\s+(\\w+)\\s*=\\s*document\\.getElementById\\(['"]${id}['"]\\)`));
  if (varMatch) {
    return !new RegExp(`\\b${varMatch[1]}\\.addEventListener`).test(js);
  }
  return !new RegExp(`getElementById\\(['"]${id}['"]\\)[\\s\\S]{0,80}addEventListener`).test(js);
});
if (unwired.length) {
  fail(
    `クリック処理の無いボタンがあります（画面に出るが押しても無反応になります）: ${unwired.join(', ')}`,
    'app.js に addEventListener を足すか、まだ実装しないなら「未実装」と伝えるハンドラを付けてください'
  );
} else {
  ok(`ボタン${buttonIds.length}個すべてにクリック処理があります`);
}

// --- 検査2: JSが参照するidが、HTMLに実在するか ---
// idのtypoは実行時に null 参照で即クラッシュし、アプリ全体が起動しなくなる
const referencedIds = [...js.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
const missing = [...new Set(referencedIds)].filter((id) => !new RegExp(`\\bid="${id}"`).test(html));
if (missing.length) {
  fail(`app.js が参照する id が index.html にありません: ${missing.join(', ')}`, 'null参照で起動時にクラッシュします');
} else {
  ok(`app.js が参照する id ${new Set(referencedIds).size}個すべてが index.html にあります`);
}

// --- 検査3: hidden属性がCSSに打ち消されていないか ---
// .screen { display:flex } はブラウザ標準の [hidden]{display:none} と詳細度が同点のため、
// 後勝ちで hidden が効かなくなる。実際に全画面が重なって表示される事故が起きた
if (/\.screen\s*\[hidden\][^{]*\{[^}]*display\s*:\s*none/.test(css)) {
  ok('.screen[hidden] の打ち消し対策があります');
} else if (/\.screen\s*\{[^}]*display\s*:\s*(flex|block|grid)/.test(css)) {
  fail(
    '.screen に display 指定があるのに .screen[hidden]{display:none} がありません',
    'hidden属性が効かず、複数の画面が重なって表示されます'
  );
} else {
  ok('画面の表示切り替えに詳細度の衝突はありません');
}

// --- 検査4: ESモジュールとして読み込まれているか ---
// app.js は import を使うため、type="module" が無いと構文エラーで何も動かない
if (/\bimport\s.*\sfrom\s/.test(js) && !/<script[^>]*type="module"[^>]*src="app\.js"/.test(html)) {
  fail('app.js が import を使っていますが、index.html の script に type="module" がありません');
} else {
  ok('script タグの読み込み方式が app.js の記法と一致しています');
}

// --- 検査5: iOS Safari で録音できる形式を選んでいるか ---
// iOS は audio/webm を作れない。候補に audio/mp4 が無いと iPhone では録音自体が失敗する
if (/MediaRecorder/.test(js) && !/audio\/mp4/.test(js)) {
  fail('録音の形式候補に audio/mp4 がありません', 'iOS Safari は webm 非対応のため iPhone で録音できません');
} else {
  ok('iOS Safari 対応の録音形式（audio/mp4）を候補に含んでいます');
}

// --- 検査6: APIキーが混入していないか ---
// このリポジトリは GitHub Pages 公開のため public。実キーが入ると即漏洩する
const secretPattern = /gsk_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}/;
const sourceFiles = ['app.js', 'index.html', 'style.css', 'db.mjs', 'vad-core.mjs', 'settings-core.mjs', 'drive-core.mjs', 'drive.mjs'];
const leaked = sourceFiles.filter((f) => existsSync(join(root, f)) && secretPattern.test(read(f)));
if (leaked.length) {
  fail(`APIキーらしき文字列が含まれています: ${leaked.join(', ')}`, 'このリポジトリは公開されています。直ちに削除してキーを再発行してください');
} else {
  ok('ソースにAPIキーの混入はありません');
}

// --- 検査7: テストが通るか ---
const tests = ['test/smoke-vad.mjs', 'test/smoke-db.mjs', 'test/smoke-settings.mjs', 'test/smoke-drive.mjs'];
for (const t of tests) {
  if (!existsSync(join(root, t))) {
    warn(`${t} が見つかりません`);
    continue;
  }
  try {
    execFileSync('node', [t], { cwd: root, stdio: 'pipe' });
    ok(`${t} 通過`);
  } catch (err) {
    fail(`${t} が失敗しました`, String(err.stdout || err.message).slice(0, 500));
  }
}

console.log('');
if (failures > 0) {
  console.error(`検査結果: ${failures}件の問題があります。修正してからデプロイしてください。`);
  process.exit(1);
}
console.log(`検査結果: 問題なし${warnings ? `（警告${warnings}件）` : ''}。デプロイして大丈夫です。`);
process.exit(0);
