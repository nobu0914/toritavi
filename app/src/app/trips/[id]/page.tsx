import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getJourney } from "@/lib/store-server";
import TripDetailClient from "./TripDetailClient";

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Guest mode: data lives in the client's localStorage — hand off without server fetch.
  const cookieStore = await cookies();
  if (cookieStore.get("toritavi_guest")?.value === "1") {
    return <TripDetailClient journeyId={id} initialJourney={null} />;
  }

  const journey = await getJourney(id);
  if (!journey) {
    redirect("/");
  }
  return <TripDetailClient journeyId={id} initialJourney={journey} />;
}
