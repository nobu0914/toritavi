import { Box, Text } from "@mantine/core";
import { IconCamera, IconCircleX, IconUpload } from "@tabler/icons-react";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import { createActions, createSteps } from "../sampleData";
import classes from "../page.module.css";

export default function UiSampleNewPage() {
  return (
    <>
      <AppHeader title="新規作成サンプル" back backHref="/ui-sample" />

      <Box className={classes.screen} pb={110}>
        <Box className={classes.section}>
          <Box className={classes.formSection}>
            <Box className={classes.formRow}>
              <Text className={classes.formLabel}>タイトル</Text>
              <Text className={classes.formValue}>例: 大阪出張</Text>
            </Box>
          </Box>

          <Text className={classes.sectionLabel}>ルート</Text>

          <Box className={classes.stepList}>
            {createSteps.map((step, index) => (
              <Box key={step.number}>
                <Box className={`${classes.stepCard} ${classes.stepDone}`}>
                  <Box className={classes.stepHead}>
                    <Box className={classes.stepHeadMeta}>
                      <Box className={classes.stepNum}>{step.number}</Box>
                      <Text className={classes.stepLabel}>{step.category}</Text>
                    </Box>
                    <Box className={classes.stepRemove}>
                      <IconCircleX size={16} />
                    </Box>
                  </Box>

                  <Text className={classes.stepTitle}>{step.title}</Text>

                  <Box className={classes.stepInfo}>
                    {step.rows.map((row) => (
                      <Box key={row.label} className={classes.stepInfoRow}>
                        <row.icon size={16} className={classes.stepInfoIcon} />
                        <Box className={classes.stepInfoText}>
                          <Text className={classes.stepInfoLabel}>{row.label}</Text>
                          <Text
                            className={`${classes.stepInfoValue} ${row.accent ? classes.stepInfoAccent : ""}`}
                          >
                            {row.value}
                          </Text>
                        </Box>
                      </Box>
                    ))}
                  </Box>

                  <Box className={classes.stepThumbs}>
                    {step.thumbs.map((thumb, thumbIndex) => (
                      <Box key={thumbIndex} className={classes.stepThumb}>
                        {thumb === "camera" ? <IconCamera size={20} /> : <IconUpload size={20} />}
                      </Box>
                    ))}
                  </Box>

                  <Box className={classes.stepSource}>{step.source}</Box>
                </Box>

                {index < createSteps.length && (
                  <Box className={classes.connector}>
                    <Box className={classes.connectorButton}>+</Box>
                  </Box>
                )}
              </Box>
            ))}

            <Box className={classes.stepCard}>
              <Box className={classes.stepHead}>
                <Box className={classes.stepHeadMeta}>
                  <Box className={classes.stepNumPending}>3</Box>
                </Box>
                <Box className={classes.stepRemove}>
                  <IconCircleX size={16} />
                </Box>
              </Box>

              <Box className={classes.stepActions}>
                {createActions.map((action) => (
                  <Box key={action.label} className={classes.stepAction}>
                    <action.icon size={20} />
                    <Text span>{action.label}</Text>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>

          <Box className={classes.createFab}>+</Box>
        </Box>
      </Box>

      <TabBar />
    </>
  );
}
