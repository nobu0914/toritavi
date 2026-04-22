# セッションログ 2026-04-22 Coyote and Powell LLC コーポレートサイト構築

## セッション概要
- **日付**: 2026-04-22
- **プロジェクト**: Coyote and Powell LLC 独立コーポレートサイト（Toritavi とは完全別管理）
- **作業ディレクトリ**: `/Users/mbneo512gb/Dev/company-site`
- **Vercel プロジェクト**: `cap-site`（同一アカウント `kijiatoraregi-3833s-projects`）
- **テーマ**: 初期版 → visitors.now 準拠の刷新 → ブランドカラー teal → メインビジュアル導入 → ロゴ導入 → デプロイ

## 1. 初期要件の整理
- ドメイン予定: `coyoteandpowell.com`（未接続）
- 英語表記: Coyote and Powell LLC
- 日本語表記: 合同会社 Coyote and Powell
- 世界観: quiet confidence / durable trust / broad horizon / calm scale / bilingual by design
- 配色希望: 深ネイビー・石・砂・鈍いゴールド。紫・SaaS グラデは避ける
- 参照系: 建築事務所、デザインスタジオ、文化施設、長期志向投資会社
- 構成: 1 ページ Hero / About / Capabilities / Business / Vision / Company Profile / Contact
- 静的ホスティング前提、モバイル対応必須

## 2. フェーズ別経過

### フェーズ A: ダークナビ × セリフ × ゴールド基調（初期版）
- Cormorant Garamond + Noto Serif JP + Manrope
- `#0a1423` 深ネイビー基調、ハイライン区切り、章番号 §01〜§06
- Products セクションを追加し、Toritavi をフラグシップとして配置（β 公開中バッジ）

### フェーズ B: visitors.now デザイン言語に全面刷新
- 参照: https://visitors.now/?ref=godly
- ライト基調、`#fafafa` / `#f5f5f5` の白系ベースに変更
- **Open Runde** フォントを `/fonts/` に自己ホスト（Apache 2.0、Regular/Medium/Semibold）
- 浮遊ピルナビ、tracking `-0.02em` / 見出し `-0.03em`
- 角丸 24–32px、極薄シャドウ
- Products セクションに Toritavi の editorial timeline mock を追加（Next · Flight → Meeting → Stay）

### フェーズ C: ブランドカラー teal 適用
- 参照: https://www.figma.com/colors/teal/
- `--teal-500: #069494` を基点に 7 段階定義（tint / 400 / 500 / 600 / 700 / 800 / 900）
- 適用範囲: primary CTA / badge / moment-next card / eyebrow mark / focus ring
- 本文・見出し・背景は neutral 維持（restraint 原則）

### フェーズ D: グラフィック素材追加 → 撤回
- グレイン、Hero radial halo、horizon SVG、ゴースト章番号、moment icons、pull quote teal rule、product corner marks を一括追加
- ユーザー判断: 「ダサくなった。戻して」→ 全撤回。teal ブランドと visitors.now 骨格は維持

### フェーズ E: メインビジュアル導入
- Hero 背景にキャニオン + teal arc 画像（108KB JPEG、`images/hero-canyon.jpg`）
- `object-fit: cover` + `object-position: 72% center` で canyon/arc を右寄せで見せる
- `.hero-fade` で左→右の白フェード overlay（テキスト可読性確保）
- テキストは中央寄せから左寄せに変更、`.hero-marks` を hero 外に分離

### フェーズ F: ブランドロゴ導入
- 当初ロゴ (1774×887) → タイト版 (1230×175) に差し替え
- 配置変遷: pillnav 内 → 枠外独立 → `.topbar` flex コンテナで `align-items: center` 統一
- モバイル: `object-fit: cover` + `object-position: 0% center` で C モノグラム部分のみ表示
- 背景白を **Python PIL で透過処理**（閾値 235 以上 alpha 0、200–235 はアンチエイリアス保護）
- ファイルサイズ 84KB → 72KB

### フェーズ G: ナビをブランドカラーに
- pillnav 背景: 白 88% → teal `rgba(6,148,148,0.94)`
- テキスト色: ダーク → 白、`--nav-fg-mute`: 白 74%
- シャドウも teal 基調に（brand glow）
- 言語ピル内側: 白 14% 背景
- About の `margin-left: 5px` で左余白調整

### フェーズ H: 最終調整
- Hero の「お問い合わせ」ゴースト CTA を削除（残るは teal primary のみ）
- メニューから Contact を削除（Contact セクション本体とフッターは維持）
- Hero meta の JP 版を「合同会社 Coyote and Powell」→「Coyote and Powell LLC」に統一

## 3. ファイル構成
```
/Users/mbneo512gb/Dev/company-site/
├── index.html
├── styles.css
├── script.js
├── README.md
├── fonts/
│   ├── OpenRunde-Regular.woff2
│   ├── OpenRunde-Medium.woff2
│   └── OpenRunde-Semibold.woff2
└── images/
    ├── hero-canyon.jpg   (108KB, 圧縮 JPEG)
    ├── logo.png          (72KB, 透過 PNG 1230×175)
    └── logo-mark.png     (11KB, C モノグラムクロップ)
```

## 4. デプロイ
### Vercel プロジェクト作成コマンド
```bash
cd /Users/mbneo512gb/Dev/company-site
vercel projects add cap-site
vercel link --yes --project cap-site
vercel --yes
```

### 最新デプロイ URL
`https://cap-site-fvkj2d2hp-kijiatoraregi-3833s-projects.vercel.app`

### 状態
- Production 環境に反映済み
- **Deployment Protection 有効**: Vercel ログイン済みブラウザからのみ閲覧可
- カスタムドメイン `coyoteandpowell.com` は未接続

### 次回以降の更新
```bash
cd /Users/mbneo512gb/Dev/company-site
vercel --yes
```

## 5. 現在のページ構成
- **トップバー**: ロゴ（透過、左上）+ teal ピルナビ（About / Products / Capabilities / Company）+ JP/EN 切替
- **Hero**: Canyon 画像 + 左フェード + 左寄せ大サンセリフ + 「プロダクトを見る →」CTA + positioning strip
- **§01 About**: 3 principles カード（Quiet Confidence / Durable Craft / Bilingual by Design）
- **§02 Products**: Toritavi feature card + editorial timeline mock + Forthcoming 行
- **§03 Capabilities**: 3 カード
- **§04 Vision**: 本文 + pull quote
- **§05 Company Profile**: 6 行 definition list
- **§06 Contact**: email リンク
- **Footer**: 3 列（Product / Company / Contact）

## 6. 残課題
- カスタムドメイン `coyoteandpowell.com` を Vercel に接続
- Deployment Protection の設定見直し（自分専用 / パブリック公開）
- Toritavi 以外の追加プロダクト情報を Products セクションに反映
- Favicon / Apple touch icon / `og:image` の追加
- Hero 画像の最終確定（現状は仮のキャニオン画像）
- 登記情報・設立年月日・代表者名が確定したら Company Profile に反映
