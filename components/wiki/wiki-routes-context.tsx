"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode
} from "react";

import {
  WIKI_DEFAULT_ROUTES_CONFIG,
  type WikiRoutes,
  type WikiRoutesConfig
} from "@/lib/wiki/routes";
import { wikiCanonicalSlug } from "@/lib/wiki/types";

function buildWikiRoutes(config: WikiRoutesConfig): WikiRoutes {
  const base = config.basePath.replace(/\/$/, "");

  return {
    rootLabel: config.rootLabel,
    rootHref: config.rootHref,
    docPath(slug) {
      return `${base}/${encodeURIComponent(wikiCanonicalSlug(slug))}`;
    },
    docEditPath(slug, sectionId) {
      const path = `${base}/${encodeURIComponent(wikiCanonicalSlug(slug))}/edit`;
      return sectionId ? `${path}?section=${encodeURIComponent(sectionId)}` : path;
    },
    docHistoryPath(slug) {
      return `${base}/${encodeURIComponent(wikiCanonicalSlug(slug))}/history`;
    },
    listPath(menuSlug) {
      if (config.listPath) return config.listPath;
      const prefix = config.listPathPrefix ?? `${base}/list`;
      return `${prefix}/${encodeURIComponent(menuSlug)}`;
    },
    newDocPath(menuSlug) {
      if (config.newDocBasePath === null) return null;
      const newBase = config.newDocBasePath ?? `${base}/new`;
      return `${newBase}?menu=${encodeURIComponent(menuSlug)}`;
    },
    hideMoveMenu: config.hideMoveMenu ?? false,
    hideLunaPrompt: config.hideLunaPrompt ?? false
  };
}

const WikiRoutesContext = createContext<WikiRoutes>(
  buildWikiRoutes(WIKI_DEFAULT_ROUTES_CONFIG)
);

export function WikiRoutesProvider({
  config,
  children
}: {
  config?: WikiRoutesConfig;
  children: ReactNode;
}) {
  const routes = useMemo(
    () => buildWikiRoutes(config ?? WIKI_DEFAULT_ROUTES_CONFIG),
    [config]
  );

  return (
    <WikiRoutesContext.Provider value={routes}>{children}</WikiRoutesContext.Provider>
  );
}

export function useWikiRoutes(): WikiRoutes {
  return useContext(WikiRoutesContext);
}
