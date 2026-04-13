"use client";

import { Box, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle,
  IconArrowRight,
  IconBell,
  IconCheck,
  IconChevronRight,
  IconInfoCircle,
  IconTrain,
} from "@tabler/icons-react";
import Link from "next/link";
import { useEffect } from "react";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import {
  formatDateRange,
  getJourneyState,
  getNextActionStep,
  sortStepsByTime,
} from "@/lib/helpers";
import type { Journey } from "@/lib/types";
import classes from "./page.module.css";

export default function TripsClient({ journeys }: { journeys: Journey[] }) {
  useEffect(() => {
    const toast = sessionStorage.getItem("toritavi_toast");
    if (!toast) return;

    sessionStorage.removeItem("toritavi_toast");

    if (toast === "journey_created") {
      notifications.show({
        message: "登録が完了しました",
        color: "teal",
        icon: <IconCheck size={18} />,
        autoClose: 3000,
        withBorder: false,
        style: { background: "var(--mantine-color-teal-6)", color: "white" },
        styles: { icon: { color: "white", background: "transparent" } },
      });
      return;
    }

    if (toast === "journey_deleted") {
      notifications.show({
        message: "Trip を削除しました",
        icon: <IconInfoCircle size={18} />,
        autoClose: 3000,
        withBorder: false,
        style: { background: "var(--mantine-color-gray-8)", color: "white" },
        styles: {
          root: { color: "white" },
          body: { color: "white" },
          description: { color: "white" },
          icon: { color: "white", background: "transparent" },
        },
      });
      return;
    }

    if (toast === "schedule_deleted") {
      notifications.show({
        message: "スケジュールを削除しました",
        icon: <IconInfoCircle size={18} />,
        autoClose: 3000,
        withBorder: false,
        style: { background: "var(--mantine-color-gray-8)", color: "white" },
        styles: {
          root: { color: "white" },
          body: { color: "white" },
          description: { color: "white" },
          icon: { color: "white", background: "transparent" },
        },
      });
    }
  }, []);

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const sortedJourneys = [...journeys].sort((a, b) => {
    const aState = getJourneyState(a);
    const bState = getJourneyState(b);
    const order = { 進行中: 0, 準備中: 1, 完了: 2 };
    const stateDiff = order[aState] - order[bState];
    if (stateDiff !== 0) return stateDiff;

    const aTime = new Date(`${a.startDate}T00:00:00`).getTime();
    const bTime = new Date(`${b.startDate}T00:00:00`).getTime();
    return aTime - bTime;
  });

  const upcomingJourneys = sortedJourneys.filter((journey) => getJourneyState(journey) !== "完了");
  const focusJourney = upcomingJourneys[0];
  const focusStep = focusJourney ? getNextActionStep(sortStepsByTime(focusJourney.steps)) : undefined;
  const attentionCards = upcomingJourneys
    .flatMap((journey) =>
      journey.steps
        .filter((step) => !step.confNumber || !step.source)
        .map((step) => ({
          title: !step.confNumber ? "確認番号が未設定" : "書類の取り込み待ち",
          detail: `${journey.title}の${step.title}`,
        }))
    )
    .slice(0, 3);
  const queueItems = upcomingJourneys
    .flatMap((journey) =>
      journey.steps
        .filter((step) => step.source && step.source !== "手入力")
        .map((step) => ({
          title:
            step.source === "撮影"
              ? "搭乗券を撮影"
              : step.source === "アップロード"
                ? "ホテル予約PDFを追加"
                : "メール内容を確認",
          detail: `${journey.title} / ${step.title}`,
        }))
    )
    .slice(0, 3);

  const stateLabel = (journey: Journey) => getJourneyState(journey);
  const stateEyebrow = (journey: Journey) => {
    const state = stateLabel(journey);
    if (state === "進行中") return "今日進行中";
    if (state === "完了") return "完了済み";
    const start = new Date(`${journey.startDate}T00:00:00`);
    const diff = Math.ceil((start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return "今日";
    if (diff === 1) return "明日";
    return `${diff}日後に出発`;
  };

  return (
    <>
      <AppHeader title="toritavi" />
      <Box className={classes.screen} pb={110}>
        <Box className={classes.hero}>
          <Box className={classes.heroTop}>
            <Box>
              <Text className={classes.heroLabel}>Journey Workspace</Text>
              <Text className={classes.heroTitle}>次にやることが迷わない旅程UI</Text>
            </Box>
            <Box className={classes.heroBell}>
              <IconBell size={18} />
            </Box>
          </Box>

          <Box className={classes.heroStats}>
            <Box className={classes.statCard}>
              <Text className={classes.statValue}>{upcomingJourneys.length}</Text>
              <Text className={classes.statLabel}>Upcoming</Text>
            </Box>
            <Box className={classes.statCard}>
              <Text className={classes.statValue}>{attentionCards.length}</Text>
              <Text className={classes.statLabel}>要確認</Text>
            </Box>
            <Box className={classes.statCard}>
              <Text className={classes.statValue}>{queueItems.length}</Text>
              <Text className={classes.statLabel}>未整理書類</Text>
            </Box>
          </Box>

          {focusJourney && (
            <Link href={`/trips/${focusJourney.id}`} className={classes.heroFocus} style={{ textDecoration: "none", color: "inherit" }}>
              <Box className={classes.focusIcon}>
                <IconTrain size={18} />
              </Box>
              <Box className={classes.focusBody}>
                <Text className={classes.focusLabel}>いま開くべき Journey</Text>
                <Text className={classes.focusTitle}>{focusJourney.title}</Text>
                <Text className={classes.focusDetail}>
                  {focusStep
                    ? `${focusStep.time || "--:--"} に ${focusStep.title}`
                    : "次にやることを追加してください。"}
                </Text>
              </Box>
              <IconChevronRight size={18} className={classes.focusChevron} />
            </Link>
          )}
        </Box>

        {attentionCards.length > 0 && (
          <Box className={classes.section}>
            <Box className={classes.sectionHead}>
              <Text className={classes.sectionLabel}>Need Attention</Text>
              <Link href="/unfiled" className={classes.sectionLink} style={{ textDecoration: "none" }}>
                すべて見る
              </Link>
            </Box>
            <Box className={classes.stack}>
              {attentionCards.map((card) => (
                <Box key={`${card.title}-${card.detail}`} className={classes.alertCard}>
                  <Box className={classes.alertIcon}>
                    <IconAlertCircle size={18} />
                  </Box>
                  <Box className={classes.alertBody}>
                    <Text className={classes.alertTitle}>{card.title}</Text>
                    <Text className={classes.alertDetail}>{card.detail}</Text>
                  </Box>
                  <IconArrowRight size={16} className={classes.alertArrow} />
                </Box>
              ))}
            </Box>
          </Box>
        )}

        <Box className={classes.section}>
          <Box className={classes.sectionHead}>
            <Text className={classes.sectionLabel}>Journeys</Text>
          </Box>
          <Box className={classes.stack}>
            {sortedJourneys.length === 0 && (
              <Box className={classes.emptyCard}>
                <Text className={classes.emptyTitle}>まだ Journey がありません</Text>
                <Text className={classes.emptyDescription}>
                  右下の「+」から最初の Journey を作成しましょう
                </Text>
              </Box>
            )}

            {sortedJourneys.map((journey, index) => {
              const state = stateLabel(journey);
              const nextStep = getNextActionStep(sortStepsByTime(journey.steps));
              const coverVariant = index === 0 ? "primary" : index === 1 ? "dark" : "muted";
              const reviewCount = journey.steps.filter((s) => s.needsReview).length;

              return (
                <Link
                  key={journey.id}
                  href={`/trips/${journey.id}`}
                  className={classes.journeyCard}
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <Box className={classes.journeyCover} data-variant={coverVariant}>
                    <Text className={classes.journeyEyebrow}>{stateEyebrow(journey)}</Text>
                    <Text className={classes.journeyTitle}>{journey.title}</Text>
                    <Text className={classes.journeyDetail}>
                      {formatDateRange(journey.startDate, journey.endDate)}
                    </Text>
                  </Box>
                  <Box className={classes.journeyBody}>
                    <Box>
                      <Text className={classes.journeyMetaLabel}>Next Action</Text>
                      <Text className={classes.journeyMeta}>
                        {nextStep ? `${nextStep.title}${nextStep.time ? ` ${nextStep.time}` : ""}` : "次のステップを追加"}
                      </Text>
                    </Box>
                    <Box style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {reviewCount > 0 && (
                        <Box className={classes.reviewBadge}>
                          要確認 {reviewCount}
                        </Box>
                      )}
                      <Box className={classes.journeyBadge} data-state={state}>
                        {state}
                      </Box>
                    </Box>
                  </Box>
                </Link>
              );
            })}
          </Box>
        </Box>

        {queueItems.length > 0 && (
          <Box className={classes.section}>
            <Box className={classes.sectionHead}>
              <Text className={classes.sectionLabel}>Capture Queue</Text>
              <Link href="/unfiled" className={classes.sectionLink} style={{ textDecoration: "none" }}>
                未整理を見る
              </Link>
            </Box>

            <Box className={classes.queueCard}>
              {queueItems.map((item, index) => (
                <Box
                  key={`${item.title}-${item.detail}`}
                  className={classes.queueRow}
                  data-border={index < queueItems.length - 1 || undefined}
                >
                  <Box className={classes.queueIcon}>
                    <IconTrain size={17} />
                  </Box>
                  <Box className={classes.queueBody}>
                    <Text className={classes.queueTitle}>{item.title}</Text>
                    <Text className={classes.queueDetail}>{item.detail}</Text>
                  </Box>
                  <IconArrowRight size={16} className={classes.queueArrow} />
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Box>

      <TabBar />
    </>
  );
}
