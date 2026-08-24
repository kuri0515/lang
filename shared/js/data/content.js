// =====================================================================
// 內容層（decks / items）—— 唯讀為主，寫入在 admin.js
// =====================================================================
import { sb, ITEM_FIELDS, fetchAll } from './client.js';

// ★ 詞庫清單快取。
//   itemsByKo 需要用 slug 換 id，而精讀「每開一幕」都會呼叫它一次 ——
//   不快取的話，每開一幕就多一次往返，只為了拿兩列不會變的資料。
let _decks = null;
export const invalidateDecks = () => { _decks = null; };

export async function listDecks() {
  if (_decks) return _decks;
  const { data, error } = await sb.from('decks')
    .select('id, slug, title, title_ko, description, level, sort_order')
    .order('sort_order').order('slug');
  if (error) throw error;
  _decks = data ?? [];
  return _decks;
}


/** 搜尋條件收斂在此，瀏覽與自由練習共用同一套語意 */
function applyFilters(q, { tag, search, deckId, ids }) {
  if (deckId) q = q.eq('deck_id', deckId);
  // 陣列＝一組標籤取聯集（生活場景由多個標籤組成），字串＝單一標籤
  if (Array.isArray(tag) && tag.length) q = q.overlaps('tags', tag);
  else if (typeof tag === 'string' && tag) q = q.contains('tags', [tag]);
  if (ids?.length) q = q.in('id', ids);
  if (search?.trim()) {
    // 這些字元會擾亂 PostgREST 的 or 語法
    const k = search.trim().replace(/[%,()]/g, '');
    q = q.or(`ko.ilike.*${k}*,zh.ilike.*${k}*,romanization.ilike.*${k}*`);
  }
  return q;
}

/**
 * 一頁一頁地取（瀏覽頁用）。
 *
 * 【為什麼瀏覽頁不能再「先全撈再前端分頁」】
 *   畫面本來就是一次只畫 60 條，但網路那一段是把整份搬下來。
 *   日文站 items 到 7049 條之後，那是 gzip 628 KB、8 趟連續往返、
 *   本機實測 3.9 秒 —— 而使用者要看的只有最前面那 60 條。
 *   撈的量必須跟著**看得到的量**走，不是跟著詞庫大小走。
 *
 * 【代價，以及為什麼接受】
 *   搜尋從「在已下載的資料上瞬間過濾」變成每次打一趟。
 *   但先前那個「瞬間」的前提是已經先等完 3.9 秒；
 *   把 3.9 秒攤成每次搜尋約 300 ms，換到的是**開頁就看得到東西**。
 *   輸入端本來就有 250 ms 的 debounce，連打字時的趟數也不會爆。
 *
 * 回傳 total 是為了「N 條」與「還有幾條」——
 * 那兩個數字若改成算已載入的筆數，會在載入更多時一路往上跳。
 */
export async function pageItems({ tag = '', search = '', deckId = null,
                                  offset = 0, limit = 60 } = {}) {
  const q = applyFilters(
    sb.from('items').select(ITEM_FIELDS, { count: 'exact' }).eq('is_active', true),
    { tag, search, deckId, ids: null }).order('sort_order');
  const { data, error, count } = await q.range(offset, offset + limit - 1);
  if (error) throw error;
  return { rows: data ?? [], total: count ?? (data?.length ?? 0) };
}

/** 任意取材：瀏覽、自由練習、弱項集中練都走這裡 */
export async function pickItems({ ids = null, tag = '', search = '', deckId = null, limit = null,
                                  fields = ITEM_FIELDS, noteHas = '' } = {}) {
  const build = () => {
    let q = applyFilters(
      sb.from('items').select(fields).eq('is_active', true),
      { tag, search, deckId, ids });
    // 對話沒有自己的表，是靠 note 開頭歸組的（見 core/dialogue.js）。
    // 讓資料庫先篩，前端就不必為了 188 句對話把 7049 條詞全搬下來。
    //
    // ★ 用「包含」而不是「開頭」：parseLine 會先 trim()，也就是
    //   「 對話 A｜…」（前面有空白）今天是合法的。改成開頭比對會把它們
    //   靜靜地濾掉 —— 少一句對話，畫面上看起來只是那段對話短了一點。
    //   實測兩種寫法在日文站都是 188 句，那就挑不會漏的那一種。
    if (noteHas) q = q.like('note', `*${noteHas}*`);
    return q.order('sort_order');
  };
  // limit 有值時是刻意取樣（例如自由練習抽 60 題）；沒給就撈完整
  if (limit) {
    const { data, error } = await build().limit(limit);
    if (error) throw error;
    return data ?? [];
  }
  return fetchAll(build, { tiebreak: 'id' });
}

/** 所有標籤與各自條目數 */
/**
 * ★ 讓資料庫算（v_tag_counts，見 migration 0027）。
 *
 *   本來是把**每一條的 tags 欄位**都撈回來再自己數 ——
 *   日文站 7049 條之後那是 8 趟連續往返、實測約 2.4 秒，
 *   而算出來的結果只有三十來列。
 *   資料量會一直長，答案卻不會，這種形狀就該讓資料庫算。
 *
 *   view 還沒建起來的環境（例如另一站還沒跑 migration）退回舊路 ——
 *   直接壞掉的話，症狀是整排篩選消失，而那不像是「少跑了一個 migration」。
 */
export async function listTags() {
  const { data, error } = await sb.from('v_tag_counts').select('tag, n');
  if (!error && data) {
    return data.map((r) => [r.tag, r.n]).sort((a, b) => b[1] - a[1]);
  }
  const rows = await fetchAll(() => sb.from('items').select('tags').eq('is_active', true),
    { tiebreak: 'id' });
  const count = {};
  for (const r of rows) for (const t of r.tags || []) count[t] = (count[t] || 0) + 1;
  return Object.entries(count).sort((a, b) => b[1] - a[1]);
}

/**
 * 共享同一個漢字的其他詞。
 * 排除句子 —— 句子含此詞 ≠ 同源詞，會污染串聯。
 */
export async function sharesHanja(char, excludeId = null, limit = 5) {
  const { data, error } = await sb.from('items')
    .select('id, ko, zh, hanja')
    .eq('is_active', true).neq('item_type', 'sentence')
    .like('hanja', `%${char}%`).limit(limit + 1);
  if (error) throw error;
  return (data ?? []).filter((x) => x.id !== excludeId).slice(0, limit);
}

/**
 * 中文意思相同的其他韓文詞。
 *
 * 為什麼需要：「中→韓」方向看到「謝謝」，學生想的可能是 고맙습니다，
 * 卡片答案卻是 감사합니다 —— 明明答對了卻會自評成答錯。
 *
 * 用完全相等而非模糊比對：쓰다 的 zh 是「寫／用／戴／苦」，
 * 拆開來比對會把「寫」的其他詞也牽進來，那些並不是同義詞。
 */
export async function sameMeaning(zh, excludeId = null, limit = 4) {
  if (!zh) return [];
  const { data, error } = await sb.from('items')
    .select('id, ko, zh, note, romanization')
    .eq('is_active', true).eq('zh', zh).limit(limit + 1);
  if (error) throw error;
  return (data ?? []).filter((x) => x.id !== excludeId).slice(0, limit);
}

/**
 * 發音課程的進度：每個發音標籤有多少條、學過幾條、掌握幾條。
 *
 * 一次撈完再在記憶體裡分組 —— 25 個標籤各打一次 API 要 25 趟往返，
 * 首頁會卡住。條目與卡片各一次查詢就夠。
 *
 * 「學過」以有卡片為準、「掌握」以 mastered_at 為準：
 * 學習者要看的是「這一課碰過沒有」與「這一課穩了沒有」兩件不同的事。
 */
export async function pronProgress(userId, tags) {
  // 一課＝一個標籤，所以走輕量的 RPC。
  // 失敗時退回舊路徑 —— 進度算不出來不該讓整個首頁空白。
  try {
    return await tagCounts(tags);
  } catch {
    return tagProgress(userId, tags.map((t) => ({ key: t, tags: [t] })), null)
      .then((rows) => rows.map((r) => ({ ...r, tag: r.key })));
  }
}

/**
 * 一組一組算進度。groups = [{ key, tags }]，一組可以涵蓋多個標籤。
 *
 * 一次撈完再在記憶體裡分組 —— 每組各打一次 API 要幾十趟往返，首頁會卡住。
 * 同一個詞同時屬於兩個標籤時只算一次（用 Set 去重），
 * 否則「溫暖」與「關心」都掛著的詞會讓總數虛胖，進度條永遠到不了 100%。
 */
/**
 * 單一標籤的進度，直接問資料庫要。
 *
 * 【為什麼不沿用底下的 tagProgress】
 *   那支要處理「一組涵蓋多個標籤」（生活場景是標籤的聯集），
 *   所以必須把條目撈到前端才能去重。發音課程沒有這個需求 ——
 *   一課就是一個標籤，計數在資料庫做就好。
 *
 *   實測：舊做法 1207 ms / 75 KB（把全部 826 條的標籤搬到前端再數），
 *   新做法 555 ms / 5 KB。而且舊做法會隨內容增加線性變差，新做法不會。
 *
 * RPC 不接受 user_id —— 由它自己取 auth.uid()，
 * 免得開一個「填別人 id 就看得到別人進度」的洞。
 */
export async function tagCounts(tags) {
  const { data, error } = await sb.rpc('tag_progress', { p_tags: tags });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    tag: r.tag,
    total: Number(r.total),
    started: Number(r.started),
    mastered: Number(r.mastered),
  }));
}

export async function tagProgress(userId, groups, deckId = null) {
  const all = [...new Set(groups.flatMap((g) => g.tags))];
  const items = await fetchAll(() => {
    let q = sb.from('items').select('id, tags').eq('is_active', true).overlaps('tags', all);
    if (deckId) q = q.eq('deck_id', deckId);
    return q;
  }, { tiebreak: 'id' });
  const cards = await fetchAll(() => sb.from('user_cards')
    .select('item_id, mastered_at').eq('user_id', userId),
  { tiebreak: ['item_id', 'direction'] });

  const started = new Set(cards.map((c) => c.item_id));
  const mastered = new Set(cards.filter((c) => c.mastered_at).map((c) => c.item_id));

  return groups.map((g) => {
    const want = new Set(g.tags);
    const ids = new Set(items.filter((it) => (it.tags || []).some((t) => want.has(t)))
                             .map((it) => it.id));
    return {
      ...g,
      total: ids.size,
      started: [...ids].filter((id) => started.has(id)).length,
      mastered: [...ids].filter((id) => mastered.has(id)).length,
    };
  }).filter((g) => g.total > 0);
}

/** 選擇題干擾項池：一次抓好放記憶體，避免每題都打一次 API */
export async function distractorPool(deckId = null) {
  return fetchAll(() => {
    let q = sb.from('items')
      // ★ 只取 buildChoices 真正會讀的欄位。
      //   example_ko / example_zh / hanja 從來沒被干擾項邏輯用到，
      //   但 hanja 裝的是注音字串（駅[えき]は…），佔了整包的四分之一。
      //   實測 180 KB → 135 KB、1182 ms → 822 ms。
      //   「多帶一點以防萬一」的代價是每個使用者每次開四選一都付一次。
      .select('id, ko, zh, pos, tags, item_type')
      .eq('is_active', true);
    if (deckId) q = q.eq('deck_id', deckId);
    return q;
  }, { tiebreak: 'id' });
}

/**
 * 依目標語言的字面精確取條目。
 *
 * 【為什麼不用「撈一批再過濾」】
 *   形近組的夥伴（ぬ／め、シ／ツ）在詞庫裡的位置是隨機的。
 *   撈前 400 條再過濾的話，排在 400 之後的夥伴永遠找不到 ——
 *   而功能看起來完全正常：它只是沒有把該加的加進去，不會報錯。
 *
 *   直接查那幾個字：結果精確，傳輸量也從幾百條變成幾條。
 */
/**
 * @param fields 只取畫面真的會讀的欄位。
 *   預設整包（ITEM_FIELDS）是為了相容既有呼叫端（形近組要完整卡片），
 *   但精讀的「這一幕的詞」只顯示詞形／注音／詞性／中文 ——
 *   整包會多帶 example_ko / example_zh（那是整句台詞）與 note，
 *   實測一幕 8 個詞就多 46% 的傳輸量，而那些欄位一個都沒被讀到。
 */
export async function itemsByKo(koList, deckSlug = null, fields = ITEM_FIELDS) {
  const list = [...new Set((koList || []).filter(Boolean))];
  if (!list.length) return [];
  let q = sb.from('items').select(fields).eq('is_active', true).in('ko', list);
  // ★ 限定詞庫。不限定的話，同一個詞形在別副詞庫裡的卡片也會被撈進來 ——
  //   精讀的「這一幕的詞」因此混進五十音課本的卡片，
  //   而畫面看起來完全正常（那些詞確實出現在這一幕，只是連錯了卡）。
  //   實測影響 29/70 幕。
  if (deckSlug) {
    const deck = (await listDecks()).find((d) => d.slug === deckSlug);
    if (deck) q = q.eq('deck_id', deck.id);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}
