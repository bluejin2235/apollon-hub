export type CandidateSource =
  | "chat"
  | "selfstudy"
  | "question"
  | "direct"
  | "interview";

export type ScopeSuggestion = "org" | "personal";

export type ThreadTurn = {
  role: "luna" | "human";
  text: string;
  at: string;
};
