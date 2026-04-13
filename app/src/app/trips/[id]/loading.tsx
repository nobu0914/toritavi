import { Box, Skeleton } from "@mantine/core";

export default function Loading() {
  return (
    <Box>
      <Skeleton height={52} radius={0} />
      <Box style={{ padding: "16px" }}>
        <Skeleton height={20} width="50%" mb={8} />
        <Skeleton height={14} width="35%" mb={20} />
        {[1, 2, 3].map((i) => (
          <Box key={i} style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <Skeleton height={14} width={44} />
            <Skeleton circle height={12} />
            <Skeleton height={64} style={{ flex: 1 }} radius={8} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}
