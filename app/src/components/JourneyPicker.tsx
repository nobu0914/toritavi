"use client";

import { Drawer, Loader } from "@mantine/core";
import { IconCheck, IconChevronLeft, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { getJourneys } from "@/lib/store-client";
import type { Journey, Step } from "@/lib/types";

/**
 * JourneyPicker — screen 2 of the Flow A branch.
 *
 * Shown when the user picks "既存の旅程に追加" in DestinationSelector.
 * Lists the user's journeys, with the date-closest candidate pinned to
 * the top and highlighted. Each item shows a mini timeline so the user
 * can recognise the journey by shape, not just by title.
 *
 * Selection returns the chosen journeyId to the parent. The parent is
 * responsible for continuing the commit flow.
 */

type Props = {
  opened: boolean;
  /** The new step whose date we use to rank journeys. Nullable in case OCR gave no date. */
  primary: Step | null;
  onBack: () => void;
  onCancel: () => void;
  onPick: (journeyId: string) => void;
};

export function JourneyPicker({ opened, primary, onBack, onCancel, onPick }: Props) {
  const [journeys, setJourneys] = useState<Journey[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    let alive = true;
    setLoading(true);
    getJourneys()
      .then((js) => {
        if (!alive) return;
        setJourneys(js);
      })
      .catch((e) => {
        console.error("[JourneyPicker] getJourneys failed", e);
        if (alive) setJourneys([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [opened]);

  const ranked = useMemo(() => rankJourneys(journeys ?? [], primary?.date), [journeys, primary?.date]);
  const topId = ranked[0]?.journey.id;

  return (
    <Drawer
      opened={opened}
      onClose={onCancel}
      position="bottom"
      size="92%"
      padding={0}
      withCloseButton={false}
      radius="lg"
      overlayProps={{ opacity: 0.55, blur: 2 }}
      trapFocus
      styles={{
        content: { display: "flex", flexDirection: "column", maxHeight: "92vh" },
        body: { padding: 0, flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
      }}
      removeScrollProps={{ gapMode: "padding" }}
    >
      {/* ===================== header ===================== */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 8px 12px 4px",
          borderBottom: "1px solid var(--n-100)",
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          aria-label="戻る"
          onClick={onBack}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text)",
            padding: 8,
            display: "inline-flex",
            cursor: "pointer",
          }}
        >
          <IconChevronLeft size={20} />
        </button>
        <div style={{ fontSize: 15, fontWeight: 700 }}>追加先の旅程</div>
        <button
          type="button"
          aria-label="閉じる"
          onClick={onCancel}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text-dim)",
            padding: 8,
            display: "inline-flex",
            cursor: "pointer",
          }}
        >
          <IconX size={20} />
        </button>
      </div>

      {/* ===================== body ===================== */}
      <div style={{ flex: 1, overflow: "auto", padding: "12px 14px 20px" }}>
        {loading && (
          <div style={{ display: "grid", placeItems: "center", padding: "40px 0" }}>
            <Loader size="sm" />
          </div>
        )}

        {!loading && journeys !== null && journeys.length === 0 && (
          <div
            style={{
              padding: 32,
              textAlign: "center",
              color: "var(--text-dim)",
              fontSize: 13,
              lineHeight: 1.8,
            }}
          >
            まだ旅程がありません。
            <br />
            「新しい旅程を作る」から作成してください。
          </div>
        )}

        {!loading && ranked.length > 0 && (
          <>
            {ranked[0].closeness !== "none" && (
              <SectionLabel text={ranked[0].closeness === "match" ? "日付が一致" : "日付が近い候補"} />
            )}
            {ranked
              .filter((r) => r.closeness !== "none")
              .map((r) => (
                <JourneyRow
                  key={r.journey.id}
                  journey={r.journey}
                  highlighted={r.journey.id === topId}
                  picking={picking === r.journey.id}
                  onPick={() => {
                    setPicking(r.journey.id);
                    onPick(r.journey.id);
                  }}
                />
              ))}

            {ranked.some((r) => r.closeness === "none") && (
              <>
                <SectionLabel text="その他" />
                {ranked
                  .filter((r) => r.closeness === "none")
                  .map((r) => (
                    <JourneyRow
                      key={r.journey.id}
                      journey={r.journey}
                      highlighted={false}
                      picking={picking === r.journey.id}
                      onPick={() => {
                        setPicking(r.journey.id);
                        onPick(r.journey.id);
                      }}
                    />
                  ))}
              </>
            )}
          </>
        )}
      </div>
    </Drawer>
  );
}

/* ================================================================== */

function SectionLabel({ text }: { text: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 800,
        color: "var(--text-dim)",
        textTransform: "uppercase",
        letterSpacing: 1,
        padding: "12px 2px 6px",
      }}
    >
      {text}
    </div>
  );
}

function JourneyRow({
  journey,
  highlighted,
  picking,
  onPick,
}: {
  journey: Journey;
  highlighted: boolean;
  picking: boolean;
  onPick: () => void;
}) {
  const stepCount = journey.steps?.length ?? 0;
  const nextStep = findNextStep(journey);
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={picking}
      style={{
        width: "100%",
        textAlign: "left",
        background: "#fff",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: 12,
        marginBottom: 8,
        cursor: picking ? "progress" : "pointer",
        fontFamily: "inherit",
        boxShadow: highlighted ? "0 0 0 2px rgba(15,27,45,0.08)" : undefined,
        borderColor: highlighted ? "var(--ink-800)" : "var(--border)",
        opacity: picking ? 0.6 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{journey.title || "(無題の旅程)"}</div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
            {fmtRange(journey.startDate, journey.endDate)} · {stepCount} step
            {nextStep ? ` · 次: ${nextStep.title}` : ""}
          </div>
          <MiniTimeline steps={journey.steps ?? []} />
        </div>
        {highlighted && <IconCheck size={18} color="var(--ink-800)" />}
      </div>
    </button>
  );
}

function MiniTimeline({ steps }: { steps: Step[] }) {
  if (!steps || steps.length === 0) {
    return (
      <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 6, fontStyle: "italic" }}>
        まだ予定がありません
      </div>
    );
  }
  const preview = steps.slice(0, 5);
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
      {preview.map((s) => {
        const done = s.status === "完了";
        const active = s.status === "進行中";
        return (
          <span
            key={s.id}
            title={s.title}
            style={{
              flex: 1,
              minWidth: 0,
              background: done
                ? "var(--success-50)"
                : active
                ? "var(--info-50)"
                : "var(--n-100)",
              color: done
                ? "var(--success-700)"
                : active
                ? "var(--info-700)"
                : "var(--text-dim)",
              borderRadius: 6,
              padding: "4px 6px",
              fontSize: 9,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {s.title}
          </span>
        );
      })}
      {steps.length > preview.length && (
        <span
          style={{
            background: "var(--n-100)",
            color: "var(--text-dim)",
            borderRadius: 6,
            padding: "4px 6px",
            fontSize: 9,
            flexShrink: 0,
          }}
        >
          +{steps.length - preview.length}
        </span>
      )}
    </div>
  );
}

/* ================================================================== */

type Closeness = "match" | "near" | "none";

function rankJourneys(
  journeys: Journey[],
  refDate: string | undefined
): Array<{ journey: Journey; closeness: Closeness; distance: number }> {
  const ref = refDate ? Date.parse(refDate) : NaN;
  const hasRef = Number.isFinite(ref);

  const scored = journeys.map((j) => {
    const s = Date.parse(j.startDate);
    const e = Date.parse(j.endDate);
    let closeness: Closeness = "none";
    let distance = Infinity;
    if (hasRef && Number.isFinite(s) && Number.isFinite(e)) {
      if (ref >= s && ref <= e) {
        closeness = "match";
        distance = 0;
      } else {
        const diffStart = Math.abs(ref - s);
        const diffEnd = Math.abs(ref - e);
        distance = Math.min(diffStart, diffEnd);
        if (distance <= 7 * 24 * 60 * 60 * 1000) closeness = "near";
      }
    }
    return { journey: j, closeness, distance };
  });

  // Sort: match first (distance 0), then near by distance, then the
  // rest by updatedAt desc.
  scored.sort((a, b) => {
    const rank = (c: Closeness) => (c === "match" ? 0 : c === "near" ? 1 : 2);
    const rr = rank(a.closeness) - rank(b.closeness);
    if (rr !== 0) return rr;
    if (a.closeness !== "none") return a.distance - b.distance;
    return (b.journey.updatedAt || "").localeCompare(a.journey.updatedAt || "");
  });

  return scored;
}

function findNextStep(j: Journey): Step | null {
  const steps = (j.steps ?? []).filter((s) => s.status !== "完了" && s.status !== "キャンセル");
  return steps[0] ?? null;
}

function fmtRange(start?: string, end?: string): string {
  if (!start) return "—";
  if (!end || end === start) return start;
  return `${start} 〜 ${end}`;
}
