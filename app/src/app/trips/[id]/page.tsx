"use client";

import {
  ActionIcon,
  Box,
  Button,
  Menu,
  Modal,
  Skeleton,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconCheck,
  IconDotsVertical,
  IconEdit,
  IconInfoCircle,
  IconMapPin,
  IconPhone,
  IconPlayerPlay,
  IconPlus,
  IconRoute,
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
import { deleteJourney, getJourney, updateJourney } from "@/lib/store-supabase";
import {
  formatDateRange,
  formatDateJP,
  getCategoryIcon,
  getNextActionStep,
  getTodayDateString,
  sortStepsByTime,
} from "@/lib/helpers";
import type { Journey, Step, StepStatus } from "@/lib/types";
import { formatTimeDisplay, isInternational } from "@/lib/ocr-rules";

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

async function loadPageData(id: string, today: string): Promise<PageData> {
  const found = (await getJourney(id)) ?? null;
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
    loadPageData(id, today).then((nextPageData) => {
      startTransition(() => {
        setPageData(nextPageData);
        setJourneyForm(nextPageData.journeyForm);
      });
    });
  }, [id, today]);

  useEffect(() => {
    if (loaded && !journey) router.replace("/");
  }, [loaded, journey, router]);

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
        styles: {
          description: { color: "white" },
          icon: { color: "white", background: "transparent" },
        },
      });
    }
  }, []);

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
    updateJourney(updated.id, updated); // async but fire-and-forget
  };

  const openEdit = (index: number) => {
    const step = journey.steps[index];
    setDraft({
      category: step.category,
      source: step.source ?? "手入力",
      title: step.title,
      date: step.date ?? "",
      endDate: step.endDate ?? "",
      time: step.time,
      endTime: step.endTime ?? "",
      from: step.from ?? "",
      to: step.to ?? "",
      confNumber: step.confNumber ?? "",
      information: step.information ?? [],
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
      date: draft.date.trim() || undefined,
      endDate: draft.endDate.trim() || undefined,
      time: draft.time.trim(),
      endTime: draft.endTime.trim() || undefined,
      from: draft.from.trim() || undefined,
      to: draft.to.trim() || undefined,
      confNumber: draft.confNumber.trim() || undefined,
      memo: editingIndex !== null ? journey.steps[editingIndex].memo : undefined,
      sourceImageUrl: editingIndex !== null ? journey.steps[editingIndex].sourceImageUrl : undefined,
      status: editingIndex !== null ? journey.steps[editingIndex].status : "未開始",
      information: draft.information,
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

  const handleDelete = async () => {
    sessionStorage.setItem("toritavi_toast", "journey_deleted");
    await deleteJourney(journey.id);
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
            const isActive = step.status === "進行中";
            const isDone = step.status === "完了";
            const isNext = nextAction?.id === step.id;
            const isLast = index === sortedSteps.length - 1;
            const dotClass = isDone
              ? classes.timelineDotDone
              : isActive
                ? classes.timelineDotActive
                : "";
            const itemClass = isLast
              ? ""
              : isDone
                ? classes.timelineItemDone
                : isActive
                  ? classes.timelineItemActive
                  : "";
            return (
              <Box key={step.id} className={`${classes.timelineItem} ${itemClass}`}>
                {/* 時間行: ● 時間(基準) ... ステータス */}
                <Box className={classes.timelineTimeRow}>
                  <Box className={`${classes.timelineDot} ${dotClass} ${step.needsReview ? classes.timelineDotReview : ""}`} />
                  <Text className={classes.timelineTimeText}>
                    {formatTimeDisplay(
                      step.time?.match(/\d{1,2}:\d{2}/)?.[0] || "--:--",
                      { timezone: step.timezone, compact: true }
                    )}
                  </Text>
                  <Box style={{ flex: 1 }} />
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
                </Box>

                {/* カード（情報量を絞った一覧向け） */}
                <Box
                  className={`${classes.timelineCard} ${isNext ? classes.timelineCardActive : ""} ${step.needsReview ? classes.timelineCardReview : ""}`}
                  onClick={() => openEdit(iconIndex)}
                >
                  <Box className={classes.timelineCardBody}>
                    {/* 1行目: 区間 */}
                    {(step.from || step.to) ? (
                      <Text className={classes.timelineRoute}>
                        {[step.from, step.to].filter(Boolean).join(" → ")}
                      </Text>
                    ) : step.detail ? (
                      <Text className={classes.timelineRoute}>{step.detail}</Text>
                    ) : (
                      <Text className={classes.timelineRoute}>{step.title}</Text>
                    )}

                    {/* 2行目: 到着時刻 */}
                    {step.endTime && (
                      <Text className={classes.timelineArrival}>
                        {formatTimeDisplay(step.endTime, {
                          timezone: step.timezone,
                          crossDay: !!(step.endDate && step.date && step.endDate !== step.date),
                          compact: true,
                        })} 到着
                      </Text>
                    )}

                    {/* 宿泊: 期間表示 */}
                    {step.category === "宿泊" && step.endDate && step.date && step.endDate !== step.date && (
                      <Text className={classes.timelineArrival}>
                        {step.endDate} {step.endTime || ""} チェックアウト
                      </Text>
                    )}

                    {/* 3行目: 便名・タイトル（区間と異なる場合のみ） */}
                    {(step.from || step.to) && (
                      <Text className={classes.timelineFlightNo}>{step.title}</Text>
                    )}

                    {/* 4行目: 要確認（ある場合のみ） */}
                    {step.needsReview && (
                      <Text className={classes.timelineReviewInline}>
                        要確認{step.inferred && step.inferred.length > 0 ? `: ${step.inferred.join(", ")}` : ""}
                      </Text>
                    )}
                  </Box>
                </Box>

                {/* カード間アクションバー */}
                {!isLast && (() => {
                  const nextStep = sortedSteps[index + 1];
                  const origin = step.to || step.from || step.title;
                  const dest = nextStep?.from || nextStep?.to || nextStep?.title || "";
                  return (
                    <Box className={classes.actionBar}>
                      <button className={classes.actionBtn} onClick={(e) => { e.stopPropagation(); /* TODO */ }}>
                        <IconPlus size={14} />
                        <span>予定追加</span>
                      </button>
                      <button
                        className={classes.actionBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(
                            `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}&travelmode=transit`,
                            "_blank", "noopener"
                          );
                        }}
                      >
                        <IconRoute size={14} />
                        <span>経路</span>
                      </button>
                      <button
                        className={classes.actionBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(
                            `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}&travelmode=driving`,
                            "_blank", "noopener"
                          );
                        }}
                      >
                        <IconPhone size={14} />
                        <span>タクシー</span>
                      </button>
                    </Box>
                  );
                })()}
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
        sourceImageUrl={editingIndex !== null ? journey.steps[editingIndex]?.sourceImageUrl : undefined}
        sourceImageUrls={editingIndex !== null ? journey.steps[editingIndex]?.sourceImageUrls : undefined}
        needsReview={editingIndex !== null ? journey.steps[editingIndex]?.needsReview : undefined}
        inferred={editingIndex !== null ? journey.steps[editingIndex]?.inferred : undefined}
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
