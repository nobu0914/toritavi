# CODEX Memory

最終更新: 2026-04-11

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

## 現在の到達点
- `app/src/app/trips/new/page.tsx` はモックにかなり近いが、ユーザーは「まったく同じUI」を求めている
- 次回はまず `trips/new` の実画面とモックスクリーンショット差分を再確認する
- 差分詰め対象は、余白、ラベル位置、ボタン寸法、線色、バッジ余白、未登録ステップカードの密度
- `trips/[id]` もタイムラインには戻したが、まだモック完全一致までは未確認

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
- 必要に応じて `CLAUDE.md`、`app/CLAUDE.md`、`app/AGENTS.md` も確認する
- 読み込み後は、把握した前提と現在の未完了事項を短く要約してから作業を再開する
