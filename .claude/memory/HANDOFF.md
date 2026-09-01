# HANDOFF — 次セッションへの明確な指示

最終更新: 2026-09-01
プロジェクト: realtime-transcribe-ios

## 引き継ぎ時に読むファイルの順序
HANDOFF.md → state.json → 設計図/2026-09-01_realtime-transcribe-ios.md

## いま何をしているか（1行）
blueprint-proで設計図を確定・GitHub private repoへpush済み。実装はStep0（初期化）完了直後、Step1未着手。

## 次にやること（Step 1: walking skeleton）
- やること: index.html/app.js/style.css の最小構成を作る。getUserMedia→MediaRecorder(audio/mp4)→Groq /audio/transcriptions（whisper-large-v3, language=ja）→結果表示
- 想定リスク: (1)GroqのCORSがブラウザ直叩きを許すか未検証 (2)iOS Safariのaudio/mp4チャンクが単体デコード可能か未検証（設計図の最大リスク仮定1・2）
- 完了判定: iPhone実機Safariで録音→日本語テキスト表示。加えて node test/smoke-groq.mjs が緑

## このセッションで記録した実物（参照）
- 設計図/2026-09-01_realtime-transcribe-ios.md: 全Step詳細・技術選定・NFR・地雷リスト
- .gitignore: .env系除外済み
- GitHub: https://github.com/tattsun0827/realtime-transcribe-ios（private）

## ユーザーの好み（重要なら抜粋）
- 散文・敬体・アスタリスク強調なし・無駄な承認要求を嫌う
- 詳細: `~/.claude/memory/USER_PROFILE.md`

## 緊急ロールバック方法
- `git log --oneline` で履歴 → `git checkout <hash> -- <path>` で復元
