"use client";

import { Box, Modal, Text } from "@mantine/core";

type Props = {
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
};

export function DeleteConfirmModal({
  opened,
  onClose,
  onConfirm,
  title,
  description,
}: Props) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      withCloseButton={false}
      centered
      radius="md"
      size={340}
      styles={{
        content: { boxShadow: "0 1px 3px rgba(0,0,0,0.05), rgba(0,0,0,0.05) 0 20px 25px -5px, rgba(0,0,0,0.04) 0 10px 10px -5px" },
        body: { padding: 0 },
      }}
    >
      <Box style={{ padding: 16 }}>
        <Text size="lg" fw={700}>
          {title}
        </Text>
      </Box>
      <Box style={{ padding: "0 16px 16px" }}>
        <Text size="sm" c="dimmed" lh={1.6}>
          {description}
        </Text>
      </Box>
      <Box
        style={{
          padding: "12px 16px 16px",
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
        }}
      >
        <button
          onClick={onClose}
          style={{
            padding: "4px 12px",
            fontSize: 12,
            fontWeight: 600,
            background: "transparent",
            color: "var(--mantine-color-blue-7)",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          キャンセル
        </button>
        <button
          onClick={() => {
            onConfirm();
            onClose();
          }}
          style={{
            padding: "4px 12px",
            fontSize: 12,
            fontWeight: 600,
            background: "var(--mantine-color-red-6)",
            color: "white",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          削除する
        </button>
      </Box>
    </Modal>
  );
}
