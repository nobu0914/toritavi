import { redirect } from "next/navigation";
import { getJourney } from "@/lib/store-supabase";
import TripDetailClient from "./TripDetailClient";

export const revalidate = 30;

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const journey = await getJourney(id);

  if (!journey) {
    redirect("/");
  }

  return <TripDetailClient initialJourney={journey} />;
}
