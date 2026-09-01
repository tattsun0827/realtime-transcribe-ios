# HANDOFF — まずこれを読む
最終更新: 2026-09-02

## 読む順序
1. このHANDOFF.md  2. state.json  3. 必要時のみ SESSION_LOG.md

## いま何をしているか（1行）
「毎回キーを聞かれる」を修正し `fix/setup-key-saved` へコミット（b0c6f65）。検査は全通過だが、目視確認もmaster合流もPages反映もまだ。

## 次にやること（Step 1）
`git switch master && git merge fix/setup-key-saved && git push` で公開する。
その前に localhost:5510 で3状態（キー無し=入力欄／キー有り=「保存済み（gsk_…abcd）」／別のキーに変える=入力欄復帰）を目視。
反映後は Pages build を `gh api repos/tattsun0827/realtime-transcribe-ios/pages/builds/latest -q '.status'` で待つ。
本人はiPhone/iPadを**Chrome**で使う。iOS Chromeでの実機確認は未実施（WebKitなので動く見込み・断定はしない）。

## 蒸し返し禁止（前提・再調査しない）
- 運用・改修の正本は `~/.claude/skills/realtime-transcribe-app/SKILL.md`
- VAD定数・並列数3・表示順の担保方法・会話IDをキュー投入時に確定させる設計は変えない
- 本文に「認識中…」は出さない。本文に `max-width` は入れない（SKILL.mdの「720px中央寄せで対処済み」は誤り・修正済み）
- キーはブラウザごとに別保存。Safari/Chrome/localhostで共有されないのは仕様であり不具合ではない
- 「反映されない」はまずPagesのビルド待ち（30〜60秒）とキャッシュ（10分）を疑う

## 応答テンプレ（このまま出す）
状態: キー設定画面の修正は b0c6f65 で枝にコミット済み・master未合流でPages未反映／「録音開始が見えない」は未決着のまま
次: 3状態を目視 → master へ合流して push → Pages反映を待つ
