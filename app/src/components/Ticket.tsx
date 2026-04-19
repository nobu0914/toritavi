"use client";

import { useMemo, useState } from "react";
import {
  IconBed,
  IconBus,
  IconCamera,
  IconCar,
  IconCircle,
  IconCopy,
  IconDownload,
  IconFirstAidKit,
  IconMail,
  IconPlane,
  IconTicket,
  IconTrain,
  IconUpload,
  IconUsers,
  IconWalk,
  IconToolsKitchen2,
} from "@tabler/icons-react";
import type { Information, StepCategory, StepSource, StepStatus } from "@/lib/types";
import { getFixedFields } from "@/lib/ocr-rules";
import "./ticket.css";

export type TicketData = {
  category: StepCategory;
  source?: StepSource;
  title: string;
  date?: string;
  endDate?: string;
  time?: string;
  endTime?: string;
  timezone?: string;
  from?: string;
  to?: string;
  confNumber?: string;
  memo?: string;
  information: Information[];
};

type Props = {
  data: TicketData;
  status?: StepStatus;
  needsReview?: boolean;
  inferred?: string[];
  sourceImageUrl?: string;
  sourceImageUrls?: string[];
  onCopyMailBody?: () => void;
};

const ROUTE_CATS: ReadonlySet<StepCategory> = new Set<StepCategory>(["飛行機", "列車", "バス", "車", "徒歩"]);

function CategoryIcon({ category, size = 14 }: { category: StepCategory; size?: number }) {
  switch (category) {
    case "飛行機": return <IconPlane size={size} />;
    case "列車": return <IconTrain size={size} />;
    case "バス": return <IconBus size={size} />;
    case "車": return <IconCar size={size} />;
    case "徒歩": return <IconWalk size={size} />;
    case "宿泊": return <IconBed size={size} />;
    case "商談": return <IconUsers size={size} />;
    case "食事": return <IconToolsKitchen2 size={size} />;
    case "観光": return <IconTicket size={size} />;
    case "病院": return <IconFirstAidKit size={size} />;
    default: return <IconCircle size={size} />;
  }
}

function variantClass(cat: StepCategory): string {
  switch (cat) {
    case "飛行機": return "ticket--flight";
    case "列車": return "ticket--train";
    case "バス": return "ticket--bus";
    case "宿泊": return "ticket--lodge";
    case "商談": return "ticket--meet ticket--quiet";
    case "食事": return "ticket--dine ticket--quiet";
    case "観光": return "ticket--sight";
    case "病院": return "ticket--hospital";
    case "その他": return "ticket--quiet";
    default: return "";
  }
}

function flagFor(status: StepStatus | undefined, needsReview?: boolean): { label: string; cls: string } {
  if (needsReview) return { label: "要確認", cls: "warn" };
  switch (status) {
    case "進行中": return { label: "進行中", cls: "info" };
    case "完了": return { label: "完了", cls: "success" };
    case "遅延": return { label: "遅延", cls: "warn" };
    case "キャンセル": return { label: "キャンセル", cls: "danger" };
    default: return { label: "準備中", cls: "" };
  }
}

function rootStateClass(status: StepStatus | undefined): string {
  if (status === "完了") return "ticket--done";
  if (status === "キャンセル") return "ticket--canceled";
  return "";
}

function fileNameBase(title: string): string {
  return (title || "toritavi").replace(/[/\\?%*:|"<>]/g, "_");
}

/**
 * Extract IATA/short code from values like:
 *   "クライストチャーチ（CHC）"          → { code: "CHC", name: "クライストチャーチ" }
 *   "San Jose (SJC)"                   → { code: "SJC", name: "San Jose" }
 *   "東京 成田 (NRT) ターミナル1"         → { code: "NRT", name: "東京 成田 ターミナル1" }
 *   "NRT"                              → { code: "NRT" }
 *   "東京駅"                            → { code: "東京駅" }
 *
 * The parenthesised IATA-style code can appear anywhere in the string; text
 * before and after it is kept as the friendly name so trailing qualifiers
 * like "ターミナル1" / "Terminal 2" / "空港第2" aren't dropped or shoved
 * into the big port-code slot (which would then truncate).
 */
function splitPort(value: string | undefined): { code: string; name?: string } {
  if (!value) return { code: "—" };
  const trimmed = value.trim();
  const m = trimmed.match(/[（(]\s*([A-Za-z0-9]{2,5})\s*[）)]/);
  if (m) {
    const code = m[1].toUpperCase();
    const name = (trimmed.slice(0, m.index) + " " + trimmed.slice((m.index ?? 0) + m[0].length))
      .replace(/\s+/g, " ")
      .trim();
    return { code, name: name || undefined };
  }
  return { code: trimmed };
}

type HighlightSpec = { label1: string; match1: RegExp; label2: string; match2: RegExp } | null;

// Permissive contains-based matching so labels like "座席番号" / "ゲート番号" / "Gate No." も拾える
function highlightSpec(category: StepCategory): HighlightSpec {
  switch (category) {
    case "飛行機": return { label1: "Gate", match1: /ゲート|gate/i,        label2: "Seat", match2: /座席|seat|シート/i };
    case "列車":   return { label1: "Car",  match1: /号車|car/i,           label2: "Seat", match2: /座席|seat|シート/i };
    case "バス":   return { label1: "Stop", match1: /のりば|乗り場|stop|platform/i, label2: "Seat", match2: /座席|seat|シート/i };
    case "観光":   return { label1: "Block",match1: /ブロック|block/i,     label2: "Seat", match2: /座席|seat|シート|席番号/i };
    default: return null;
  }
}

export function Ticket({ data, status, needsReview, inferred, sourceImageUrl, sourceImageUrls, onCopyMailBody }: Props) {
  const [activePage, setActivePage] = useState(0);

  const images = sourceImageUrls && sourceImageUrls.length > 0
    ? sourceImageUrls
    : sourceImageUrl ? [sourceImageUrl] : [];
  const isMail = data.source === "メール";
  const isImageSource = data.source === "アップロード" || data.source === "撮影";
  const showScan = images.length > 0 || (isMail && Boolean(data.memo)) || isImageSource;
  const hasImages = images.length > 0;

  const variant = variantClass(data.category);
  const stateCls = rootStateClass(status);
  const flag = flagFor(status, needsReview);
  const inferredSet = useMemo(() => new Set(inferred ?? []), [inferred]);

  const hl = highlightSpec(data.category);
  // DS v2 §13.11 rule (4): keep the frame even when both values are missing
  // so the layout stays consistent across boarding-pass / e-ticket variants.
  const highlight = useMemo(() => {
    if (!hl) return null;
    const find = (re: RegExp) => data.information.find((i) => re.test(i.label.trim()));
    const info1 = find(hl.match1);
    const info2 = find(hl.match2);
    return {
      label1: hl.label1,
      value1: info1?.value ?? "",
      id1: info1?.id,
      label2: hl.label2,
      value2: info2?.value ?? "",
      id2: info2?.id,
    };
  }, [data.information, hl]);

  const highlightIds = useMemo(
    () => new Set([highlight?.id1, highlight?.id2].filter(Boolean) as string[]),
    [highlight]
  );
  const visibleInformation = useMemo(
    () => data.information.filter((i) => !highlightIds.has(i.id)),
    [data.information, highlightIds]
  );

  const fixedFields = useMemo(() => getFixedFields(data.category), [data.category]);

  const fieldToStepKey = (key: string): keyof TicketData | null => {
    switch (key) {
      case "title": return "title";
      case "date": return "date";
      case "startTime": return "time";
      case "endTime": return "endTime";
      case "endDate": return "endDate";
      case "from": return "from";
      case "to": return "to";
      case "confNumber": return "confNumber";
      case "timezone": return "timezone";
      default: return null;
    }
  };

  const fields = fixedFields.map((f) => {
    const stepKey = fieldToStepKey(f.key);
    const rawVal = stepKey ? (data[stepKey] as string | undefined) : undefined;
    return {
      key: f.key,
      label: f.label,
      value: typeof rawVal === "string" ? rawVal : "",
      inferred: inferredSet.has(f.key) || (stepKey ? inferredSet.has(stepKey) : false),
      fullRow: f.key === "title" || f.key === "from" || f.key === "to",
      supported: stepKey !== null,
    };
  });

  const filledCount = fields.filter((f) => f.supported && f.value.trim().length > 0).length;
  const supportedTotal = fields.filter((f) => f.supported).length;

  const isRoute = ROUTE_CATS.has(data.category) && Boolean(data.from || data.to);

  const downloadOne = (url: string, index: number) => {
    const safe = fileNameBase(data.title);
    const ext = url.match(/\.(png|jpe?g|webp|gif|pdf)/i)?.[1] ?? "jpg";
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safe}${images.length > 1 ? `_${index + 1}` : ""}.${ext}`;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  const handleDownloadAll = () => {
    if (images.length === 1) downloadOne(images[0], 0);
    else images.forEach((u, i) => setTimeout(() => downloadOne(u, i), i * 150));
  };

  const routeDateLabel = () => {
    if (!data.endDate || !data.date) return data.endDate || data.date || "";
    if (data.endDate === data.date) return data.date;
    return `${data.endDate} 翌`;
  };

  return (
    <div className={`ticket ${variant} ${stateCls}`.trim()}>
      <div className="ticket-hero">
        <div className="ticket-hero-top">
          <div className="ticket-hero-category">
            <CategoryIcon category={data.category} />
            <span>{data.category}{data.title && data.category !== "その他" ? ` · ${data.title}` : ""}</span>
          </div>
          <span className={`ticket-hero-flag ${flag.cls}`.trim()}>{flag.label}</span>
        </div>

        {isRoute ? (() => {
          const fromPort = splitPort(data.from);
          const toPort = splitPort(data.to);
          return (
            <div className="ticket-route">
              <div className="ticket-port">
                <div className="ticket-port-code">{fromPort.code}</div>
                {fromPort.name && <div className="ticket-port-name">{fromPort.name}</div>}
                <div className={`ticket-port-time ${data.time ? "" : "empty"}`.trim()}>{data.time || "--:--"}</div>
                {data.date && <div className="ticket-port-date">{data.date}</div>}
              </div>
              <div className="ticket-arrow"><div className="ticket-arrow-line"></div></div>
              <div className="ticket-port ticket-port--right">
                <div className="ticket-port-code">{toPort.code}</div>
                {toPort.name && <div className="ticket-port-name">{toPort.name}</div>}
                <div className={`ticket-port-time ${data.endTime ? "" : "empty"}`.trim()}>{data.endTime || "--:--"}</div>
                {(data.endDate || data.date) && <div className="ticket-port-date">{routeDateLabel()}</div>}
              </div>
            </div>
          );
        })() : (
          <div className="ticket-hero-single">
            <div className="ticket-hero-subject">{data.title || "—"}</div>
            <div className="ticket-hero-subject-sub">
              {data.date || "日付未設定"}
              {data.time ? ` ${data.time}` : ""}
              {data.endDate && data.endDate !== data.date ? ` → ${data.endDate}` : ""}
              {data.endTime ? ` ${data.endTime}` : ""}
              {data.from ? ` · ${data.from}` : ""}
            </div>
          </div>
        )}
      </div>

      {(highlight || data.confNumber) && <div className="ticket-perf"></div>}

      {highlight && (
        <div className="ticket-highlight">
          <div className="ticket-highlight-cell">
            <div className="ticket-highlight-label">{highlight.label1}</div>
            <div className={`ticket-highlight-value ${highlight.value1 ? "" : "empty"}`.trim()}>
              {highlight.value1 || "未読取"}
            </div>
          </div>
          <div className="ticket-highlight-cell">
            <div className="ticket-highlight-label">{highlight.label2}</div>
            <div className={`ticket-highlight-value ${highlight.value2 ? "" : "empty"}`.trim()}>
              {highlight.value2 || "未読取"}
            </div>
          </div>
        </div>
      )}

      {data.confNumber && (
        <div className="ticket-code-zone">
          <div>
            <div className="ticket-code-label">確認番号</div>
            <div className="ticket-code-value">{data.confNumber}</div>
          </div>
        </div>
      )}

      {/* 基本情報 */}
      <div className="ticket-info-section">
        <div className="ticket-info-head">
          <span>基本情報</span>
          <span className="ticket-info-head-count">{filledCount} / {supportedTotal}</span>
        </div>
        <div className="ticket-info-grid">
          <div className="ticket-info-cell">
            <div className="ticket-info-label">カテゴリ</div>
            <div className="ticket-info-value plain">{data.category}</div>
          </div>
          {data.source && (
            <div className="ticket-info-cell">
              <div className="ticket-info-label">取り込み元</div>
              <div className="ticket-info-value plain">{data.source}</div>
            </div>
          )}
          {fields.filter((f) => f.supported).map((f) => {
            const hasValue = f.value.trim().length > 0;
            const cls = hasValue
              ? (f.inferred ? "inferred" : (f.fullRow ? "plain" : ""))
              : "empty";
            return (
              <div key={f.key} className={`ticket-info-cell ${f.fullRow ? "full-row" : ""}`.trim()}>
                <div className="ticket-info-label">
                  {f.label}
                  {f.inferred && hasValue && <span className="ticket-meta-badge">推定</span>}
                </div>
                <div className={`ticket-info-value ${cls}`.trim()}>
                  {hasValue ? f.value : "未読取"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* その他の情報（Highlight に引き上げた項目は除外） */}
      {visibleInformation.length > 0 && (
        <div className="ticket-info-section">
          <div className="ticket-info-head">
            <span>その他の情報</span>
            <span className="ticket-info-head-count">{visibleInformation.length}</span>
          </div>
          <div className="ticket-info-list">
            {visibleInformation.map((info) => (
              <div key={info.id} className="ticket-info-list-row">
                <div className="ticket-info-list-label">{info.label}</div>
                <div className={`ticket-info-list-value ${info.value ? "plain" : "empty"}`.trim()}>
                  {info.value || "未読取"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scan Source — always expanded */}
      {showScan && (
        <div className="ticket-scan">
          <div className="ticket-scan-head" style={{ cursor: "default" }}>
            <span className="ticket-scan-head-left">
              {isMail
                ? (<><IconMail size={14} />メール本文</>)
                : data.source === "撮影"
                  ? (<><IconCamera size={14} />撮影 · {images.length} 枚</>)
                  : (<><IconUpload size={14} />スキャン元 · {images.length > 1 ? `${images.length} ページ` : "1 ページ"}</>)
              }
            </span>
          </div>

          {isMail && data.memo ? (
            <div className="ticket-scan-full">
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontSize: 12, lineHeight: 1.7, maxHeight: 200, overflowY: "auto", whiteSpace: "pre-wrap" }}>
                {data.memo}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 10 }}>
                <button type="button" className="ticket-scan-action-btn" onClick={onCopyMailBody}>
                  <IconCopy size={14} />本文をコピー
                </button>
              </div>
            </div>
          ) : hasImages ? (
            <div className="ticket-scan-full">
              <div className="ticket-scan-image-wrap">
                <div className={`ticket-scan-image ${images.length > 1 ? "tall" : ""}`.trim()}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={images[activePage]} alt={`ページ ${activePage + 1}`} />
                </div>
                <button type="button" className="ticket-scan-dl-float" onClick={handleDownloadAll} aria-label="原本を保存">
                  <IconDownload size={14} />{images.length > 1 ? "一括保存" : "保存"}
                </button>
              </div>
              {images.length > 1 && (
                <div className="ticket-scan-pages">
                  {images.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`ticket-scan-page-thumb ${i === activePage ? "active" : ""}`.trim()}
                      onClick={() => setActivePage(i)}
                    >{i + 1}</button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="ticket-scan-full">
              <div className="ticket-scan-empty">
                原本が見つかりません
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
