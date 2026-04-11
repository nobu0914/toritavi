import { Box, Text } from "@mantine/core";
import {
  IconBell,
  IconCalendarEvent,
  IconChevronRight,
  IconClock,
  IconFileDescription,
  IconMapPin,
  IconPlane,
  IconTicket,
  IconTrain,
  IconUserCircle,
} from "@tabler/icons-react";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import classes from "./page.module.css";

const summaryCards = [
  { label: "進行中", value: "2" },
  { label: "準備中", value: "6" },
  { label: "未整理", value: "14" },
];

const journeys = [
  {
    title: "大阪 出張",
    date: "4月18日 (土) - 4月19日 (日)",
    detail: "rail 1 / meeting 2 / hotel 1",
    state: "Upcoming",
  },
  {
    title: "木更津 アウトレット",
    date: "4月18日 (土)",
    detail: "car 1 / activity 1 / meal 1",
    state: "On Time",
  },
];

const plans = [
  {
    icon: IconTrain,
    type: "Rail",
    title: "のぞみ 225号",
    detail: "東京 10:00 → 新大阪 12:30",
    conf: "TK-882541",
  },
  {
    icon: IconCalendarEvent,
    type: "Meeting",
    title: "ABC社 商談",
    detail: "14:00 - 16:00 / 大阪市北区梅田1-2-3",
    conf: "Room 12F",
  },
  {
    icon: IconPlane,
    type: "Flight",
    title: "ANA NH21",
    detail: "HND 10:00 → ITM 11:10",
    conf: "ABCDEF",
  },
];

const unfiled = [
  {
    title: "予約確認PDF",
    detail: "ホテル大阪ベイに関連付け候補",
    icon: IconFileDescription,
  },
  {
    title: "位置情報メモ",
    detail: "大阪駅から会場まで徒歩8分",
    icon: IconMapPin,
  },
  {
    title: "観光候補",
    detail: "赤レンガ倉庫 / 木更津港",
    icon: IconTicket,
  },
];

export default function UiSampleDadsPage() {
  return (
    <>
      <AppHeader title="UIサンプル DADS" back backHref="/" />

      <Box className={classes.screen} pb={110}>
        <Box className={classes.headerPanel}>
          <Box className={classes.headerMeta}>
            <Text className={classes.kicker}>Journey Management</Text>
            <Box className={classes.headerIcons}>
              <Box className={classes.headerIcon}>
                <IconBell size={18} />
              </Box>
              <Box className={classes.headerIcon}>
                <IconUserCircle size={18} />
              </Box>
            </Box>
          </Box>
          <Text className={classes.pageTitle}>情報を抜け漏れなく整理する旅程UI</Text>
          <Text className={classes.pageDescription}>
            `design-system.html` のトークンとコンポーネント構成を使い、一覧性と確認作業を優先した別案です。
          </Text>
        </Box>

        <Box className={classes.summaryGrid}>
          {summaryCards.map((item) => (
            <Box key={item.label} className={classes.summaryCard}>
              <Text className={classes.summaryValue}>{item.value}</Text>
              <Text className={classes.summaryLabel}>{item.label}</Text>
            </Box>
          ))}
        </Box>

        <Box className={classes.section}>
          <Text className={classes.sectionTitle}>Trip Cards</Text>
          <Box className={classes.stack}>
            {journeys.map((journey) => (
              <Box key={journey.title} className={classes.tripCard}>
                <Box className={classes.tripCardHeader}>
                  <Text className={classes.tripCardTitle}>{journey.title}</Text>
                  <Text className={classes.tripCardDate}>{journey.date}</Text>
                </Box>
                <Box className={classes.tripCardBody}>
                  <Text className={classes.tripCardDetail}>{journey.detail}</Text>
                  <Box className={classes.badge} data-state={journey.state}>
                    {journey.state}
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>

        <Box className={classes.section}>
          <Text className={classes.sectionTitle}>Current Trip</Text>
          <Box className={classes.tripHero}>
            <Text className={classes.tripHeroTitle}>大阪 出張</Text>
            <Text className={classes.tripHeroDate}>4月18日 (土) - 4月19日 (日)</Text>
            <Box className={classes.tripHeroSummary}>
              <Text span>1 rail</Text>
              <Text span>2 meeting</Text>
              <Text span>1 hotel</Text>
            </Box>
          </Box>

          <Box className={classes.dayHeader}>土曜日, 4月18日</Box>

          <Box className={classes.stack}>
            {plans.map((plan) => (
              <Box key={plan.title} className={classes.planCard}>
                <Box className={classes.planIcon}>
                  <plan.icon size={20} />
                </Box>
                <Box className={classes.planBody}>
                  <Text className={classes.planType}>{plan.type}</Text>
                  <Text className={classes.planTitle}>{plan.title}</Text>
                  <Text className={classes.planDetail}>{plan.detail}</Text>
                  <Text className={classes.planConf}>Conf# {plan.conf}</Text>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>

        <Box className={classes.section}>
          <Text className={classes.sectionTitle}>Action Sheet Direction</Text>
          <Box className={classes.sheetCard}>
            <Box className={classes.sheetItem}>
              <Text>編集する</Text>
              <IconChevronRight size={16} />
            </Box>
            <Box className={classes.sheetItem}>
              <Text>共有する</Text>
              <IconChevronRight size={16} />
            </Box>
            <Box className={classes.sheetItem}>
              <Text>複製する</Text>
              <IconChevronRight size={16} />
            </Box>
            <Box className={`${classes.sheetItem} ${classes.sheetDanger}`}>
              <Text>削除する</Text>
              <IconChevronRight size={16} />
            </Box>
          </Box>
        </Box>

        <Box className={classes.section}>
          <Text className={classes.sectionTitle}>Unfiled Queue</Text>
          <Box className={classes.infoCard}>
            {unfiled.map((item, index) => (
              <Box
                key={item.title}
                className={classes.infoRow}
                data-border={index < unfiled.length - 1 || undefined}
              >
                <Box className={classes.infoLabelWrap}>
                  <item.icon size={16} className={classes.infoIcon} />
                  <Box>
                    <Text className={classes.infoTitle}>{item.title}</Text>
                    <Text className={classes.infoDetail}>{item.detail}</Text>
                  </Box>
                </Box>
                <IconChevronRight size={16} className={classes.infoArrow} />
              </Box>
            ))}
          </Box>
        </Box>

        <Box className={classes.section}>
          <Text className={classes.sectionTitle}>Empty State Direction</Text>
          <Box className={classes.emptyCard}>
            <IconClock size={40} className={classes.emptyIcon} />
            <Text className={classes.emptyTitle}>着手待ちのTripはありません</Text>
            <Text className={classes.emptyDescription}>
              右下の「+」から新しいTripを作成するか、
              <br />
              未整理の書類を既存Tripへ関連付けます。
            </Text>
          </Box>
        </Box>
      </Box>

      <TabBar />
    </>
  );
}
