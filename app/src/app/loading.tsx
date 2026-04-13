import { Box, Skeleton } from "@mantine/core";

export default function Loading() {
  return (
    <Box>
      <Skeleton height={52} radius={0} />
      <Skeleton height={180} radius={0} />
      <Box style={{ padding: "16px" }}>
        <Box style={{ display: "inline-flex", gap: 3, marginBottom: 12 }}>
          <Skeleton height={32} width={100} radius={6} />
          <Skeleton height={32} width={60} radius={6} />
        </Box>
        {[1, 2, 3].map((i) => (
          <Box
            key={i}
            style={{
              marginBottom: 8,
              borderRadius: 8,
              overflow: "hidden",
              border: "1px solid var(--mantine-color-gray-2)",
            }}
          >
            <Skeleton height={72} radius={0} />
            <Box style={{ padding: "10px 14px" }}>
              <Skeleton height={12} width="60%" mb={6} />
              <Skeleton height={12} width="40%" />
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
