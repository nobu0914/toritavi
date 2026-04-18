# CODEX Memory

最終更新: 2026-04-18

## 目的
このファイルは、Codex がこのリポジトリで継続作業するための簡易メモリです。
会話ログそのものではなく、作業継続に必要な前提・確認結果・運用上の注意を残します。

## 現在の主要な引き継ぎ元
- プロジェクトの実質的な引き継ぎ情報は `HANDOVER.md` にある
- `CLAUDE.md` はほぼ未記入
- `app/CLAUDE.md` は `app/AGENTS.md` 参照のみ
- `app/AGENTS.md` には「Next.js のこの版は従来と違うため、必要に応じて `node_modules/next/dist/docs/` を読むこと」とある

## この会話で確認した事実
- ローカル開発サーバーの閲覧 URL は `http://localhost:3000`
- `Journey` データはファイルではなくブラウザの `localStorage` に保存される
- 保存キーは `toritavi_journeys`
- トップ初回表示時、`toritavi_journeys` が空ならサンプル Journey を自動投入する
- 新規作成用の下書きは `toritavi_journey_draft` に保存する
- `Alerts` と `Account` は静的モックデータ中心
- 画面修正では必ず先に `mock/design-system-mantine.html` を参照する
- デザインシステムやモックにある UI を優先し、独自 UI を勝手に作らない
- 本番独自ドメインは `https://toritavi.com/`
- `toritavi.com` は `Vercel` 配信の `Next.js` アプリで、ルート `/` は `/login` へリダイレクトされる
- 認証関連の公開導線として `/login`、`/signup`、`/forgot-password` が存在する
- `security.txt` は `/.well-known/security.txt`、`robots.txt` は `/robots.txt` で公開されている
- `Google` ログインは現時点では実フロー未実装で、ボタンは disabled 想定
- OCR は `/api/ocr` 経由で server-side の Claude API プロキシを使う構成

## 今回の作業記録
- ユーザー指示 `会話・作業の履歴を確認して` に従い、`CODEX_MEMORY.md` と `HANDOVER.md` を読み、現状を整理した
- 優先課題として「日付入力」「Journey 編集 UI」「下書き保存」を整理した
- `app/src/lib/store.ts` に新規作成下書き保存 API を追加した
- `app/src/app/trips/[id]/page.tsx` に Journey 編集モーダルを追加した
- トップページの見え方確認用に、空の `localStorage` へサンプル Journey 3 件を投入する処理を追加した
- ユーザーから「UIが違う」「タイムライン表示だった」「design-system-mantine.html を参照して」と修正依頼あり
- `mock/index.html` と `mock/design-system-mantine.html` を再参照し、`trips/new` と `trips/[id]` の UI をモック準拠へ戻す方向で修正した
- `trips/new` は `mock/index.html` の `s-new` をかなり直接的に React 化した
- `trips/[id]` はタイムライン表示へ戻し、編集モーダルも素の Mantine 見えから外してフォーム風に寄せた
- 2026-04-17〜2026-04-18 の会話では、認証機能の指示整理を行った
- 会員登録、ログイン、Google認証、メール認証、パスワード再設定、テストモードを含む開発指示書を作成した
- `toritavi.com` に対する非破壊の公開面セキュリティチェック計画を作成した
- `toritavi.com` の初期公開面テストを実施し、セキュリティヘッダー不足、`access-control-allow-origin: *` の露出、`robots.txt` / `security.txt` 未整備を指摘した
- ユーザーからの修正報告を受けて再テストし、CSP など主要ヘッダー追加、`security.txt` / `robots.txt` 公開、`/api/ocr` の cross-origin POST 403 を確認した
- 続く再テストで、公開面の `access-control-allow-origin: *` が `https://toritavi.com` 固定値に置き換わったことを確認した
- ただし `Vary: Origin` は `/robots.txt`、`/.well-known/security.txt`、`/` の 307 応答では確認できた一方、`/login`、`/signup`、`/forgot-password` の HTML 応答では確認できなかった
- セキュリティ再テスト結果を Claude Code に渡しやすいコピペ形式で複数回整形した

## 現在の到達点
- `app/src/app/trips/new/page.tsx` はモックにかなり近いが、ユーザーは「まったく同じUI」を求めている
- 次回はまず `trips/new` の実画面とモックスクリーンショット差分を再確認する
- 差分詰め対象は、余白、ラベル位置、ボタン寸法、線色、バッジ余白、未登録ステップカードの密度
- `trips/[id]` もタイムラインには戻したが、まだモック完全一致までは未確認
- セキュリティ観点では、公開面の大きな改善は確認済み
- 現時点の残課題は、HTML 応答で `Vary: Origin` を本当に付けたいかの整理、実ブラウザでの認証画面表示確認、preview deployment での CORS 挙動確認
- 認可、RLS、パスワード再設定トークン再利用、メール認証リンク再利用、ゲストモードと本会員データ分離は次フェーズの検証対象

## 実データ確認時の制約
- この環境からブラウザの `localStorage` を自動取得しようとしたが失敗した
- Safari は `Allow JavaScript from Apple Events` が無効
- Chrome は `Apple Events からの JavaScript を許可` が無効
- そのため、実データの確認はブラウザ開発者コンソールで行うのが確実

## 実データ確認コマンド
`http://localhost:3000` のブラウザコンソールで以下を実行する:

```js
JSON.parse(localStorage.getItem("toritavi_journeys") ?? "[]")
```

## 現在の重要課題
- 新規作成 `/trips/new` をモックと完全一致まで詰める
- Journey 詳細 `/trips/[id]` をモックと完全一致まで詰める
- 認証画面導線の実装と UI 整備
- 認証後ページの認可テスト（Supabase RLS 含む）
- パスワード再設定 / メール認証トークンの安全性確認
- `Vary: Origin` の HTML 応答での扱い整理
- preview deployment での CORS 確認
- OCR / 撮影 / アップロード / メール取込は未実装
- 下書き保存は実装済みだが UI/運用確認は未完
- Journey 編集 UI は追加済みだがモック完全一致ではない
- ステップ並べ替えは未実装
- TabBar 右端の表示崩れが未解決

## 会話保存方針
- 会話そのものはクライアントの履歴仕様に依存するため、永続性は保証しない
- 継続に必要な内容はこの `CODEX_MEMORY.md` または `HANDOVER.md` に残す

## 再開時の定型指示
- ユーザーが `会話・作業の履歴を確認して` と指示した場合は、まず `CODEX_MEMORY.md` と `HANDOVER.md` を読む
- セキュリティ文脈なら `SESSION_LOG_20260418_SECURITY.md` も読む
- 必要に応じて `CLAUDE.md`、`app/CLAUDE.md`、`app/AGENTS.md` も確認する
- 画面修正に入る前は、必ず `mock/design-system-mantine.html` と必要なモック HTML を再確認する
- 読み込み後は、把握した前提と現在の未完了事項を短く要約してから作業を再開する
