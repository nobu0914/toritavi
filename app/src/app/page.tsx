import { getJourneys } from "@/lib/store-server";
import TripsClient from "./TripsClient";

export default async function TripsPage() {
  const journeys = await getJourneys();
  return <TripsClient journeys={journeys} />;
}
