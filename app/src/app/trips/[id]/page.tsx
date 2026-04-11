"use client";

import {
  ActionIcon,
  Box,
  Button,
  Menu,
  Modal,
  Skeleton,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconCamera,
  IconCheck,
  IconDotsVertical,
  IconEdit,
  IconUpload,
  IconInfoCircle,
  IconPlayerPlay,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { startTransition, useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useParams, useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import { StepEditModal, emptyStepDraft } from "@/components/StepEditModal";
import type { StepDraft } from "@/components/StepEditModal";
import classes from "./page.module.css";
import { deleteJourney, getJourney, updateJourney } from "@/lib/store";
import {
  formatDateRange,
  formatDateJP,
  getCategoryIcon,
  getNextActionStep,
  getTodayDateString,
  sortStepsByTime,
} from "@/lib/helpers";
import type { Journey, Step, StepStatus } from "@/lib/types";

type JourneyForm = {
  title: string;
  startDate: string;
  endDate: string;
  memo: string;
};

type PageData = {
  journey: Journey | null;
  journeyForm: JourneyForm;
  loaded: boolean;
};

function createInitialPageData(today: string): PageData {
  return {
    journey: null,
    journeyForm: { title: "", startDate: today, endDate: today, memo: "" },
    loaded: false,
  };
}

function loadPageData(id: string, today: string): PageData {
  const found = getJourney(id) ?? null;
  return {
    journey: found,
    journeyForm: found
      ? { title: found.title, startDate: found.startDate, endDate: found.endDate, memo: found.memo ?? "" }
      : { title: "", startDate: today, endDate: today, memo: "" },
    loaded: true,
  };
}

export default function TripDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const today = getTodayDateString();
  const [pageData, setPageData] = useState<PageData>(() => createInitialPageData(today));
  const { journey, loaded } = pageData;
  const setJourney = (j: Journey | null) => setPageData((d) => ({ ...d, journey: j }));
  const [journeyForm, setJourneyForm] = useState<JourneyForm>(() => createInitialPageData(today).journeyForm);
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
  const [journeyModalOpened, { open: openJourneyModal, close: closeJourneyModal }] =
    useDisclosure(false);
  const [deleteModalOpened, { open: openDeleteModal, close: closeDeleteModal }] =
    useDisclosure(false);
  const [stepDeleteModalOpened, { open: openStepDeleteModal, close: closeStepDeleteModal }] =
    useDisclosure(false);
  const [journeyMenuOpened, setJourneyMenuOpened] = useState(false);
  const [draft, setDraft] = useState<StepDraft>(emptyStepDraft());
  const [editingStepId, setEditingStepId] = useState<string>("new");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [pendingStepDeleteIndex, setPendingStepDeleteIndex] = useState<number | null>(null);

  useEffect(() => {
    startTransition(() => {
      const nextPageData = loadPageData(id, today);
      setPageData(nextPageData);
      setJourneyForm(nextPageData.journeyForm);
    });
  }, [id, today]);

  useEffect(() => {
    if (loaded && !journey) router.replace("/");
  }, [loaded, journey, router]);

  if (!loaded || !journey) {
    return (
      <Box>
        <Skeleton height={52} radius={0} />
        <Skeleton height={120} radius={0} />
        <Box style={{ padding: "16px" }}>
          <Skeleton height={16} width="40%" mb={16} />
          {[1, 2, 3].map((i) => (
            <Box key={i} style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <Skeleton height={12} width={44} />
              <Skeleton circle height={12} />
              <Skeleton height={60} style={{ flex: 1 }} radius={8} />
            </Box>
          ))}
        </Box>
        <TabBar />
      </Box>
    );
  }

  const sortedSteps = sortStepsByTime(journey.steps);
  const nextAction = getNextActionStep(sortedSteps);

  const persist = (updated: Journey) => {
    setJourney(updated);
    updateJourney(updated.id, updated);
  };

  const openEdit = (index: number) => {
    const step = journey.steps[index];
    setDraft({
      category: step.category,
      source: step.source ?? "手入力",
      title: step.title,
      time: step.time,
      detail: step.detail ?? "",
      confNumber: step.confNumber ?? "",
    });
    setEditingStepId(step.id);
    setEditingIndex(index);
    openModal();
  };

  const handleSaveStep = () => {
    if (!draft.title.trim()) return;

    const step: Step = {
      id: editingStepId,
      category: draft.category,
      source: draft.source,
      title: draft.title.trim(),
      time: draft.time.trim(),
      detail: draft.detail.trim() || undefined,
      confNumber: draft.confNumber.trim() || undefined,
      memo: editingIndex !== null ? journey.steps[editingIndex].memo : undefined,
      status: editingIndex !== null ? journey.steps[editingIndex].status : "未開始",
      information: editingIndex !== null ? journey.steps[editingIndex].information : [],
    };

    const nextSteps =
      editingIndex !== null
        ? journey.steps.map((item, index) => (index === editingIndex ? step : item))
        : [...journey.steps, step];

    persist({ ...journey, steps: nextSteps });
    closeModal();
  };

  const openJourneyEdit = () => {
    setJourneyMenuOpened(false);
    setJourneyForm({
      title: journey.title,
      startDate: journey.startDate,
      endDate: journey.endDate,
      memo: journey.memo ?? "",
    });
    openJourneyModal();
  };

  const requestJourneyDelete = () => {
    setJourneyMenuOpened(false);
    window.setTimeout(() => {
      openDeleteModal();
    }, 0);
  };

  const saveJourneyDetails = () => {
    if (!journeyForm.title.trim() || !journeyForm.startDate || !journeyForm.endDate) return;

    const sortedDates =
      journeyForm.startDate <= journeyForm.endDate
        ? { startDate: journeyForm.startDate, endDate: journeyForm.endDate }
        : { startDate: journeyForm.endDate, endDate: journeyForm.startDate };

    persist({
      ...journey,
      title: journeyForm.title.trim(),
      startDate: sortedDates.startDate,
      endDate: sortedDates.endDate,
      memo: journeyForm.memo.trim() || undefined,
    });
    closeJourneyModal();
  };

  const removeStep = (index: number) => {
    persist({ ...journey, steps: journey.steps.filter((_, stepIndex) => stepIndex !== index) });
  };

  const requestStepDelete = (index: number) => {
    setPendingStepDeleteIndex(index);
    window.setTimeout(() => {
      openStepDeleteModal();
    }, 0);
  };

  const confirmStepDelete = () => {
    if (pendingStepDeleteIndex === null) return;
    removeStep(pendingStepDeleteIndex);
    setPendingStepDeleteIndex(null);
    closeStepDeleteModal();
    notifications.show({
      message: "Step を削除しました",
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
  };

  const setStepStatus = (index: number, status: StepStatus) => {
    persist({
      ...journey,
      steps: journey.steps.map((item, stepIndex) =>
        stepIndex === index ? { ...item, status } : item
      ),
    });
  };

  const handleDelete = () => {
    sessionStorage.setItem("toritavi_toast", "journey_deleted");
    deleteJourney(journey.id);
    router.push("/");
  };

  return (
    <>
      <AppHeader
        title={journey.title}
        back
        backHref="/"
        action={
          <Menu
            position="bottom-end"
            withArrow
            opened={journeyMenuOpened}
            onChange={setJourneyMenuOpened}
          >
            <Menu.Target>
              <ActionIcon variant="transparent" color="white" radius="sm">
                <IconDotsVertical size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconEdit size={14} />} onClick={openJourneyEdit}>
                Journey を編集
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={14} />}
                onClick={requestJourneyDelete}
              >
                Journey を削除
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        }
      />

      <Box className={classes.hero}>
        <Text className={classes.heroTitle}>{journey.title}</Text>
        <Text className={classes.heroDate}>{formatDateRange(journey.startDate, journey.endDate)}</Text>
        <Box className={classes.heroSummary}>
          {(() => {
            const counts: Record<string, number> = {};
            journey.steps.forEach((s) => {
              counts[s.category] = (counts[s.category] || 0) + 1;
            });
            return Object.entries(counts).map(([cat, count]) => (
              <Text key={cat} span>
                {count} {cat}
              </Text>
            ));
          })()}
        </Box>
      </Box>

      <Box pb={110}>
        <Box className={classes.dayHeader}>
          {formatDateJP(journey.startDate)}
          <Box className={classes.dayLine} />
        </Box>

        <Box className={classes.timeline}>
          {sortedSteps.length === 0 && (
            <Box py="xl" ta="center" bg="white" style={{ borderRadius: 8, border: "1px solid var(--mantine-color-gray-2)" }}>
              <Text fw={800}>ステップを追加してください</Text>
              <Text size="sm" c="dimmed" mt={6}>
                移動、宿泊、予定を追加するとこの Journey が動き始めます。
              </Text>
            </Box>
          )}

          {sortedSteps.map((step, index) => {
            const iconIndex = journey.steps.findIndex((item) => item.id === step.id);
            const Icon = getCategoryIcon(step.category);
            const isActive = step.status === "進行中";
            const isDone = step.status === "完了";
            const isNext = nextAction?.id === step.id;
            const isLast = index === sortedSteps.length - 1;
            const lineClass = isLast
              ? classes.timelineLineLast
              : isDone
                ? classes.timelineLineDone
                : isActive
                  ? classes.timelineLineActive
                  : "";
            const dotClass = isDone
              ? classes.timelineDotDone
              : isActive
                ? classes.timelineDotActive
                : "";
            return (
              <Box key={step.id} className={classes.timelineItem}>
                <Box className={classes.timelineTime}>
                  {step.time?.match(/\d{1,2}:\d{2}/)?.[0] || "--:--"}
                </Box>
                <Box className={classes.timelineRail}>
                  <Box className={`${classes.timelineDot} ${dotClass}`} />
                  <Box className={`${classes.timelineLine} ${lineClass}`} />
                </Box>
                <Box
                  className={`${classes.timelineCard} ${isNext ? classes.timelineCardActive : ""}`}
                  onClick={() => openEdit(iconIndex)}
                >
                  <Box className={`${classes.timelineCardIcon} ${isDone ? classes.timelineCardIconDone : ""}`}>
                    <Icon size={20} />
                  </Box>
                  <Box className={classes.timelineCardBody}>
                    <Text className={classes.timelineType}>{step.category}</Text>
                    <Text className={classes.timelineTitle}>{step.title}</Text>
                    {step.detail && <Text className={classes.timelineDetail}>{step.detail}</Text>}
                    {step.time && step.time !== (step.time.match(/\d{1,2}:\d{2}/)?.[0] || "") && (
                      <Text className={classes.timelineDetail}>{step.time}</Text>
                    )}
                    {step.confNumber && (
                      <Text className={classes.timelineConf}>Conf# {step.confNumber}</Text>
                    )}
                    {(step.source === "撮影" || step.source === "アップロード") && (
                      <Box className={classes.timelinePreview}>
                        <Box className={classes.timelinePreviewThumb}>
                          <Box className={classes.timelinePreviewTop}>
                            {step.source === "撮影" ? <IconCamera size={12} /> : <IconUpload size={12} />}
                            <Text span className={classes.timelinePreviewMeta}>
                              {step.source === "撮影" ? "IMG_2404" : "ticket.pdf"}
                            </Text>
                          </Box>
                          <Box className={classes.timelinePreviewPaper}>
                            <Box className={classes.timelinePreviewLineShort} />
                            <Box className={classes.timelinePreviewLineLong} />
                            <Box className={classes.timelinePreviewLineLong} />
                          </Box>
                        </Box>
                        {step.source === "アップロード" && (
                          <Box className={classes.timelinePreviewThumb}>
                            <Box className={classes.timelinePreviewTop}>
                              <IconUpload size={12} />
                              <Text span className={classes.timelinePreviewMeta}>
                                page-2.pdf
                              </Text>
                            </Box>
                            <Box className={classes.timelinePreviewPaper}>
                              <Box className={classes.timelinePreviewLineShort} />
                              <Box className={classes.timelinePreviewLineLong} />
                              <Box className={classes.timelinePreviewStamp}>PDF</Box>
                            </Box>
                          </Box>
                        )}
                      </Box>
                    )}
                  </Box>
                  <Stack gap={6} align="flex-end">
                    <Menu position="bottom-end" withArrow>
                      <Menu.Target>
                        <ActionIcon variant="subtle" color="gray" onClick={(e) => e.stopPropagation()}>
                          <IconDotsVertical size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Label>ステータス変更</Menu.Label>
                        <Menu.Item
                          leftSection={<IconPlayerPlay size={14} />}
                          onClick={(e) => {
                            e.stopPropagation();
                            setStepStatus(iconIndex, "進行中");
                          }}
                        >
                          進行中
                        </Menu.Item>
                        <Menu.Item
                          leftSection={<IconCheck size={14} />}
                          onClick={(e) => {
                            e.stopPropagation();
                            setStepStatus(iconIndex, "完了");
                          }}
                        >
                          完了
                        </Menu.Item>
                        <Menu.Item onClick={(e) => {
                          e.stopPropagation();
                          setStepStatus(iconIndex, "未開始");
                        }}>未開始</Menu.Item>
                        <Menu.Item onClick={(e) => {
                          e.stopPropagation();
                          setStepStatus(iconIndex, "遅延");
                        }}>遅延</Menu.Item>
                        <Menu.Item onClick={(e) => {
                          e.stopPropagation();
                          setStepStatus(iconIndex, "キャンセル");
                        }}>キャンセル</Menu.Item>
                        <Menu.Divider />
                        <Menu.Item leftSection={<IconEdit size={14} />} onClick={(e) => {
                          e.stopPropagation();
                          openEdit(iconIndex);
                        }}>
                          編集
                        </Menu.Item>
                        <Menu.Item
                          color="red"
                          leftSection={<IconTrash size={14} />}
                          onClick={(e) => {
                            e.stopPropagation();
                            requestStepDelete(iconIndex);
                          }}
                        >
                          削除
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                    <Box
                      className={classes.timelineBadge}
                      style={{
                        background: isDone
                          ? "var(--mantine-color-teal-0)"
                          : isActive || isNext
                            ? "var(--mantine-color-blue-0)"
                            : "var(--mantine-color-gray-1)",
                        color: isDone
                          ? "var(--mantine-color-teal-8)"
                          : isActive || isNext
                            ? "var(--mantine-color-blue-7)"
                            : "var(--mantine-color-gray-7)",
                      }}
                    >
                      {isNext && !isDone ? "次" : step.status}
                    </Box>
                  </Stack>
                </Box>
              </Box>
            );
          })}
        </Box>

        {journey.memo && (
          <Box className={classes.notesCard}>
            <Text className={classes.notesHeader}>Notes</Text>
            <Text className={classes.notesBody}>{journey.memo}</Text>
          </Box>
        )}

        <Box className={classes.dangerZone}>
          <button
            className={classes.deleteScheduleButton}
            onClick={requestJourneyDelete}
          >
            スケジュールを削除
          </button>
        </Box>
      </Box>

      <StepEditModal
        opened={modalOpened}
        onClose={closeModal}
        draft={draft}
        onChange={setDraft}
        onSave={handleSaveStep}
        isEdit={editingIndex !== null}
        editingTitle={editingIndex !== null ? journey.steps[editingIndex]?.title : undefined}
      />

      <Modal
        opened={journeyModalOpened}
        onClose={closeJourneyModal}
        centered
        radius="md"
        classNames={{ content: classes.editModal }}
        withCloseButton={false}
      >
        <Box className={classes.modalPanel}>
          <Box className={classes.modalTop}>
            <Text className={classes.modalTitle}>Journey を編集</Text>
            <ActionIcon variant="subtle" color="gray" radius="xl" onClick={closeJourneyModal}>
              <IconX size={18} />
            </ActionIcon>
          </Box>
          <Box className={classes.modalBody}>
            <Text className={classes.modalSectionLabel}>Journey</Text>
            <Box className={classes.formSection}>
              <Box className={classes.formRow}>
                <Text className={classes.formLabel}>タイトル</Text>
                <TextInput
                  className={classes.plainInput}
                  variant="unstyled"
                  placeholder="例: 大阪出張 / 京都一日旅"
                  value={journeyForm.title}
                  onChange={(e) =>
                    setJourneyForm((current) => ({ ...current, title: e.currentTarget.value }))
                  }
                  required
                />
              </Box>
              <Box className={classes.formRow}>
                <Box className={classes.dateGrid}>
                  <Box>
                    <Text className={classes.formLabel}>開始日</Text>
                    <TextInput
                      className={classes.plainInput}
                      variant="unstyled"
                      type="date"
                      value={journeyForm.startDate}
                      onChange={(e) =>
                        setJourneyForm((current) => ({ ...current, startDate: e.currentTarget.value }))
                      }
                    />
                  </Box>
                  <Box>
                    <Text className={classes.formLabel}>終了日</Text>
                    <TextInput
                      className={classes.plainInput}
                      variant="unstyled"
                      type="date"
                      min={journeyForm.startDate}
                      value={journeyForm.endDate}
                      onChange={(e) =>
                        setJourneyForm((current) => ({ ...current, endDate: e.currentTarget.value }))
                      }
                    />
                  </Box>
                </Box>
              </Box>
              <Box className={classes.formRow}>
                <Text className={classes.formLabel}>メモ</Text>
                <TextInput
                  className={classes.plainInput}
                  variant="unstyled"
                  placeholder="目的、持ち物、注意点など"
                  value={journeyForm.memo}
                  onChange={(e) =>
                    setJourneyForm((current) => ({ ...current, memo: e.currentTarget.value }))
                  }
                />
              </Box>
            </Box>
            <Button
              className={classes.saveButton}
              radius="md"
              onClick={saveJourneyDetails}
              disabled={!journeyForm.title.trim() || !journeyForm.startDate || !journeyForm.endDate}
            >
              更新
            </Button>
          </Box>
        </Box>
      </Modal>

      <Modal
        opened={deleteModalOpened}
        onClose={closeDeleteModal}
        centered
        radius="md"
        classNames={{ content: classes.confirmModal }}
        withCloseButton={false}
      >
        <Box className={classes.confirmPanel}>
          <Text className={classes.confirmTitle}>Journeyを削除しますか？</Text>
          <Text className={classes.confirmBody}>
            「{journey.title}」とすべてのPlanが削除されます。この操作は取り消せません。
          </Text>
          <Box className={classes.confirmFooter}>
            <button className={classes.confirmCancel} onClick={closeDeleteModal}>
              キャンセル
            </button>
            <button className={classes.confirmDelete} onClick={handleDelete}>
              削除する
            </button>
          </Box>
        </Box>
      </Modal>

      <Modal
        opened={stepDeleteModalOpened}
        onClose={() => {
          setPendingStepDeleteIndex(null);
          closeStepDeleteModal();
        }}
        centered
        radius="md"
        classNames={{ content: classes.confirmModal }}
        withCloseButton={false}
      >
        <Box className={classes.confirmPanel}>
          <Text className={classes.confirmTitle}>ステップを削除しますか？</Text>
          <Text className={classes.confirmBody}>
            {pendingStepDeleteIndex !== null
              ? `「${journey.steps[pendingStepDeleteIndex]?.title ?? ""}」が削除されます。この操作は取り消せません。`
              : "この操作は取り消せません。"}
          </Text>
          <Box className={classes.confirmFooter}>
            <button
              className={classes.confirmCancel}
              onClick={() => {
                setPendingStepDeleteIndex(null);
                closeStepDeleteModal();
              }}
            >
              キャンセル
            </button>
            <button className={classes.confirmDelete} onClick={confirmStepDelete}>
              削除する
            </button>
          </Box>
        </Box>
      </Modal>

      <TabBar />
    </>
  );
}
