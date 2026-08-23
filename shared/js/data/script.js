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
    .select('id, slug, work, work_title, season, episode, title, line_count, scene_count')
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
export async function loadLines(episodeId) {
  return fetchAll(() => sb.from('script_lines')
    .select('idx, scene, start_s, end_s, ja, ruby, zh')
    .eq('episode_id', episodeId)
    .order('idx'));
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
    .select('episode_id, scene').eq('user_id', userId));
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
