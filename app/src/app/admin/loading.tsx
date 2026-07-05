/**
 * Shared loading skeleton for every /admin/* route. Because it sits at the
 * /admin segment, Next renders it INSTANTLY as the Suspense fallback while
 * the target page's server component awaits its (dynamic, service-role)
 * data. The sidebar shell stays mounted, so navigation feels immediate
 * instead of blocking on Supabase round-trips.
 */
export default function AdminLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }} aria-busy="true">
      <div style={{ ...bar, width: 180, height: 24 }} />
      <div style={{ ...bar, width: 320, height: 14 }} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginTop: 8,
        }}
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            style={{
              background: "#fff",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 16,
              height: 92,
            }}
          >
            <div style={{ ...bar, width: 60, height: 10 }} />
            <div style={{ ...bar, width: 40, height: 20, marginTop: 10 }} />
          </div>
        ))}
      </div>
      <div
        style={{
          background: "#fff",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 16,
          height: 220,
        }}
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{ ...bar, width: "100%", height: 14, marginBottom: 14 }} />
        ))}
      </div>
    </div>
  );
}

const bar: React.CSSProperties = {
  background: "linear-gradient(90deg, var(--n-100, #eee) 25%, var(--n-50, #f5f5f5) 50%, var(--n-100, #eee) 75%)",
  backgroundSize: "200% 100%",
  animation: "adminShimmer 1.2s ease-in-out infinite",
  borderRadius: 6,
};
