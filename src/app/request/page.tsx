import { GuestRequest } from "@/components/GuestRequest";

export const dynamic = "force-dynamic";

export const metadata = { title: "Request a song" };

export default async function RequestPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  return <GuestRequest code={(code ?? "").toUpperCase()} />;
}
