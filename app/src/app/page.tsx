"use client";

import { Box, Skeleton, Text } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import { seedSampleJourneys } from "@/lib/store";
import {
  daysUntil,
  formatDateRange,
  getCategoryIcon,
} from "@/lib/helpers";
import type { Journey } from "@/lib/types";

function TripsSkeleton() {
  return (
    <Box pb={110}>
      <Box style={{ display: "inline-flex", gap: 3, margin: "12px 16px" }}>
        <Skeleton height={32} width={100} radius={6} />
        <Skeleton height={32} width={60} radius={6} />
      </Box>
      {[1, 2, 3].map((i) => (
        <Box
          key={i}
          style={{
            margin: "6px 16px",
            borderRadius: 8,
            overflow: "hidden",
            border: "1px solid var(--mantine-color-gray-2)",
          }}
        >
          <Skeleton height={72} radius={0} />
          <Box style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Box>
              <Skeleton height={12} width={60} mb={6} />
              <Box style={{ display: "flex", gap: 6 }}>
                <Skeleton height={28} width={28} radius={8} />
                <Skeleton height={28} width={28} radius={8} />
              </Box>
            </Box>
            <Skeleton height={22} width={48} radius={32} />
          </Box>
        </Box>
      ))}
    </Box>
  );
}

export default function TripsPage() {
  const [filter, setFilter] = useState("upcoming");
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [loaded, setLoaded] = useState(false);
  const router = useRouter();

  useEffect(() => {
    startTransition(() => {
      setJourneys(seedSampleJourneys());
      setLoaded(true);
    });
  }, []);

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const filtered = journeys
    .filter((journey) => {
      const end = new Date(`${journey.endDate}T00:00:00`);
      return filter === "upcoming" ? end >= now : end < now;
    })
    .sort((a, b) => {
      const aTime = new Date(
        `${filter === "upcoming" ? a.startDate : a.endDate}T00:00:00`
      ).getTime();
      const bTime = new Date(
        `${filter === "upcoming" ? b.startDate : b.endDate}T00:00:00`
      ).getTime();
      return filter === "upcoming" ? aTime - bTime : bTime - aTime;
    });

  // Collect unique category icons for a journey
  const getUniqueCategories = (journey: Journey) => {
    const seen = new Set<string>();
    return journey.steps.filter((s) => {
      if (seen.has(s.category)) return false;
      seen.add(s.category);
      return true;
    });
  };

  const daysBadgeStyle = (journey: Journey) => {
    const d = daysUntil(journey.startDate);
    if (d === "完了") {
      return { background: "var(--mantine-color-gray-1)", color: "var(--mantine-color-gray-7)" };
    }
    return { background: "var(--mantine-color-blue-0)", color: "var(--mantine-color-blue-7)" };
  };

  if (!loaded) {
    return (
      <>
        <AppHeader title="toritavi" />
        <TripsSkeleton />
        <TabBar />
      </>
    );
  }

  return (
    <>
      <AppHeader title="toritavi" />

      {/* Segmented Control */}
      <Box
        style={{
          display: "inline-flex",
          background: "var(--mantine-color-gray-1)",
          borderRadius: 8,
          padding: 3,
          gap: 3,
          margin: "12px 16px",
        }}
      >
        {["Upcoming", "Past"].map((label) => {
          const val = label.toLowerCase();
          const isOn = filter === val;
          return (
            <button
              key={val}
              onClick={() => setFilter(val)}
              style={{
                padding: "7px 16px",
                fontSize: 13,
                fontWeight: 600,
                background: isOn ? "white" : "transparent",
                color: isOn ? "var(--mantine-color-gray-9)" : "var(--mantine-color-gray-6)",
                border: "none",
                cursor: "pointer",
                borderRadius: 6,
                boxShadow: isOn ? "0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.1)" : "none",
                fontFamily: "inherit",
              }}
            >
              {label}
            </button>
          );
        })}
      </Box>

      <Box pb={110}>
        {filtered.length === 0 && (
          <Box style={{ textAlign: "center", padding: "48px 32px" }}>
            <Text fw={600} size="16px" c="gray.7" mb={4}>
              まだ Journey がありません
            </Text>
            <Text size="14px" c="gray.6" lh={1.6}>
              次の外出や出張を登録すると、
              <br />
              ここに表示されます。
            </Text>
          </Box>
        )}

        {filtered.map((journey, i) => {
          const uniqueSteps = getUniqueCategories(journey);
          const coverBg =
            i === 0
              ? "var(--mantine-color-blue-7)"
              : i === 1
                ? "var(--mantine-color-blue-9)"
                : "var(--mantine-color-gray-7)";

          return (
            <Box
              key={journey.id}
              onClick={() => router.push(`/trips/${journey.id}`)}
              style={{
                background: "white",
                margin: "6px 16px",
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid var(--mantine-color-gray-2)",
                cursor: "pointer",
              }}
            >
              {/* Cover */}
              <Box
                style={{
                  background: coverBg,
                  color: "white",
                  padding: 16,
                }}
              >
                <Text fw={700} size="18px">
                  {journey.title}
                </Text>
                <Text size="12px" style={{ opacity: 0.8, marginTop: 2 }}>
                  {formatDateRange(journey.startDate, journey.endDate)}
                </Text>
              </Box>

              {/* Body */}
              <Box
                style={{
                  padding: "10px 14px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Box>
                  <Text size="13px" c="gray.6">
                    {journey.steps.length} plans
                  </Text>
                  <Box
                    style={{
                      display: "flex",
                      gap: 6,
                      marginTop: 4,
                    }}
                  >
                    {uniqueSteps.map((step) => {
                      const Icon = getCategoryIcon(step.category);
                      return (
                        <Box
                          key={step.id}
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 8,
                            background: "var(--mantine-color-blue-0)",
                            color: "var(--mantine-color-blue-7)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Icon size={16} />
                        </Box>
                      );
                    })}
                  </Box>
                </Box>

                <Box
                  style={{
                    padding: "3px 10px",
                    borderRadius: 32,
                    fontSize: 11,
                    fontWeight: 700,
                    ...daysBadgeStyle(journey),
                  }}
                >
                  {daysUntil(journey.startDate)}
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* FAB */}
      <Box
        component="button"
        onClick={() => router.push("/trips/new")}
        style={{
          position: "fixed",
          bottom: "calc(68px + env(safe-area-inset-bottom))",
          right: "max(16px, calc(50% - 199px))",
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "var(--mantine-color-yellow-5)",
          color: "white",
          border: "none",
          cursor: "pointer",
          boxShadow:
            "0 1px 3px rgba(0,0,0,0.05), rgba(0,0,0,0.05) 0 20px 25px -5px, rgba(0,0,0,0.04) 0 10px 10px -5px",
          zIndex: 150,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <IconPlus size={24} />
      </Box>

      <TabBar />
    </>
  );
}
