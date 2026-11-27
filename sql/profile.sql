-- profile.sql —— 建立帳號層的顯示名稱表（SPEC.md 第 10.4 節）
--
-- 谁跑：使用者在 Supabase dashboard 的 SQL Editor 貼上整檔執行。
--   理由：公開 key 不能做 DDL（實測 GET /rest/v1/ 用公開 key 回 401「Secret API key required」），
--   本機也沒有 psql client，所以分工是「助手寫 SQL、使用者貼」。
--
-- 欄名採中文（SPEC 10.7 定案，與第 7 節的 CSV 表一致）。
-- 代價要記得：Postgres 的中文識別符必須包雙引號，且大小寫敏感 —— 寫成 顯示名稱 或 "显示名称" 都找不到欄位。
-- user_id 維持英文名，因為它是對 auth.users(id) 的外鍵，auth.users 的欄位都是英文。

create table if not exists public.profile (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  "顯示名稱"   text not null,
  "建立時間"   timestamptz not null default now()
);

-- 專案開著「新表自動開 RLS」，这句是冪等的保險；沒 policy 時查它回 0 列、寫入被擋（SPEC 10.2）。
alter table public.profile enable row level security;

-- 四條 policy：只有本人讀寫得到自己那一筆。anon（公開 key、未登入）讀不到任何列。
drop policy if exists "本人可讀個人資料" on public.profile;
create policy "本人可讀個人資料"
  on public.profile for select
  using (auth.uid() = user_id);

drop policy if exists "本人可新增個人資料" on public.profile;
create policy "本人可新增個人資料"
  on public.profile for insert
  with check (auth.uid() = user_id);

drop policy if exists "本人可改個人資料" on public.profile;
create policy "本人可改個人資料"
  on public.profile for update
  using (auth.uid() = user_id);

-- 驗證：建好後在 SQL Editor 跑這行，应回 0 列（anon 角色受 RLS 限制），不是回錯。
--   select count(*) from public.profile;
