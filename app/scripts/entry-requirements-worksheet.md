# entry_requirements 拡充ワークシート

**対象は日本国籍・短期観光**（`docs/travel-info-safety.md` §2）。
1 行入れるたびに、誤りが搭乗拒否・入国拒否に直結する。**検索結果の要約を
根拠にしない。**下の「一次情報」を人が開いて確認してから入れる。

現在 **8 行**（2026-07-27 時点）。日本人の渡航先上位はまだ大きく抜けている。

---

## ⚠ 登録済みだが未確認（`verified_at` が NULL）

**ここが今いちばん危ない。** 下の 5 行は誰がいつ確認したのか分からないまま、
**断定的な内容を画面に出している**。増やすより先にここを確認する方が価値が高い。

| 国 | 種別 | 出しているもの | 状態 |
|---|---|---|---|
| **AU** | `eta` | 「ETA（電子渡航許可・601…）が必要か確認」 | **未確認**（immi.homeaffairs.gov.au が 403） |
| **US** | `eta` | 「ESTA（電子渡航認証）が必要か確認」 | **未確認**（cbp.gov / travel.state.gov が 403） |
| **TH** | `none` | 入国タスクは出さないが、**残存 6 か月**を断定 | **未確認**（本文が PDF 内。公式ドメインの検索結果とは一致したが、それを確認済みにはしない） |

いずれもブラウザで開ける環境なら数分で終わる。AU / US は断定的な内容を
出している行なので優先度が高い。

> **残存月数は「起算点」まで見ること。** 2026-07-27 に確認したところ、
> 4 か国中 3 か国で「入国時の残存」が成り立っていなかった
> （NZ = 出国予定日から / IN = 申請時に / TW = 滞在日数以上）。
> 月数だけで書くと **当社の基準の方が緩くなり**、通してはいけない人を通す。
> 起算点が「入国時」でないなら `passport_validity_note` に文で入れる。

確認したら `verified_at` を入れる:

```sql
update public.entry_requirements
   set verified_at = current_date
 where country_code = 'XX';   -- 一次情報を開いて確認した国だけ
```

---

## 確認済み（一次情報を読んだ）

| 国 | 手続き | 種別 | 一次情報 | 確認日 | 備考 |
|---|---|---|---|---|---|
| GB 英国 | UK ETA | `eta` | https://www.gov.uk/eta | 2026-07-27 | ETA National List の 22 番に Japan。2025-01-08 以降の渡航が対象で、**2026-02-25 から無いと搭乗できない**。£20 / 2 年間有効 / 1 回 6 か月まで。判定は多くが数分だが最大 3 営業日 |
| KR 韓国 | K-ETA | `none` | https://www.k-eta.go.kr/ | 2026-07-27 | **日本国籍は 2026-12-31 まで一時免除**（在韓日本国大使館 2025-12-24 告知）。`valid_until = 2026-12-31` で登録できる（列は 2026-07-27 に追加済み） |
| NZ ニュージーランド | NZeTA + IVL | `eta` | https://www.immigration.govt.nz/new-zealand-visas/visas/visa/nzeta | 2026-07-27 | **「出国予定日から3か月以上」**（"valid for at least 3 months after the date you intend to leave"）。「入国時に3か月」と書いていたのは誤りで、当社の基準の方が緩かった → `passport_validity_note` へ。NZeTA は NZD $17〜・処理に最大 3 日 |
| IN インド | 観光 e-Visa | `visa` | https://indianvisaonline.gov.in/evisa/tvoa.html | 2026-07-27 | **「e-Visa 申請時に6か月以上」**（"at least six months validity at the time of making application"）。「入国時に」ではない → `passport_validity_note` へ。申請は到着の**最低4日前**まで（`lead_time_days=4` と一致）、最大 120 日前から |
| TW 台湾 | ビザ免除（90日） | `none` | https://www.roc-taiwan.org/jp_ja/post/49589.html | 2026-07-27 | 台北駐日経済文化代表処。**旅券残存は「滞在日数以上」**（2017-08-15〜）。`passport_validity_months` は整数なのでこの規則を表せない → **NULL にして公式リンクに送る**。3 と書くと 5 日の旅行に 3 か月を要求し、不要な旅券更新を促す |

## 保留（開始前・情報が確定しない）

| 国・地域 | 状況 | いつ見直すか |
|---|---|---|
| EU シェンゲン 30 か国 | **ETIAS は 2026 年第 4 四半期に開始予定**。まだ運用されていない | 開始を確認してから。今入れると「未稼働の制度を必要と案内する」ことになる |

## 未着手（要確認）

日本人の渡航先として多い順。**手続きが要る国**（`eta` / `visa`）を先に埋める。

| 国・地域 | 見るべき一次情報 |
|---|---|
| CN 中国 | https://www.china-embassy.gov.cn/jp/ |
| HK 香港 | https://www.immd.gov.hk/ |
| VN ベトナム | https://evisa.gov.vn/ |
| SG シンガポール | https://eservices.ica.gov.sg/sgarrivalcard/ |
| MY マレーシア | https://imigresen-online.imi.gov.my/mdac/main |
| PH フィリピン | https://etravel.gov.ph/ |
| ID インドネシア | https://evisa.imigrasi.go.id/ |
| CA カナダ | https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta.html |
| GU グアム | https://travel.state.gov/ ／ CNMI-Guam VWP |

**日本側の横断確認**: 外務省「ビザ免除国・地域」
https://www.mofa.go.jp/mofaj/toko/visa/tanki/novisa.html

---

## 入れる前のチェック（1 行ごと）

1. **一次情報を開いたか。** 検索結果の要約や旅行代理店のページは根拠にしない
2. `applies_to` に `{JP}` を入れたか（空だと表示されない ——
   `docs/travel-info-safety.md` §3-1 のフェイルクローズ）
3. `official_url` は**申請・案内の本体**か。トップページや検索結果ではない
4. `requirement_type` は `visa` / `eta` / `none` のどれか。
   `none`（免除）は入国手続きタスクを生成しない。旅券残存の判定にだけ効く
5. `passport_validity_months` は**その国の規定**か。「6 か月」を惰性で入れない。
   規定が無い国は NULL（英国・米国・豪州は残存規定なし）

   **月数で表せない規則は NULL にする。** 台湾は「滞在日数以上」で、
   3 と書くと 5 日の旅行に 3 か月を要求することになり、**不要な旅券更新を
   促す誤り**（安全基準 §0 の後者）になる。NULL なら一般形の文言になり、
   公式リンクが実際の規則を説明する。列が整数である以上、ここは
   「入れない」で正しい。
6. **期限のある措置か。** K-ETA の免除のように期限付きなら、
   `valid_until` を入れられるようになるまで登録しない
7. `verified_at` に確認した日を入れる

## 文言

`requirement_name` はカードのタイトルに入る。断定形にしない
（`docs/travel-info-safety.md` §4）。エンジンが
「〜 が必要か確認」の形に組み立てるので、名前は制度の呼称だけでよい。

例: `ETA（電子渡航認証）` `NZeTA + IVL（国際観光税）` `観光 e-Visa`
