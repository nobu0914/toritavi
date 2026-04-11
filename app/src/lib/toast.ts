import { notifications } from "@mantine/notifications";

export function showSuccessToast(message: string) {
  notifications.show({
    message,
    autoClose: 3000,
    withBorder: false,
    withCloseButton: false,
    style: {
      background: "var(--mantine-color-teal-6)",
      color: "white",
      boxShadow:
        "0 1px 3px rgba(0,0,0,0.05), rgba(0,0,0,0.05) 0 20px 25px -5px, rgba(0,0,0,0.04) 0 10px 10px -5px",
    },
    styles: {
      description: { color: "white" },
    },
  });
}
