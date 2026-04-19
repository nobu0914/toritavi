"use client";

import { ActionIcon, Box, Text } from "@mantine/core";
import { IconChevronDown, IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";
import classes from "./SheetHeader.module.css";

/*
 * SheetHeader — Design System v2 §6 Header System Type C
 * Drawer / Modal の天井バー。
 *
 * leftIcon:
 *   "down"  → ↓  (iOS Drawer 作法、Bottom Drawer のデフォルト)
 *   "close" → ✕  (中央モーダルの破棄)
 *
 * 右スロットは最大 2 つ。超える場合は ⋮ More Menu に退避する。
 */
type Props = {
  title: string;
  onClose: () => void;
  leftIcon?: "down" | "close";
  actions?: ReactNode;
};

export function SheetHeader({ title, onClose, leftIcon = "down", actions }: Props) {
  return (
    <Box className={classes.root}>
      <ActionIcon
        className={classes.leftSlot}
        variant="subtle"
        color="gray"
        radius="xl"
        onClick={onClose}
        aria-label="閉じる"
      >
        {leftIcon === "down" ? <IconChevronDown size={22} /> : <IconX size={18} />}
      </ActionIcon>
      <Text className={classes.title} component="div">
        {title}
      </Text>
      <Box className={classes.actions}>
        {actions ?? <Box style={{ width: 32 }} />}
      </Box>
    </Box>
  );
}
