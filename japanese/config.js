// Supabase 前端配置（日文站）
//
// ⚠️ publishable key 是設計上公開的：靜態站前端必須攜帶它，Supabase 官方即如此使用。
//    真正的門禁邊界是資料庫 RLS（見 shared/supabase/migrations/0001_init.sql）。
//    secret／service_role key 絕不出現在本檔或任何前端程式碼中。
//
// 這是日文站「自己的」Supabase 專案（Japanese），與韓文站是兩個不同的專案 ——
// 共用一個的話，匯入或清理腳本的條件一寫寬就會動到韓文站的真實學習記錄。
export const SUPABASE_URL = 'https://ihkrmcbhzmzlczedswyv.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_L95CPuI_rqYK7KYaFiRJIQ_5YjxrTA8';
