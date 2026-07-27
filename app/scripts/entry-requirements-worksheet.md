# entry_requirements 拡充ワークシート

**対象は日本国籍・短期観光**（`docs/travel-info-safety.md` §2）。
1 行入れるたびに、誤りが搭乗拒否・入国拒否に直結する。**検索結果の要約を
根拠にしない。**下の「一次情報」を人が開いて確認してから入れる。

現在 5 行（AU / IN / NZ / TH / US）。日本人の渡航先上位が丸ごと抜けている。

---

## 確認済み（一次情報を読んだ）

| 国 | 手続き | 種別 | 一次情報 | 確認日 | 備考 |
|---|---|---|---|---|---|
| GB 英国 | UK ETA | `eta` | https://www.gov.uk/eta | 2026-07-27 | ETA National List の 22 番に Japan。2025-01-08 以降の渡航が対象で、**2026-02-25 から無いと搭乗できない**。£20 / 2 年間有効 / 1 回 6 か月まで。判定は多くが数分だが最大 3 営業日 |
| KR 韓国 | K-ETA | `none` | https://www.k-eta.go.kr/ | 2026-07-27 | **日本国籍は 2026-12-31 まで一時免除**（在韓日本国大使館 2025-12-24 告知）。`valid_until` を入れられるまで登録しない —— 2027-01-01 に黙って嘘になる |

## 保留（開始前・情報が確定しない）

| 国・地域 | 状況 | いつ見直すか |
|---|---|---|
| EU シェンゲン 30 か国 | **ETIAS は 2026 年第 4 四半期に開始予定**。まだ運用されていない | 開始を確認してから。今入れると「未稼働の制度を必要と案内する」ことになる |

## 未着手（要確認）

日本人の渡航先として多い順。**手続きが要る国**（`eta` / `visa`）を先に埋める。

| 国・地域 | 見るべき一次情報 |
|---|---|
| TW 台湾 | https://www.roc-taiwan.org/jp_ja/ |
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
6. **期限のある措置か。** K-ETA の免除のように期限付きなら、
   `valid_until` を入れられるようになるまで登録しない
7. `verified_at` に確認した日を入れる

## 文言

`requirement_name` はカードのタイトルに入る。断定形にしない
（`docs/travel-info-safety.md` §4）。エンジンが
「〜 が必要か確認」の形に組み立てるので、名前は制度の呼称だけでよい。

例: `ETA（電子渡航認証）` `NZeTA + IVL（国際観光税）` `観光 e-Visa`
