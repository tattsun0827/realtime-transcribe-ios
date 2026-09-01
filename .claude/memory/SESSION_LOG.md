# SESSION_LOG — 過去の経緯（新しい順）

## 2026-09-01 セッション1: 設計から Step4 完了・スキル化まで

ACS の引き継ぎで開始したが、別件として iPhone/iPad 向けリアルタイム文字起こし Web アプリの
新規開発を依頼され、このプロジェクトを起こした。

やったこと:
- blueprint-pro で設計図を作成（`設計図/2026-09-01_realtime-transcribe-ios.md`）。公開範囲=自分用、
  サーバー無しの静的PWA＋Groq直叩き構成に決定。GitHub public リポジトリ＋Pages で公開
- Step0 memory-init / Step1 walking skeleton（録音→Groq→表示）/ Step2 VAD リアルタイム化 /
  Step3 文字サイズ・Wake Lock・レベルメーター / Step4 会話の逐次自動保存（IndexedDB）
- ACS の `resources/app/renderer/app.js`（recordDraftSegment / watch / processDraftQueue）を移植元とし、
  VAD 定数はそのまま採用
- 高性能化: 無音セグメントを送らない音声区間ゲート、temperature=0、幻聴・重複フィルタ、
  Groq への最大3並列送信（順序は先行挿入したプレースホルダーで担保）、noiseSuppression 等の明示有効化
- 検査スクリプト `scripts/verify.mjs`（7項目）と `~/.claude/skills/realtime-transcribe-app/` を作成

このセッションで直したバグ（同じ種類が繰り返された）:
- index.html にボタンを置いたのに app.js のイベント登録を忘れる事故が3回（⚙設定・☰会話一覧・A−/A＋文字サイズ）。
  いずれもテストは通り画面にも出るが押しても無反応。verify.mjs の検査1はこれを潰すために作った
- `.screen { display:flex }` が `[hidden]` と詳細度同点で後勝ちし、全画面が重なって表示された
- Step1 は録音停止時に1回だけ送る実装で「停止しないと文字が出ない」と指摘され、Step2 の VAD 方式へ作り直した

未実施:
- Step5（PWA化: manifest.json・アイコン・Service Worker）
- iPhone 実機での保存機能・高性能化まわりの確認（Step1/2 の基本動作はユーザーのスクリーンショットで確認済み）
