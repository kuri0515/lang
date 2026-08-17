// supabase-js 的最小替身。
//
// 只需要讓 createClient() 回傳一個「怎麼串都不會爆」的物件 ——
// 卡片渲染不查資料，真正會查的地方（同義詞、漢字詞群）拿到空結果，
// 而那正是「查詢還沒回來」的狀態，畫面本來就要能正常顯示。
const chain = () => new Proxy(function () {}, {
  get(_, prop) {
    if (prop === 'then') return undefined;          // 別讓它被當成 thenable
    if (prop === 'data') return [];
    if (prop === 'error') return null;
    return chain();
  },
  apply() { return chain(); },
});

export const createClient = () => ({
  from: chain,
  rpc: chain,
  auth: { getUser: async () => ({ data: { user: null } }), onAuthStateChange() {} },
});
