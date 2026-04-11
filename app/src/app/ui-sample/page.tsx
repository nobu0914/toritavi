import Link from "next/link";
import { Box, Text } from "@mantine/core";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import classes from "./page.module.css";

export default function UiSamplePage() {
  return (
    <>
      <AppHeader title="UIサンプル" back backHref="/" />

      <Box className={classes.screen} pb={110}>
        <Box className={classes.hero}>
          <Text className={classes.heroLabel}>Journey Workspace</Text>
          <Text className={classes.heroTitle}>3つのサンプル画面を個別に確認できます</Text>
          <Text className={classes.heroIntro}>
            トップページ、TRIP内、新規作成画面をそれぞれ別URLに分けました。
          </Text>
        </Box>

        <Box className={classes.section}>
          <Box className={classes.stack}>
            <Link href="/ui-sample/top" className={classes.sampleLink}>
              <Box className={classes.sampleCard}>
                <Text className={classes.sampleEyebrow}>Sample 1</Text>
                <Text className={classes.sampleTitle}>トップページ</Text>
                <Text className={classes.sampleDetail}>
                  概要、要確認、Journey一覧、未整理導線のあるホームUI
                </Text>
              </Box>
            </Link>
            <Link href="/ui-sample/trip" className={classes.sampleLink}>
              <Box className={classes.sampleCard}>
                <Text className={classes.sampleEyebrow}>Sample 2</Text>
                <Text className={classes.sampleTitle}>TRIP内画面</Text>
                <Text className={classes.sampleDetail}>
                  ヒーロー、タイムライン、次アクションを中心にした詳細UI
                </Text>
              </Box>
            </Link>
            <Link href="/ui-sample/new" className={classes.sampleLink}>
              <Box className={classes.sampleCard}>
                <Text className={classes.sampleEyebrow}>Sample 3</Text>
                <Text className={classes.sampleTitle}>新規作成画面</Text>
                <Text className={classes.sampleDetail}>
                  タイトル、登録済みカード、未登録カード、追加導線を持つ作成UI
                </Text>
              </Box>
            </Link>
          </Box>
        </Box>
      </Box>

      <TabBar />
    </>
  );
}
