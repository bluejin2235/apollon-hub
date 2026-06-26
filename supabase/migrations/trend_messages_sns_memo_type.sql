-- trend_messages: sns_memo 및 기존 누락 타입(vimeo, file) 허용

alter table public.trend_messages drop constraint if exists trend_messages_message_type_check;

alter table public.trend_messages
  add constraint trend_messages_message_type_check
  check (message_type in ('text', 'link', 'youtube', 'vimeo', 'image', 'file', 'ai', 'sns_memo'));

notify pgrst, 'reload schema';
