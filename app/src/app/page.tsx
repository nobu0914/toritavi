import { getJourneys } from "@/lib/store-supabase";
import TripsClient from "./TripsClient";

export const dynamic = "force-dynamic";

export default async function TripsPage() {
  const journeys = await getJourneys();
  return <TripsClient journeys={journeys} />;
}
