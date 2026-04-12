# Test Data

AI OCR 検証用のサンプルデータです。各カテゴリに `PDF × 6` と `JPG × 6` を配置しています。

## 配置先

- `test-data/flight/`
- `test-data/train/`
- `test-data/hotel/`
- `test-data/hospital/`
- `test-data/ticket/`
- `test-data/restaurant/`
- `test-data/bus/`
- `test-data/business/`
- `test-data/other/`
- `test-data/broken-samples/`

## 収録内容

- `flight`: ANA/JAL/Peach/シンガポール航空に加え、Cathay Pacific、Jetstar、ZIPAIR、Emirates の搭乗券・eチケット
- `train`: 新幹線、在来線特急、スマートEX、えきねっとに加え、近鉄特急、小田急ロマンスカー、南海ラピート
- `hotel`: 国内ホテル、旅館、予約確認書、宿泊領収書、アプリ画面に加え、外資系ホテルや Booking.com 風の予約明細
- `hospital`: 外来予約票、歯科予約、MRI検査予約、処方箋、診察券、紹介状に加え、人間ドックや薬局受取案内
- `ticket`: コンサート、美術館、野球、ミュージカル、映画、水族館に加え、USJ、サッカー代表戦、展示会、舞台チケット
- `restaurant`: 高級店、居酒屋、ホテルレストラン、料亭、予約サイト画面、レシートに加え、TableCheck 風や焼肉店予約
- `bus`: 高速バス、空港リムジン、観光バス、市バス一日券、深夜バスに加え、空港連絡、深夜急行、ツアー集合案内
- `business`: 会議招集、セミナー受講票、商談確認、研修案内、会議室予約、名刺に加え、展示会出展者パス、Zoom 招待
- `other`: 引越し見積、車検予約、ペットホテル、免許更新通知、不在票、役所予約に加え、レンタカー、駐車場、ロッカー通知

## 特徴

- 日付・時間・確認番号・会場名・金額・座席番号などをカテゴリごとにばらけさせています
- PDF はA4帳票風、JPG はスマホ撮影やアプリ画面に近い簡易レイアウトです
- OCR で拾いたい代表項目を意識して、表記ゆれを含めています

## 崩れサンプル

`test-data/broken-samples/` には、OCR が苦手になりやすい崩れ専用ファイルをまとめています。

- 低コントラスト
- 斜め撮影風
- 反射入り
- 下部欠け
- ノイズ入り
- 情報密度高め
- 英日混在
- しわ寄せ・軽いぼかし
- 薄い帳票PDF
- レイアウトが不揃いなPDF

## 再生成

以下で通常サンプル 108 ファイルと崩れサンプルをまとめて再生成できます。

```bash
python3 test-data/generate.py
```
