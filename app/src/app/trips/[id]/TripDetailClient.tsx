"use client";

import {
  ActionIcon,
  Box,
  Button,
  Menu,
  Modal,
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
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { StepDetailDrawer, emptyStepDraft } from "@/components/StepDetailDrawer";
import type { StepDraft } from "@/components/StepDetailDrawer";
import { SheetHeader } from "@/components/SheetHeader";
import classes from "./page.module.css";
import { deleteJourney, getJourney, getStepImages, updateJourney } from "@/lib/store-client";
import {
  formatDateRange,
  formatDateJP,
  getCategoryIcon,
  getNextActionStep,
  sortStepsByTime,
} from "@/lib/helpers";
import type { Journey, Step, StepStatus } from "@/lib/types";
import { formatTimeDisplay, isInternational, formatInferredFields } from "@/lib/ocr-rules";

type JourneyForm = {
  title: string;
  startDate: string;
  endDate: string;
  memo: string;
};

export default function TripDetailClient({
  initialJourney,
  journeyId,
}: {
  initialJourney: Journey | null;
  journeyId: string;
}) {
  const router = useRouter();
  const [journey, setJourney] = useState<Journey | null>(initialJourney);
  const [journeyForm, setJourneyForm] = useState<JourneyForm>({
    title: initialJourney?.title ?? "",
    startDate: initialJourney?.startDate ?? "",
    endDate: initialJourney?.endDate ?? "",
    memo: initialJourney?.memo ?? "",
  });

  // Guest mode: hydrate from localStorage after mount
  useEffect(() => {
    if (initialJourney) return;
    let cancelled = false;
    (async () => {
      const j = await getJourney(journeyId);
      if (cancelled) return;
      if (!j) {
        router.replace("/");
        return;
      }
      setJourney(j);
      setJourneyForm({
        title: j.title,
        startDate: j.startDate,
        endDate: j.endDate,
        memo: j.memo ?? "",
      });
    })();
    return () => { cancelled = true; };
  }, [initialJourney, journeyId, router]);
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
  const [journeyModalOpened, { open: openJourneyModal, close: closeJourneyModal }] =
    useDisclosure(false);
  const [deleteModalOpened, { open: openDeleteModal, close: closeDeleteModal }] =
    useDisclosure(false);
  const [journeyMenuOpened, setJourneyMenuOpened] = useState(false);
  const [draft, setDraft] = useState<StepDraft>(emptyStepDraft());
  const [editingStepId, setEditingStepId] = useState<string>("new");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [stepImages, setStepImages] = useState<{ sourceImageUrl?: string; sourceImageUrls?: string[] }>({});

  useEffect(() => {
    if (!modalOpened || editingIndex === null || !journey) {
      setStepImages({});
      return;
    }
    const step = journey.steps[editingIndex];
    if (!step) return;
    if (step.sourceImageUrl || (step.sourceImageUrls && step.sourceImageUrls.length > 0)) {
      setStepImages({ sourceImageUrl: step.sourceImageUrl, sourceImageUrls: step.sourceImageUrls });
      return;
    }
    let cancelled = false;
    getStepImages(step.id).then((imgs) => {
      if (!cancelled) setStepImages(imgs);
    });
    return () => { cancelled = true; };
  }, [modalOpened, editingIndex, journey]);

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
        style: { background: "var(--success-500)", color: "white" },
        styles: {
          description: { color: "white" },
          icon: { color: "white", background: "transparent" },
        },
      });
    }
  }, []);

  if (!journey) {
    return <LoadingOverlay />;
  }

  const sortedSteps = sortStepsByTime(journey.steps);
  const nextAction = getNextActionStep(sortedSteps);

  const persist = async (updated: Journey) => {
    setJourney(updated);
    setSaving(true);
    try {
      await updateJourney(updated.id, updated);
    } finally {
      setSaving(false);
    }
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
      memo: step.memo,
    });
    setEditingStepId(step.id);
    setEditingIndex(index);
    openModal();
  };

  // "+予定を追加" → 予定登録 (/scan) に遷移し、OCR/撮影/メール貼付/手入力の
  // フルフローを再利用する。target パラメータで現在の Journey に自動紐付け。
  const openNewStep = () => {
    router.push(`/scan?target=${journey.id}`);
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

  /**
   * ⑥ Undo delete with 5s grace window.
   * Optimistically removes the step from UI and schedules a persist.
   * If the user taps "元に戻す" within 5s the timer is cancelled.
   */
  const softDeleteStep = (index: number) => {
    if (!journey) return;
    const victim = journey.steps[index];
    if (!victim) return;
    const remaining = journey.steps.filter((_, i) => i !== index);
    const optimisticJourney = { ...journey, steps: remaining };
    setJourney(optimisticJourney);

    const toastId = `undo-step-${victim.id}`;
    let committed = false;
    const timer = window.setTimeout(async () => {
      committed = true;
      try {
        await updateJourney(optimisticJourney.id, optimisticJourney);
      } catch (e) {
        console.error("[delete-step] commit failed:", e);
      }
    }, 5000);

    notifications.show({
      id: toastId,
      autoClose: 5000,
      withBorder: false,
      style: { background: "var(--ink-700)", color: "white" },
      styles: {
        root: { color: "white" },
        body: { color: "white" },
        description: { color: "white" },
        icon: { color: "white", background: "transparent" },
      },
      icon: <IconTrash size={18} />,
      message: (
        <Box style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span>Step を削除しました</span>
          <button
            type="button"
            onClick={() => {
              if (committed) return;
              window.clearTimeout(timer);
              const restored = { ...journey };
              setJourney(restored);
              notifications.hide(toastId);
            }}
            style={{ background: "transparent", border: "none", color: "var(--accent-500)", fontWeight: 700, cursor: "pointer", padding: 0 }}
          >
            元に戻す
          </button>
        </Box>
      ),
    });
  };

  const duplicateStep = (index: number) => {
    if (!journey) return;
    const src = journey.steps[index];
    if (!src) return;
    const copy: Step = {
      ...src,
      id: crypto.randomUUID(),
      title: `${src.title} (複製)`,
      status: "未開始",
      sourceImageUrl: undefined,
      sourceImageUrls: undefined,
    };
    persist({ ...journey, steps: [...journey.steps, copy] });
    notifications.show({
      message: "Step を複製しました",
      icon: <IconCheck size={18} />,
      autoClose: 2500,
      withBorder: false,
      style: { background: "var(--success-500)", color: "white" },
      styles: { icon: { color: "white", background: "transparent" } },
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
    setDeleting(true);
    sessionStorage.setItem("toritavi_toast", "journey_deleted");
    await deleteJourney(journey.id);
    router.push("/");
  };

  return (
    <>
      {saving && <LoadingOverlay message="保存中..." />}
      {deleting && <LoadingOverlay message="削除中..." />}
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
            <Box py="xl" ta="center" bg="var(--surface)" style={{ borderRadius: "var(--r-lg)", border: "1px solid var(--border)" }}>
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
                    data-state={isDone ? "done" : isActive || isNext ? "active" : "idle"}
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
                        {step.inferred && step.inferred.length > 0
                          ? `AI推定: ${formatInferredFields(step.inferred, step.category)}（要確認）`
                          : "要確認"}
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

        <Box className={classes.addScheduleWrap}>
          <button
            type="button"
            className={classes.addScheduleButton}
            onClick={openNewStep}
          >
            <IconPlus size={18} />
            予定を追加
          </button>
        </Box>
      </Box>

      <StepDetailDrawer
        opened={modalOpened}
        onClose={closeModal}
        draft={draft}
        onChange={setDraft}
        onSave={handleSaveStep}
        isEdit={editingIndex !== null}
        editingTitle={editingIndex !== null ? journey.steps[editingIndex]?.title : undefined}
        sourceImageUrl={stepImages.sourceImageUrl}
        sourceImageUrls={stepImages.sourceImageUrls}
        needsReview={editingIndex !== null ? journey.steps[editingIndex]?.needsReview : undefined}
        inferred={editingIndex !== null ? journey.steps[editingIndex]?.inferred : undefined}
        status={editingIndex !== null ? journey.steps[editingIndex]?.status : undefined}
        onCancelEdit={() => {
          if (editingIndex === null) return;
          openEdit(editingIndex);
        }}
        onDelete={() => {
          if (editingIndex === null) return;
          const idx = editingIndex;
          closeModal();
          setTimeout(() => softDeleteStep(idx), 150);
        }}
        onDuplicate={() => {
          if (editingIndex === null) return;
          const idx = editingIndex;
          closeModal();
          setTimeout(() => duplicateStep(idx), 150);
        }}
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
          <SheetHeader
            title="Journey を編集"
            onClose={closeJourneyModal}
            leftIcon="close"
          />
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
            <button className={classes.confirmCancel} onClick={closeDeleteModal} disabled={deleting}>
              キャンセル
            </button>
            <button className={classes.confirmDelete} onClick={handleDelete} disabled={deleting}>
              {deleting ? "削除中..." : "削除する"}
            </button>
          </Box>
        </Box>
      </Modal>

      <TabBar />
    </>
  );
}
