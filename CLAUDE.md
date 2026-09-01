# realtime-transcribe-ios

iPhone/iPad向けリアルタイム文字起こしPWA。Groq API（whisper-large-v3）で文字起こしする。
サーバー無し・npm依存ゼロ・APIキーは利用者の端末（localStorage）にのみ置く。

公開URL: https://tattsun0827.github.io/realtime-transcribe-ios/

## 変更したら必ず実行する

```bash
node scripts/verify.mjs
```

7項目を数秒で検査する。落ちたまま push しない。
特に「ボタンを置いたのにイベント登録を忘れる」事故が3回起きているため、その検出が主目的。

## 構成

| ファイル | 役割 |
|---|---|
| `index.html` | 4画面のマークアップ（キー設定・メイン・会話一覧・会話詳細） |
| `app.js` | 録音・VAD・Groq送信・画面遷移（ESモジュール） |
| `vad-core.mjs` | 無音判定・整形・幻聴フィルタ（純粋関数のみ） |
| `db.mjs` | IndexedDB読み書き＋ID/タイトル生成 |
| `test/smoke-vad.mjs` | VAD・整形の検証（19件） |
| `test/smoke-db.mjs` | 保存まわりの純粋関数の検証（9件） |
| `scripts/verify.mjs` | 上記の検査 |

## ローカルで起動

```bash
npx --yes serve -l 5510 .
```

`http://localhost:5510/` で開く。localhost はセキュアコンテキスト扱いなのでマイクが使える。

## よくあるエラーと対処法

| 症状 | 原因と対処 |
|---|---|
| ボタンを押しても無反応 | `app.js` のイベント登録漏れ。`node scripts/verify.mjs` が検出する |
| 画面が重なって表示される | `.screen[hidden] { display: none }` が消えている（CSS詳細度の衝突） |
| iPhoneで録音できない | HTTPSでないか、録音形式に `audio/mp4` が無い。iOSはwebm非対応 |
| 言っていない文が出る | Whisperの幻聴。無音ゲート・temperature=0・`isHallucination()` で対策済み |
| 直したのに反映されない | GitHub Pagesのビルド待ち（30〜60秒）とキャッシュ（10分）。`?t=<unix時刻>` を付けて開く |
| 同じエラーが延々出る | 401/429は録音ごと止める設計。この分岐を消さない |

詳しい経緯と触ってはいけない箇所は `~/.claude/skills/realtime-transcribe-app/SKILL.md` を参照。
設計の正本は `設計図/2026-09-01_realtime-transcribe-ios.md`。
