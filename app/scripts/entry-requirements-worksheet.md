# entry_requirements 拡充ワークシート

**対象は日本国籍・短期観光**（`docs/travel-info-safety.md` §2）。
1 行入れるたびに、誤りが搭乗拒否・入国拒否に直結する。**検索結果の要約を
根拠にしない。**下の「一次情報」を人が開いて確認してから入れる。

現在 **10 行**（2026-07-27 時点）。**全行が一次情報で裏付け済み。**

---

## ⚠ 登録済みだが未確認（`verified_at` が NULL）

**現在 0 行。**

新しい行を入れたら、確認が済むまでここに書く。**入れた時点では未確認**であり、
`verified_at` を空にしておくこと自体が「まだ根拠を読んでいない」の印になる。

> **到達手段について（2026-07-27 の実測）。** 政府サイトの多くは
> スクリプトからの取得を 403 で拒む（immi.homeaffairs.gov.au /
> travel.state.gov / cbp.gov / mofa.go.jp / canada.ca）。
> **実ブラウザ経由なら同じページが読める。** 「403 だった」を
> 「情報が無い」と書かないこと —— 経路を変えれば取れる。
> TH は経路の問題ではなく、本文が PDF に入っているため別の壁。

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
| AU オーストラリア | ETA（subclass 601） | `eta` | https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/electronic-travel-authority-601 | 2026-07-27 | 対象旅券の一覧に **Japan** あり。**申請は「Australian ETA」アプリからのみ**（"must apply for an ETA using the Australian ETA app"）—— 知らないと詰まるので `notes` へ。1 回の滞在は最大 3 か月・AUD20。**旅券残存の規定は要件一覧に無い**（健康・素行・債務・未成年のみ）ので NULL |
| US アメリカ | ESTA（VWP） | `eta` | https://www.cbp.gov/travel/international-visitors/esta | 2026-07-27 | **e-Passport（IC チップ入り）必須**（"You must have an e-Passport to use the VWP"）→ `notes` へ。申請は渡航前ならいつでも可。旅券残存の規定は無いので NULL |
| GB 英国 | UK ETA | `eta` | https://www.gov.uk/eta | 2026-07-27 | ETA National List の 22 番に Japan。2025-01-08 以降の渡航が対象で、**2026-02-25 から無いと搭乗できない**。£20 / 2 年間有効 / 1 回 6 か月まで。判定は多くが数分だが最大 3 営業日 |
| KR 韓国 | K-ETA | `none` | https://www.k-eta.go.kr/ | 2026-07-27 | **日本国籍は 2026-12-31 まで一時免除**（在韓日本国大使館 2025-12-24 告知）。`valid_until = 2026-12-31` で登録できる（列は 2026-07-27 に追加済み） |
| NZ ニュージーランド | NZeTA + IVL | `eta` | https://www.immigration.govt.nz/new-zealand-visas/visas/visa/nzeta | 2026-07-27 | **「出国予定日から3か月以上」**（"valid for at least 3 months after the date you intend to leave"）。「入国時に3か月」と書いていたのは誤りで、当社の基準の方が緩かった → `passport_validity_note` へ。NZeTA は NZD $17〜・処理に最大 3 日 |
| IN インド | 観光 e-Visa | `visa` | https://indianvisaonline.gov.in/evisa/tvoa.html | 2026-07-27 | **「e-Visa 申請時に6か月以上」**（"at least six months validity at the time of making application"）。「入国時に」ではない → `passport_validity_note` へ。申請は到着の**最低4日前**まで（`lead_time_days=4` と一致）、最大 120 日前から |
| SG シンガポール | SG Arrival Card | `eta` | https://www.ica.gov.sg/enter-depart/entry_requirements | 2026-07-27 | ICA（入国管理局）。査証は不要だが **SG Arrival Card は全員に義務**（"All travellers are required to submit the SG Arrival Card within three (3) days"）。忘れると入国審査で止まるので `eta` にしてタスクを出す。旅券残存 6 か月（"minimum validity of 6 months"）。**`lead_time_days` は NULL** —— 表示文が「**承認に**最大N日」なので、「到着3日前から提出可」を入れると意味が変わる |
| HK 香港 | ビザ免除（90日） | `none` | https://www.immd.gov.hk/eng/services/visas/visit-transit/visit-visa-entry-permit.html | 2026-07-27 | 入境事務處の公式表に **"JAPAN \| 90 Days"**。旅券残存の記載がページに無いので NULL のまま（**書いていないものを補わない**） |
| TW 台湾 | ビザ免除（90日） | `none` | https://www.roc-taiwan.org/jp_ja/post/49589.html | 2026-07-27 | 台北駐日経済文化代表処。**旅券残存は「滞在日数以上」**（2017-08-15〜）。`passport_validity_months` は整数なのでこの規則を表せない → **NULL にして公式リンクに送る**。3 と書くと 5 日の旅行に 3 か月を要求し、不要な旅券更新を促す |
| TH タイ | ビザ免除（60日） | `none` | https://site.thaiembassy.jp/jp/visa/type/9793/ （本文は PDF `20240801visa60DaysJP.pdf`） | 2026-07-27 | 在東京タイ王国大使館。**2024-07-15 以降、観光は 1 回の入国につき 60 日**（従来 30 日）。93 か国の一覧の **40 番に Japan**。オンアライバルビザの 31 か国に日本は無い（免除があるので不要、で整合）。**旅券残存の規定は PDF 3 ページのどこにも無い** → `passport_validity_months` を 6 から **NULL に落とした**（出所を示せない断定をやめた。タスク自体は出続け、大使館リンクに送る）。同 PDF 内の商用ビザ免除（30日）は 2024-01-01〜2026-12-31 の期限付き |

## 保留（開始前・情報が確定しない）

| 国・地域 | 状況 | いつ見直すか |
|---|---|---|
| EU シェンゲン 30 か国 | **ETIAS は 2026 年第 4 四半期に開始予定**。まだ運用されていない | 開始を確認してから。今入れると「未稼働の制度を必要と案内する」ことになる |

## 未着手（要確認）

日本人の渡航先として多い順。**手続きが要る国**（`eta` / `visa`）を先に埋める。

**2026-07-27 に試して到達できなかったもの。**「読めなかった」であって
「情報が無い」ではない。ブラウザで開ける環境なら数分で終わる。

| 国・地域 | 障害 | 見るべき一次情報 |
|---|---|---|
| VN ベトナム | **TLS 証明書エラー**（`evisa.gov.vn` / 在日大使館とも） | https://evisa.gov.vn/ |
| MY マレーシア | 対象・期限が画像内 | https://imigresen-online.imi.gov.my/mdac/main |
| PH フィリピン | 「無料」以外読めず | https://etravel.gov.ph/ |

**403 は「情報が無い」ではない。** VN / MY / PH は実ブラウザ経由なら
取れる可能性が高い（AU / US / TH はそれで取れた）。

> **PDF の読み方（TH で使った手）。** 日本語が CID 埋め込みでテキスト層から
> 読めなくても、**国名などの ASCII は残る**ので `strings` 相当の抽出で
> 一覧の当否は判定できる。本文はブラウザで `....pdf#page=N` を開けば読める。
> 「PDF なので読めない」で止めない。

### まだ着手していない

| 国・地域 | 見るべき一次情報 |
|---|---|
| CN 中国 | https://www.china-embassy.gov.cn/jp/ |
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
   規定が無い国は NULL（英国・米国・豪州・タイ・香港は本文に残存規定なし）

   **月数で表せない規則は NULL にする。** 台湾は「滞在日数以上」で、
   3 と書くと 5 日の旅行に 3 か月を要求することになり、**不要な旅券更新を
   促す誤り**（安全基準 §0 の後者）になる。

   **一次情報に書いていない残存月数は消す。** タイは 6 が入っていたが、
   公式 PDF 全 3 ページのどこにも残存の規定が無く、出所も辿れなかったので
   NULL に落とした。**数字を消しても警告は弱まらない** —— 旅券タスクは
   変わらず出て、「入国要件を満たす残存期間があるかご確認ください」＋
   公式リンクになる。やめるのは**根拠を示せない具体的な数字の断定だけ**。
6. **起算点は「入国時」か。** 違うなら `passport_validity_note` に文で入れる
   （月数より優先して表示される）。2026-07-27 の確認では 4 か国中 3 か国で
   「入国時」が成り立たず、NZ と IN では**当社の基準の方が緩かった**。
   これは搭乗拒否・入国拒否につながる側の誤り。
7. **期限のある措置か。** K-ETA の免除のように期限付きなら `valid_until` に
   最終日を入れる。翌日から自動的に表示されなくなる
8. `verified_at` に確認した日を入れる。**「検索結果で一致した」を確認済みに
   しない。** 一次情報の本文を読んだ日だけを入れる

## 文言

`requirement_name` はカードのタイトルに入る。断定形にしない
（`docs/travel-info-safety.md` §4）。エンジンが
「〜 が必要か確認」の形に組み立てるので、名前は制度の呼称だけでよい。

例: `ETA（電子渡航認証）` `NZeTA + IVL（国際観光税）` `観光 e-Visa`
