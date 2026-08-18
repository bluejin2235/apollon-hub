"use client";

import { createContext, useContext } from "react";

export const WikiDrawerContext = createContext<{ open: () => void }>({
  open: () => undefined
});

export function useWikiDrawer() {
  return useContext(WikiDrawerContext);
}
