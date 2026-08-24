// =====================================================================
// 精讀的資料存取
//
// 台詞不在 items 裡 —— items 同時餵詞庫、輪練、複習三處，
// 一集四百多句會把那三個地方全部淹沒。台詞有自己的表，
// 進度也是自己的一套：它回答「讀到哪一幕」，不是「什麼時候該再看一次」。
// =====================================================================
import { sb, fetchAll } from './client.js';

/** 有哪些集。依 sort_order —— 劇集的順序是內容的一部分，不能靠 id */
export async function listEpisodes() {
  const { data, error } = await sb.from('script_episodes')
    .select('id, slug, work, work_title, season, episode, title, line_count, scene_count, deck_slug')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

/**
 * 一整集的行。
 *
 * ★ 不給 limit —— PostgREST 單次最多回 1000 列，
 *   而一集目前 479 行。給一個「我猜夠了」的數字，
 *   等哪天有更長的集數時會靜靜地少掉結尾那幾幕，
 *   而畫面看起來完全正常（幕數是從行算出來的）。
 */
/**
 * ★ 這串欄位就是精讀畫面看得到的全部。
 *
 *   上線之後有一整段時間，這裡少了 tokens 與 grammar ——
 *   資料庫裡有（471/479 行有 tokens、171 行有 grammar），
 *   匯入時也逐集核對過數量，但畫面永遠讀到 undefined，於是
 *   「這一幕的詞」永遠說「沒有需要另外背的詞」、句型卡永遠收著、
 *   「練這一幕」永遠不出現。**沒有任何一處報錯**，因為那三處的
 *   寫法都是 `l.tokens || []` —— 空陣列是完全合法的答案。
 *
 *   測試也全綠：替身直接把 tokens/grammar 遞出來，
 *   而真正的查詢從來沒有要過它們（見 tests/_script-data-stub.mjs，
 *   替身現在改成只遞出這串欄位裡有的東西）。
 */
export const LINE_FIELDS = 'idx, scene, start_s, end_s, ja, ruby, zh, tokens, grammar';

export async function loadLines(episodeId) {
  return fetchAll(() => sb.from('script_lines')
    .select(LINE_FIELDS)
    .eq('episode_id', episodeId)
    .order('idx'), { tiebreak: 'idx' });
}

/** 這個人在這一集讀過哪幾幕 */
export async function loadProgress(userId, episodeId) {
  if (!userId) return new Set();
  const { data, error } = await sb.from('script_progress')
    .select('scene').eq('user_id', userId).eq('episode_id', episodeId);
  if (error) return new Set();     // 進度讀不到不該擋住閱讀本身
  return new Set((data ?? []).map((r) => r.scene));
}

/** 每一集讀了幾幕。首頁與清單要用，逐集查會打 N 次 API */
export async function progressCounts(userId) {
  if (!userId) return {};
  const rows = await fetchAll(() => sb.from('script_progress')
    .select('episode_id, scene').eq('user_id', userId),
  { tiebreak: ['episode_id', 'scene'] });
  const out = {};
  for (const r of rows) out[r.episode_id] = (out[r.episode_id] || 0) + 1;
  return out;
}

/**
 * 標記／取消標記一幕讀完。
 *
 * 可以取消是刻意的：讀完的判斷是自評，而自評會後悔 ——
 * 標錯了卻收不回來，下次就沒有人敢按。
 */
export async function markScene(userId, episodeId, scene, done) {
  if (!userId) return;
  if (done) {
    const { error } = await sb.from('script_progress')
      .upsert({ user_id: userId, episode_id: episodeId, scene },
              { onConflict: 'user_id,episode_id,scene' });
    if (error) throw error;
  } else {
    const { error } = await sb.from('script_progress').delete()
      .eq('user_id', userId).eq('episode_id', episodeId).eq('scene', scene);
    if (error) throw error;
  }
}
