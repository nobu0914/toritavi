"use client";

import { Box, UnstyledButton, Text } from "@mantine/core";
import {
  IconPlane,
  IconScan,
  IconBell,
  IconInbox,
  IconUser,
} from "@tabler/icons-react";
import { usePathname, useRouter } from "next/navigation";
import classes from "./TabBar.module.css";

const tabs = [
  { label: "旅程", icon: IconPlane, href: "/" },
  { label: "予定登録", icon: IconScan, href: "/scan" },
  { label: "通知", icon: IconBell, href: "/alerts" },
  { label: "未整理", icon: IconInbox, href: "/unfiled" },
  { label: "アカウント", icon: IconUser, href: "/account" },
];

export function TabBar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <Box className={classes.tabbar}>
      {tabs.map((tab) => {
        const active =
          tab.href === "/"
            ? pathname === "/" || pathname.startsWith("/trips")
            : pathname.startsWith(tab.href);
        return (
          <UnstyledButton
            key={tab.href}
            className={classes.tab}
            data-active={active || undefined}
            onClick={() => router.push(tab.href)}
          >
            <tab.icon size={22} stroke={2} />
            <Text size="10px" fw={600} lh={1}>
              {tab.label}
            </Text>
          </UnstyledButton>
        );
      })}
    </Box>
  );
}
