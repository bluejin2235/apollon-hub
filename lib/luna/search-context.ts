/** Use only this conversation's user questions; never recycle a cached answer as evidence. */
export function searchWithConversationContext(message: string, previousQuestions: string[]): string {
  const question = message.trim();
  const followUp = /^(그럼|그러면|그\s|그거|그것|그곳|거기|이\s*중|이것|이어서|앞서|방금|해당|같은|추가로|더\s|좀\s*더)/.test(question)
    || /^(이미지|사진|파일|폴더|자료)(도|만|는|를|을)?\s*(보여|찾아|알려|검색)/.test(question);
  if (!followUp) return question;
  const previous = previousQuestions.filter(q => q.trim() && q.trim() !== question).slice(-2);
  if (!previous.length) return question;
  return `${previous.map(q => q.trim().slice(0, 500)).join("\n")}\n후속 요청: ${question}`;
}
