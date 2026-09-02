# HANDOFF — まずこれを読む
最終更新: 2026-09-02

## 読む順序
1. このHANDOFF.md  2. state.json  3. 必要時のみ SESSION_LOG.md

## いま何をしているか（1行）
UIの日本語化とGoogleドライブ保存を master へ合流し、公開版（GitHub Pages）へ反映済み。前セッションからの公開保留は解除された。

## 次にやること（Step 1）
ドライブ保存を実データで1本通す。本人が Google Cloud で OAuth クライアントID（種類はウェブアプリケーション／承認済みJavaScript生成元に `https://tattsun0827.github.io` と `http://localhost:5510`／OAuth同意画面のテストユーザーに本人アカウント）を作り、アプリの 設定 →「Googleドライブ保存」へ貼る。
その後 iPhone で録音 →「☁ Googleドライブに保存」→ ドライブに「リアルタイム文字起こし」フォルダとテキストができることを確認する。
提案済み・未回答: 保存形式を .txt から Google ドキュメントへ（アップロード時の mimeType 指定だけ・数行）。合流済みブランチ `feat/ui-labels` の削除可否も未回答。

## 蒸し返し禁止（前提・再調査しない）
- 運用・改修の正本は `~/.claude/skills/realtime-transcribe-app/SKILL.md`。変更したら `node scripts/verify.mjs`
- VAD定数・並列数3・表示順の担保方法・会話IDをキュー投入時に確定させる設計は変えない
- 本文に「認識中…」は出さない。本文に `max-width` は入れない
- ドライブ権限は drive.file から広げない。トークンは localStorage に保存しない
- master へ push ＝ 即公開（Pagesが自動ビルド）。公開版の確認は `?t=<unix時刻>` を付ける
- 本人はiPhone/iPadを Chrome で使う。PCはWindows

## 応答テンプレ（このまま出す）
状態: UI日本語化とドライブ保存を公開版へ反映済み／ドライブへの実書き込みはクライアントID待ちで未実証
次: 本人にクライアントIDを登録してもらい、iPhoneでドライブ保存を1本通す
