"use client";

import { useParams } from "next/navigation";
import { ChatRoom } from "@/components/research/chat-room";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";

export default function ResearchRoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const { status, profile } = useRequirePortalSession();

  if (status === "checking") {
    return <PortalAuthChecking />;
  }

  if (!profile?.id) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-1">
      <ChatRoom roomId={roomId} profileId={profile.id} />
    </div>
  );
}
