// Supabase 前端配置（日文站）
//
// ⚠️ anon key 是設計上公開的：靜態站前端必須攜帶它，Supabase 官方即如此使用。
//    真正的門禁邊界是資料庫 RLS（見 shared/supabase/migrations/0001_init.sql）。
//    service_role key 絕不出現在本檔或任何前端程式碼中。
//
// ⚠️ 尚未填值 —— 日文站要用「自己的」Supabase 專案，不能沿用韓文站的。
//    兩站共用一個專案，等於匯入腳本的條件一寫寬就會動到韓文站的線上資料。
//
// 建立步驟見 README「新增一個語言站」。填好之後這兩行就是唯一要改的地方。
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
