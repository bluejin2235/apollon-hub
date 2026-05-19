-- 아르테 API 사용량 CSV 업로드용 (Supabase SQL Editor에서 실행)
alter table api_usage add column if not exists api_key_label text;
alter table api_usage add column if not exists input_cost_usd numeric(10,6) default 0;
alter table api_usage add column if not exists output_cost_usd numeric(10,6) default 0;

alter table api_usage drop constraint if exists api_usage_unique_record;
alter table api_usage add constraint api_usage_unique_record
  unique (provider, date, model, api_key_label);

alter table api_usage add column if not exists uploaded_by uuid references profiles(id) on delete set null;
