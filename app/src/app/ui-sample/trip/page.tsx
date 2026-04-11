import { Box, Text } from "@mantine/core";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import { plans } from "../sampleData";
import classes from "../page.module.css";

export default function UiSampleTripPage() {
  return (
    <>
      <AppHeader title="TRIP内サンプル" back backHref="/ui-sample" />

      <Box className={classes.screen} pb={110}>
        <Box className={classes.section}>
          <Box className={classes.detailHero}>
            <Box className={classes.detailHeroTop}>
              <Text className={classes.detailTitle}>木更津 アウトレット</Text>
              <Box className={classes.inlineBadge}>進行中</Box>
            </Box>
            <Text className={classes.detailDate}>4月18日 (土)</Text>
            <Text className={classes.detailSummary}>車 1 / 観光 1 / 食事 1</Text>
          </Box>

          <Box className={classes.timeline}>
            {plans.map((plan) => (
              <Box key={plan.time + plan.title} className={classes.timelineRow}>
                <Text className={classes.timelineTime}>{plan.time}</Text>
                <Box className={classes.timelineRail}>
                  <Box className={classes.timelineDot} data-state={plan.state} />
                  <Box className={classes.timelineLine} />
                </Box>
                <Box className={classes.planCard} data-state={plan.state}>
                  <Box className={classes.planIcon}>
                    <plan.icon size={18} />
                  </Box>
                  <Box className={classes.planBody}>
                    <Text className={classes.planType}>{plan.info}</Text>
                    <Text className={classes.planTitle}>{plan.title}</Text>
                    <Text className={classes.planDetail}>{plan.detail}</Text>
                  </Box>
                  {plan.state === "next" && <Box className={classes.nextBadge}>次</Box>}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>

      <TabBar />
    </>
  );
}
