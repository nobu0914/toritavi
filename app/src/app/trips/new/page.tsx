"use client";

import {
  Box,
  Button,
  Modal,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconCamera,
  IconCircleX,
  IconClock,
  IconCopy,
  IconDeviceFloppy,
  IconInfoCircle,
  IconMail,
  IconMapPin,
  IconPlus,
  IconTypography,
  IconUpload,
} from "@tabler/icons-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDisclosure } from "@mantine/hooks";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import { StepEditModal, emptyStepDraft } from "@/components/StepEditModal";
import type { StepDraft } from "@/components/StepEditModal";
import classes from "./page.module.css";
import {
  addJourney,
  clearJourneyDraft,
  generateId,
  getJourneyDraft,
  saveJourneyDraft,
} from "@/lib/store";
import { getCategoryIcon, getSourceIcon, getSourceLabel, getTodayDateString } from "@/lib/helpers";
import type { JourneyDraftItem, Step, StepCategory, StepSource } from "@/lib/types";

const actions: { icon: typeof IconCamera; label: string; key: StepSource }[] = [
  { icon: IconCamera, label: "撮影", key: "撮影" },
  { icon: IconUpload, label: "アップロード", key: "アップロード" },
  { icon: IconMail, label: "メール", key: "メール" },
  { icon: IconTypography, label: "手入力", key: "手入力" },
];

const REMOVE_ANIMATION_MS = 260;

function getPrimaryStepIcon(category?: StepCategory) {
  return getCategoryIcon(category ?? "その他");
}

// モック s-new 準拠のサンプルデータ（固定ID）
const defaultItems: JourneyDraftItem[] = [
  {
    id: "sample-new-1",
    registered: true,
    source: "撮影",
    step: {
      id: "sample-new-1",
      category: "列車",
      title: "のぞみ 225号",
      time: "10:00 → 12:30",
      detail: "東京 → 新大阪",
      confNumber: "TK-882541",
      source: "撮影",
      status: "未開始",
      information: [],
    },
  },
  {
    id: "sample-new-2",
    registered: true,
    source: "メール",
    step: {
      id: "sample-new-2",
      category: "商談",
      title: "ABC社 商談",
      time: "14:00 - 16:00",
      detail: "大阪市北区梅田1-2-3",
      source: "メール",
      status: "未開始",
      information: [],
    },
  },
  {
    id: "sample-new-3",
    registered: true,
    source: "アップロード",
    step: {
      id: "sample-new-3",
      category: "宿泊",
      title: "ホテル大阪ベイ",
      time: "Check-in 18:00 / Check-out 11:00",
      confNumber: "H-283901",
      source: "アップロード",
      status: "未開始",
      information: [],
    },
  },
  {
    id: "sample-new-4",
    registered: false,
  },
];

type FormState = {
  title: string;
  memo: string;
  startDate: string;
  endDate: string;
  items: JourneyDraftItem[];
};

function loadInitialForm(today: string): FormState {
  if (typeof window !== "undefined") {
    const saved = getJourneyDraft();
    if (saved?.title) {
      return {
        title: saved.title,
        memo: saved.memo ?? "",
        startDate: saved.startDate || today,
        endDate: saved.endDate || saved.startDate || today,
        items: saved.items.length ? saved.items : defaultItems,
      };
    }
    // 古い空の下書きをクリア
    clearJourneyDraft();
  }
  return { title: "", memo: "", startDate: today, endDate: today, items: defaultItems };
}

export default function NewTripPage() {
  const router = useRouter();
  const today = getTodayDateString();
  const [form, setForm] = useState<FormState>(() => loadInitialForm(today));
  const { title, memo, startDate, endDate, items } = form;
  const setTitle = (v: string) => setForm((f) => ({ ...f, title: v }));
  const setMemo = (v: string) => setForm((f) => ({ ...f, memo: v }));
  const setItems = (fn: JourneyDraftItem[] | ((prev: JourneyDraftItem[]) => JourneyDraftItem[])) =>
    setForm((f) => ({ ...f, items: typeof fn === "function" ? fn(f.items) : fn }));
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
  const [cameraOpened, { open: openCamera, close: closeCamera }] = useDisclosure(false);
  const [deleteModalOpened, { open: openDeleteModal, close: closeDeleteModal }] =
    useDisclosure(false);
  const [scheduleDeleteModalOpened, { open: openScheduleDeleteModal, close: closeScheduleDeleteModal }] =
    useDisclosure(false);
  const [draft, setDraft] = useState<StepDraft>(emptyStepDraft());
  const [targetItemId, setTargetItemId] = useState<string | null>(null);
  const [targetSource, setTargetSource] = useState<StepSource>("手入力");
  const [pendingDeleteItemId, setPendingDeleteItemId] = useState<string | null>(null);
  const [removingItemId, setRemovingItemId] = useState<string | null>(null);

  const openManualInput = (itemId: string) => {
    const item = items.find((entry) => entry.id === itemId);
    if (item?.registered && item.step) {
      setDraft({
        category: item.step.category,
        source: item.step.source ?? item.source ?? "手入力",
        title: item.step.title,
        time: item.step.time,
        detail: item.step.detail ?? "",
        confNumber: item.step.confNumber ?? "",
      });
    } else {
      setDraft(emptyStepDraft());
    }
    setTargetItemId(itemId);
    setTargetSource("手入力");
    openModal();
  };

  const openCameraForItem = (itemId: string) => {
    setTargetItemId(itemId);
    setTargetSource("撮影");
    openCamera();
  };

  const saveDraft = () => {
    if (!draft.title.trim() || !targetItemId) return;
    const step: Step = {
      id: targetItemId,
      category: draft.category,
      source: draft.source,
      title: draft.title.trim(),
      time: draft.time.trim(),
      detail: draft.detail.trim() || undefined,
      confNumber: draft.confNumber.trim() || undefined,
      status: "未開始",
      information: [],
    };

    setItems((prev) =>
      prev.map((item) =>
        item.id === targetItemId
          ? { ...item, registered: true, source: draft.source, step }
          : item
      )
    );
    closeModal();
  };

  const addStep = () => {
    setItems((prev) => [...prev, { id: generateId(), registered: false }]);
  };

  const insertStep = (afterIndex: number) => {
    setItems((prev) => {
      const next = [...prev];
      next.splice(afterIndex + 1, 0, { id: generateId(), registered: false });
      return next;
    });
  };

  const removeStep = (itemId: string) => {
    setItems((prev) => prev.filter((item) => item.id !== itemId));
  };

  const requestRemoveStep = (itemId: string) => {
    setPendingDeleteItemId(itemId);
    openDeleteModal();
  };

  const confirmRemoveStep = () => {
    if (!pendingDeleteItemId) return;
    const itemId = pendingDeleteItemId;
    setRemovingItemId(itemId);
    setPendingDeleteItemId(null);
    closeDeleteModal();
    window.setTimeout(() => {
      removeStep(itemId);
      setRemovingItemId((current) => (current === itemId ? null : current));
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
    }, REMOVE_ANIMATION_MS);
  };

  const handleCreate = () => {
    if (!title.trim() || !startDate || !endDate) return;
    const now = new Date().toISOString();
    const steps = items.filter((item) => item.registered && item.step).map((item) => item.step!);
    const sortedDates =
      startDate <= endDate ? { startDate, endDate } : { startDate: endDate, endDate: startDate };

    addJourney({
      id: generateId(),
      title: title.trim(),
      startDate: sortedDates.startDate,
      endDate: sortedDates.endDate,
      memo: memo.trim() || undefined,
      steps,
      createdAt: now,
      updatedAt: now,
    });

    clearJourneyDraft();
    sessionStorage.setItem("toritavi_toast", "journey_created");
    router.push("/");
  };

  const handleSaveJourneyDraft = () => {
    const sortedDates =
      startDate && endDate && startDate > endDate
        ? { startDate: endDate, endDate: startDate }
        : { startDate: startDate || today, endDate: endDate || startDate || today };

    saveJourneyDraft({
      title,
      memo,
      startDate: sortedDates.startDate,
      endDate: sortedDates.endDate,
      items,
      savedAt: new Date().toISOString(),
    });
    router.push("/");
  };

  const handleDeleteSchedule = () => {
    clearJourneyDraft();
    sessionStorage.setItem("toritavi_toast", "schedule_deleted");
    router.push("/");
  };

  return (
    <>
      <AppHeader title="新規作成" back backHref="/" />

      <Box className={classes.screen} pt="xs" pb={110}>
        <Box className={classes.formSection}>
          <Box className={classes.formRow}>
            <Text className={classes.formLabel}>タイトル</Text>
            <TextInput
              className={classes.titleInput}
              variant="unstyled"
              placeholder="例: 大阪出張"
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
            />
          </Box>
        </Box>

        <Text className={classes.sectionLabel}>ルート</Text>

        <Box className={classes.stepList}>
          {items.map((item, i) => (
            <Box
              key={item.id}
              className={classes.stepItem}
              data-removing={removingItemId === item.id || undefined}
            >
              <Box className={`${classes.stepCard} ${item.registered ? classes.stepDone : ""}`}>
                <Box className={classes.stepHead}>
                  <Box className={classes.stepHeadMeta}>
                    <Box className={classes.stepNum}>{i + 1}</Box>
                    <Text className={classes.stepLabel}>{item.step?.category ?? ""}</Text>
                    {!item.registered && (
                      <Text style={{ fontSize: 9, color: "var(--mantine-color-gray-4)", fontWeight: 600, marginLeft: "auto" }}>
                        新規個別カード
                      </Text>
                    )}
                  </Box>
                  <button
                    className={classes.stepRemove}
                    onClick={() => requestRemoveStep(item.id)}
                  >
                    <IconCircleX size={16} />
                  </button>
                </Box>

                {item.registered && item.step ? (
                  <Box style={{ cursor: "pointer" }} onClick={() => openManualInput(item.id)}>
                    <Box className={classes.stepInfo}>
                      <Box className={classes.stepInfoRow}>
                        {(() => {
                          const Icon = getPrimaryStepIcon(item.step.category);
                          return <Icon size={16} className={classes.stepInfoIcon} />;
                        })()}
                        <Box className={classes.stepInfoText}>
                          <Text className={classes.stepInfoValue}>{item.step.title}</Text>
                        </Box>
                      </Box>
                      {item.step.time && (
                        <Box className={classes.stepInfoRow}>
                          <IconClock size={16} className={classes.stepInfoIcon} />
                          <Box className={classes.stepInfoText}>
                            <Text className={classes.stepInfoLabel}>時間</Text>
                            <Text className={classes.stepInfoValue}>{item.step.time}</Text>
                          </Box>
                        </Box>
                      )}
                      {item.step.detail && (
                        <Box className={classes.stepInfoRow}>
                          <IconMapPin size={16} className={classes.stepInfoIcon} />
                          <Box className={classes.stepInfoText}>
                            <Text className={classes.stepInfoLabel}>
                              {item.step.category === "列車" ? "区間" : "場所"}
                            </Text>
                            <Text className={classes.stepInfoValue}>{item.step.detail}</Text>
                          </Box>
                        </Box>
                      )}
                      {item.step.confNumber && (
                        <Box className={classes.stepInfoRow}>
                          <IconCopy size={16} className={classes.stepInfoIcon} />
                          <Box className={classes.stepInfoText}>
                            <Text className={classes.stepInfoLabel}>確認番号</Text>
                            <Text className={`${classes.stepInfoValue} ${classes.stepConf}`}>
                              {item.step.confNumber}
                            </Text>
                          </Box>
                        </Box>
                      )}
                    </Box>
                    {(item.source === "撮影" || item.source === "アップロード") && (
                      <Box className={classes.stepThumb}>
                        <Box className={classes.stepThumbImg}>
                          <Box className={classes.stepThumbTop}>
                            {item.source === "撮影" ? <IconCamera size={12} /> : <IconUpload size={12} />}
                            <Text span className={classes.stepThumbMeta}>
                              {item.source === "撮影" ? "IMG_2404" : "ticket.pdf"}
                            </Text>
                          </Box>
                          <Box className={classes.stepThumbPaper}>
                            <Box className={classes.stepThumbLineShort} />
                            <Box className={classes.stepThumbLineLong} />
                            <Box className={classes.stepThumbLineLong} />
                          </Box>
                        </Box>
                        {item.source === "アップロード" && (
                          <Box className={classes.stepThumbImg}>
                            <Box className={classes.stepThumbTop}>
                              <IconUpload size={12} />
                              <Text span className={classes.stepThumbMeta}>page-2.pdf</Text>
                            </Box>
                            <Box className={classes.stepThumbPaper}>
                              <Box className={classes.stepThumbLineShort} />
                              <Box className={classes.stepThumbLineLong} />
                              <Box className={classes.stepThumbStamp}>PDF</Box>
                            </Box>
                          </Box>
                        )}
                      </Box>
                    )}
                    {item.source && (
                      <Box className={classes.stepSource}>
                        {(() => {
                          const Icon = getSourceIcon(item.source);
                          return <Icon size={12} />;
                        })()}
                        {getSourceLabel(item.source)}
                      </Box>
                    )}
                  </Box>
                ) : (
                  <Box className={classes.stepActions}>
                    {actions.map((action) => (
                      <button
                        key={action.key}
                        className={classes.stepAct}
                        onClick={
                          action.key === "手入力"
                            ? () => openManualInput(item.id)
                            : action.key === "撮影"
                              ? () => openCameraForItem(item.id)
                              : undefined
                        }
                      >
                        <action.icon size={20} />
                        {action.label}
                      </button>
                    ))}
                  </Box>
                )}
              </Box>

              {i < items.length - 1 && (
                <Box className={classes.connector}>
                  <button
                    className={classes.connectorButton}
                    onClick={() => insertStep(i)}
                  >
                    <IconPlus size={14} />
                  </button>
                </Box>
              )}
            </Box>
          ))}
        </Box>

        <Box className={classes.fabWrap}>
          <button className={classes.fab} onClick={addStep}>
            <IconPlus size={22} />
          </button>
        </Box>

        <Text className={classes.sectionLabel}>メモ</Text>
        <Box className={classes.formSection}>
          <Box className={classes.formRow}>
            <TextInput
              className={classes.memoInput}
              variant="unstyled"
              placeholder="目的や備考など"
              value={memo}
              onChange={(e) => setMemo(e.currentTarget.value)}
            />
          </Box>
        </Box>

        <Box className={classes.footerButtons}>
          <button
            className={classes.createButton}
            onClick={handleCreate}
            disabled={!title.trim()}
          >
            作成
          </button>
          <button
            className={classes.draftButton}
            onClick={handleSaveJourneyDraft}
          >
            <IconDeviceFloppy size={16} />
            下書き保存
          </button>
          <button
            className={classes.deleteScheduleButton}
            onClick={openScheduleDeleteModal}
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
        onSave={saveDraft}
        isEdit={!!items.find((item) => item.id === targetItemId)?.registered}
        editingTitle={items.find((item) => item.id === targetItemId)?.step?.title}
      />

      <Modal
        opened={cameraOpened}
        onClose={closeCamera}
        withCloseButton={false}
        centered
        radius="md"
        styles={{
          content: { maxHeight: "min(90vh, 820px)", display: "flex", flexDirection: "column" as const },
          body: { flex: 1, minHeight: 0, overflowY: "auto" as const },
        }}
      >
        <Box ta="center" py="sm">
          <Box
            w={72}
            h={72}
            mx="auto"
            mb="md"
            style={{
              borderRadius: 12,
              background: "#e8f1fe",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconCamera size={34} color="var(--mantine-color-blue-7)" />
          </Box>
          <Text size="lg" fw={800}>
            書類を撮影
          </Text>
          <Text size="sm" c="dimmed" mt={6}>
            チケット・予約確認書・QRコードなどを撮影してください。
            <br />
            <strong>OCRで自動的に反映します。</strong>
          </Text>
          <Box
            mt="md"
            p="xl"
            style={{
              borderRadius: 8,
              background: "var(--mantine-color-gray-0)",
              border: "1px solid var(--mantine-color-gray-2)",
            }}
          >
            <Box
              style={{
                width: "100%",
                height: 160,
                borderRadius: 6,
                background: "var(--mantine-color-gray-1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--mantine-color-gray-4)",
              }}
            >
              <IconCamera size={40} />
            </Box>
          </Box>
          <Text size="12px" c="dimmed" mt="sm">
            対応形式: チケット、搭乗券、予約確認メール、QRコード
          </Text>
          <Box mt="lg" style={{ display: "flex", gap: 8 }}>
            <Button radius="md" variant="default" onClick={closeCamera} style={{ flex: 1 }}>
              キャンセル
            </Button>
            <Button radius="md" color="blue" onClick={closeCamera} style={{ flex: 1 }}>
              撮影する
            </Button>
          </Box>
        </Box>
      </Modal>

      <Modal
        opened={deleteModalOpened}
        onClose={() => {
          setPendingDeleteItemId(null);
          closeDeleteModal();
        }}
        centered
        radius="md"
        classNames={{ content: classes.confirmModal }}
        withCloseButton={false}
      >
        <Box className={classes.confirmPanel}>
          <Text className={classes.confirmTitle}>ステップを削除しますか？</Text>
          <Text className={classes.confirmBody}>
            {pendingDeleteItemId
              ? `「${items.find((item) => item.id === pendingDeleteItemId)?.step?.title ?? `ステップ ${items.findIndex((item) => item.id === pendingDeleteItemId) + 1}`}」が削除されます。この操作は取り消せません。`
              : "この操作は取り消せません。"}
          </Text>
          <Box className={classes.confirmFooter}>
            <button
              className={classes.confirmCancel}
              onClick={() => {
                setPendingDeleteItemId(null);
                closeDeleteModal();
              }}
            >
              キャンセル
            </button>
            <button className={classes.confirmDelete} onClick={confirmRemoveStep}>
              削除する
            </button>
          </Box>
        </Box>
      </Modal>

      <Modal
        opened={scheduleDeleteModalOpened}
        onClose={closeScheduleDeleteModal}
        centered
        radius="md"
        classNames={{ content: classes.confirmModal }}
        withCloseButton={false}
      >
        <Box className={classes.confirmPanel}>
          <Text className={classes.confirmTitle}>スケジュールを削除しますか？</Text>
          <Text className={classes.confirmBody}>
            {title.trim()
              ? `「${title.trim()}」の作成内容が削除されます。この操作は取り消せません。`
              : "この作成中スケジュールが削除されます。この操作は取り消せません。"}
          </Text>
          <Box className={classes.confirmFooter}>
            <button className={classes.confirmCancel} onClick={closeScheduleDeleteModal}>
              キャンセル
            </button>
            <button className={classes.confirmDelete} onClick={handleDeleteSchedule}>
              削除する
            </button>
          </Box>
        </Box>
      </Modal>

      <TabBar />
    </>
  );
}
