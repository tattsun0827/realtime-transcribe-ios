# HANDOFF — 次セッションへの明確な指示

最終更新: 2026-09-01
プロジェクト: realtime-transcribe-ios

## 引き継ぎ時に読むファイルの順序
HANDOFF.md → state.json → 設計図/2026-09-01_realtime-transcribe-ios.md

## いま何をしているか（1行）
Step1（walking skeleton）実装済み・GitHub Pagesで公開済み。iPhone実機での最終確認待ち。

## 次にやること（ユーザー本人の作業）
- やること: iPhoneのSafariで https://tattsun0827.github.io/realtime-transcribe-ios/ を開き、Groq実APIキーを入力→録音→文字が表示されるか確認
- 想定リスク: (1)GroqのCORSがブラウザ直叩きを許すか未検証 (2)iOS Safariのaudio/mp4チャンクが単体デコード可能か未検証（設計図の最大リスク仮定1・2）。ダメならCloudflare Worker中継へ切替
- 完了したら「Step完了」と発話 → step-completeでタグstep-1-done・Step2着手

## このセッションで記録した実物（参照）
- 設計図/2026-09-01_realtime-transcribe-ios.md: 全Step詳細・技術選定・NFR・地雷リスト
- index.html/app.js/style.css/test/smoke-groq.mjs: Step1実装一式
- GitHub: https://github.com/tattsun0827/realtime-transcribe-ios（public・Pages公開中）
- 公開URL: https://tattsun0827.github.io/realtime-transcribe-ios/
- 発見・修正済みバグ: `.screen[hidden]`未定義でCSS特異性衝突により2画面が重なる不具合（style.cssで対処済み）

## ユーザーの好み（重要なら抜粋）
- 散文・敬体・アスタリスク強調なし・無駄な承認要求を嫌う
- 詳細: `~/.claude/memory/USER_PROFILE.md`

## 緊急ロールバック方法
- `git log --oneline` で履歴 → `git checkout <hash> -- <path>` で復元
