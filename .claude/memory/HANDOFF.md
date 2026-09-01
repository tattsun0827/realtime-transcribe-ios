# HANDOFF — まずこれを読む
最終更新: 2026-09-02

## 読む順序
1. このHANDOFF.md  2. state.json  3. 必要時のみ SESSION_LOG.md

## いま何をしているか（1行）
キー設定画面の修正を master へローカル合流済み。**公開は本人が保留**（UIが未完成・いまいちとの判断）。master は push していない。

## 次にやること（Step 1）
UIのどこが「いまいち」なのかを本人から具体的に聞く（どの画面・何が不満か）。ここが未確認のまま作り込まない。
そのうえでUIを直し、本人の合意が取れてから初めて `git push origin master` で公開する。
**master への push ＝ 即公開**（Pagesが自動ビルド）。UI未完成のうちは絶対に push しない。

## 蒸し返し禁止（前提・再調査しない）
- 運用・改修の正本は `~/.claude/skills/realtime-transcribe-app/SKILL.md`
- VAD定数・並列数3・表示順の担保方法・会話IDをキュー投入時に確定させる設計は変えない
- 本文に「認識中…」は出さない。本文に `max-width` は入れない
- キーはブラウザごとに別保存。Safari/Chrome/localhostで共有されないのは仕様
- 「毎回キーを聞かれる」の原因は解明済み（#setup-screen に hidden が無く module 遅延実行までの間に描画されていた）。再調査しない
- 本人はiPhone/iPadを**Chrome**で使う。PCはWindows

## 応答テンプレ（このまま出す）
状態: キー設定画面の修正はmasterへローカル合流済み・公開は本人保留（UIが未完成）／master未push
次: UIのどこが不満かを聞き取り、直してから公開の可否を確認する
