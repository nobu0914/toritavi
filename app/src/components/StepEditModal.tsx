"use client";

import {
  ActionIcon,
  Box,
  Modal,
  Select,
  Text,
  TextInput,
} from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import classes from "./StepEditModal.module.css";
import type { StepCategory } from "@/lib/types";

const categories: StepCategory[] = [
  "列車",
  "飛行機",
  "バス",
  "車",
  "徒歩",
  "宿泊",
  "商談",
  "食事",
  "観光",
  "その他",
];

export type StepDraft = {
  category: StepCategory;
  title: string;
  time: string;
  detail: string;
  confNumber: string;
};

export function emptyStepDraft(): StepDraft {
  return { category: "列車", title: "", time: "", detail: "", confNumber: "" };
}

type Props = {
  opened: boolean;
  onClose: () => void;
  draft: StepDraft;
  onChange: (draft: StepDraft) => void;
  onSave: () => void;
  isEdit: boolean;
};

export function StepEditModal({
  opened,
  onClose,
  draft,
  onChange,
  onSave,
  isEdit,
}: Props) {
  const update = (patch: Partial<StepDraft>) =>
    onChange({ ...draft, ...patch });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      radius="md"
      classNames={{ content: classes.modal }}
      withCloseButton={false}
    >
      <Box className={classes.panel}>
        <Box className={classes.top}>
          <Text className={classes.topTitle}>
            {isEdit ? "ステップを編集" : "ステップを追加"}
          </Text>
          <ActionIcon variant="subtle" color="gray" radius="xl" onClick={onClose}>
            <IconX size={18} />
          </ActionIcon>
        </Box>
        <Box className={classes.body}>
          <Text className={classes.sectionLabel}>Basic Info</Text>
          <Box className={classes.formSection}>
            <Box className={classes.formRow}>
              <Text className={classes.formLabel}>カテゴリ</Text>
              <Select
                data={categories}
                value={draft.category}
                onChange={(value) =>
                  value && update({ category: value as StepCategory })
                }
                allowDeselect={false}
              />
            </Box>
            <Box className={classes.formRow}>
              <Text className={classes.formLabel}>タイトル</Text>
              <TextInput
                className={classes.plainInput}
                variant="unstyled"
                placeholder="例: のぞみ 225号"
                value={draft.title}
                onChange={(e) => update({ title: e.currentTarget.value })}
                required
              />
            </Box>
            <Box className={classes.formRow}>
              <Text className={classes.formLabel}>詳細・場所</Text>
              <TextInput
                className={classes.plainInput}
                variant="unstyled"
                placeholder="例: 東京 → 新大阪"
                value={draft.detail}
                onChange={(e) => update({ detail: e.currentTarget.value })}
              />
            </Box>
            <Box className={classes.formRow}>
              <Box className={classes.dateGrid}>
                <Box>
                  <Text className={classes.formLabel}>時刻</Text>
                  <TextInput
                    className={classes.plainInput}
                    variant="unstyled"
                    placeholder="10:00"
                    value={draft.time}
                    onChange={(e) => update({ time: e.currentTarget.value })}
                  />
                </Box>
                <Box>
                  <Text className={classes.formLabel}>確認番号</Text>
                  <TextInput
                    className={classes.plainInput}
                    variant="unstyled"
                    placeholder="TK-882541"
                    value={draft.confNumber}
                    onChange={(e) => update({ confNumber: e.currentTarget.value })}
                  />
                </Box>
              </Box>
            </Box>
          </Box>
          <button
            className={classes.saveButton}
            onClick={onSave}
            disabled={!draft.title.trim()}
          >
            {isEdit ? "更新" : "保存"}
          </button>
        </Box>
      </Box>
    </Modal>
  );
}
