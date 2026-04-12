#!/usr/bin/env python3
"""
テストデータ生成: 各区分 PDF×6 + 画像×6 = 12ファイル × 9区分 = 108件
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# --- フォント設定 ---
FONT_PATH = "/Library/Fonts/Arial Unicode.ttf"

# reportlab用
pdfmetrics.registerFont(TTFont("JP", FONT_PATH))
PDF_FONT = "JP"
PDF_FONT_BOLD = "JP"

# Pillow用
pil_font = ImageFont.truetype(FONT_PATH, 20)
pil_font_sm = ImageFont.truetype(FONT_PATH, 16)
pil_font_lg = ImageFont.truetype(FONT_PATH, 28)
pil_font_xl = ImageFont.truetype(FONT_PATH, 36)
pil_font_label = ImageFont.truetype(FONT_PATH, 13)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# --- データ定義 ---

CATEGORIES = {
    "flight": {
        "label": "フライト",
        "pdf": [
            {"title": "ANA 搭乗券", "lines": [
                "全日本空輸 ANA", "BOARDING PASS", "",
                "便名: NH 225", "日付: 2026年4月15日（火）",
                "出発: 東京（羽田） HND  10:00", "到着: 大阪（伊丹） ITM  11:15",
                "座席: 7A（窓側）", "搭乗口: Gate 62", "確認番号: ANA-882541",
                "", "旅客名: 田中 太郎 / TANAKA TARO", "クラス: 普通席"
            ]},
            {"title": "JAL 国際線 Eチケット", "lines": [
                "JAPAN AIRLINES", "Electronic Ticket", "",
                "予約番号: JLTK49", "旅客名: SUZUKI HANAKO", "",
                "JL 408  2026年5月10日", "東京 成田 NRT  11:25 出発",
                "ロサンゼルス LAX  06:30 到着", "座席: 32K エコノミー", "",
                "合計運賃: ¥185,400"
            ]},
            {"title": "Peach 搭乗案内", "lines": [
                "Peach Aviation", "搭乗案内", "",
                "MM 311", "2026年6月1日（月）",
                "関西国際空港 KIX → 新千歳空港 CTS",
                "出発 07:55 / 到着 09:55", "ゲート: 23B", "座席番号: 15F",
                "予約番号: MM-76234", "旅客: 佐藤 一郎"
            ]},
            {"title": "シンガポール航空 Eチケット", "lines": [
                "SINGAPORE AIRLINES", "E-TICKET RECEIPT", "",
                "BOOKING REF: SQ8821", "PASSENGER: YAMADA/YUKO MS", "",
                "SQ 637  12MAY2026", "TOKYO NARITA (NRT) 18:30",
                "SINGAPORE CHANGI (SIN) 00:55+1",
                "CLASS: ECONOMY  SEAT: 44A", "", "TOTAL: JPY 98,500"
            ]},
        ],
        "image": [
            {"title": "モバイル搭乗券", "lines": [
                "ANA", "", "NH 451",
                "羽田 HND → 福岡 FUK", "2026/04/20  13:30発",
                "Gate 58", "座席 12C", "確認番号 ANA-551208"
            ]},
            {"title": "搭乗ゲート案内", "lines": [
                "FLIGHT INFORMATION", "",
                "NH225  OSAKA/ITAMI", "BOARDING TIME 09:30",
                "GATE 62", "DEPARTURE 10:00", "ON TIME"
            ]},
            {"title": "チェックイン完了", "lines": [
                "チェックイン完了", "",
                "JAL JL 123", "2026年7月5日",
                "羽田 HND 08:00 → 那覇 OKA 10:45",
                "座席: 5A CLASSJ", "予約番号: JLHK82"
            ]},
            {"title": "航空券レシート", "lines": [
                "■お支払い明細", "全日本空輸株式会社", "",
                "予約番号: ANA-449201", "NH 857  2026/08/12",
                "東京(成田) NRT 17:30", "バンコク BKK 22:15",
                "エコノミー 28D", "合計: ¥55,140"
            ]},
        ],
    },
    "train": {
        "label": "鉄道",
        "pdf": [
            {"title": "新幹線 指定席きっぷ", "lines": [
                "東海旅客鉄道株式会社", "■乗車券・特急券", "",
                "のぞみ 225号", "2026年4月15日（火）",
                "東京 → 新大阪", "発車 10:00 / 到着 12:30",
                "7号車 3番A席（窓側）", "指定席 普通車",
                "確認番号: TK-882541"
            ]},
            {"title": "グリーン車予約", "lines": [
                "JR東海 EXサービス", "スマートEX 予約内容", "",
                "ひかり 503号", "2026年5月8日（木）",
                "名古屋 → 東京", "発車 09:12 / 到着 10:55",
                "10号車 5番D席", "グリーン車 指定席",
                "予約番号: EX-209481"
            ]},
            {"title": "北陸新幹線", "lines": [
                "JR東日本・JR西日本", "新幹線eチケット", "",
                "かがやき 509号", "2026年6月22日（日）",
                "東京 → 金沢", "発車 08:36 / 到着 11:12",
                "5号車 12番E席", "予約番号: JRE-775204"
            ]},
            {"title": "東北新幹線 グランクラス", "lines": [
                "えきねっと 予約確認書", "",
                "はやぶさ 7号", "2026年7月1日（火）",
                "東京 → 仙台", "発車 07:32 / 到着 09:06",
                "3号車 8番A席", "グランクラス",
                "予約番号: JRE-113058", "運賃合計: ¥17,470"
            ]},
        ],
        "image": [
            {"title": "きっぷ写真", "lines": [
                "のぞみ 103号", "4月20日",
                "新大阪 → 東京", "14:00発 16:30着",
                "12号車 1A", "TK-449102"
            ]},
            {"title": "モバイルSuica", "lines": [
                "スマートEX", "ひかり 511号",
                "5月15日（木）", "京都 → 東京",
                "10:44発 → 13:06着", "8号車 15C", "EX-330291"
            ]},
            {"title": "在来線特急", "lines": [
                "JR西日本", "サンダーバード 15号",
                "6月30日", "大阪 → 金沢",
                "09:12発 → 11:51着", "4号車 3D", "JRW-88201"
            ]},
            {"title": "九州新幹線", "lines": [
                "みずほ 601号", "2026/08/05",
                "博多 → 鹿児島中央", "08:00発 09:19着",
                "6号車 2A", "確認番号 JRK-55012"
            ]},
        ],
    },
    "hotel": {
        "label": "ホテル",
        "pdf": [
            {"title": "ホテル大阪ベイ 予約確認", "lines": [
                "ホテル大阪ベイ", "宿泊予約確認書", "",
                "予約番号: H-283901", "宿泊者名: 田中 太郎 様", "",
                "チェックイン: 2026年4月15日 18:00",
                "チェックアウト: 2026年4月16日 11:00",
                "部屋: シングル（禁煙）", "料金: ¥9,800", "",
                "大阪市中央区難波5-1-1"
            ]},
            {"title": "ホテル日航アリビラ", "lines": [
                "ホテル日航アリビラ", "RESERVATION CONFIRMATION", "",
                "Confirmation No: NKA-50221",
                "Check-in: May 10, 2026  14:00",
                "Check-out: May 12, 2026  11:00",
                "Room: Ocean View Twin", "Rate: ¥28,600/泊", "",
                "沖縄県読谷村"
            ]},
            {"title": "三井ガーデンホテル銀座", "lines": [
                "楽天トラベル 予約確認", "",
                "三井ガーデンホテル銀座プレミア",
                "予約番号: RTK-8841023", "",
                "チェックイン 15:00 / チェックアウト 11:00",
                "モデレートダブル 禁煙", "大人2名", "合計: ¥22,000"
            ]},
            {"title": "加賀屋 旅館予約", "lines": [
                "加賀屋", "ご予約確認書", "",
                "予約番号: KGY-12045", "お客様名: 山田 裕子 様", "",
                "チェックイン: 2026年7月20日 15:00",
                "チェックアウト: 2026年7月21日 10:00",
                "和室12.5畳 一泊二食付", "料金: ¥55,000"
            ]},
        ],
        "image": [
            {"title": "予約アプリ画面", "lines": [
                "ホテルメトロポリタン仙台",
                "チェックイン 2026/08/10 15:00",
                "チェックアウト 2026/08/11 10:00",
                "シングル 禁煙", "予約番号: MET-33201", "¥8,500"
            ]},
            {"title": "アパホテル予約", "lines": [
                "アパホテル新宿御苑前",
                "チェックイン: 9月5日 15:00",
                "チェックアウト: 9月6日 10:00",
                "ダブル 禁煙", "APA-991022", "¥7,200"
            ]},
            {"title": "ウェルカムカード", "lines": [
                "WELCOME", "東急ホテル横浜",
                "Room 1524", "Check-out 11:00",
                "WiFi: TOKYU-GUEST"
            ]},
            {"title": "宿泊領収書", "lines": [
                "■宿泊領収書",
                "ホテルグランヴィア京都", "2026年10月12日 1泊",
                "ツイン 禁煙", "予約番号: GVK-77015",
                "合計: ¥19,800"
            ]},
        ],
    },
    "hospital": {
        "label": "病院",
        "pdf": [
            {"title": "外来予約票", "lines": [
                "東京大学医学部附属病院", "外来予約票", "",
                "患者名: 田中 太郎 様", "診察券番号: 0012345678", "",
                "予約日: 2026年4月18日（金）", "予約時刻: 10:30",
                "診療科: 内科（消化器内科）", "担当医: 鈴木 医師"
            ]},
            {"title": "歯科クリニック", "lines": [
                "青山デンタルクリニック", "次回予約確認書", "",
                "患者名: 佐藤 一郎", "診察券番号: 8820134", "",
                "予約日: 2026年5月12日（月）", "時間: 14:00～14:30",
                "診療内容: 定期検診", "担当: 山田歯科医師"
            ]},
            {"title": "MRI検査予約", "lines": [
                "慶應義塾大学病院", "検査予約確認", "",
                "患者名: 山田 裕子", "ID: 20260401-551", "",
                "検査日: 2026年6月5日（木）", "受付時間: 08:30",
                "検査: MRI検査（頭部）", "検査時間: 約30分"
            ]},
            {"title": "眼科 処方箋", "lines": [
                "渋谷眼科クリニック", "処方箋", "",
                "患者: 高橋 健太", "診察券: 3301245", "",
                "処方日: 2026年7月2日", "診療科: 眼科",
                "ヒアルロン酸点眼液 0.1%", "次回: 2026年8月6日 15:00"
            ]},
        ],
        "image": [
            {"title": "診察券", "lines": [
                "品川内科クリニック", "診察券",
                "番号: 55201", "田中 太郎 様"
            ]},
            {"title": "受付番号票", "lines": [
                "順天堂大学病院", "受付番号: A-145",
                "2026年8月20日", "整形外科",
                "予約時刻: 09:00", "診察券: 1100982"
            ]},
            {"title": "予約リマインド", "lines": [
                "次回予約のお知らせ",
                "新宿メディカルクリニック",
                "9月15日（月） 11:00", "皮膚科", "診察券: 2205511"
            ]},
            {"title": "紹介状", "lines": [
                "紹介状（診療情報提供書）",
                "宛先: 東京医科大学病院 循環器内科",
                "患者: 鈴木 花子",
                "予約日: 2026年10月8日 13:30"
            ]},
        ],
    },
    "ticket": {
        "label": "チケット",
        "pdf": [
            {"title": "コンサートチケット", "lines": [
                "ぴあ チケット", "電子チケット", "",
                "宇多田ヒカル CONCERT TOUR 2026",
                "東京ドーム", "2026年5月3日（土）",
                "開場 16:00 / 開演 17:00", "",
                "アリーナ A12列 25番", "PIA-20260503-08821", "¥12,000"
            ]},
            {"title": "美術館入場券", "lines": [
                "国立新美術館", "企画展入場券", "",
                "ルーヴル美術館展 2026",
                "入場日: 2026年6月15日（日）",
                "入場時間: 10:00～10:30", "",
                "NACT-0615-1142", "大人1名 ¥2,200"
            ]},
            {"title": "野球チケット", "lines": [
                "読売巨人軍", "東京ドーム 公式戦", "",
                "2026年7月12日（土）", "巨人 vs 阪神",
                "試合開始: 18:00", "",
                "1塁側 指定席A", "22ブロック 15列 8番",
                "GTS-0712-A2215-08"
            ]},
            {"title": "ミュージカルチケット", "lines": [
                "劇団四季", "ライオンキング", "",
                "2026年8月23日（土）", "有明四季劇場",
                "開演: 13:00", "",
                "S席 1階 C列 18番", "SHIKI-0823-S1C18", "¥13,200"
            ]},
        ],
        "image": [
            {"title": "ディズニーランド", "lines": [
                "東京ディズニーランド",
                "1デーパスポート", "2026年9月14日（日）",
                "大人 ¥9,400", "TDR-914-20261"
            ]},
            {"title": "映画チケット", "lines": [
                "TOHOシネマズ 日比谷",
                "シン・ゴジラ2", "2026/10/05 18:30～",
                "F列 12番", "TOHO-1005-7F12", "¥1,900"
            ]},
            {"title": "Jリーグチケット", "lines": [
                "Jリーグ", "川崎F vs 横浜FM",
                "等々力 11月3日 14:00",
                "メインS指定 ブロック5 列8 番22",
                "TKT-1103-MS0508-22"
            ]},
            {"title": "水族館チケット", "lines": [
                "海遊館", "入館チケット",
                "2026年12月20日 13:00", "大人 ¥2,700",
                "KYK-1220-4018"
            ]},
        ],
    },
    "business": {
        "label": "ビジネス",
        "pdf": [
            {"title": "会議招集通知", "lines": [
                "会議招集通知", "",
                "第3四半期 事業戦略会議",
                "2026年4月20日（月）14:00～16:00",
                "ABC株式会社 本社ビル 8階 会議室A", "",
                "議題: Q3実績報告、Q4計画策定",
                "会議ID: MTG-20260420-08A"
            ]},
            {"title": "セミナー受講票", "lines": [
                "日経新聞社主催", "DXリーダーズサミット 2026", "",
                "受講者: 田中 太郎", "受講番号: NKS-2026-5521", "",
                "2026年5月25日 13:00～17:30",
                "東京国際フォーラム ホールB7"
            ]},
            {"title": "商談アポイント", "lines": [
                "商談確認書", "",
                "2026年6月10日（火）10:00～11:30",
                "株式会社XYZ 大阪支店",
                "グランフロント大阪 タワーA 15階", "",
                "訪問者: 田中太郎（営業部）",
                "確認番号: APT-0610-XYZ"
            ]},
            {"title": "研修案内", "lines": [
                "社内研修のお知らせ", "",
                "リーダーシップ研修（中級編）",
                "2026年7月8日 09:00～17:00",
                "品川研修センター 3階 研修室B", "",
                "受講者ID: TRN-2026-0451"
            ]},
        ],
        "image": [
            {"title": "名刺", "lines": [
                "ABC株式会社", "営業本部 第二営業部",
                "部長 山本 健太郎", "",
                "TEL: 03-1234-5678",
                "yamamoto@abc-corp.co.jp"
            ]},
            {"title": "会議室予約", "lines": [
                "会議室予約", "8F-A（大会議室）",
                "4月25日 13:00～15:00",
                "予約者: 田中太郎", "月次レビュー",
                "予約ID: RM-0425-8A"
            ]},
            {"title": "カンファレンス入場証", "lines": [
                "AWS Summit Tokyo 2026", "",
                "田中 太郎", "ABC株式会社",
                "登録ID: AWS-2026-TK8812",
                "6月26日 東京ビッグサイト"
            ]},
            {"title": "打ち合わせメモ", "lines": [
                "打ち合わせ記録",
                "8月5日 15:00～16:30", "新宿本社 5F 会議室C",
                "相手: 株式会社DEF 佐藤様",
                "内容: システム連携仕様確認"
            ]},
        ],
    },
    "restaurant": {
        "label": "レストラン",
        "pdf": [
            {"title": "高級レストラン予約", "lines": [
                "レストラン ジョエル・ロブション", "ご予約確認書", "",
                "予約番号: JR-20260420-1930",
                "2026年4月20日（日）19:30", "2名",
                "ディスカバリーコース ¥22,000/名", "",
                "ドレスコード: スマートカジュアル"
            ]},
            {"title": "居酒屋コース予約", "lines": [
                "個室居酒屋 はなの舞", "新宿西口店", "",
                "予約番号: HNM-0515-2201",
                "2026年5月15日 19:00～21:00", "6名",
                "飲み放題付き ¥4,500/名", "個室（掘りごたつ）"
            ]},
            {"title": "ホテルレストラン", "lines": [
                "帝国ホテル東京", "レ セゾン", "",
                "予約番号: IH-LS-0601",
                "2026年6月1日 12:00", "4名",
                "シェフズランチ ¥8,800/名",
                "アレルギー: 甲殻類"
            ]},
            {"title": "京料理 料亭", "lines": [
                "京料理 菊乃井 本店", "ご予約承り書", "",
                "予約番号: KKN-0720-1800",
                "2026年7月20日 18:00", "2名",
                "懐石 おまかせ ¥33,000/名", "お座敷: 和室個室"
            ]},
        ],
        "image": [
            {"title": "一休レストラン", "lines": [
                "一休.com", "鮨 さいとう",
                "8月10日 18:00", "2名",
                "おまかせ ¥38,500", "IQ-0810-SS22"
            ]},
            {"title": "食べログ予約", "lines": [
                "食べログ", "叙々苑 恵比寿店",
                "9月5日 19:30", "4名",
                "TBL-0905-JJ14", "10%OFFクーポン"
            ]},
            {"title": "カフェイベント", "lines": [
                "スターバックス リザーブ",
                "TASTING EVENT", "10月12日 15:00",
                "2名 ¥3,300/名", "SBR-1012-EVT8"
            ]},
            {"title": "レシート", "lines": [
                "ビストロ パリジャン", "2026/11/03",
                "3名", "ランチセット ×3",
                "合計: ¥8,140"
            ]},
        ],
    },
    "bus": {
        "label": "バス",
        "pdf": [
            {"title": "WILLER EXPRESS 高速バス", "lines": [
                "WILLER EXPRESS", "高速バス 乗車券", "",
                "予約番号: WEX-20260415-88201",
                "2026年4月15日", "WX 104便", "",
                "東京（バスタ新宿） 23:00",
                "→ 大阪（梅田） 06:30", "3列独立 5B", "¥4,800"
            ]},
            {"title": "空港リムジンバス", "lines": [
                "東京空港交通", "リムジンバス 乗車券", "",
                "予約番号: LMB-0510-3201",
                "2026年5月10日", "",
                "TCAT 07:00発 → 成田第1 08:30着",
                "大人1名 ¥3,200"
            ]},
            {"title": "夜行バス往復", "lines": [
                "さくら高速バス", "予約確認書", "",
                "予約番号: SKR-0601-VIP",
                "【往路】6月1日 東京22:30 → 京都06:00",
                "【復路】6月3日 京都22:00 → 東京06:30", "",
                "往復合計: ¥9,600"
            ]},
            {"title": "観光バスツアー", "lines": [
                "はとバス", "日帰りバスツアー", "",
                "富士山五合目と河口湖ランチ",
                "ツアーコード: HB-0720-FJ05",
                "2026年7月20日 08:15出発", "帰着18:00",
                "座席: 7A, 7B  ¥12,800/名"
            ]},
        ],
        "image": [
            {"title": "JRバス チケット", "lines": [
                "JRバス関東", "東京→名古屋",
                "8月10日 07:00発", "12:30着",
                "3列 4A", "JRB-0810-5512", "¥5,200"
            ]},
            {"title": "京都市バス 一日券", "lines": [
                "京都市バス", "一日乗車券",
                "2026年9月15日有効", "大人 ¥700",
                "KCB-0915-2201"
            ]},
            {"title": "空港連絡バス", "lines": [
                "南海バス", "なんば → 関西空港",
                "10月5日 10:00発 11:00着",
                "NKB-1005-4401", "¥1,100"
            ]},
            {"title": "深夜バス", "lines": [
                "VIPライナー", "東京→大阪",
                "11/20 23:10発 翌06:40着",
                "3列独立 2C", "VIP-1120-GR22", "¥5,500"
            ]},
        ],
    },
    "other": {
        "label": "その他",
        "pdf": [
            {"title": "引越し見積書", "lines": [
                "サカイ引越センター", "お見積書", "",
                "見積番号: SKI-20260501-3301",
                "引越し日: 2026年5月1日 午前便",
                "現住所: 品川区東品川2-3-1",
                "新住所: 横浜市西区みなとみらい3-5-1", "",
                "せつやくコース ¥85,000"
            ]},
            {"title": "車検予約", "lines": [
                "トヨタモビリティ東京", "車検予約確認書", "",
                "予約番号: TMT-0515-VC12",
                "車両: トヨタ プリウス",
                "入庫日: 2026年5月15日 09:00",
                "完了予定: 5月16日 17:00", "概算: ¥95,000～"
            ]},
            {"title": "ペットホテル予約", "lines": [
                "ドッグガーデン東京", "お預かり予約確認", "",
                "予約番号: DG-0720-P8801",
                "ペット: モモ（トイプードル）",
                "お預かり: 7月20日 10:00",
                "お迎え: 7月23日 17:00", "¥5,500/泊 計¥16,500"
            ]},
            {"title": "免許更新通知", "lines": [
                "東京都公安委員会", "運転免許証更新のお知らせ", "",
                "免許番号: 123456789012",
                "氏名: 田中 太郎",
                "有効期限: 2026年8月15日", "",
                "場所: 府中運転免許試験場", "手数料: ¥3,000"
            ]},
        ],
        "image": [
            {"title": "宅配便 不在票", "lines": [
                "ヤマト運輸", "ご不在連絡票",
                "9月10日 14:22", "伝票: 3456-7890-1234",
                "田中太郎 様", "荷送人: Amazon.co.jp"
            ]},
            {"title": "クリーニング引取票", "lines": [
                "白洋舎 渋谷店", "お預り票",
                "No. HYS-0912-445", "9月12日",
                "スーツ×1 ワイシャツ×3",
                "仕上がり: 9月15日 ¥3,850"
            ]},
            {"title": "役所予約", "lines": [
                "品川区役所",
                "マイナンバーカード受取予約",
                "10月20日 14:00～14:30",
                "予約番号: SGW-1020-MN552"
            ]},
            {"title": "パーソナルトレーニング", "lines": [
                "コナミスポーツ 目黒",
                "パーソナルトレーニング",
                "11月5日 18:00～19:00",
                "高橋コーチ", "会員: KNM-88201"
            ]},
        ],
    },
}

EXTRA_CATEGORIES = {
    "flight": {
        "pdf": [
            {"title": "Cathay Pacific E-Ticket", "lines": [
                "CATHAY PACIFIC", "E-TICKET ITINERARY / RECEIPT", "",
                "BOOKING REF: P7K2LM", "PASSENGER: KOBAYASHI/NAOKO MS", "",
                "CX 509  21SEP2026", "TOKYO NARITA (NRT) 09:35",
                "HONG KONG (HKG) 13:30", "SEAT: 41A  ECONOMY",
                "TICKET NO: 160-4219087731", "TOTAL FARE: JPY 64,820"
            ]},
            {"title": "Jetstar 予約確認書", "lines": [
                "Jetstar Japan", "旅程表 / 予約確認書", "",
                "予約番号: JQ8L2N", "搭乗者: MORI KENTA", "",
                "GK 203", "2026年10月18日（日）",
                "成田 NRT 07:10 出発", "新千歳 CTS 08:55 到着",
                "座席: 18F", "受託手荷物: 20kg", "支払総額: ¥11,980"
            ]},
        ],
        "image": [
            {"title": "eチケット控え", "lines": [
                "ZIPAIR Tokyo", "ZG 24",
                "成田 NRT → ソウル ICN",
                "2026/11/07  09:15発", "到着 11:55",
                "座席 21K", "予約番号 ZA-1107-2408", "受託手荷物 30kg"
            ]},
            {"title": "国際線チェックイン", "lines": [
                "EMIRATES", "Online Check-in Confirmed",
                "EK 319", "2026/12/03",
                "TOKYO NRT 22:30", "DUBAI DXB 05:40+1",
                "Seat 27A", "Booking Ref: EM4Q8R"
            ]},
        ],
    },
    "train": {
        "pdf": [
            {"title": "近鉄特急 予約確認", "lines": [
                "近畿日本鉄道", "特急券予約確認", "",
                "アーバンライナー 17号", "2026年9月11日（金）",
                "大阪難波 → 近鉄名古屋", "発車 09:00 / 到着 11:08",
                "4号車 9番C席", "予約番号: KNT-0911-417C", "支払額: ¥4,560"
            ]},
            {"title": "小田急ロマンスカー eチケット", "lines": [
                "小田急電鉄", "e-Romancecar 予約票", "",
                "GSE はこね 9号", "2026年10月2日（金）",
                "新宿 → 箱根湯本", "11:00発 / 12:25着",
                "3号車 7番A席", "チケットID: ODX-1002-3907A"
            ]},
        ],
        "image": [
            {"title": "えきねっと チケットレス", "lines": [
                "特急あずさ 17号", "2026/11/14",
                "新宿 → 松本", "10:00発 12:38着",
                "6号車 11D", "JRE-1114-6D11", "チケットレス特急券"
            ]},
            {"title": "南海ラピート", "lines": [
                "rapi:t β47号", "なんば → 関西空港",
                "12月8日 16:35発", "17:10着",
                "4号車 6A", "NKT-1208-RP47", "空港特急"
            ]},
        ],
    },
    "hotel": {
        "pdf": [
            {"title": "ザ・リッツ・カールトン福岡", "lines": [
                "The Ritz-Carlton, Fukuoka", "Reservation Confirmation", "",
                "Confirmation No: RCF-260918-5521",
                "Guest: TANAKA TARO", "Check-in: 18 Sep 2026 15:00",
                "Check-out: 20 Sep 2026 12:00", "Room: Deluxe King",
                "Rate: JPY 48,000 per night", "Special Request: High Floor"
            ]},
            {"title": "東横INN 予約確認", "lines": [
                "東横INN 新大阪中央口新館", "宿泊予約確認書", "",
                "予約番号: TYI-1014-8832", "宿泊者: 佐々木 美咲 様",
                "チェックイン: 2026年10月14日 16:00",
                "チェックアウト: 2026年10月15日 10:00",
                "エコノミーダブル 喫煙", "料金合計: ¥8,300"
            ]},
        ],
        "image": [
            {"title": "Booking.com 予約詳細", "lines": [
                "Hotel Monterey Kyoto", "予約確定",
                "2026/11/21 - 2026/11/23", "Superior Twin",
                "2名 朝食付き", "予約番号 BKG-1121-8820", "総額 ¥31,640"
            ]},
            {"title": "チェックイン案内", "lines": [
                "sequence KYOTO GOJO",
                "Self Check-in Available", "Room Type: Queen",
                "Check-in 15:00", "Reservation SQK-1202-1045",
                "Access Code: 624913"
            ]},
        ],
    },
    "hospital": {
        "pdf": [
            {"title": "人間ドック受診票", "lines": [
                "聖路加国際病院附属クリニック", "人間ドック受診票", "",
                "受診者: 中村 恒一", "受付番号: DOC-20260903-41", "",
                "受診日: 2026年9月3日（木）", "受付時間: 08:10",
                "コース: 一日人間ドック", "持参物: 保険証・問診票"
            ]},
            {"title": "婦人科予約確認", "lines": [
                "みなとみらいレディースクリニック", "予約確認票", "",
                "患者名: 井上 真理", "診察券番号: 4408213", "",
                "予約日時: 2026年10月27日 15:20",
                "診療科: 婦人科", "診療内容: 定期検診", "担当医: 田村 医師"
            ]},
        ],
        "image": [
            {"title": "検査受付票", "lines": [
                "虎の門病院", "採血受付",
                "2026年11月11日", "受付番号 B-032",
                "受付時間 08:45", "診察券 7712054"
            ]},
            {"title": "薬局受取案内", "lines": [
                "さくら薬局", "処方せん受付完了",
                "患者: 松本 直子", "受付番号 RX-1207-018",
                "2026/12/07 17:40", "出来上がり予定 18:05"
            ]},
        ],
    },
    "ticket": {
        "pdf": [
            {"title": "USJ スタジオ・パス", "lines": [
                "ユニバーサル・スタジオ・ジャパン", "1デイ・スタジオ・パス", "",
                "入場日: 2026年9月26日（土）", "大人 2名",
                "チケット番号: USJ-0926-440812", "エリア入場整理券対象日",
                "購入金額: ¥19,600"
            ]},
            {"title": "サッカー代表戦チケット", "lines": [
                "SAMURAI BLUE", "電子チケット", "",
                "日本 vs 韓国", "2026年10月13日（火） 19:20 KICK OFF",
                "埼玉スタジアム2002", "カテゴリー1 メイン下層",
                "209入口 14列 118番", "TKT-JFA-1013-20914118"
            ]},
        ],
        "image": [
            {"title": "展示会入場QR", "lines": [
                "CEATEC 2026", "幕張メッセ",
                "来場日 2026/10/21", "入場区分: ビジネス",
                "登録ID CEA-1021-9912", "ホール 4-6"
            ]},
            {"title": "舞台チケット", "lines": [
                "明治座", "12月公演",
                "2026/12/18 11:30開演", "S席 1階 10列 22番",
                "チケット番号 MJZ-1218-S1022", "¥14,000"
            ]},
        ],
    },
    "restaurant": {
        "pdf": [
            {"title": "焼肉うしごろ 銀座店 予約確認", "lines": [
                "焼肉うしごろ 銀座店", "ご予約確認", "",
                "予約番号: USG-20260918-1930",
                "2026年9月18日（金）19:30", "3名",
                "席種: テーブル席", "コース: 極みコース ¥12,000/名",
                "要望: 1名が甲殻類アレルギー"
            ]},
            {"title": "オーベルジュ ディナー予約", "lines": [
                "Auberge TOKITO", "Reservation Details", "",
                "Booking ID: ATK-1022-1800", "Date: 22 Oct 2026 18:00",
                "Guests: 2", "Menu: Seasonal Chef Tasting",
                "Estimated Total: JPY 46,000", "Dress Code: Smart Elegant"
            ]},
        ],
        "image": [
            {"title": "TableCheck 確認", "lines": [
                "NARISAWA", "Reservation Confirmed",
                "2026/11/28 12:00", "2 guests",
                "Booking TC-1128-2204", "Counter Seating",
                "Anniversary Plate requested"
            ]},
            {"title": "予約完了画面", "lines": [
                "もつ鍋 おおやま", "博多店",
                "12月11日 20:00", "4名",
                "座席: 半個室", "予約番号 OYM-1211-8004"
            ]},
        ],
    },
    "bus": {
        "pdf": [
            {"title": "京成バス 深夜急行", "lines": [
                "京成バス", "深夜急行バス 予約確認", "",
                "予約番号: KSB-20260930-114",
                "2026年9月30日", "新橋 24:10発 → 千葉中央 01:35着",
                "座席: 2列目A", "運賃: ¥2,100", "乗車時刻の10分前集合"
            ]},
            {"title": "那覇空港シャトル", "lines": [
                "沖縄エアポートシャトル", "予約確認メール", "",
                "予約番号: OAS-1018-5520", "2026年10月18日",
                "那覇空港 14:20発 → 恩納村 15:55着",
                "乗客: 2名", "支払額: ¥3,200"
            ]},
        ],
        "image": [
            {"title": "空港バス モバイル券", "lines": [
                "Airport Bus", "羽田空港 → 横浜駅",
                "2026/11/02 18:40", "Seat 9B",
                "Ticket AB-1102-009B", "大人1名 ¥650"
            ]},
            {"title": "バスツアー集合案内", "lines": [
                "クラブツーリズム", "日帰り紅葉ツアー",
                "12月6日 07:45 集合", "新宿都庁大型バス駐車場",
                "受付番号 CT-1206-331", "バス号車 2号車"
            ]},
        ],
    },
    "business": {
        "pdf": [
            {"title": "展示会出展者パス", "lines": [
                "Japan IT Week 秋 2026", "出展者バッジ引換票", "",
                "会社名: ABCソリューションズ株式会社", "来場者: 田中 太郎",
                "登録番号: ITW-20261028-8821", "会期: 2026年10月28日-30日",
                "会場: 幕張メッセ 1-8ホール"
            ]},
            {"title": "取引先訪問予定表", "lines": [
                "訪問予定確認", "",
                "訪問日: 2026年11月12日（木） 13:30～14:30",
                "訪問先: 株式会社オリオンテック", "住所: 名古屋市中村区名駅3-28-12",
                "担当: 営業企画部 佐久間様", "案件番号: BIZ-1112-ORN"
            ]},
        ],
        "image": [
            {"title": "Zoom 招待", "lines": [
                "Weekly Product Sync", "2026/11/05 10:00-11:00",
                "Meeting ID 839 2201 4421", "Passcode 551208",
                "Host: product-team@toritavi.jp"
            ]},
            {"title": "受付用QR", "lines": [
                "Salesforce World Tour Tokyo", "Admission Pass",
                "Name: TANAKA TARO", "Company: ABC Corp.",
                "Pass ID SFT-1201-9921", "2026/12/01 Tokyo Big Sight"
            ]},
        ],
    },
    "other": {
        "pdf": [
            {"title": "レンタカー予約確認", "lines": [
                "トヨタレンタカー", "予約確認書", "",
                "予約番号: TRC-20260912-3102",
                "利用日時: 2026年9月12日 09:00",
                "返却日時: 2026年9月13日 18:00",
                "車種: ヤリス", "受取店舗: 新千歳空港店", "概算料金: ¥13,200"
            ]},
            {"title": "コワーキング会議室予約", "lines": [
                "WeWork 神谷町トラストタワー", "会議室予約確認", "",
                "予約番号: WWK-1031-ROOM8",
                "2026年10月31日 14:00～16:00",
                "Room: Sakura 8A", "利用者: 田中 太郎", "料金: ¥6,600"
            ]},
        ],
        "image": [
            {"title": "駐車場予約", "lines": [
                "akippa", "予約完了",
                "2026/11/15 09:00-18:00", "渋谷区神南1丁目駐車場",
                "予約番号 AKP-1115-4012", "¥1,800"
            ]},
            {"title": "宅配ロッカー通知", "lines": [
                "PUDO ステーション", "荷物受取案内",
                "お問い合わせ番号 9901-2284-5510",
                "保管期限 2026/12/14 23:59", "受取場所: 品川駅港南口"
            ]},
        ],
    },
}

for cat_key, extra_data in EXTRA_CATEGORIES.items():
    CATEGORIES[cat_key]["pdf"].extend(extra_data["pdf"])
    CATEGORIES[cat_key]["image"].extend(extra_data["image"])

BROKEN_SAMPLES = {
    "pdf": [
        {
            "filename": "broken_pdf_01_flight_mixed_layout.pdf",
            "title": "E-TKT / 搭乗案内 / Itinerary",
            "lines": [
                "ANA / Codeshare with UA", "Passenger: TANAKA TARO", "REF: NH-UC3A91",
                "NRT 07:25  ->  SFO 00:45", "Seat 39K / Group 5 / Gate 47A",
                "Baggage 1PC 23KG", "2026-10-14(WED)", "Check-in closed 06:45",
                "Invoice total JPY 142,380", "Note: Terminal 1 South Wing"
            ],
        },
        {
            "filename": "broken_pdf_02_receipt_faded.pdf",
            "title": "宿泊領収 / Payment Slip",
            "lines": [
                "Hotel Monterey Sendai", "CONF# MTS-1108-5501", "Guest: SASAKI MISAKI",
                "Check-in 2026/11/08 15:00", "Check-out 2026/11/09 11:00", "Rm Type Semi Double",
                "Room charge 8,900", "City tax 200", "Breakfast x1 1,870", "TOTAL 10,970"
            ],
        },
        {
            "filename": "broken_pdf_03_business_dense.pdf",
            "title": "Meeting / Seminar / Access Info",
            "lines": [
                "DX Leaders Forum 2026", "Tokyo Midtown Yaesu 5F Hall C", "2026/12/02 13:00-18:10",
                "受付開始 12:20", "入場コード DLF-1202-8821", "Speaker track B / breakout room 2",
                "Lunch coupon attached", "Wi-Fi SSID DLF-GUEST", "Emergency contact 03-5500-1881"
            ],
        },
        {
            "filename": "broken_pdf_04_hospital_overprint.pdf",
            "title": "予約票 / Prescription / Next Visit",
            "lines": [
                "Shibuya Medical Clinic", "Pt.ID 4402188", "Dermatology / 皮膚科",
                "2026/12/18 17:20", "Doctor: HASEGAWA", "Rx: Ointment 0.1%",
                "Next appt tentative 2027/01/22 10:40", "Pharmacy code RX-8841"
            ],
        },
    ],
    "image": [
        {
            "filename": "broken_img_01_train_skewed.jpg",
            "title": "斜め撮影の切符",
            "lines": ["のぞみ 243号", "東京→京都", "2026/10/21", "13:57発 16:09着", "8号車 5E", "EX-1021-8E05"],
            "style": "skewed",
        },
        {
            "filename": "broken_img_02_flight_low_contrast.jpg",
            "title": "低コントラスト搭乗券",
            "lines": ["JAL JL318", "FUK→HND", "2026/11/02 19:35", "Seat 21A", "Gate 11", "JL-1102-K821"],
            "style": "low_contrast",
        },
        {
            "filename": "broken_img_03_hotel_glare.jpg",
            "title": "反射入りホテル確認",
            "lines": ["Hotel Gracery", "2026/11/14-11/15", "Twin Non-smoking", "Conf HGR-1114-2201", "TOTAL 18,400"],
            "style": "glare",
        },
        {
            "filename": "broken_img_04_restaurant_crop.jpg",
            "title": "下部欠けた予約画面",
            "lines": ["TableCheck", "NARISAWA", "2026/11/28 12:00", "2 guests", "Counter", "Booking TC-1128-2204"],
            "style": "cropped",
        },
        {
            "filename": "broken_img_05_bus_noise.jpg",
            "title": "ノイズ入り高速バス",
            "lines": ["WILLER EXPRESS", "新宿23:20→京都06:10", "2026/12/05", "Seat 4C", "WEX-1205-04C"],
            "style": "noise",
        },
        {
            "filename": "broken_img_06_ticket_dense.jpg",
            "title": "情報密度高めチケット",
            "lines": ["SAMURAI BLUE", "2026/10/13 19:20", "埼玉スタジアム2002", "Cat1 209入口14列118番", "TKT-JFA-1013-20914118", "開場17:30", "QR ENTRY"],
            "style": "dense",
        },
        {
            "filename": "broken_img_07_hospital_mixed_lang.jpg",
            "title": "英日混在の予約票",
            "lines": ["Toranomon Hosp.", "採血 / Blood Test", "2026-11-11 08:45", "No.B-032", "Pt ID 7712054", "fasting required"],
            "style": "mixed_lang",
        },
        {
            "filename": "broken_img_08_other_wrinkled.jpg",
            "title": "しわ寄せ風の控え",
            "lines": ["Toyota Rent a Car", "Pickup CTS 09:00", "Return 18:00 next day", "Yaris", "TRC-20260912-3102", "13,200 JPY"],
            "style": "wrinkled",
        },
    ],
}


def create_pdf(filepath, title, lines):
    """PDF生成（A4サイズ、日本語対応）"""
    c = canvas.Canvas(filepath, pagesize=A4)
    w, h = A4

    # ヘッダーバー
    c.setFillColorRGB(0.11, 0.49, 0.84)  # blue-7
    c.rect(0, h - 60, w, 60, fill=1, stroke=0)
    c.setFillColorRGB(1, 1, 1)
    c.setFont(PDF_FONT_BOLD, 18)
    c.drawString(20 * mm, h - 42, title)

    # 本文
    c.setFillColorRGB(0.13, 0.13, 0.13)
    y = h - 90
    for line in lines:
        if not line:
            y -= 10
            continue
        if line.startswith("■") or line.startswith("予約番号") or line.startswith("確認番号") or line.startswith("Confirmation"):
            c.setFont(PDF_FONT_BOLD, 12)
        else:
            c.setFont(PDF_FONT, 11)
        c.drawString(20 * mm, y, line)
        y -= 20
        if y < 40:
            break

    c.save()


def create_image(filepath, title, lines, bg_color=(248, 249, 250)):
    """画像生成（スマホ画面風 390x600）"""
    W, H = 390, 600
    img = Image.new("RGB", (W, H), bg_color)
    draw = ImageDraw.Draw(img)

    # ヘッダーバー
    draw.rectangle([0, 0, W, 52], fill=(28, 126, 214))
    draw.text((16, 12), title, fill="white", font=pil_font_lg)

    # 白いカード
    card_y = 70
    card_h = H - 90
    draw.rounded_rectangle([16, card_y, W - 16, card_h], radius=8, fill="white", outline=(233, 236, 239))

    # テキスト
    y = card_y + 20
    for line in lines:
        if not line:
            y += 10
            continue
        font = pil_font if len(line) < 25 else pil_font_sm
        draw.text((32, y), line, fill=(33, 37, 41), font=font)
        y += 30
        if y > card_h - 20:
            break

    img.save(filepath, quality=92)


def create_broken_pdf(filepath, title, lines, variant):
    """OCRで崩れやすい帳票風PDF"""
    c = canvas.Canvas(filepath, pagesize=A4)
    w, h = A4
    c.setFillColorRGB(0.92, 0.92, 0.92)
    c.rect(0, 0, w, h, fill=1, stroke=0)
    c.setFillColorRGB(0.35, 0.35, 0.35)
    c.setFont(PDF_FONT_BOLD, 15)
    c.drawString(18 * mm, h - 26 * mm, title)

    if variant == "broken_pdf_02_receipt_faded.pdf":
        c.setFillColorRGB(0.58, 0.58, 0.58)
    elif variant == "broken_pdf_04_hospital_overprint.pdf":
        c.setFillColorRGB(0.22, 0.22, 0.22)
        c.rotate(0.6)

    y = h - 42 * mm
    for i, line in enumerate(lines):
        font_size = 9 if i % 2 == 0 else 10.5
        x = 18 * mm + (i % 3) * 2.2 * mm
        if i in {2, 5}:
            x += 12 * mm
        c.setFont(PDF_FONT, font_size)
        c.drawString(x, y, line)
        y -= 13 * mm if i % 2 == 0 else 9 * mm

    c.setFillColorRGB(0.75, 0.75, 0.75)
    c.setFont(PDF_FONT, 8)
    c.drawString(22 * mm, 22 * mm, "Scanned copy / some text may be partially unreadable")
    c.save()


def create_broken_image(filepath, title, lines, style):
    """OCRで失敗しやすい画像サンプル"""
    w, h = 390, 600
    base = Image.new("RGB", (w, h), (242, 242, 240))
    draw = ImageDraw.Draw(base)
    draw.rectangle([0, 0, w, 54], fill=(78, 96, 110))
    draw.text((16, 12), title, fill=(245, 245, 245), font=pil_font_lg)
    draw.rounded_rectangle([18, 76, w - 18, h - 28], radius=10, fill=(252, 252, 248), outline=(214, 214, 214))

    y = 104
    for index, line in enumerate(lines):
        font = pil_font_sm if len(line) > 22 or style in {"dense", "mixed_lang"} else pil_font
        text_x = 34 + (index % 2) * (4 if style in {"skewed", "wrinkled"} else 0)
        if style == "dense":
            y += 1
        draw.text((text_x, y), line, fill=(40, 40, 40), font=font)
        y += 22 if style == "dense" else 30

    if style == "glare":
        draw.ellipse([210, 120, 410, 320], fill=(255, 255, 255))
    elif style == "cropped":
        base = base.crop((0, 0, w, h - 85))
    elif style == "noise":
        for x in range(24, w - 20, 18):
            for y2 in range(86, h - 38, 28):
                shade = 215 if (x + y2) % 36 else 185
                draw.point((x, y2), fill=(shade, shade, shade))
                draw.point((x + 2, y2 + 1), fill=(shade - 10, shade - 10, shade - 10))
    elif style == "low_contrast":
        overlay = Image.new("RGB", base.size, (232, 232, 228))
        base = Image.blend(base, overlay, 0.46)
    elif style == "wrinkled":
        for y2 in range(90, h - 40, 48):
            draw.arc([20, y2, w - 20, y2 + 28], start=0, end=180, fill=(220, 220, 220), width=2)

    if style == "skewed":
        base = base.rotate(-7, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=(236, 236, 232))
    elif style in {"glare", "noise", "mixed_lang", "wrinkled"}:
        base = base.rotate(2, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=(238, 238, 236))

    if style in {"noise", "low_contrast", "wrinkled"}:
        base = base.filter(ImageFilter.GaussianBlur(radius=0.6))

    base.save(filepath, quality=88)


def main():
    for cat_key, cat_data in CATEGORIES.items():
        cat_dir = os.path.join(BASE_DIR, cat_key)
        os.makedirs(cat_dir, exist_ok=True)

        # PDF
        for i, item in enumerate(cat_data["pdf"], 1):
            path = os.path.join(cat_dir, f"pdf_{i:02d}_{cat_key}.pdf")
            create_pdf(path, item["title"], item["lines"])
            print(f"  PDF: {path}")

        # 画像
        for i, item in enumerate(cat_data["image"], 1):
            path = os.path.join(cat_dir, f"img_{i:02d}_{cat_key}.jpg")
            create_image(path, item["title"], item["lines"])
            print(f"  IMG: {path}")

        # テキスト (2件) - 既存テキストファイルから流用
        print(f"  TXT: 既存の {cat_key} テキストファイルを参照")

    broken_dir = os.path.join(BASE_DIR, "broken-samples")
    os.makedirs(broken_dir, exist_ok=True)

    for item in BROKEN_SAMPLES["pdf"]:
        path = os.path.join(broken_dir, item["filename"])
        create_broken_pdf(path, item["title"], item["lines"], item["filename"])
        print(f"  BROKEN PDF: {path}")

    for item in BROKEN_SAMPLES["image"]:
        path = os.path.join(broken_dir, item["filename"])
        create_broken_image(path, item["title"], item["lines"], item["style"])
        print(f"  BROKEN IMG: {path}")

    per_category = len(next(iter(CATEGORIES.values()))["pdf"]) + len(next(iter(CATEGORIES.values()))["image"])
    broken_total = len(BROKEN_SAMPLES["pdf"]) + len(BROKEN_SAMPLES["image"])
    print(
        f"\n合計: {len(CATEGORIES)} カテゴリ × {per_category} ファイル = {len(CATEGORIES) * per_category} ファイル"
        f" + 崩れサンプル {broken_total} ファイル"
    )


if __name__ == "__main__":
    main()
