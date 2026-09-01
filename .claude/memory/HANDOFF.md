# HANDOFF — まずこれを読む
最終更新: 2026-09-01

## 読む順序
1. このHANDOFF.md  2. state.json  3. 必要時のみ SESSION_LOG.md

## いま何をしているか（1行）
Step0〜4 完了・GitHub Pages 公開中。残るは Step5（PWA化）のみで、実機での保存機能の確認は未実施。

## 次にやること（Step 1）
ユーザーに iPhone で https://tattsun0827.github.io/realtime-transcribe-ios/?t=<現在のunix時刻> を開いてもらい、
録音→自動保存→☰から一覧・詳細が見えるかを確認する。問題なければ Step5（manifest.json＋アイコン＋Service Worker）へ。
改修前に必ず `node scripts/verify.mjs` を通す（7項目・数秒）。

## 蒸し返し禁止（前提・再調査しない）
- 運用・改修の正本は `~/.claude/skills/realtime-transcribe-app/SKILL.md`。落とし穴と「触ってはいけない箇所」はそこ
- VAD定数・並列数3・表示順の担保方法（先行挿入したプレースホルダー）・会話IDをキュー投入時に確定させる設計は変えない
- iOS は audio/webm 非対応（mp4のみ）／マイクは HTTPS か localhost のみ／背景録音は不可（Wake Lockで代替）
- Groq 無料枠で先に尽きるのは RPD 2000（回数）。無音は送らない
- 「直したのに反映されない」はまずGitHub Pagesのビルド待ち（30〜60秒）とキャッシュ（10分）を疑う
- ネイティブアプリ化（App Store・開発者登録）は不採用

## 応答テンプレ（このまま出す）
状態: Step0〜4完了・Pages公開中／残りはStep5(PWA化)のみ／実機での保存機能の確認が未実施
次: iPhoneで公開URLを開き録音→自動保存→一覧表示を確認 → 問題なければStep5へ（改修前に node scripts/verify.mjs）
