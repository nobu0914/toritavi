import { Box, Text } from "@mantine/core";
import {
  IconAlertCircle,
  IconArrowRight,
  IconBell,
  IconChevronRight,
  IconTrain,
} from "@tabler/icons-react";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import { attentionCards, captureQueue, journeyCards } from "../sampleData";
import classes from "../page.module.css";

export default function UiSampleTopPage() {
  return (
    <>
      <AppHeader title="トップサンプル" back backHref="/ui-sample" />

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
              <Text className={classes.statValue}>6</Text>
              <Text className={classes.statLabel}>Upcoming</Text>
            </Box>
            <Box className={classes.statCard}>
              <Text className={classes.statValue}>3</Text>
              <Text className={classes.statLabel}>要確認</Text>
            </Box>
            <Box className={classes.statCard}>
              <Text className={classes.statValue}>14</Text>
              <Text className={classes.statLabel}>未整理書類</Text>
            </Box>
          </Box>

          <Box className={classes.heroFocus}>
            <Box className={classes.focusIcon}>
              <IconTrain size={18} />
            </Box>
            <Box className={classes.focusBody}>
              <Text className={classes.focusLabel}>いま開くべき Journey</Text>
              <Text className={classes.focusTitle}>木更津 アウトレット</Text>
              <Text className={classes.focusDetail}>11:00 に出発。移動書類は揃っています。</Text>
            </Box>
            <IconChevronRight size={18} className={classes.focusChevron} />
          </Box>
        </Box>

        <Box className={classes.section}>
          <Box className={classes.sectionHead}>
            <Text className={classes.sectionLabel}>Need Attention</Text>
            <Text className={classes.sectionLink}>すべて見る</Text>
          </Box>
          <Box className={classes.stack}>
            {attentionCards.map((card) => (
              <Box key={card.title} className={classes.alertCard}>
                <Box className={classes.alertIcon}>
                  <card.icon size={18} />
                </Box>
                <Box className={classes.alertBody}>
                  <Text className={classes.alertTitle}>{card.title}</Text>
                  <Text className={classes.alertDetail}>{card.detail}</Text>
                </Box>
                <IconAlertCircle size={18} className={classes.alertArrow} />
              </Box>
            ))}
          </Box>
        </Box>

        <Box className={classes.section}>
          <Box className={classes.sectionHead}>
            <Text className={classes.sectionLabel}>Journeys</Text>
            <Text className={classes.sectionLink}>一覧を開く</Text>
          </Box>
          <Box className={classes.stack}>
            {journeyCards.map((card, index) => (
              <Box key={card.title} className={classes.journeyCard}>
                <Box
                  className={classes.journeyCover}
                  data-variant={index === 0 ? "primary" : index === 1 ? "dark" : "muted"}
                >
                  <Text className={classes.journeyEyebrow}>{card.eyebrow}</Text>
                  <Text className={classes.journeyTitle}>{card.title}</Text>
                  <Text className={classes.journeyDetail}>{card.detail}</Text>
                </Box>
                <Box className={classes.journeyBody}>
                  <Box>
                    <Text className={classes.journeyMetaLabel}>Next Action</Text>
                    <Text className={classes.journeyMeta}>{card.meta}</Text>
                  </Box>
                  <Box className={classes.journeyBadge} data-state={card.badge}>
                    {card.badge}
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>

        <Box className={classes.section}>
          <Box className={classes.sectionHead}>
            <Text className={classes.sectionLabel}>Capture Queue</Text>
            <Text className={classes.sectionLink}>未整理を見る</Text>
          </Box>

          <Box className={classes.queueCard}>
            {captureQueue.map((item, index) => (
              <Box
                key={item.title}
                className={classes.queueRow}
                data-border={index < captureQueue.length - 1 || undefined}
              >
                <Box className={classes.queueIcon}>
                  <item.icon size={17} />
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
      </Box>

      <TabBar />
    </>
  );
}
