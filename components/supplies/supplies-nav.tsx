"use client";

import { Package, Wrench } from "lucide-react";
import { MobileBottomTabBar, type MobileBottomTabItem } from "@/components/mobile/bottom-tab-bar";

export type SuppliesTabKey = "loan" | "manage";

export type SuppliesTabId = "loanable" | "managed";

export const SUPPLIES_NAV: {
  tabKey: SuppliesTabKey;
  tabId: SuppliesTabId;
  label: string;
  href: string;
  icon: typeof Package;
}[] = [
  {
    tabKey: "loan",
    tabId: "loanable",
    label: "대출물품",
    href: "/supplies?tab=loan",
    icon: Package
  },
  {
    tabKey: "manage",
    tabId: "managed",
    label: "관리물품",
    href: "/supplies?tab=manage",
    icon: Wrench
  }
];

export function parseSuppliesTabKey(value: string | null | undefined): SuppliesTabKey {
  if (value === "manage") return "manage";
  return "loan";
}

export function suppliesTabKeyToId(tabKey: SuppliesTabKey): SuppliesTabId {
  return tabKey === "manage" ? "managed" : "loanable";
}

export function SuppliesMobileBottomNav({ activeTabKey }: { activeTabKey: SuppliesTabKey }) {
  const items: MobileBottomTabItem[] = SUPPLIES_NAV.map((item) => {
    const Icon = item.icon;
    return {
      href: item.href,
      label: item.label,
      icon: <Icon aria-hidden />,
      active: item.tabKey === activeTabKey
    };
  });

  return <MobileBottomTabBar items={items} variant="light" />;
}
