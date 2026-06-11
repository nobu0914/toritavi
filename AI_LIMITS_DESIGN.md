# AI 制限機能 整備 設計書

対象: トリタビの AI 利用制限（OCR / コンシェルジュ / 情報タブ提案）。
スコープ（ユーザー選択）: **① 設定の統一・全env化 / ② ユーザーへの可視化・UX / ③ プラン階層別の上限**。
今回スコープ外: 予算アラート/監視（別途）。

> 凡例: 🟩 コード（私が実装可・デプロイ不要） / 🟦 本番デプロイ要（Vercel・要承認） / 🟨 DB 変更（ユーザー実行 SQL） / 🟧 アプリ実機ビルド

---

## 0. 現状（2026-06-11 時点）

| 層 | OCR `/api/ocr`（Sonnet 4.6） | コンシェルジュ `/api/concierge`（Haiku 4.5）※情報タブ提案も共用 |
|---|---|---|
| 月予算（全体ハードキャップ） | $20 `OCR_BUDGET_MONTHLY_CENTS` | $50 `CONCIERGE_BUDGET_MONTHLY_CENTS` |
| 日次（ユーザー別） | 50 req / 500k tok | 100 req / 200k tok |
| 分間バースト | 5/min | 5/min |
| env で可変 | ✅ 全4項目 | ⚠️ 予算のみ（日次/分は**ハードコード**） |
| テーブル | `toritavi_ocr_budget` / `toritavi_ocr_usage` / RPC `increment_ocr_usage` | `toritavi_concierge_budget` / `toritavi_concierge_usage` / RPC `increment_concierge_usage` |
| 認証 | Bearer 必須・デバッグ入場中は AI 不可 | 同左 |

課題: ①ガード処理が2ルートに重複・コンシェルジュ側が一部ハードコード ②ユーザーに残量/上限が見えない ③上限が全ユーザー一律（プラン無し）。

---

## ① 統一ガードモジュール + 全env化  🟩→🟦

`app/src/lib/ai-guard.ts`（新規）に 2 ルート共通のガードを抽出する。

```ts
type AiFeature = 'ocr' | 'concierge';
type Plan = 'free' | 'pro';            // §3

// 上限解決: env(基準) → プラン補正。
function resolveLimits(feature: AiFeature, plan: Plan): {
  budgetMonthlyCents: number; dailyRequests: number; dailyTokens: number; ratePerMin: number;
}

// 事前チェック（予算→日次→分）。超過時は {status:429, body:{error,message,retryable}} を返す。
async function enforceAiLimits(a: { feature; sb; userId; plan }): Promise<GuardResult>

// 使用量加算（既存 RPC をラップ）。
async function recordAiUsage(a: { feature; sb; userId; tokensIn; tokensOut; costCents }): Promise<void>

// §2 可視化用。今日の使用量と上限・リセット時刻を返す。
async function getAiUsage(a: { feature; sb; userId; plan }): Promise<AiUsageView>
```

`ocr/route.ts` / `concierge/route.ts` は上記を呼ぶだけにする（挙動は不変＝デプロイ安全）。

### env 命名（統一・後方互換維持）
旧名（`OCR_*` / `CONCIERGE_*`）は当面フォールバックで読み続ける。新・正準名:

```
AI_OCR_BUDGET_MONTHLY_CENTS        (既定 2000)   ← OCR_BUDGET_MONTHLY_CENTS 互換
AI_OCR_DAILY_REQUESTS              (既定 50)     ← OCR_DAILY_REQUEST_LIMIT 互換
AI_OCR_DAILY_TOKENS                (既定 500000) ← OCR_DAILY_TOKEN_LIMIT 互換
AI_OCR_RATE_PER_MIN                (既定 5)      ← OCR_RATE_LIMIT_PER_MIN 互換
AI_CONCIERGE_BUDGET_MONTHLY_CENTS  (既定 5000)
AI_CONCIERGE_DAILY_REQUESTS        (既定 100)    ★ 新規env化（現状ハードコード）
AI_CONCIERGE_DAILY_TOKENS          (既定 200000) ★ 新規env化
AI_CONCIERGE_RATE_PER_MIN          (既定 5)      ★ 新規env化
```

---

## ② プラン階層別の上限  🟨🟦

### データモデル（DB）🟨
```sql
-- 既定は free（行が無ければ free 扱い）。upgrade は当面 admin/手動で設定。
create table if not exists public.toritavi_user_plan (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','pro')),
  updated_at timestamptz not null default now()
);
alter table public.toritavi_user_plan enable row level security;
-- 本人は自分のプランを読めるだけ（変更は service_role / admin のみ）。
create policy "read own plan" on public.toritavi_user_plan
  for select using (auth.uid() = user_id);
```

### 上限テーブル（コード内・env 上書き可）— **値はすべて仮**
| 機能 | free（現状維持） | pro（仮） |
|---|---|---|
| OCR 日次 | 50 req / 500k tok | **200 req / 2M tok**（仮） |
| コンシェルジュ 日次 | 100 req / 200k tok | **500 req / 1M tok**（仮） |
| 分間バースト | 5/min | 10/min（仮） |
| 月予算（全体） | 共通（プラン非依存） | 共通 |

> pro の env 上書き: `AI_OCR_PRO_DAILY_REQUESTS` 等を用意（未設定なら上表の既定）。
> **要決定(TODO)**: (a) プラン名/段数（free/pro の2段で良いか）, (b) pro の実数値, (c) 課金/アップグレード導線（今回は admin 手動付与でも可か）。

ガードは `toritavi_user_plan` を引いて plan を解決 → `resolveLimits(feature, plan)`。

---

## ③ ユーザーへの可視化・UX  🟦🟧

### 使用状況 API（新規）🟦
`GET /api/ai-usage`（要ログイン）:
```json
{
  "plan": "free",
  "ocr":       { "usedRequests": 12, "limitRequests": 50, "usedTokens": 90000, "limitTokens": 500000, "resetAt": "2026-06-12T00:00:00+09:00" },
  "concierge": { "usedRequests": 4,  "limitRequests": 100, "usedTokens": 8000, "limitTokens": 200000, "resetAt": "..." }
}
```

### アプリ（Flutter）🟧
- **アカウントタブに「AI利用状況」**: 機能別に「本日 12/50」「リセットまで○時間」をバー表示＋プランバッジ（free/pro）。
- **429 UX 改善**: 既存 `_friendly()`（OCR）/ コンシェルジュのエラーを、`error` 種別で出し分け:
  - `daily_request_limit` → 「本日の解析上限（50回）に達しました。明日リセットされます。」
  - `monthly_budget_exceeded` → 「ただいま混雑のため一時停止中です。」
  - `rate_limit` → 既存どおり「少しお待ちください」。
- **情報タブの「AIからの提案を更新する」**: 残量0時はボタン無効化＋「本日の上限に達しました」。連打抑止（取得中は無効）。

---

## 段階実装プラン

| Phase | 内容 | 種別 | 挙動変化 |
|---|---|---|---|
| **P0 基盤** | `ai-guard.ts` 抽出・全env化（既定値=現状）。2ルートを置換。 | 🟩 実装→🟦 デプロイ | **無し**（純リファクタ・安全） |
| **P1 プラン** | `toritavi_user_plan` 追加・plan 解決・pro 上限。全員 free=現状維持。 | 🟨 SQL＋🟩→🟦 | free は不変 / pro のみ緩和 |
| **P2 可視化** | `/api/ai-usage`＋アプリ「利用状況」＋429文言出し分け。 | 🟩→🟦＋🟧 | 追加UIのみ |

各 Phase は独立リリース可。P0 はデプロイしても挙動不変なので最初に入れて安全に基盤を作る。

## リスク / 注意
- Web は **Vercel 本番**。push=自動デプロイの可能性 → **デプロイは都度ユーザー承認**。コードは working tree / ローカルコミットまで。
- DB は **共有本番**（LANDTRIP2 と別。toritavi_* テーブル）。SQL は**ユーザー実行**。`toritavi_user_plan` は新規なので既存に影響しない。
- 後方互換: 旧 env 名と挙動を維持（P0 で値を変えない）。

## 未決事項（要ユーザー判断）
1. プラン段数・名称（free/pro の2段で確定？）
2. pro の上限実数値（上表の仮値で良いか）
3. アップグレード導線（今回は admin 手動付与のみ／課金連携は別フェーズ、で良いか）
4. 「利用状況」の置き場所（アカウントタブ内で良いか）
