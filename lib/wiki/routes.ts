export type WikiRoutes = {
  rootLabel: string;
  rootHref: string;
  docPath(slug: string): string;
  docEditPath(slug: string, sectionId?: string): string;
  docHistoryPath(slug: string): string;
  listPath(menuSlug: string): string;
  newDocPath(menuSlug: string): string | null;
  hideMoveMenu?: boolean;
  hideLunaPrompt?: boolean;
};

/** 서버→클라이언트로 넘길 수 있는 직렬화 가능한 라우트 설정 */
export type WikiRoutesConfig = {
  rootLabel: string;
  rootHref: string;
  basePath: string;
  /** 고정 목록 URL. 없으면 listPathPrefix + menuSlug */
  listPath?: string;
  listPathPrefix?: string;
  /** null이면 새 문서 링크 없음 */
  newDocBasePath?: string | null;
  hideMoveMenu?: boolean;
  hideLunaPrompt?: boolean;
};

export const WIKI_DEFAULT_ROUTES_CONFIG: WikiRoutesConfig = {
  rootLabel: "Wikipedia",
  rootHref: "/wiki/terms",
  basePath: "/wiki",
  listPathPrefix: "/wiki/list",
  newDocBasePath: "/wiki/new",
  hideMoveMenu: false,
  hideLunaPrompt: false
};

export const WEBSITE_GUIDE_ROUTES_CONFIG: WikiRoutesConfig = {
  rootLabel: "제작·운영 가이드",
  rootHref: "/website/guide",
  basePath: "/website/guide",
  listPath: "/website/guide",
  newDocBasePath: null,
  hideMoveMenu: true,
  hideLunaPrompt: true
};
