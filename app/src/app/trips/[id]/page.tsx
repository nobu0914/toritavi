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
import {
  IconCheck,
  IconDotsVertical,
  IconEdit,
  IconPlayerPlay,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { startTransition, useEffect, useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useParams, useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { DeleteConfirmModal } from "@/components/DeleteConfirmModal";
import { TabBar } from "@/components/TabBar";
import { StepEditModal, emptyStepDraft } from "@/components/StepEditModal";
import type { StepDraft } from "@/components/StepEditModal";
import classes from "./page.module.css";
import { deleteJourney, getJourney, updateJourney } from "@/lib/store";
import { showSuccessToast } from "@/lib/toast";
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

export default function TripDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const today = getTodayDateString();
  const [journey, setJourney] = useState<Journey | null>(null);
  const [journeyForm, setJourneyForm] = useState<JourneyForm>({
    title: "", startDate: today, endDate: today, memo: "",
  });
  const [loaded, setLoaded] = useState(false);
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
  const [journeyModalOpened, { open: openJourneyModal, close: closeJourneyModal }] =
    useDisclosure(false);
  const [draft, setDraft] = useState<StepDraft>(emptyStepDraft());
  const [editingStepId, setEditingStepId] = useState<string>("new");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "step"; index: number } | { type: "journey" } | null>(null);

  useEffect(() => {
    startTransition(() => {
      const found = getJourney(id) ?? null;
      setJourney(found);
      if (found) {
        setJourneyForm({
          title: found.title,
          startDate: found.startDate,
          endDate: found.endDate,
          memo: found.memo ?? "",
        });
      }
      setLoaded(true);
    });
  }, [id]);

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
      title: draft.title.trim(),
      time: draft.time.trim(),
      detail: draft.detail.trim() || undefined,
      confNumber: draft.confNumber.trim() || undefined,
      memo: editingIndex !== null ? journey.steps[editingIndex].memo : undefined,
      source: editingIndex !== null ? journey.steps[editingIndex].source : undefined,
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
    setJourneyForm({
      title: journey.title,
      startDate: journey.startDate,
      endDate: journey.endDate,
      memo: journey.memo ?? "",
    });
    openJourneyModal();
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
    setDeleteTarget({ type: "step", index });
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
    setDeleteTarget({ type: "journey" });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "step") {
      persist({ ...journey, steps: journey.steps.filter((_, i) => i !== deleteTarget.index) });
      showSuccessToast("ステップを削除しました");
    } else {
      deleteJourney(journey.id);
      showSuccessToast("Journeyを削除しました");
      router.push("/");
    }
    setDeleteTarget(null);
  };

  return (
    <>
      <AppHeader
        title={journey.title}
        back
        backHref="/"
        action={
          <Menu position="bottom-end" withArrow>
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
              <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={handleDelete}>
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
                          onClick={() => setStepStatus(iconIndex, "進行中")}
                        >
                          進行中
                        </Menu.Item>
                        <Menu.Item
                          leftSection={<IconCheck size={14} />}
                          onClick={() => setStepStatus(iconIndex, "完了")}
                        >
                          完了
                        </Menu.Item>
                        <Menu.Item onClick={() => setStepStatus(iconIndex, "未開始")}>未開始</Menu.Item>
                        <Menu.Item onClick={() => setStepStatus(iconIndex, "遅延")}>遅延</Menu.Item>
                        <Menu.Item onClick={() => setStepStatus(iconIndex, "キャンセル")}>キャンセル</Menu.Item>
                        <Menu.Divider />
                        <Menu.Item leftSection={<IconEdit size={14} />} onClick={() => openEdit(iconIndex)}>
                          編集
                        </Menu.Item>
                        <Menu.Item
                          color="red"
                          leftSection={<IconTrash size={14} />}
                          onClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            removeStep(iconIndex);
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
      </Box>

      <StepEditModal
        opened={modalOpened}
        onClose={closeModal}
        draft={draft}
        onChange={setDraft}
        onSave={handleSaveStep}
        isEdit={editingIndex !== null}
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

      <DeleteConfirmModal
        opened={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title={
          deleteTarget?.type === "journey"
            ? "Journeyを削除しますか？"
            : "ステップを削除しますか？"
        }
        description={
          deleteTarget?.type === "journey"
            ? `「${journey.title}」とすべてのステップが削除されます。この操作は取り消せません。`
            : "このステップが削除されます。この操作は取り消せません。"
        }
      />

      <TabBar />
    </>
  );
}
