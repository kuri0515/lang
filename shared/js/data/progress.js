// =====================================================================
// 學習狀態層（user_cards / reviews）—— 與內容層完全解耦
// 換 SRS 演算法只改 srs.js，換詞表只動 content.js，兩者互不影響。
// =====================================================================
import { sb, ITEM_FIELDS, DIRECTIONS, fetchAll } from './client.js';
import { scheduleRecall } from '../core/srs.js';

// ---------- 佇列 ----------
/** 到期的複習卡 */
/**
 * 首頁只要兩個數字：待複習幾條、其中幾條是順延來的。
 *
 * 【為什麼不沿用 fetchDue】
 *   那支會連 items 一起撈（每張卡帶完整的詞條資料），實測 18.3 KB ——
 *   而首頁一個欄位都沒用到，只算 length。
 *   在手機的行動網路上，那是每次進首頁都白花的一趟。
 *
 * 【為什麼用 count=exact 而不是 select 幾個欄位】
 *   撈 500 列的 due_at 仍然是 15 KB。要的是數字，就只拿數字：
 *   PostgREST 的 count 會把結果放在 Content-Range 標頭裡，回應本體是空的。
 *
 * 【為什麼順延也一起算】
 *   分兩次查也可以，但那是兩趟往返換一個數字。
 *   兩個 count 可以並行，成本是一趟。
 */
export async function dueCounts(userId, dirs = DIRECTIONS) {
  // ★ 用 item_id 不是 id —— user_cards 沒有 id 欄位（複合主鍵）。
  //   寫 select('id') 會 400：column user_cards.id does not exist。
  //   而 home.load() 對這支是 .catch(() => ...) 之外的路徑，
  //   400 會讓整個首頁載入失敗 —— 這種錯必須在上線前抓到，
  //   而抓到它的方法就是拿真的資料庫打一次。
  const base = () => sb.from('user_cards')
    .select('item_id', { count: 'exact', head: true })
    .eq('user_id', userId).in('direction', dirs)
    .neq('state', 'suspended')
    .lte('due_at', new Date().toISOString());
  // 逾期超過一天 = 之前排定、當天沒做完而順延過來的
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const [all, carried] = await Promise.all([
    base(), base().lt('due_at', yesterday),
  ]);
  return { total: all.count ?? 0, carried: carried.count ?? 0 };
}

export async function fetchDue(userId, dirs = DIRECTIONS, limit = 200) {
  const { data, error } = await sb.from('user_cards')
    .select(`*, items(${ITEM_FIELDS})`)
    .eq('user_id', userId).in('direction', dirs)
    .neq('state', 'suspended')
    .lte('due_at', new Date().toISOString())
    .order('due_at').limit(limit);
  if (error) throw error;
  return (data ?? []).filter((c) => c.items);
}

/** 尚未建卡的新條目（對指定方向而言是「新」的） */
/**
 * @param {string|string[]} tag 單一標籤，或一組標籤（任一符合即可）。
 *   生活場景由多個標籤組成（溫暖＋關心），所以要吃陣列。
 */
export async function fetchNewItems(userId, deckId, dirs, limit = 20, tag = '') {
  const seen = await fetchAll(() => sb.from('user_cards')
    .select('item_id, direction').eq('user_id', userId));
  const seenKey = new Set(seen.map((r) => `${r.item_id}|${r.direction}`));

  // 撈完整而非取前 N 筆 —— 已學過的都要跳過，截斷會讓後面的新詞永遠排不到
  const pool = await fetchAll(() => {
    let q = sb.from('items').select(ITEM_FIELDS).eq('is_active', true)
      .order('sort_order').order('slug');
    if (deckId) q = q.eq('deck_id', deckId);
    // 陣列用 overlaps（任一符合），單一用 contains —— 場景是多標籤的聯集
    if (Array.isArray(tag) && tag.length) q = q.overlaps('tags', tag);
    else if (typeof tag === 'string' && tag) q = q.contains('tags', [tag]);
    return q;
  });

  const out = [];
  for (const item of pool) {
    for (const dir of dirs) {
      if (!seenKey.has(`${item.id}|${dir}`)) out.push({ item, direction: dir, card: null });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// ---------- 寫入 ----------
/** 正規複習：更新排程 + 記錄答題 */
export async function saveReview({ userId, item, direction, prevCard, rating, next,
                                  elapsedMs, mode, sessionId, activity }) {
  const prev = prevCard || {};
  const isCorrect = rating >= 3;
  const cardRow = {
    user_id: userId, item_id: item.id, direction, ...next,
    total_reviews: (prev.total_reviews ?? 0) + 1,
    correct_reviews: (prev.correct_reviews ?? 0) + (isCorrect ? 1 : 0),
  };
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    sb.from('user_cards').upsert(cardRow, { onConflict: 'user_id,item_id,direction' }),
    sb.from('reviews').insert({
      user_id: userId, item_id: item.id, direction, rating,
      elapsed_ms: elapsedMs ?? null,
      mode: mode ?? null, session_id: sessionId ?? null, is_free: false,
      activity: activity ?? 'review',
      prev_interval_days: prev.interval_days ?? 0,
      prev_ease_factor: prev.ease_factor ?? 2.5,
    }),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
}

/**
 * 自由練習：只記錄答題，不動排程。
 * ★ 若也更新到期時間，臨時多背幾遍就會把下次複習日往後推，
 *   破壞間隔重複的節奏。歷史與正確率照記，排程留給正規複習決定。
 */
export async function logPractice({ item, direction, rating, elapsedMs, mode, sessionId, activity }) {
  // 走 RPC 而非兩次 insert：記錄與計數必須同進同退，
  // 否則會出現「答題記錄有、卡片計數沒加」的半套狀態。
  const { error } = await sb.rpc('log_practice', {
    p_item_id: item.id,
    p_direction: direction,
    p_rating: rating,
    p_elapsed_ms: elapsedMs ?? null,
    p_mode: mode ?? null,
    p_session_id: sessionId ?? null,
    p_activity: activity ?? 'free',
  });
  if (error) throw error;
}

// ---------- 統計 ----------
export async function todayStats(userId) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const { data, error } = await sb.from('reviews').select('is_correct')
    .eq('user_id', userId).gte('reviewed_at', start.toISOString());
  if (error) throw error;
  const rows = data ?? [];
  const correct = rows.filter((r) => r.is_correct).length;
  return { reviewed: rows.length, correct, accuracy: rows.length ? correct / rows.length : null };
}

export async function overallStats(userId) {
  const { data, error } = await sb.from('user_cards')
    .select('total_reviews, correct_reviews, state, interval_days').eq('user_id', userId);
  if (error) throw error;
  const rows = data ?? [];
  const total = rows.reduce((s, r) => s + r.total_reviews, 0);
  const correct = rows.reduce((s, r) => s + r.correct_reviews, 0);
  return {
    cards: rows.length,
    // 「已掌握」= 進入複習期且間隔已拉到 21 天以上
    mastered: rows.filter((r) => r.state === 'review' && Number(r.interval_days) >= 21).length,
    accuracy: total ? correct / total : null,
  };
}


/** 弱項：正確率低 / 遺忘次數多 */
export async function weakItems(userId, limit = 20) {
  const { data, error } = await sb.from('v_item_accuracy').select('*')
    .eq('user_id', userId).gte('total_reviews', 3)
    .order('accuracy', { ascending: true }).order('lapses', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}


/** 近 N 天的每日答題量與正確率 */
export async function dailyStats(userId, days = 30) {
  const from = new Date();
  from.setDate(from.getDate() - days + 1);
  from.setHours(0, 0, 0, 0);
  const { data, error } = await sb.from('reviews').select('is_correct, reviewed_at')
    .eq('user_id', userId).gte('reviewed_at', from.toISOString());
  if (error) throw error;

  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const byDay = {};
  for (const r of data ?? []) {
    const k = key(new Date(r.reviewed_at));
    (byDay[k] ||= { n: 0, correct: 0 });
    byDay[k].n += 1;
    if (r.is_correct) byDay[k].correct += 1;
  }
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(from); d.setDate(from.getDate() + i);
    const v = byDay[key(d)] || { n: 0, correct: 0 };
    return { date: key(d), ...v, accuracy: v.n ? v.correct / v.n : null };
  });
}

/**
 * 取得多個條目的雙向學習狀態，供瀏覽頁標示「我學到哪了」。
 *
 * 分批查詢：PostgREST 的 in.() 會把 id 全塞進 URL，
 * 300 個 UUID 約 11KB，超過常見代理的 8KB 上限就會被截斷或拒絕。
 */
export async function cardsByItem(userId, itemIds, batch = 80) {
  if (!userId || !itemIds?.length) return {};
  const out = {};
  for (let i = 0; i < itemIds.length; i += batch) {
    const { data, error } = await sb.from('user_cards')
      .select('item_id, direction, state, total_reviews, correct_reviews')
      .eq('user_id', userId).in('item_id', itemIds.slice(i, i + batch));
    if (error) throw error;
    for (const c of data ?? []) (out[c.item_id] ||= {})[c.direction] = c;
  }
  return out;
}

// ---------- 學習軌跡 ----------


// ---------- 學習場次 ----------
/**
 * 場次列表（一輪學習一列），新到舊。
 * 走 v_sessions 讓資料庫做彙總 —— 否則要把幾百筆明細撈回前端
 * 再自己 group by，資料量一大就慢。
 */
export async function listSessions(userId, { limit = 30, before = null } = {}) {
  let q = sb.from('v_sessions')
    .select('session_id, mode, activity, direction, is_free, answered, correct, accuracy, started_at, ended_at, duration_sec')
    .eq('user_id', userId).order('started_at', { ascending: false }).limit(limit);
  if (before) q = q.lt('started_at', before);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** 某一場次的逐題明細（展開時才查，不預先載入） */
export async function sessionDetail(userId, sessionId) {
  const { data, error } = await sb.from('reviews')
    .select('rating, is_correct, elapsed_ms, reviewed_at, direction, items(ko, zh, romanization, hanja)')
    .eq('user_id', userId).eq('session_id', sessionId)
    .order('reviewed_at');
  if (error) throw error;
  return (data ?? []).filter((r) => r.items);
}

/** 0007 之前沒有 session_id 的舊記錄，按天彙總 */
export async function legacyDays(userId, limit = 400) {
  const { data, error } = await sb.from('reviews')
    .select('reviewed_at, is_correct, direction')
    .eq('user_id', userId).is('session_id', null)
    .order('reviewed_at', { ascending: false }).limit(limit);
  if (error) throw error;
  const byDay = {};
  for (const r of data ?? []) {
    const k = r.reviewed_at.slice(0, 10);
    (byDay[k] ||= { day: k, answered: 0, correct: 0, first: r.reviewed_at, last: r.reviewed_at });
    byDay[k].answered++;
    if (r.is_correct) byDay[k].correct++;
    if (r.reviewed_at < byDay[k].first) byDay[k].first = r.reviewed_at;
    if (r.reviewed_at > byDay[k].last) byDay[k].last = r.reviewed_at;
  }
  return Object.values(byDay).sort((a, b) => b.day.localeCompare(a.day));
}

/** 某一天的舊記錄明細 */
export async function legacyDayDetail(userId, day) {
  const { data, error } = await sb.from('reviews')
    .select('rating, is_correct, elapsed_ms, reviewed_at, direction, source, items(ko, zh)')
    .eq('user_id', userId).is('session_id', null)
    .gte('reviewed_at', `${day}T00:00:00`).lt('reviewed_at', `${day}T23:59:59.999`)
    .order('reviewed_at');
  if (error) throw error;
  return (data ?? []).filter((r) => r.items);
}

// ---------- 單詞維度的學習進度 ----------
/**
 * 每個詞的學習狀態，兩個方向彙整成一列。
 *
 * 為什麼在前端彙整而不寫成 view：兩個方向的狀態要並排呈現
 * （韓→中 已掌握、中→韓 還在學），SQL 要 pivot 才做得到，
 * 而條目量在數百級，撈回來 group 一次比維護一個 pivot view 划算。
 */
export async function wordProgress(userId) {
  const data = await fetchAll(() => sb.from('v_learning_timeline')
    .select('item_id, direction, ko, zh, hanja, item_type, state, first_learned_at, last_reviewed_at, mastered_at, due_at, interval_days, total_reviews, correct_reviews, accuracy, mastered')
    .eq('user_id', userId));

  const byItem = new Map();
  for (const r of data) {
    let w = byItem.get(r.item_id);
    if (!w) {
      w = { item_id: r.item_id, ko: r.ko, zh: r.zh, hanja: r.hanja,
            item_type: r.item_type, dirs: {} };
      byItem.set(r.item_id, w);
    }
    w.dirs[r.direction] = r;
  }

  // 詞層級的彙總指標
  for (const w of byItem.values()) {
    const ds = Object.values(w.dirs);
    w.total = ds.reduce((s, d) => s + d.total_reviews, 0);
    w.correct = ds.reduce((s, d) => s + d.correct_reviews, 0);
    w.accuracy = w.total ? w.correct / w.total : null;
    w.masteredCount = ds.filter((d) => d.mastered).length;
    w.firstLearnedAt = ds.map((d) => d.first_learned_at).sort()[0];
    w.lastReviewedAt = ds.map((d) => d.last_reviewed_at).filter(Boolean).sort().pop() || null;
    w.nextDueAt = ds.map((d) => d.due_at).filter(Boolean).sort()[0] || null;
    // 詞的整體階段取「最落後的那個方向」—— 一邊會了另一邊不會，就不算學完
    const rank = { new: 0, learning: 1, review: 2, suspended: 3 };
    w.state = ds.reduce((a, d) => (rank[d.state] < rank[a] ? d.state : a), 'review');
    w.mastered = w.masteredCount === ds.length && ds.length > 0;
  }
  return [...byItem.values()];
}

/**
 * 練過但還沒進複習輪轉的詞（自由練習只寫記錄、不建卡）。
 * 與「完全沒碰過」分開，才不會把練過的詞誤標成未開始。
 */
export async function practicedOnly(userId) {
  const data = await fetchAll(() => sb.from('v_practiced_only')
    .select('item_id, direction, ko, zh, hanja, item_type, attempts, correct, accuracy, first_at, last_at')
    .eq('user_id', userId));

  const byItem = new Map();
  for (const r of data) {
    let w = byItem.get(r.item_id);
    if (!w) {
      w = { item_id: r.item_id, ko: r.ko, zh: r.zh, hanja: r.hanja,
            item_type: r.item_type, practicedOnly: true, dirs: {},
            total: 0, correct: 0 };
      byItem.set(r.item_id, w);
    }
    w.dirs[r.direction] = r;
    w.total += r.attempts;
    w.correct += r.correct;
  }
  for (const w of byItem.values()) {
    w.accuracy = w.total ? w.correct / w.total : null;
    w.state = 'practiced';
    w.mastered = false;
    w.firstLearnedAt = Object.values(w.dirs).map((d) => d.first_at).sort()[0];
    w.lastReviewedAt = Object.values(w.dirs).map((d) => d.last_at).sort().pop();
  }
  return [...byItem.values()];
}

/** 完全沒碰過的條目 —— 既沒有卡片，也沒有任何作答記錄 */
export async function notStartedItems(userId) {
  const [cards, revs, items] = await Promise.all([
    fetchAll(() => sb.from('user_cards').select('item_id').eq('user_id', userId)),
    fetchAll(() => sb.from('reviews').select('item_id').eq('user_id', userId)),
    fetchAll(() => sb.from('items').select('id, ko, zh, hanja, item_type, tags').eq('is_active', true)),
  ]);
  const touched = new Set([...cards, ...revs].map((c) => c.item_id));
  return items.filter((i) => !touched.has(i.id));
}

/** 某個詞的作答歷程（含題型），新到舊 */
export async function itemAttempts(userId, itemId, limit = 30) {
  const { data, error } = await sb.from('reviews')
    .select('rating, is_correct, elapsed_ms, reviewed_at, direction, mode, activity, is_free, source')
    .eq('user_id', userId).eq('item_id', itemId)
    .order('reviewed_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

// ---------- 回顧清單 ----------

/**
 * 加入回顧清單。冪等 —— 重複按不報錯，也不會產生第二列。
 * note 選填：「跟 ぬ 搞混」這種備註，下次回顧看到會很有用，
 * 但強制填就變成負擔，多數人會因此乾脆不標。
 */
export async function addToReviewList(itemId, note = null) {
  const { error } = await sb.rpc('review_list_add', { p_item_id: itemId, p_note: note });
  if (error) throw error;
}

export async function removeFromReviewList(itemId) {
  const { error } = await sb.rpc('review_list_remove', { p_item_id: itemId });
  if (error) throw error;
}

/** 目前在清單上的條目（含內容），最近加入的排前面 */
export async function fetchReviewList(userId) {
  const rows = await fetchAll(() => sb.from('review_list')
    .select(`item_id, note, added_at, items!inner(${ITEM_FIELDS})`)
    .eq('user_id', userId).is('removed_at', null)
    .order('added_at', { ascending: false }));
  return rows.map((r) => ({ ...r, item: r.items }));
}

/** 只取 id，用來在詞庫與卡片上標出「已在清單」*/
export async function fetchReviewListIds(userId) {
  const rows = await fetchAll(() => sb.from('review_list')
    .select('item_id').eq('user_id', userId).is('removed_at', null));
  return new Set(rows.map((r) => r.item_id));
}

/**
 * 回顧作答：記錄照記，排程走「只縮不放」（見 core/srs.js 的 scheduleRecall）。
 *
 * ★ 為什麼不重用 logReview：那支會無條件把新排程寫回卡片。
 *   在回顧情境下，答得好卻把下次複習日推遠，正好破壞間隔重複的節奏。
 */
export async function logRecall({ userId, item, direction, rating, elapsedMs,
                                 mode, sessionId, prevCard }) {
  const next = scheduleRecall(prevCard || {}, rating);
  if (!next) {
    // 排程不動，只記答題 —— 走與自由練習相同的路徑
    return logPractice({ item, direction, rating, elapsedMs, mode, sessionId, activity: 'drill' });
  }
  return saveReview({
    userId, item, direction, rating, elapsedMs, mode, sessionId,
    prevCard: prevCard || {}, next, activity: 'drill',
  });
}

/**
 * 回顧清單的作答佇列：條目 + 該方向的完整卡片。
 *
 * ★ 一定要帶完整的卡（interval_days／ease_factor／due_at…），
 *   因為「只縮不放」要拿現有的到期日去比。
 *   cardsByItem 只取統計欄位，用它算會把 interval 當成 0，
 *   於是每張卡都被當成「還在學習階段」而不動排程 ——
 *   功能看起來能用，實際上永遠沒作用。
 */
export async function fetchRecallEntries(userId, direction) {
  const rows = await fetchReviewList(userId);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.item_id);
  const cards = {};
  for (let i = 0; i < ids.length; i += 80) {
    const { data, error } = await sb.from('user_cards')
      .select('*').eq('user_id', userId).eq('direction', direction)
      .in('item_id', ids.slice(i, i + 80));
    if (error) throw error;
    for (const c of data ?? []) cards[c.item_id] = c;
  }
  return rows.map((r) => ({ item: r.item, direction, card: cards[r.item_id] ?? null }));
}

// ---------------------------------------------------------------------
// 學習中斷後的續跑狀態（雲端）
//
// 瀏覽器端也存一份（app.js 的 localStorage）。兩邊都存的重點不是「寫兩份」，
// 而是回來時該信哪一份 —— 判斷寫在 app.js，這裡只負責讀寫。
//
// 【為什麼失敗一律吞掉】
//   續跑是加分功能。網路不通、表還沒建、RLS 擋掉 ——
//   任何一種情況都不該讓學習者連學都學不了。
//   本機那一份仍然有效，同一台裝置照樣接得上。
// ---------------------------------------------------------------------

/** 讀雲端的續跑狀態。沒有、讀不到、壞掉 → 一律回 null */
export async function loadResume(userId, mode) {
  if (!userId || !mode) return null;
  try {
    const { data, error } = await sb.from('study_resume')
      .select('state, saved_at').eq('user_id', userId).eq('mode', mode).maybeSingle();
    if (error || !data?.state) return null;
    return { ...data.state, savedAt: Date.parse(data.saved_at) || 0 };
  } catch { return null; }
}

/** 寫雲端。一個使用者一列，直接覆蓋 —— 續跑狀態是「現在做到哪」，不是歷史 */
export async function saveResume(userId, mode, state) {
  if (!userId || !mode || !state) return;
  try {
    await sb.from('study_resume').upsert({
      user_id: userId,
      mode,
      state,
      // saved_at 用用戶端的時間：要比的是「哪一台裝置的進度比較新」。
      // 用伺服器時間的話，網路慢的那一台會後到，於是先操作的蓋掉後操作的。
      saved_at: new Date(state.savedAt || Date.now()).toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,mode' });
  } catch { /* 見檔頭：續跑不該擋住學習 */ }
}

export async function clearResume(userId, mode) {
  if (!userId || !mode) return;
  try {
    await sb.from('study_resume').delete().eq('user_id', userId).eq('mode', mode);
  } catch { /* 同上 */ }
}
