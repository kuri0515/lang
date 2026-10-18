// =====================================================================
// 私密音檔的簽名網址
//
// 【問題】
//   items.audio_url 存的是 sb:<桶>/<路徑>（見 migration 0028）。
//   私密桶的檔案不能直接播，要先換成「有時效的簽名網址」，
//   而換網址是一趟網路往返。
//
// 【為什麼一定要預先換好】
//   瀏覽器（尤其 iOS Safari）只允許在「使用者點擊的當下」開始播放。
//   若點下去才去換網址，await 之後再 play() 已經不算點擊當下，
//   會被拒絕 —— 症狀是「有錄音的卡按了沒聲音」，而且只在手機上發生。
//   所以開始一輪時就把這一輪用得到的網址一次換好（createSignedUrls 一趟批次），
//   播放時從快取同步取，保留在點擊當下。
//
// 【為什麼只快取 50 分鐘】簽名網址有效 60 分鐘，留 10 分鐘餘裕。
//
// 一般 http(s) 網址完全不經過這裡，照舊直接播。
// =====================================================================
import { sb } from './client.js';

const TTL_S = 3600;
const KEEP_MS = 50 * 60 * 1000;
const cache = new Map();                       // 'sb:桶/路徑' → { url, exp }

/** 'sb:haerin-audio/p06-05.mp3' → { bucket, path }；不是這種格式回 null */
export function parseStored(u) {
  const m = /^sb:([^/]+)\/(.+)$/.exec(String(u || ''));
  return m ? { bucket: m[1], path: m[2] } : null;
}

export const isStored = (u) => !!parseStored(u);

/** 同步查快取。沒有或過期回 null —— 呼叫端要退回別條路，不能等 */
export function cachedUrl(u) {
  const c = cache.get(u);
  return c && c.exp > Date.now() ? c.url : null;
}

/** 一次換好一批（依桶分組，每桶一趟）。失敗不丟錯：播放端會退回 TTS */
export async function prefetch(urls) {
  const need = [...new Set((urls || []).filter((u) => isStored(u) && !cachedUrl(u)))];
  const byBucket = new Map();
  for (const u of need) {
    const { bucket, path } = parseStored(u);
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket).push({ u, path });
  }
  await Promise.all([...byBucket].map(async ([bucket, list]) => {
    try {
      const { data, error } = await sb.storage.from(bucket)
        .createSignedUrls(list.map((x) => x.path), TTL_S);
      if (error || !Array.isArray(data)) return;
      const byPath = new Map(data.map((d) => [d.path, d.signedUrl]));
      for (const { u, path } of list) {
        const url = byPath.get(path);
        if (url) cache.set(u, { url, exp: Date.now() + KEEP_MS });
      }
    } catch { /* 換不到就沒有錄音，退回 TTS —— 不該擋住學習 */ }
  }));
}

/** 取單一個（快取沒有就現換）。給「沒預先換到」的情況保底 */
export async function signedUrl(u) {
  if (!isStored(u)) return u;
  await prefetch([u]);
  return cachedUrl(u);
}

export const _clear = () => cache.clear();
