import { getJourneys } from "@/lib/store-supabase";
import TripsClient from "./TripsClient";

export const revalidate = 30;

export default async function TripsPage() {
  const journeys = await getJourneys();
  return <TripsClient journeys={journeys} />;
}
