"use client";

import { createContext, useContext } from "react";
import type { TrendRoom } from "@/lib/research/types";

type ResearchRoomsContextValue = {
  onRoomUpdated: (room: TrendRoom) => void;
  removeRoom: (roomId: string) => void;
};

export const ResearchRoomsContext = createContext<ResearchRoomsContextValue | null>(null);

export function useResearchRooms() {
  return useContext(ResearchRoomsContext);
}
