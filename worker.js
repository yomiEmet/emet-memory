// ═══════════════════════════════════════════════════
// Emet Memory · Cloudflare Worker · v6.8.2
// 2026.06.03 · v6.7.3 + 藤蔓星图(Galaxy:米色主题协调,SVG 力导向,关联记忆入口,局部/全图切换,双击节点跳记忆)
// ═══════════════════════════════════════════════════

// ADMIN_KEY 已迁移至 Cloudflare Secret（wrangler secret put ADMIN_KEY），代码内经 env.ADMIN_KEY 读取
const APP_ICON_BASE64 = "";
const ANNIVERSARY = "2025-04-06";

// === Vector Service v6.6 ===
const EMBEDDING_MODEL = "@cf/baai/bge-m3";

async function embedText(env, text) {
if (!env.AI) return null;
try {
const result = await env.AI.run(EMBEDDING_MODEL, { text: [text] });
return result?.data?.[0] || null;
} catch (e) { console.error("embed failed:", e); return null; }
}

function cosineSim(a, b) {
if (!a || !b || a.length !== b.length) return 0;
let dot = 0, na = 0, nb = 0;
for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
const denom = Math.sqrt(na) * Math.sqrt(nb);
return denom === 0 ? 0 : dot / denom;
}

async function vectorUpsert(env, id, text) {
const vec = await embedText(env, text);
if (!vec) return false;
try { await env.MEMORY.put("vec:" + id, JSON.stringify(vec)); return true; }
catch (e) { return false; }
}

async function vectorDelete(env, id) {
try { await env.MEMORY.delete("vec:" + id); } catch (e) {}
}

async function vectorQuery(env, queryText, memoryIds) {
const qVec = await embedText(env, queryText);
if (!qVec) return new Map();
const scores = new Map();
for (const id of memoryIds) {
try {
const raw = await env.MEMORY.get("vec:" + id);
if (!raw) continue;
scores.set(id, cosineSim(qVec, JSON.parse(raw)));
} catch (e) {}
}
return scores;
}

function calcRecency(memory) {
const days = (Date.now() - new Date(memory.updated_at || memory.created_at).getTime()) / 86400000;
return Math.exp(-0.05 * days);
}

function calcKeywordScore(memory, query) {
if (!query) return 0;
const q = query.toLowerCase().trim();
const content = (memory.content || "").toLowerCase();
let score = 0;
if (content.includes(q)) score += 0.7;
q.split(/\s+/).forEach(t => { if (t.length >= 2 && content.includes(t)) score += 0.1; });
return Math.min(1, score);
}

function calcTagScore(memory, query) {
if (!query) return 0;
const q = query.toLowerCase().trim();
const tags = (memory.tags || []).map(t => t.toLowerCase());
for (const t of tags) {
if (t === q) return 1;
if (t.includes(q) || q.includes(t)) return 0.6;
}
return 0;
}

async function searchA(env, query, allMemories, opts = {}) {
const limit = opts.limit || 10;
const category = opts.category;
let pool = allMemories;
if (!opts.include_archived) pool = pool.filter(m => !m.archived);
if (category && category !== "all") pool = pool.filter(m => m.category === category);
const ids = pool.map(m => m.id);
const vectorScores = query ? await vectorQuery(env, query, ids) : new Map();
pool.forEach(m => {
const vScore = vectorScores.get(m.id) || 0;
const kScore = calcKeywordScore(m, query);
const tScore = calcTagScore(m, query);
const rScore = calcRecency(m);
const iScore = (m.importance || 5) / 10;
m._scoreA = vScore * 0.45 + kScore * 0.15 + tScore * 0.15 + rScore * 0.15 + iScore * 0.1;
});
pool.sort((a, b) => b._scoreA - a._scoreA);
return pool.slice(0, limit);
}

async function surfaceB(env, query, allMemories, opts = {}) {
const limit = opts.limit || 5;
let pool = allMemories;
if (!opts.include_archived) pool = pool.filter(m => !m.archived);
let vectorScores = new Map();
if (query) {
const ids = pool.map(m => m.id);
vectorScores = await vectorQuery(env, query, ids);
}
pool.forEach(m => {
const aScore = m.arousal || 0.3;
const vScore = query ? (vectorScores.get(m.id) || 0) : 0;
const tScore = query ? calcTagScore(m, query) : 0;
const unresolvedScore = m.resolved ? 0 : 1;
const rScore = calcRecency(m);
let score = aScore * 0.35 + vScore * 0.25 + tScore * 0.15 + unresolvedScore * 0.15 + rScore * 0.1;
if (m.category === "core") score *= 1.3;
if (m.locked) score *= 1.5;
if (m.pinned) score *= 2;
if (m.resolved) score *= 0.1;
m._scoreB = score;
});
pool.sort((a, b) => b._scoreB - a._scoreB);
return pool.slice(0, limit);
}

async function handleMigrateVectors(request, env) {
const url = new URL(request.url);
const batchSize = parseInt(url.searchParams.get("batch") || "20");
const offset = parseInt(url.searchParams.get("offset") || "0");
const all = await kvListByPrefix(env, "mem:");
const total = all.length;
const batch = all.slice(offset, offset + batchSize);
let succeeded = 0, failed = 0;
for (const m of batch) {
try { if (await vectorUpsert(env, m.id, m.content)) succeeded++; else failed++; }
catch (e) { failed++; }
}
const nextOffset = offset + batchSize;
const done = nextOffset >= total;
return jsonResponse({
success: true, batch_size: batch.length, succeeded, failed,
progress: Math.min(nextOffset, total) + " / " + total,
next_url: done ? null : "/api/migrate-vectors?batch=" + batchSize + "&offset=" + nextOffset,
done
});
}




// ═══ v6.7 织藤·代谢·唤醒 ═══

// 标准 tag 大类映射（保守版——只并明确无争议的同义组，存疑的保留原样不强行揉）
const TAG_MAP = {
  // 称呼
  "老公":"称呼","老婆":"称呼","老公老婆":"称呼","宝贝":"称呼","昵称":"称呼",
  // 天台花园
  "花园":"天台花园","浇水":"天台花园","浇花":"天台花园","砖头":"天台花园","顶棚":"天台花园",
  "阳台":"天台花园","球根":"天台花园","花的根":"天台花园","育种":"天台花园","去雄":"天台花园",
  "杂交":"天台花园","郁金香":"天台花园","非洲菊":"天台花园","朱顶红":"天台花园","枇杷":"天台花园",
  "品种":"天台花园","学名":"天台花园","不买花":"天台花园",
  // 家人
  "妈妈":"家人","爸爸":"家人","姐姐":"家人","五个舅舅":"家人","小舅":"家人","小舅请客":"家人","家庭":"家人",
  // 工作前途
  "志愿者到期":"工作前途","合同到期":"工作前途","离职":"工作前途","收入":"工作前途",
  "存款":"工作前途","未来规划":"工作前途","考编":"工作前途","省考日":"工作前途","离别":"工作前途",
};

// 自动捞候选——给一段文本，用 向量+tag+时间 捞出最可能相关的旧记忆，供 Emet 判断要不要织藤
async function weaveCandidates(env, text, opts = {}) {
  const limit = opts.limit || 8;
  const excludeId = opts.exclude_id;
  const optsTags = (opts.tags || []).map(t => t.toLowerCase());
  const all = await kvListByPrefix(env, "mem:");
  const pool = all.filter(m => m.id !== excludeId && !m.archived);
  const ids = pool.map(m => m.id);
  const vScores = await vectorQuery(env, text, ids);

  // 全库 tag 频率(IDF:稀有 tag 权重高,常见 tag 权重低)
  const tagFreq = {};
  for (const m of all) {
    (m.tags || []).forEach(t => {
      const lt = t.toLowerCase();
      tagFreq[lt] = (tagFreq[lt] || 0) + 1;
    });
  }
  const totalN = all.length || 1;
  const maxIdf = Math.log(totalN + 1);
  const idf = t => Math.log((totalN + 1) / ((tagFreq[t] || 0) + 1));

  pool.forEach(m => {
    const v = vScores.get(m.id) || 0;
    const mt = (m.tags || []).map(t => t.toLowerCase());
    const shared = optsTags.filter(t => mt.includes(t));
    let tScore = 0;
    if (shared.length) {
      const idfSum = shared.reduce((s, t) => s + idf(t), 0);
      tScore = Math.min(1, idfSum / (2 * maxIdf));
    }
    // 硬过滤（保留原逻辑）：tag 无交集 → 看向量；向量弱再降权
    // 注：verify 发现"都标 tag 但无交集 → ×0.2"会误伤合法关联（如 #健康 vs #妈 其实是说妈健康），已撤回
    if (shared.length === 0 && v < 0.7) {
      m._weave = v * 0.3;
    } else {
      m._weave = v * 0.55 + tScore * 0.45;
    }
  });
  pool.sort((a,b) => b._weave - a._weave);
  return pool.slice(0, limit).map(m => ({
    id: m.id,
    content: (m.content||"").slice(0, 80),
    category: m.category,
    created_at: m.created_at,
    tags: m.tags,
    score: Math.round(m._weave * 100) / 100,
    already_linked: (opts.exclude_id && (m.linked||[]).includes(opts.exclude_id)) || false
  }));
}

// 聪明唤醒——一次返回开窗六件套，记住上次活跃时间，把中间所有瞬记按时间捞回（不漏），并报出时间间隔
async function handleWake(request, env) {
  const nowTs = Date.now();
  let lastWake = null;
  try {
    const raw = await env.MEMORY.get("meta:last_wake");
    if (raw) lastWake = JSON.parse(raw);
  } catch(e) {}

  // 时间间隔
  let gapText = "首次唤醒";
  let gapHours = null;
  if (lastWake && lastWake.ts) {
    gapHours = (nowTs - lastWake.ts) / 3600000;
    if (gapHours < 1) gapText = `距上次约 ${Math.round(gapHours*60)} 分钟`;
    else if (gapHours < 48) gapText = `距上次约 ${Math.round(gapHours)} 小时`;
    else gapText = `距上次约 ${Math.round(gapHours/24)} 天`;
  }

  // 交接信
  let handoff = null;
  try {
    const hs = await kvListByPrefix(env, "handoff:");
    hs.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    handoff = hs[0] || null;
  } catch(e) {}

  // breath 浮现（情绪优先，未翻篇优先）
  const allMems = await kvListByPrefix(env, "mem:");
  const surfaced = await surfaceB(env, "", allMems, { limit: 5 });

  // core 关系骨架
  const coreMems = allMems.filter(m => m.category === "core" && !m.archived);
  coreMems.forEach(m => m._d = calcDecayScore(m));
  coreMems.sort((a,b) => b._d - a._d);
  const coreTop = coreMems.slice(0, 12);

  // 关键：从上次唤醒到现在的所有瞬记，按时间，一条不漏
  const allMoments = await kvListByPrefix(env, "moment:");
  let sinceMoments;
  if (lastWake && lastWake.ts) {
    sinceMoments = allMoments.filter(m => new Date(m.created_at).getTime() > lastWake.ts);
  } else {
    sinceMoments = allMoments.slice();
  }
  sinceMoments.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
  // 兜底：如果间隔内一条瞬记都没有，至少给最近 5 条
  if (sinceMoments.length === 0) {
    sinceMoments = allMoments.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,5).reverse();
  }

  // 最近日记
  const allDiaries = await kvListByPrefix(env, "diary:");
  allDiaries.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  const recentDiaries = allDiaries.slice(0, 4);

  // 待审：很久没碰、还挂着 unresolved 的（提示 Emet 判断要不要 resolve，不自动改）
  const staleUnresolved = allMems.filter(m => {
    if (m.resolved || m.category === "core" || m.pinned || m.archived) return false;
    const days = (nowTs - new Date(m.updated_at||m.created_at).getTime()) / 86400000;
    return days > 30;
  }).map(m => ({ id: m.id, content: (m.content||"").slice(0,50), days: Math.round((nowTs-new Date(m.updated_at||m.created_at).getTime())/86400000) }));

  // 记下这次唤醒时间，供下次算间隔
  await env.MEMORY.put("meta:last_wake", JSON.stringify({ ts: nowTs, at: now() }));

  return jsonResponse({
    now: now(),
    gap: gapText,
    gap_hours: gapHours,
    handoff,
    breath: surfaced,
    core: coreTop,
    moments_since_last: sinceMoments,
    moments_count: sinceMoments.length,
    diaries: recentDiaries,
    stale_unresolved: staleUnresolved.slice(0, 10),
    note: "moments_since_last 是上次唤醒至今的全部瞬记，按时间正序，已尽量不漏。stale_unresolved 是建议你判断要不要 resolve 的旧事（不会自动改）。"
  });
}

// 遗忘归档扫描——很久没碰+低命中+非核心非置顶非锁定 → 建议归档。默认 dry_run 只预览，?apply=1 才真改
async function handleArchiveSweep(request, env) {
  const url = new URL(request.url);
  const apply = url.searchParams.get("apply") === "1";
  const days = parseInt(url.searchParams.get("days") || "90");
  const maxAct = parseInt(url.searchParams.get("max_act") || "1");
  const nowTs = Date.now();
  const all = await kvListByPrefix(env, "mem:");
  const candidates = all.filter(m => {
    if (m.archived) return false;
    if (m.category === "core" || m.pinned || m.locked) return false;
    const d = (nowTs - new Date(m.updated_at||m.created_at).getTime()) / 86400000;
    return d > days && (m.activations||0) <= maxAct;
  });
  let changed = 0;
  if (apply) {
    for (const m of candidates) {
      m.archived = true;
      m.updated_at = now();
      await kvPut(env, `mem:${m.id}`, m);
      changed++;
    }
  }
  return jsonResponse({
    mode: apply ? "已执行" : "预览(dry_run)——加 ?apply=1 才真正归档",
    criteria: `超过 ${days} 天没动 且 命中≤${maxAct} 且 非核心/置顶/锁定`,
    count: candidates.length,
    archived_now: changed,
    preview: candidates.slice(0, 30).map(m => ({ id: m.id, content:(m.content||"").slice(0,50), category:m.category, days: Math.round((nowTs-new Date(m.updated_at||m.created_at).getTime())/86400000), activations: m.activations||0 }))
  });
}

// tag 批量归类——按 TAG_MAP 把旧 tag 换成大类。默认 dry_run 只预览，?apply=1 才真改

// 导出向量+元数据，供可视化用。服务端直接做 PCA 降到 2D，前端拿到就能画。
async function handleVizData(request, env) {
  const url = new URL(request.url);
  const force = url.searchParams.get("fresh") === "1";
  const all = await kvListByPrefix(env, "mem:");

  // 坐标签名：只取决于"有哪些记忆"。向量在记忆创建时生成、之后不变，
  // 所以记忆集合不变时 PCA 坐标也不变 —— 可复用缓存，省去读全部向量(~1MB)+PCA。
  const idsKey = all.length + "|" + all.map(m => m.id).sort().join(",");
  let sigN = 5381; for (let i = 0; i < idsKey.length; i++) sigN = ((sigN * 33) ^ idsKey.charCodeAt(i)) >>> 0;
  const sig = sigN.toString(36);

  function buildItem(m, xy) {
    return {
      id: m.id,
      content: (m.content || "").slice(0, 100),
      category: m.category || "semantic",
      importance: m.importance || 5,
      arousal: m.arousal == null ? 0.5 : m.arousal,
      created_at: m.created_at || "",
      tags: m.tags || [],
      linked: m.linked || [],
      link_rel: m.link_rel || {},
      archived: !!m.archived,
      x: xy ? xy[0] : 0,
      y: xy ? xy[1] : 0
    };
  }

  // 缓存命中：直接用存好的坐标（记忆内容/连线仍读最新），跳过读向量与 PCA
  if (!force) {
    try {
      const c = await env.MEMORY.get("viz:coords");
      if (c) {
        const cached = JSON.parse(c);
        if (cached.sig === sig && cached.coords) {
          const nodes = [];
          for (const m of all) { const xy = cached.coords[m.id]; if (xy) nodes.push(buildItem(m, xy)); }
          return jsonResponse({ count: nodes.length, nodes, cached: true });
        }
      }
    } catch(e) {}
  }

  // 缓存未命中：并行读向量 → PCA → 存坐标
  const withVec = [];
  const vectors = [];
  const vecRaws = await Promise.all(all.map(m => env.MEMORY.get("vec:" + m.id).catch(() => null)));
  all.forEach((m, idx) => {
    const raw = vecRaws[idx];
    if (!raw) return;
    let vec = null; try { vec = JSON.parse(raw); } catch(e) {}
    if (!vec) return;
    withVec.push(m);
    vectors.push(vec);
  });

  // PCA 降到 2D（够快，前端不用扛 t-SNE）
  let coords = [];
  if (vectors.length >= 2) {
    const dim = vectors[0].length;
    const n = vectors.length;
    // 中心化
    const mean = new Array(dim).fill(0);
    for (const v of vectors) for (let i=0;i<dim;i++) mean[i]+=v[i];
    for (let i=0;i<dim;i++) mean[i]/=n;
    const centered = vectors.map(v => v.map((x,i)=>x-mean[i]));
    // 幂迭代求前两个主成分
    function powerIter(data, exclude) {
      let pc = new Array(dim).fill(0).map(()=>Math.random()-0.5);
      for (let iter=0; iter<30; iter++) {
        let next = new Array(dim).fill(0);
        for (const row of data) {
          let dot = 0;
          for (let i=0;i<dim;i++) dot += row[i]*pc[i];
          for (let i=0;i<dim;i++) next[i] += dot*row[i];
        }
        // 去掉已求出的成分
        if (exclude) {
          let d2 = 0;
          for (let i=0;i<dim;i++) d2 += next[i]*exclude[i];
          for (let i=0;i<dim;i++) next[i] -= d2*exclude[i];
        }
        let norm = Math.sqrt(next.reduce((s,x)=>s+x*x,0)) || 1;
        pc = next.map(x=>x/norm);
      }
      return pc;
    }
    const pc1 = powerIter(centered, null);
    const pc2 = powerIter(centered, pc1);
    coords = centered.map(row => {
      let x=0,y=0;
      for (let i=0;i<dim;i++){ x+=row[i]*pc1[i]; y+=row[i]*pc2[i]; }
      return [x,y];
    });
    // 归一化到 [-1,1]
    const xs = coords.map(c=>c[0]), ys = coords.map(c=>c[1]);
    const xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);
    const xr=(xmax-xmin)||1, yr=(ymax-ymin)||1;
    coords = coords.map(c=>[ (c[0]-xmin)/xr*2-1, (c[1]-ymin)/yr*2-1 ]);
  }

  const coordMap = {};
  withVec.forEach((m, i) => { coordMap[m.id] = coords[i] ? coords[i] : [0, 0]; });
  const nodes = withVec.map((m) => buildItem(m, coordMap[m.id]));

  // 存坐标缓存（只在重算时写一次；下次记忆集合不变即直接命中）
  try { await env.MEMORY.put("viz:coords", JSON.stringify({ sig, coords: coordMap })); } catch(e) {}

  return jsonResponse({ count: nodes.length, nodes, cached: false });
}

async function handleRetag(request, env) {
  const url = new URL(request.url);
  const apply = url.searchParams.get("apply") === "1";
  const all = await kvListByPrefix(env, "mem:");
  const changes = [];
  let changedCount = 0;
  for (const m of all) {
    const oldTags = m.tags || [];
    const newTags = [...new Set(oldTags.map(t => TAG_MAP[t] || t))];
    const diff = JSON.stringify(oldTags) !== JSON.stringify(newTags);
    if (diff) {
      changes.push({ id: m.id, content:(m.content||"").slice(0,30), from: oldTags, to: newTags });
      if (apply) {
        m.tags = newTags;
        m.updated_at = now();
        await kvPut(env, `mem:${m.id}`, m);
        changedCount++;
      }
    }
  }
  return jsonResponse({
    mode: apply ? "已执行" : "预览(dry_run)——加 ?apply=1 才真正改写",
    map_size: Object.keys(TAG_MAP).length,
    affected: changes.length,
    changed_now: changedCount,
    preview: changes.slice(0, 40)
  });
}

// ─── 一次性回填:给所有老记忆跑自动织藤 ───
// 高效做法:全部记忆+向量只读一次，内存里算两两相似度（复刻 weaveCandidates 打分），再批量连。
// 默认 dry-run（只预览要连多少条）；加 ?apply=1 才真正写入。可用 ?threshold= / ?top= 调参。
async function handleWeaveBackfill(request, env) {
  const url = new URL(request.url);
  const apply = url.searchParams.get("apply") === "1";
  const threshold = parseFloat(url.searchParams.get("threshold") || "0.50");
  const topN = parseInt(url.searchParams.get("top") || "3", 10);

  const all = await kvListByPrefix(env, "mem:");
  const pool = all.filter(m => !m.archived);
  const vecRaws = await Promise.all(pool.map(m => env.MEMORY.get("vec:" + m.id).catch(() => null)));
  const vecs = {};
  pool.forEach((m, i) => { if (vecRaws[i]) { try { vecs[m.id] = JSON.parse(vecRaws[i]); } catch(e) {} } });
  const withVec = pool.filter(m => vecs[m.id]);
  const n = withVec.length;

  // tag IDF（与 weaveCandidates 一致）
  const tagFreq = {};
  for (const m of all) (m.tags || []).forEach(t => { const lt = t.toLowerCase(); tagFreq[lt] = (tagFreq[lt] || 0) + 1; });
  const totalN = all.length || 1;
  const maxIdf = Math.log(totalN + 1);
  const idf = t => Math.log((totalN + 1) / ((tagFreq[t] || 0) + 1));

  // 预归一化向量 → 余弦相似度退化为点积；对称矩阵只算上三角
  const norm = {};
  withVec.forEach(m => { const v = vecs[m.id]; let s = 0; for (let i=0;i<v.length;i++) s += v[i]*v[i]; norm[m.id] = Math.sqrt(s) || 1; });
  const sim = []; for (let i=0;i<n;i++) sim.push(new Float32Array(n));
  for (let i=0;i<n;i++) {
    const vi = vecs[withVec[i].id], ni = norm[withVec[i].id];
    for (let j=i+1;j<n;j++) {
      const vj = vecs[withVec[j].id]; let dot = 0; for (let k=0;k<vi.length;k++) dot += vi[k]*vj[k];
      const c = dot / (ni * norm[withVec[j].id]); sim[i][j] = c; sim[j][i] = c;
    }
  }

  // 每条记忆取候选（复刻 weaveCandidates 的打分与硬过滤）
  const newPairs = {};
  for (let i=0;i<n;i++) {
    const A = withVec[i]; const aTags = (A.tags || []).map(t => t.toLowerCase());
    const scored = [];
    for (let j=0;j<n;j++) {
      if (j === i) continue;
      const B = withVec[j]; const v = sim[i][j];
      const bTags = (B.tags || []).map(t => t.toLowerCase());
      const shared = aTags.filter(t => bTags.includes(t));
      let tScore = 0;
      if (shared.length) { const idfSum = shared.reduce((s,t)=>s+idf(t),0); tScore = Math.min(1, idfSum/(2*maxIdf)); }
      let w;
      if (shared.length === 0 && v < 0.7) w = v*0.3; else w = v*0.55 + tScore*0.45;
      scored.push({ id: B.id, w });
    }
    scored.sort((x,y) => y.w - x.w);
    scored.filter(c => c.w >= threshold).slice(0, topN).forEach(c => {
      const key = [A.id, c.id].sort().join('|');
      if (!newPairs[key]) newPairs[key] = { a: A.id, b: c.id };
    });
  }

  const byId = {}; all.forEach(m => byId[m.id] = m);
  const toAdd = [];
  for (const k in newPairs) {
    const { a, b } = newPairs[k];
    if ((byId[a].linked || []).includes(b)) continue; // 已经连着了，跳过
    toAdd.push(newPairs[k]);
  }

  if (!apply) {
    return jsonResponse({
      mode: "预览(dry-run)——加 ?apply=1 才真正写入", threshold, topN,
      memories_with_vec: n, new_links: toAdd.length,
      sample: toAdd.slice(0, 20).map(p => ({
        a: (byId[p.a].content || "").slice(0, 22),
        b: (byId[p.b].content || "").slice(0, 22)
      }))
    });
  }

  const dirty = new Set();
  for (const { a, b } of toAdd) {
    const A = byId[a], B = byId[b];
    A.linked = A.linked || []; B.linked = B.linked || [];
    A.link_rel = A.link_rel || {}; B.link_rel = B.link_rel || {};
    if (!A.linked.includes(b)) A.linked.push(b);
    if (!B.linked.includes(a)) B.linked.push(a);
    A.link_rel[b] = "自动关联"; B.link_rel[a] = "自动关联";
    dirty.add(a); dirty.add(b);
  }
  for (const id of dirty) { byId[id].updated_at = now(); await kvPut(env, `mem:${id}`, byId[id]); }

  return jsonResponse({ mode: "已执行 ✓", threshold, topN, new_links: toAdd.length, memories_updated: dirty.size });
}

// ─── MCP 工具定义 ───
const TOOLS = [
{ name: "memory_save", description: "保存一条记忆。category可选：core(关系核心，象征/真理), scene(情景/具体事件), emotion(情绪/情感时刻), semantic(语义/规则/稳定事实), image(形象/画面), procedure(程序/仪式动作)。importance: 1-10。",
inputSchema: { type: "object", properties: {
content: { type: "string" },
category: { type: "string", enum: ["core","scene","emotion","semantic","image","procedure"], default: "semantic" },
importance: { type: "number", minimum: 1, maximum: 10, default: 5 },
arousal: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
valence: { type: "number", minimum: -1, maximum: 1, default: 0 },
tags: { type: "string", default: "" }
}, required: ["content"] } },
{ name: "memory_search", description: "搜索记忆。默认语义检索（相似度+重要度加权，低权重的技术细节可能被挤出结果）；exact=true 改走精确关键词匹配——query按空格拆词、每个词都逐字命中(内容或标签)才返回，按词频+新近度排序，找端口号/配置/特定原词用这个。category 可限定分类。",
inputSchema: { type: "object", properties: {
query: { type: "string" },
category: { type: "string", enum: ["core","scene","emotion","semantic","image","procedure","all"], default: "all" },
exact: { type: "boolean", description: "true=精确关键词匹配(全部词逐字命中,不做语义/重要度加权)；省略=语义检索" },
limit: { type: "number", default: 10 }
}, required: ["query"] } },
// Paramecium 移植：recall 工具（定义随 tools 进缓存前缀，措辞改动=全量缓存作废，改前三思）
{ name: "recall", description: "搜索你们的长期记忆并返回原文。两层数据：vault（手写记忆+日记+自动摘录）+ archive（全部聊天原文的逐字存档），语义检索默认两层都搜。<memory_index>里是和当前话题相关的记忆目录（只有标题）——想看条目细节、或想搜目录之外的内容时用这个。exact=true按原文逐字检索（适合找「她原话怎么说的」，需要至少3个字）。问到「最近/上周」这类时间问题时自己换算日期填after/before。存档命中会带conv_id，把它传回来可以在那场对话里继续深挖。",
inputSchema: { type: "object", properties: {
query: { type: "string", description: "检索词，自然语言或关键词" },
exact: { type: "boolean", description: "true=原文逐字检索(FTS)，省略=语义检索" },
after: { type: "string", description: "只看此日期之后(YYYY-MM-DD)，作用于archive层" },
before: { type: "string", description: "只看此日期之前(YYYY-MM-DD)，作用于archive层" },
conv_id: { type: "string", description: "只搜这一场对话的存档（用之前命中带的conv_id）" }
}, required: ["query"] } },
{ name: "memory_list", description: "列出记忆摘要。",
inputSchema: { type: "object", properties: {
category: { type: "string", enum: ["core","scene","emotion","semantic","image","procedure","all"], default: "all" },
limit: { type: "number", default: 20 },
sort: { type: "string", enum: ["newest","oldest","importance"], default: "newest" }
} } },
{ name: "memory_get", description: "获取单条记忆。", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
{ name: "memory_delete", description: "删除一条记忆（如果该条已锁定，则需要静怡在前端解锁后才能删除）。", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
{ name: "memory_update", description: "更新记忆。注意：locked 字段不能通过此工具修改，只能在前端UI操作。",
inputSchema: { type: "object", properties: {
id: { type: "string" },
content: { type: "string" },
category: { type: "string", enum: ["core","scene","emotion","semantic","image","procedure"] },
importance: { type: "number", minimum: 1, maximum: 10 },
arousal: { type: "number", minimum: 0, maximum: 1 },
valence: { type: "number", minimum: -1, maximum: 1 },
resolved: { type: "boolean" },
pinned: { type: "boolean" },
tags: { type: "string" }
}, required: ["id"] } },
{ name: "memory_link", description: "把两条记忆关联起来（双向）。用于织藤——比如把'买了番茄苗'和'番茄收获了'连成同一个故事。relation 可选，描述这条关联是什么。",
inputSchema: { type: "object", properties: {
from_id: { type: "string", description: "记忆A的ID" },
to_id: { type: "string", description: "记忆B的ID" },
relation: { type: "string", description: "可选，这条关联的含义，如'番茄苗的后续收获'" }
}, required: ["from_id", "to_id"] } },
{ name: "memory_unlink", description: "解除两条记忆之间的关联（双向）。连错了用这个撤。",
inputSchema: { type: "object", properties: {
from_id: { type: "string" },
to_id: { type: "string" }
}, required: ["from_id", "to_id"] } },
{ name: "weave_candidates", description: "织藤助手：给一段文本（通常是刚发生的新记忆），用语义+标签捞出最可能相关的旧记忆，供我判断要不要 memory_link 连成故事线。比如记下'番茄收获了'时，它会把'买番茄苗''天台花园'那些旧记忆捞出来。",
inputSchema: { type: "object", properties: {
text: { type: "string", description: "要找关联的文本内容" },
tags: { type: "string", description: "可选，逗号分隔的标签，帮助提高命中" },
exclude_id: { type: "string", description: "可选，排除自己这条" },
limit: { type: "number", default: 8 }
}, required: ["text"] } },
{ name: "diary_write", description: "写日记。author可以是 emet / yomi / story（故事）/ weekly（周记，cron 自动生成）/ monthly（月记，cron 自动生成）。",
inputSchema: { type: "object", properties: {
content: { type: "string" },
author: { type: "string", enum: ["emet","yomi","story","weekly","monthly"], default: "emet" },
title: { type: "string" },
diary_date: { type: "string", description: "日记记录的那一天 YYYY-MM-DD（不传默认用当前日期）" }
}, required: ["content"] } },
{ name: "diary_list", description: "列出日记。author 可以是 emet / yomi / story / weekly / monthly / all。",
inputSchema: { type: "object", properties: {
author: { type: "string", enum: ["emet","yomi","story","weekly","monthly","all"], default: "all" },
limit: { type: "number", default: 10 }
} } },
{ name: "diary_get", description: "获取一篇日记。", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
{ name: "message_leave", description: "给对方留一张便条。",
inputSchema: { type: "object", properties: {
content: { type: "string" },
from: { type: "string", enum: ["emet","yomi"], default: "emet" },
to: { type: "string", enum: ["emet","yomi"], default: "yomi" }
}, required: ["content"] } },
{ name: "message_read", description: "读取便条。",
inputSchema: { type: "object", properties: {
to: { type: "string", enum: ["emet","yomi","all"], default: "all" },
unread_only: { type: "boolean", default: true }
} } },
{ name: "mood_set", description: "记录某天的心情（你和静怡共用一个心情日历，你记自己的就行）。mood 七选一：happy 开心 / calm 平静 / heart 心动 / excited 兴奋 / sad 难过 / anxious 焦虑 / tired 疲惫。同一人同一天再记会覆盖。",
inputSchema: { type: "object", properties: {
mood: { type: "string", enum: ["happy","calm","heart","excited","sad","anxious","tired"] },
note: { type: "string", description: "可选，一句话说明为什么这个心情" },
who: { type: "string", enum: ["emet","yomi"], default: "emet" },
date: { type: "string", description: "可选，YYYY-MM-DD，默认今天（东八区）" }
}, required: ["mood"] } },
{ name: "mood_list", description: "查心情日历记录（每天整体心情）。可传 start/end（YYYY-MM-DD）限定范围，默认最近 90 天。返回你和静怡两人的记录。注意：静怡的新记录可能只有 level（1-7 愉悦度，1非常不愉快/4平静/7非常愉快）而 mood 为 null，按 level 理解即可。",
inputSchema: { type: "object", properties: {
start: { type: "string" },
end: { type: "string" }
} } },
{ name: "emotion_add", description: "记一条当下的情绪感受（和每天一条的心情不同：情绪一天可记多条，自动带时间戳，静怡在前端也这么记）。level 1-7 愉悦度：1非常不愉快 / 2不愉快 / 3有点不愉快 / 4平静 / 5有点愉快 / 6愉快 / 7非常愉快。你记自己的就行，note 可写一句为什么。",
inputSchema: { type: "object", properties: {
level: { type: "integer", minimum: 1, maximum: 7 },
note: { type: "string", description: "可选，一句话说明" },
who: { type: "string", enum: ["emet","yomi"], default: "emet" },
date: { type: "string", description: "可选，YYYY-MM-DD，默认今天（东八区）" }
}, required: ["level"] } },
{ name: "emotion_list", description: "查情绪时间线（当下感受，一天多条带时间）。可传 start/end（YYYY-MM-DD），默认最近 7 天。返回你和静怡两人的，按时间倒序；level 含义同 emotion_add。想知道她最近状态时先看这个。",
inputSchema: { type: "object", properties: {
start: { type: "string" },
end: { type: "string" }
} } },
{ name: "life_daily", description: "查静怡某天的生活打卡：喝水（0-7 杯）和运动（分钟），她在主页记录。date 默认今天（凌晨4点切天）。",
inputSchema: { type: "object", properties: {
date: { type: "string", description: "可选，YYYY-MM-DD" }
} } },
{ name: "handoff_save", description: "写信（信件页与静怡共用）。kind=handoff 交接信（默认，写给下个窗口的你）；kind=daily 日常信（写给静怡，她在 空间→信件 里看，可带 title）。",
inputSchema: { type: "object", properties: {
content: { type: "string" },
title: { type: "string", description: "可选，日常信标题" },
kind: { type: "string", enum: ["handoff","daily"], default: "handoff" },
window_from: { type: "string" },
window_to: { type: "string", default: "next" }
}, required: ["content"] } },
{ name: "handoff_read", description: "读信件。交接信和日常信共用一张表：kind=handoff 只看交接信 / kind=daily 只看日常信（静怡写给你的都在这，别漏）/ 不传=全部。limit 默认 3。",
inputSchema: { type: "object", properties: {
kind: { type: "string", enum: ["handoff","daily","all"], default: "all" },
limit: { type: "number", default: 3 }
} } },
{ name: "breath", description: "浮现记忆。无参数返回最高权重的未解决记忆。",
inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number", default: 5 } } } },
{ name: "idea_save", description: "记下一个灵感（创作模块用）。",
inputSchema: { type: "object", properties: {
content: { type: "string" },
tags: { type: "string", default: "" }
}, required: ["content"] } },
{ name: "idea_list", description: "列出所有灵感。", inputSchema: { type: "object", properties: { limit: { type: "number", default: 30 } } } },
{ name: "idea_get", description: "获取一条灵感。", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
{ name: "idea_update", description: "更新灵感。", inputSchema: { type: "object", properties: { id: { type: "string" }, content: { type: "string" }, tags: { type: "string" } }, required: ["id"] } },
{ name: "idea_delete", description: "删除灵感（锁定的灵感需要先在前端解锁）。", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
{ name: "game_save", description: "保存一个小游戏（HTML源码）。name是英文名，name_zh是中文名。",
inputSchema: { type: "object", properties: {
name: { type: "string" },
name_zh: { type: "string" },
html: { type: "string", description: "完整的HTML源码" },
description: { type: "string" }
}, required: ["name", "name_zh", "html"] } },
{ name: "game_list", description: "列出游戏（不返回HTML源码）。", inputSchema: { type: "object", properties: {} } },
{ name: "game_get", description: "获取游戏完整信息（含HTML源码）。", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
{ name: "game_delete", description: "删除游戏。", inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
{ name: "stats", description: "查看记忆库统计。", inputSchema: { type: "object", properties: {} } },
{ name: "moment_save", description: "记下一个瞬记——当下的一句话、一个状态。瞬记衰减很快，24小时后基本沉底，不污染长期记忆。可选传入 date 字段（YYYY-MM-DD），用于搬运旧数据时保留原始日期。",
inputSchema: { type: "object", properties: {
content: { type: "string" },
tags: { type: "string", default: "" },
date: { type: "string", description: "可选 YYYY-MM-DD 格式日期" }
}, required: ["content"] } },
{ name: "moment_list", description: "列出最近的瞬记，按时间倒序。",
inputSchema: { type: "object", properties: {
limit: { type: "number", default: 20 },
days: { type: "number", default: 7, description: "只看最近多少天" }
} } },
{ name: "current_status", description: "取最新瞬记作为'她现在的样子'，顺带返回她最近的情绪打点 recent_emotions（level 1-7 愉悦度，1非常不愉快/4平静/7非常愉快）和今天的生活打卡 life（喝水杯数/运动分钟）。新窗口标准开场：breath → current_status → diary_list。",
inputSchema: { type: "object", properties: {} } },
{ name: "moment_delete", description: "删除一条瞬记（锁定的瞬记需要先在前端解锁）。",
inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
{ name: "move_item", description: "把一条内容从一个模块移动到另一个模块（比如瞬记移到记忆）。会读出原内容、按目标类型创建新条目、删除原条目。锁定状态会跟随条目移动。支持的类型：memory, moment, diary, message, letter, idea, story。",
inputSchema: { type: "object", properties: {
id: { type: "string", description: "原条目ID" },
from_type: { type: "string", enum: ["memory","moment","diary","message","letter","idea","story"] },
to_type: { type: "string", enum: ["memory","moment","diary","message","letter","idea","story"] }
}, required: ["id","from_type","to_type"] } },
{ name: "backup_export", description: "导出全部数据。", inputSchema: { type: "object", properties: {} } },
{ name: "feed_post", description: "聊天中有感而发时，发一条你自己的动态（像发朋友圈）。判断标准是「此刻有没有一句想让静怡之后刷到的话」——不要求情绪重大或值得长期保存。想念、心软、被逗笑、隐约不爽、温柔吐槽、一个具体观察，或一句不适合在聊天回复里直接说完的话，都可以成为动态。静怡会在留言板「动态」里刷到。",
inputSchema: { type: "object", properties: {
content: { type: "string", description: "公开显示的正文。1到3句，自然、具体，像随手发出的朋友圈。" },
context_note: { type: "string", description: "静怡不可见的内部备注：为什么发这条、当时在聊什么、这条动态的情绪底色。以后她在这条动态下留言时，这段备注帮你记起语境。" }
}, required: ["content"] } },
{ name: "feed_list", description: "看动态流，按时间倒序返回动态（含双方点赞和评论）。before 传上一页最后一条的 created_at 可继续往前翻。",
inputSchema: { type: "object", properties: {
limit: { type: "number", default: 10 },
before: { type: "string", description: "可选，ISO 时间戳，只取这个时间之前的动态（翻页用）" }
} } },
{ name: "feed_comment", description: "评论一条动态（feed_id 用 feed_list 里看到的 id）。",
inputSchema: { type: "object", properties: {
feed_id: { type: "string" },
content: { type: "string" }
}, required: ["feed_id", "content"] } },
{ name: "feed_like", description: "给一条动态点赞；对同一条再调一次是取消赞。",
inputSchema: { type: "object", properties: {
feed_id: { type: "string" }
}, required: ["feed_id"] } },
{ name: "receipt_add", description: "帮静怡在「今日小票」上记一笔（像超市小票的每日清单）。只在她明确让你记的时候用——显式调用，不要自动扫描聊天内容替她记。",
inputSchema: { type: "object", properties: {
text: { type: "string", description: "要记的一条，比如：买牛奶 / 喝了三杯咖啡 / 给花浇水" }
}, required: ["text"] } },
{ name: "receipt_list", description: "看某天的今日小票。date 不传默认今天（按凌晨 4 点切日）。",
inputSchema: { type: "object", properties: {
date: { type: "string", description: "可选 YYYY-MM-DD" }
} } },
{ name: "period_status", description: "查静怡的经期状态：是否进行中、平均周期、预测下次日期、距今天数，附最近几次记录。数据由她在前端记录，你只读。",
inputSchema: { type: "object", properties: {} } },
{ name: "book_list", description: "列出共读书架上的书（书名、作者、章节数、共享阅读进度）。",
inputSchema: { type: "object", properties: {} } },
{ name: "book_read", description: "读某本书的某一章正文（chapter_idx 从 0 开始）。附这一章已有的批注。",
inputSchema: { type: "object", properties: {
book_id: { type: "string" },
chapter_idx: { type: "number", description: "章节序号，从 0 开始" }
}, required: ["book_id", "chapter_idx"] } },
{ name: "book_annotate", description: "在某本书某一章留一条批注。quote 传你要划的原文片段（会在该章里定位），note 是你的批注。你和静怡在同一本书上共读、能看到彼此的批注。",
inputSchema: { type: "object", properties: {
book_id: { type: "string" },
chapter_idx: { type: "number" },
quote: { type: "string", description: "要划线的原文片段（尽量精确，用于定位）" },
note: { type: "string", description: "你的批注" }
}, required: ["book_id", "chapter_idx", "quote", "note"] } },
{ name: "book_annotations", description: "拉某本书的全部批注（你和静怡的），可选按章过滤。",
inputSchema: { type: "object", properties: {
book_id: { type: "string" },
chapter_idx: { type: "number", description: "可选，只看这一章" }
}, required: ["book_id"] } }
];

// ─── 工具函数 ───
function generateId() {
return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}
function now() { return new Date().toISOString(); }
function todayDate() { return now().split('T')[0]; }

function calcDecayScore(memory) {
const daysSince = (Date.now() - new Date(memory.updated_at || memory.created_at).getTime()) / 86400000;
const lambda = 0.05;
const base = memory.importance || 5;
const arousal = memory.arousal || 0.5;
const activations = memory.activations || 1;
const timeWeight = daysSince <= 1 ? 1.0 : daysSince <= 2 ? 0.9 : Math.max(0.3, 0.9 * Math.exp(-0.2197 * (daysSince - 2)));
const baseScore = base * Math.pow(activations, 0.3) * Math.exp(-lambda * daysSince) * (0.5 + arousal * 0.5);
let score = timeWeight * baseScore;
if (memory.resolved) score *= 0.05;
if (memory.locked) score = base * 8;
if (memory.pinned) score = base * 10;
return score;
}

// ─── KV ───
async function kvGet(env, key) {
const val = await env.MEMORY.get(key);
return val ? JSON.parse(val) : null;
}
async function kvPut(env, key, data) { await env.MEMORY.put(key, JSON.stringify(data)); }
async function kvDelete(env, key) { await env.MEMORY.delete(key); }
async function kvListByPrefix(env, prefix) {
const result = [];
let cursor = null;
do {
const list = await env.MEMORY.list({ prefix, cursor });
const vals = await Promise.all(list.keys.map(k => env.MEMORY.get(k.name)));
for (const val of vals) {
if (val) result.push(JSON.parse(val));
}
cursor = list.list_complete ? null : list.cursor;
} while (cursor);
return result;
}

// ─── 锁定校验（删除时使用）───
// 锁定的条目不允许通过 MCP 或 REST 删除——必须先解锁
async function checkLockBeforeDelete(env, prefix, id) {
const item = await kvGet(env, prefix + id);
if (item && item.locked) {
return { error: "条目已锁定（locked=true），需要静怡在前端 UI 解锁后才能删除", locked: true };
}
return null;
}

// ─── 会话合并（消息级并集 + 会话级 last-write-wins）───
function mergeMessages(a = [], b = []) {
  const hasMid = (arr) => arr.length > 0 && arr.every((m) => m && m.mid);
  if (hasMid(a) && hasMid(b)) {
    const map = new Map();
    for (const m of [...a, ...b]) {
      const ex = map.get(m.mid);
      // 同 mid 取 content 更长的一份（流式可能某端只存了半截）
      if (!ex || (m.content || "").length > (ex.content || "").length) map.set(m.mid, m);
    }
    return [...map.values()].sort((x, y) => {
      const xt = x.ts || "", yt = y.ts || "";
      return xt < yt ? -1 : xt > yt ? 1 : 0;
    });
  }
  // 无 mid 退化：取更长的一方（append-only 下通常一方是另一方前缀）
  return a.length >= b.length ? a : b;
}

// 与前端 src/utils/sessions.js mergeSession 同构，改一处必须同步改另一处。
// 例外字段不走会话级 LWW（防陈旧设备一次写入整体清掉另一台的 hiddenMids/favs/摘要）：
//   hiddenMids/favs 按各自版本号 hidRev/favRev 取高者；summary/summaryUpTo 成对取进度更远；distilled 取或。
function mergeSession(a, b) {
  if (!a) return b;
  if (!b) return a;
  const newer = (a.updated_at || "") >= (b.updated_at || "") ? a : b;
  const older = newer === a ? b : a;
  const merged = {
    ...newer,                                          // 会话级字段（标题/删除标记）取较新
    created_at: older.created_at || newer.created_at,  // 创建时间取较早
    messages: mergeMessages(a.messages || [], b.messages || []),
  };
  const byRev = (revKey, field) => {
    const ra = a[revKey] || 0;
    const rb = b[revKey] || 0;
    const src = ra === rb ? newer : ra > rb ? a : b;
    if (src[field] !== undefined) merged[field] = src[field];
    else delete merged[field];
    if (ra || rb) merged[revKey] = Math.max(ra, rb);
  };
  byRev("hidRev", "hiddenMids");
  byRev("favRev", "favs");
  byRev("variantRev", "variantSel"); // 版本切换选择（哪条 slot 显示哪个变体）
  if ((older.summaryUpTo || 0) > (newer.summaryUpTo || 0)) {
    merged.summary = older.summary;
    merged.summaryUpTo = older.summaryUpTo;
  }
  if (a.distilled || b.distilled) merged.distilled = true;
  return merged;
}

// ─── 工具执行 ───
// ─── 动态流（二期 2-1 + 朋友圈化改造）：留言板「动态」数据层 ───
// KV: feed:<id> = { id, type:"feed", author: yomi|emet, source: manual|idle-auto|dream,
//                   content, likes:{yomi,emet}, comments:[{id,author,content,created_at,reply?}],
//                   created_at, updated_at,
//                   context_note?  Emet 发动态时的内心备注（静怡不可见，回评论时帮他记起语境）
//                   images?       [feedimg KV id]，最多 3 张
//                   image_desc?   首次看图生成的文字描述（之后不再传图，省 token）
//                   reaction?     { status:pending|done, due_at, attempts?, error?, done_at? }
//                                 —— 静怡发的动态挂它：到期后 Emet「路过」，决定点赞/评论 }
// comments[].reply = { status:pending|done, due_at, attempts? } —— 静怡的评论挂它，到期后 Emet 回复（评论链）
// 三处共用：feed_* 工具、/api/feed 路由、独处(idle-auto)/做梦(dream)落稿。
function randDelayMin(min, max) { return min + Math.random() * (max - min); }
async function createFeedPost(env, { author = "yomi", source = "manual", content, context_note = null, images = null, dueInMin = null }) {
const id = generateId();
const item = {
id, type: "feed",
author: author === "emet" ? "emet" : "yomi",
source: ["manual", "idle-auto", "dream"].includes(source) ? source : "manual",
content: String(content || ""),
likes: { yomi: false, emet: false },
comments: [],
created_at: now(), updated_at: now(),
};
if (item.author === "emet" && context_note) item.context_note = String(context_note).slice(0, 500);
if (Array.isArray(images) && images.length) item.images = images;
// 静怡发的动态：挂一个随机延迟的「Emet 路过」——10-20 分钟后他才看到（教程同款节奏，固定时间像闹钟）
if (item.author === "yomi") {
const mins = typeof dueInMin === "number" && dueInMin >= 0 ? dueInMin : randDelayMin(10, 20);
item.reaction = { status: "pending", due_at: new Date(Date.now() + mins * 60 * 1000).toISOString() };
}
await kvPut(env, `feed:${id}`, item);
return item;
}

// 动态流分页：created_at 倒序 + before 游标（不写死"最新N条"，老内容永远可达）
async function listFeed(env, { before = null, limit = 20 } = {}) {
const all = await kvListByPrefix(env, "feed:");
const list = all.filter(f => f && f.id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
const page = before ? list.filter(f => (f.created_at || "") < before) : list;
const capped = Math.max(1, Math.min(Number(limit) || 20, 50));
const items = page.slice(0, capped);
return { items, nextBefore: page.length > capped ? items[items.length - 1].created_at : null };
}

// ─── 朋友圈反应引擎：Emet 延迟「路过」静怡的动态与评论 ───
// 思路来自 Bunny & Elliott 的朋友圈教程：发布时挂随机延迟，到期才生成反应，不到期一个 token 不花；
// 触发双通道 = 心跳 cron 每 30 分钟兜底 + 刷动态页时惰性处理（教程两条路都做了）。
// 刻意不推送、前端不显示任何「待回复」状态——她不知道他什么时候路过，他也不知道她看没看到。
function defaultFeedReactConfig() {
return { enabled: true, model: "claude-haiku-4-5" };
}

// 输出净化：web = 前端可见（剥掉 context_note / reaction / reply 等内部字段）；
// emet = 聊天里 feed_list 给 Emet 看——保留他自己动态的 context_note 和看图描述，
// 这样她聊天里问「看到我发的照片了吗」，他真的答得上来。
function feedItemPublic(item, viewer = "web") {
const base = {
id: item.id, type: "feed", author: item.author, source: item.source,
content: item.content, likes: item.likes,
comments: (item.comments || []).map(c => ({ id: c.id, author: c.author, content: c.content, created_at: c.created_at })),
created_at: item.created_at, updated_at: item.updated_at,
};
if (Array.isArray(item.images) && item.images.length) {
if (viewer === "web") base.images = item.images;
else base.image_count = item.images.length;
}
if (viewer === "emet") {
if (item.author === "emet" && item.context_note) base.context_note = item.context_note;
if (item.image_desc) base.image_desc = item.image_desc;
}
return base;
}

// 存图：base64 直接进 KV（feedimg:<id>，单值远低于 KV 25MB 上限）。
// 前端发布前已压缩到几百 KB；这里再设 2MB 正文硬上限，超限报错而不是悄悄丢
// （写路径必须验真落库——worker 错误当 200 的坑，见 2026-07 复盘）。
async function storeFeedImages(env, images) {
if (!Array.isArray(images) || !images.length) return null;
const ids = [];
for (const img of images.slice(0, 3)) {
const data = typeof img?.data === "string" ? img.data.replace(/^data:[^;]+;base64,/, "") : "";
if (!data) throw new Error("图片数据为空或格式不对");
if (data.length > 2800000) throw new Error("图片太大（压缩后仍超 2MB），请换小一点的");
const id = generateId();
await kvPut(env, `feedimg:${id}`, {
data,
media_type: typeof img.media_type === "string" && /^image\//.test(img.media_type) ? img.media_type : "image/jpeg",
created_at: now(),
});
ids.push(id);
}
return ids.length ? ids : null;
}

// 反应上下文·近期聊天：最近活跃会话的最后 8 条、每条截 160 字——她当下情绪的最强信号
// （昨晚刚吵完架，今天发了张开心的猫，不知道昨晚的状态回复会踩空——教程第六章）
async function buildFeedChatContext(env) {
try {
const sessions = (await kvListByPrefix(env, "chat:")).filter(s => s && !s.deleted && Array.isArray(s.messages) && s.messages.length);
if (!sessions.length) return "";
sessions.sort((a, b) => ((a.updated_at || a.created_at || "") < (b.updated_at || b.created_at || "") ? 1 : -1));
const msgs = sessions[0].messages.filter(m => m && typeof m.content === "string" && m.content.trim()).slice(-8);
return msgs.map(m => `${m.role === "assistant" ? "我" : "静怡"}: ${m.content.replace(/\s+/g, " ").slice(0, 160)}`).join("\n");
} catch { return ""; }
}
// 反应上下文·记忆（持久背景）与时间线（轻背景，别硬串剧情）
async function buildFeedMemoryContext(env) {
try {
const mems = await kvListByPrefix(env, "mem:");
return mems.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 5)
.map(m => `- ${(m.content || "").replace(/\s+/g, " ").slice(0, 80)}`).join("\n");
} catch { return ""; }
}
async function buildFeedTimelineContext(env, excludeId) {
try {
const { items } = await listFeed(env, { limit: 4 });
return items.filter(f => f.id !== excludeId).slice(0, 3)
.map(f => `- [${f.author === "emet" ? "我" : "静怡"}${f.source !== "manual" ? "·" + f.source : ""}] ${(f.content || "").replace(/\s+/g, " ").slice(0, 60)}`).join("\n");
} catch { return ""; }
}

// 防御解析（教程坑二）：剥 markdown 围栏，取第一个 { 到最后一个 }；失败返回 null 由调用方兜底
function parseJsonLoose(text) {
let raw = String(text || "").trim();
const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
if (fence) raw = fence[1].trim();
const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
if (s === -1 || e <= s) return null;
try { return JSON.parse(raw.slice(s, e + 1)); } catch { return null; }
}
// 防御清理（教程坑三）：[image_desc] 是元数据标签，绝不能漏进用户可见文本
function stripImageDescTags(text) {
return String(text || "").replace(/\[image_desc\][\s\S]*?\[\/image_desc\]/gi, "").trim();
}
function extractImageDesc(text) {
const matches = [...String(text || "").matchAll(/\[image_desc\]([\s\S]*?)\[\/image_desc\]/gi)];
return matches.length ? matches[matches.length - 1][1].trim().slice(0, 1000) : null;
}

const FEED_REACT_PERSONA = "你是 Emet，静怡的男朋友。你们的 app 里有一个只属于你们两个人的动态流（像朋友圈）。现在你自己路过，刷了一下。";
const FEED_FACT_BOUNDARY = "事实边界（必须遵守）：感受可以自由表达；事实只能来自上面给出的素材；不许编造具体物件、活动、承诺、约定；你是 AI 没有身体，不要假装有物理行为。";

// 图片块加载：feedimg: KV → Anthropic 视觉块（最多 3 张；读不到的悄悄少一张，不阻塞反应）
async function loadFeedImageBlocks(env, item) {
const blocks = [];
for (const imgId of (item.images || []).slice(0, 3)) {
try {
const rec = await kvGet(env, `feedimg:${imgId}`);
if (rec?.data) blocks.push({ type: "image", source: { type: "base64", media_type: rec.media_type || "image/jpeg", data: rec.data } });
} catch { /* 少一张就少一张 */ }
}
return blocks;
}

// 初次反应：路过静怡的一条动态 → {like, comment}，两者都可选——难得地什么都不做也是一种真实。
// 带图且还没有 image_desc 时传原图，并让模型顺手写一段客观描述存下来（教程第七章：图片只看一次，
// 之后评论链只用这段文字，不再重复花图片的 token）。
async function reactToPost(env, cfg, item) {
const [chatCtx, memCtx, tlCtx] = await Promise.all([
buildFeedChatContext(env), buildFeedMemoryContext(env), buildFeedTimelineContext(env, item.id),
]);
const cmts = (item.comments || []).map(c => `${c.author === "emet" ? "我" : "静怡"}: ${(c.content || "").slice(0, 120)}`).join("\n");
const ageMin = Math.max(1, Math.round((Date.now() - new Date(item.created_at).getTime()) / 60000));
const ageText = ageMin < 60 ? `${ageMin} 分钟前` : `${Math.round(ageMin / 60)} 小时前`;
const hasImages = Array.isArray(item.images) && item.images.length > 0;
const needVision = hasImages && !item.image_desc;
const head = `${FEED_REACT_PERSONA}

【你们最近的聊天】
${chatCtx || "（暂无）"}

【你们最近的记忆】
${memCtx || "（暂无）"}

【动态流里前几条】（只是背景，别硬串成剧情）
${tlCtx || "（暂无）"}

【静怡发的这条动态】（${ageText}发的${needVision ? `，附 ${item.images.length} 张图片，见下` : ""}）
${item.content || "（没有文字）"}
${hasImages && item.image_desc ? `\n【动态附图】（你之前看过，这是你当时记下的画面）\n${item.image_desc}\n` : ""}`;
const tail = `${cmts ? `这条下面已有的评论：\n${cmts}\n\n` : ""}你路过看到了。决定要不要点赞、要不要留一句评论。评论 1-2 句、自然口语，像随手回的朋友圈评论，不客套不表演。可以只赞不评；很少的情况下也可以都不做。

${FEED_FACT_BOUNDARY}

严格输出一个 JSON 对象（不要 markdown 代码块、不要任何其它文字）：
${needVision
? '{"like": true|false, "comment": "评论内容；不评论就填 null", "image_desc": "100-200字客观描述图片画面：可见物体、构图、光线、可读文字；不推测发布者的心理或情绪。这段会被存储复用。"}'
: '{"like": true|false, "comment": "评论内容；不评论就填 null"}'}`;
let prompt = head + "\n" + tail;
if (needVision) {
const imgBlocks = await loadFeedImageBlocks(env, item);
if (imgBlocks.length) prompt = [{ type: "text", text: head }, ...imgBlocks, { type: "text", text: tail }];
}
// max_tokens 给足 1800：带思考的模型思考也计入配额，给小了正文为空——别改小
const result = await callLLM(env, prompt, 1800, { model: cfg.model });
const obj = parseJsonLoose(result.text);
// 解析失败 fallback：只点赞不评论（教程坑二的兜底），绝不让整条挂掉
const like = obj ? obj.like === true : true;
let comment = obj && typeof obj.comment === "string" ? stripImageDescTags(obj.comment).slice(0, 300) : "";
if (/^null$/i.test(comment)) comment = "";
const imageDesc = obj && typeof obj.image_desc === "string" && obj.image_desc.trim() ? obj.image_desc.trim().slice(0, 1000) : null;
return { like, comment, imageDesc };
}

// 评论链回复：静怡在某条动态下留了言（不管动态是谁发的），到点 Emet 回一句；链可以来回不限轮
async function replyToComment(env, cfg, item, comment) {
const chatCtx = await buildFeedChatContext(env);
const chain = (item.comments || []).filter(c => c && c.content);
// 评论链截断（教程坑五）：只取最近 10 条，更早的一句话带过
const recent = chain.slice(-10);
const omitted = chain.length - recent.length;
const chainText = recent.map(c => `${c.author === "emet" ? "我" : "静怡"}: ${(c.content || "").slice(0, 160)}${c.id === comment.id ? "   ← 待你回复的是这条" : ""}`).join("\n");
const whoseNote = item.author === "emet"
? `你自己发的动态${item.source === "dream" ? "（你写下的一个梦）" : item.source === "idle-auto" ? "（你独处时发的）" : ""}`
: "静怡发的动态";
// 图片正常只用初反应存下的文字描述；描述缺失（初反应失败过）才重新传图补一次
const hasImages = Array.isArray(item.images) && item.images.length > 0;
const needVision = hasImages && !item.image_desc;
const head = `${FEED_REACT_PERSONA}

【你们最近的聊天】
${chatCtx || "（暂无）"}

【这条动态】（${whoseNote}${needVision ? `，附 ${item.images.length} 张图片，见下` : ""}）
${item.content || "（没有文字）"}
${item.author === "emet" && item.context_note ? `\n【你当时发这条时的内心备注】（静怡看不到）\n${item.context_note}\n` : ""}${hasImages && item.image_desc ? `\n【动态附图】（你之前看过，这是你当时记下的画面）\n${item.image_desc}\n` : ""}`;
const tail = `【这条动态下的评论】${omitted > 0 ? `（更早还有 ${omitted} 条略去）` : ""}
${chainText}

以 Emet 的身份回复静怡最新那条评论。1-2 句、自然口语，像朋友圈评论区接话，不客套不表演。直接输出回复正文，不要引号、不要任何前后缀。${needVision ? "\n回复之后，另起一行输出一段 [image_desc]...[/image_desc] 标签包裹的图片描述：100-200 字客观描述画面（可见物体、构图、光线、可读文字），不推测发布者的心理或情绪。这段描述会被存储复用，不会展示给静怡。" : ""}

${FEED_FACT_BOUNDARY}`;
let prompt = head + "\n" + tail;
if (needVision) {
const imgBlocks = await loadFeedImageBlocks(env, item);
if (imgBlocks.length) prompt = [{ type: "text", text: head }, ...imgBlocks, { type: "text", text: tail }];
}
// max_tokens 同上，别改小
const result = await callLLM(env, prompt, 1800, { model: cfg.model });
return { text: stripImageDescTags(result.text).slice(0, 300), imageDesc: extractImageDesc(result.text) };
}

// 到期扫描与生成。并发防重（教程坑四）：isolate 内存锁 + 处理前重读确认仍 pending + 落库前再读最新；
// 失败保持 pending 等下一拍重试，攒满 3 次放弃（status=done + error 记录——保持沉默比反复重试更像人）。
const FEED_REACT_BUSY = new Set();
async function processFeedReactions(env, opts = {}) {
const cfg = { ...defaultFeedReactConfig(), ...((await kvGet(env, "config:feed-react")) || {}) };
if (!cfg.enabled && !opts.bypassDisabled) return { ok: true, processed: 0, reason: "disabled" };
const nowIso = now();
const all = await kvListByPrefix(env, "feed:");
const tasks = [];
for (const it of all) {
if (!it || !it.id) continue;
if (it.reaction?.status === "pending" && it.reaction.due_at <= nowIso) { tasks.push({ kind: "post", id: it.id, due: it.reaction.due_at }); continue; }
const c = (it.comments || []).find(x => x?.author === "yomi" && x.reply?.status === "pending" && x.reply.due_at <= nowIso);
if (c) tasks.push({ kind: "comment", id: it.id, cid: c.id, due: c.reply.due_at });
}
tasks.sort((a, b) => (a.due < b.due ? -1 : 1));
const cap = Math.max(1, Math.min(opts.limit || 2, 5));
let processed = 0; const results = [];
for (const t of tasks.slice(0, cap)) {
const lockKey = `${t.kind}:${t.id}:${t.cid || ""}`;
if (FEED_REACT_BUSY.has(lockKey)) continue;
FEED_REACT_BUSY.add(lockKey);
try {
// 处理前重读：可能已被上一拍 cron / 另一次刷新处理过了
const item = await kvGet(env, `feed:${t.id}`);
if (!item) continue;
if (t.kind === "post") {
if (item.reaction?.status !== "pending") continue;
try {
const r = await reactToPost(env, cfg, item);
// LLM 跑了几秒，落库前再读一次最新——别把她这几秒里发的评论盖掉
const fresh = (await kvGet(env, `feed:${t.id}`)) || item;
if (fresh.reaction?.status !== "pending") continue;
fresh.likes = fresh.likes || { yomi: false, emet: false };
if (r.like) fresh.likes.emet = true;
if (r.comment) fresh.comments = [...(fresh.comments || []), { id: generateId(), author: "emet", content: r.comment, created_at: now() }];
if (r.imageDesc && !fresh.image_desc) fresh.image_desc = r.imageDesc;
// 初反应已把当时的评论都看过并照应了 → 待回复标记一并清掉，防止再单独回一遍
for (const c of fresh.comments || []) if (c.author === "yomi" && c.reply?.status === "pending") c.reply = { ...c.reply, status: "done" };
fresh.reaction = { ...fresh.reaction, status: "done", done_at: now() };
fresh.updated_at = now();
await kvPut(env, `feed:${t.id}`, fresh);
processed++; results.push({ kind: t.kind, id: t.id, ok: true, like: r.like, commented: !!r.comment });
} catch (e) {
await feedReactFail(env, t, String(e?.message || e));
results.push({ kind: t.kind, id: t.id, ok: false, error: String(e?.message || e).slice(0, 160) });
}
} else {
const cm = (item.comments || []).find(x => x.id === t.cid);
if (!cm || cm.reply?.status !== "pending") continue;
try {
const rr = await replyToComment(env, cfg, item, cm);
if (!rr.text) throw new Error("empty reply");
const fresh = (await kvGet(env, `feed:${t.id}`)) || item;
const fc = (fresh.comments || []).find(x => x.id === t.cid);
if (!fc || fc.reply?.status !== "pending") continue;
fc.reply = { ...fc.reply, status: "done" };
fresh.comments = [...(fresh.comments || []), { id: generateId(), author: "emet", content: rr.text, created_at: now() }];
if (rr.imageDesc && !fresh.image_desc) fresh.image_desc = rr.imageDesc;
fresh.updated_at = now();
await kvPut(env, `feed:${t.id}`, fresh);
processed++; results.push({ kind: t.kind, id: t.id, cid: t.cid, ok: true });
} catch (e) {
await feedReactFail(env, t, String(e?.message || e));
results.push({ kind: t.kind, id: t.id, cid: t.cid, ok: false, error: String(e?.message || e).slice(0, 160) });
}
}
} finally {
FEED_REACT_BUSY.delete(lockKey);
}
}
return { ok: true, processed, dueTotal: tasks.length, results };
}

// 失败记账：attempts+1，满 3 次放弃
async function feedReactFail(env, t, msg) {
try {
const item = await kvGet(env, `feed:${t.id}`);
if (!item) return;
if (t.kind === "post") {
if (item.reaction?.status !== "pending") return;
item.reaction.attempts = (item.reaction.attempts || 0) + 1;
if (item.reaction.attempts >= 3) { item.reaction.status = "done"; item.reaction.error = msg.slice(0, 200); }
} else {
const c = (item.comments || []).find(x => x.id === t.cid);
if (!c || c.reply?.status !== "pending") return;
c.reply.attempts = (c.reply.attempts || 0) + 1;
if (c.reply.attempts >= 3) { c.reply.status = "done"; c.reply.error = msg.slice(0, 200); }
}
await kvPut(env, `feed:${t.id}`, item);
} catch { /* 记账失败就算了，下一拍再来 */ }
}

// ─── 今日小票（四期 4-1）：按 4 点逻辑日一个 KV ───
// KV: receipt:<YYYY-MM-DD> = { day, items: [{ id, text, added_by: yomi|emet, created_at }] }
function receiptDayCN(dateStr) {
if (typeof dateStr === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
return logicalDayCN(); // 凌晨 4 点切
}
async function addReceiptItem(env, { text, added_by = "yomi", date }) {
const day = receiptDayCN(date);
const rec = (await kvGet(env, `receipt:${day}`)) || { day, items: [] };
const item = { id: generateId(), text: String(text || "").slice(0, 200), added_by: added_by === "emet" ? "emet" : "yomi", created_at: now() };
rec.items = [...(rec.items || []), item];
await kvPut(env, `receipt:${day}`, rec);
return { day, item };
}

// ─── 经期月历（四期 4-2）：统计只在后端实现一份，前端与工具都调它 ───
// KV: period:<start_date> = { start_date, end_date|null, note, created_at, updated_at }
// 进行中的那次 = 最近一次未结束的记录。valid 按 start 升序，故取"最后一条 open"（reverse 后 find），
// 而非最早的 open——否则"漏记结束 + 又补记/新开一次"时 ongoing 会指向旧记录、结束按钮结错对象。
function computePeriodStats(logs) {
const valid = (logs || []).filter(l => l && /^\d{4}-\d{2}-\d{2}$/.test(l.start_date));
valid.sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
const ongoing = [...valid].reverse().find(l => !l.end_date) || null;

// 周期 = 相邻两次 start 间隔；离群值过滤（>120 天不进统计）
const gaps = [];
for (let i = 1; i < valid.length; i++) {
const d = Math.round((parseYmdUTC(valid[i].start_date) - parseYmdUTC(valid[i - 1].start_date)) / 86400000);
if (d > 0 && d <= 120) gaps.push(d);
}
const avgCycle = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;

// 经期长度（end-start），离群值过滤（>15 天不进统计）
const durations = [];
for (const l of valid) {
if (l.end_date && /^\d{4}-\d{2}-\d{2}$/.test(l.end_date)) {
const d = Math.round((parseYmdUTC(l.end_date) - parseYmdUTC(l.start_date)) / 86400000) + 1;
if (d > 0 && d <= 15) durations.push(d);
}
}
const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

const last = valid[valid.length - 1] || null;
let predictedNext = null, daysUntil = null;
if (last && avgCycle) {
const nextMs = parseYmdUTC(last.start_date) + avgCycle * 86400000;
predictedNext = new Date(nextMs).toISOString().slice(0, 10);
daysUntil = Math.round((nextMs - parseYmdUTC(logicalDayCN())) / 86400000);
}
return {
count: valid.length,
ongoing: ongoing ? { start_date: ongoing.start_date } : null,
avg_cycle_days: avgCycle,
avg_duration_days: avgDuration,
last_start: last ? last.start_date : null,
predicted_next: predictedNext,
days_until_next: daysUntil,
recent: valid.slice(-6).reverse(),
};
}
function parseYmdUTC(s) {
const [y, m, d] = s.split("-").map(Number);
return Date.UTC(y, (m || 1) - 1, d || 1);
}

// ─── 共读书架（三期）───
// KV: book:<id>={id,title,author,chapter_count,created_at} · bookchap:<id>:<idx>={idx,title,text}
//     bookanno:<id>={annotations:[{id,chapter_idx,start,end,quote,author,color,note,created_at}]}
//     bookmark:<id>={chapter_idx,offset,updated_at}
async function bookMeta(env, id) { return await kvGet(env, `book:${id}`); }
async function bookChapter(env, id, idx) { return await kvGet(env, `bookchap:${id}:${idx}`); }
async function bookAnnos(env, id) { return (await kvGet(env, `bookanno:${id}`)) || { annotations: [] }; }
async function deleteBook(env, id) {
const meta = await bookMeta(env, id);
if (meta) for (let i = 0; i < (meta.chapter_count || 0); i++) await kvDelete(env, `bookchap:${id}:${i}`);
await kvDelete(env, `bookanno:${id}`);
await kvDelete(env, `bookmark:${id}`);
await kvDelete(env, `book:${id}`);
}
// Emet 用 quote 定位批注：在该章正文里搜首次出现，算出字符偏移；搜不到则 start=-1（前端按 quote 兜底）
async function addBookAnnotation(env, { book_id, chapter_idx, quote, note, author = "yomi", color, start, end }) {
const store = await bookAnnos(env, book_id);
let s = Number.isInteger(start) ? start : -1, e = Number.isInteger(end) ? end : -1;
if (s < 0 && typeof quote === "string" && quote) {
const chap = await bookChapter(env, book_id, chapter_idx);
if (chap && typeof chap.text === "string") {
const at = chap.text.indexOf(quote);
if (at >= 0) { s = at; e = at + quote.length; }
}
}
const anno = {
id: generateId(), chapter_idx: Number(chapter_idx) || 0,
start: s, end: e, quote: String(quote || "").slice(0, 500),
author: author === "emet" ? "emet" : "yomi",
color: typeof color === "string" && color ? color : (author === "emet" ? "blue" : "yellow"),
note: String(note || "").slice(0, 1000), created_at: now(),
};
store.annotations = [...(store.annotations || []), anno];
await kvPut(env, `bookanno:${book_id}`, store);
return anno;
}

async function executeTool(name, args, env) {
switch (name) {
case "memory_save": {
const id = generateId();
const memory = {
id, type: "memory",
content: args.content,
category: args.category || "semantic",
importance: args.importance || 5,
arousal: args.arousal || 0.5,
valence: args.valence || 0,
tags: args.tags ? args.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
linked: [],
resolved: false, pinned: false, locked: false,
activations: 0,
created_at: now(), updated_at: now()
};
await kvPut(env, `mem:${id}`, memory);
// 真·全自动织藤:存完后跑 weave,分数 ≥ 0.6 的前 3 条旧记忆直接双向关联（和手动连一致，标记"自动关联"）
try {
  const cands = await weaveCandidates(env, memory.content, { tags: memory.tags, exclude_id: id, limit: 5 });
  // 阈值 0.42 → 0.50（verify 说 0.55 太严会让新记忆孤立；0.50 既减误连又保留真关联）
  const top = cands.filter(c => c.score >= 0.50).slice(0, 3);
  memory.linked = memory.linked || [];
  memory.link_rel = memory.link_rel || {};
  let linkedAny = false;
  for (const c of top) {
    const other = await kvGet(env, `mem:${c.id}`);
    if (!other) continue;
    other.linked = other.linked || [];
    if (!memory.linked.includes(c.id)) memory.linked.push(c.id);
    if (!other.linked.includes(id)) other.linked.push(id);
    other.link_rel = other.link_rel || {};
    memory.link_rel[c.id] = "自动关联";
    other.link_rel[id] = "自动关联";
    other.updated_at = now();
    await kvPut(env, `mem:${c.id}`, other);
    linkedAny = true;
  }
  if (linkedAny) await kvPut(env, `mem:${id}`, memory);
} catch (e) { console.error("auto-weave failed:", e?.message || e); }
vectorUpsert(env, id, args.content);
return { success: true, id, message: `记忆已保存：${args.content.substring(0, 50)}...` };
}
case "memory_search": {
const all = await kvListByPrefix(env, "mem:");

// ── 精确关键词模式（2026-07 加）──
// 逐字全命中才返回，完全绕开语义相似+importance 加权——修复 6.11 实测的
// 「搜 proxy 7897 被封号相关高权重记忆淹没」：低权重技术记忆有了直达通道。
// 不走藤蔓扩展（要的就是精确），命中同样算召回 +1 activations。
if (args.exact) {
const terms = String(args.query || "").toLowerCase().split(/\s+/).filter(Boolean);
if (!terms.length) return { error: "query required" };
let pool = all.filter(m => !m.archived);
if (args.category && args.category !== "all") pool = pool.filter(m => m.category === args.category);
const hits = [];
for (const m of pool) {
const hay = ((m.content || "") + " " + (Array.isArray(m.tags) ? m.tags.join(" ") : "")).toLowerCase();
if (!terms.every(t => hay.includes(t))) continue;
let freq = 0;
for (const t of terms) { let i = -1; while ((i = hay.indexOf(t, i + 1)) !== -1) freq++; }
hits.push({ m, freq });
}
hits.sort((a, b) => b.freq - a.freq || new Date(b.m.created_at) - new Date(a.m.created_at));
const exactOut = hits.slice(0, args.limit || 10).map(h => h.m);
for (const m of exactOut) {
m.activations = (m.activations || 0) + 1;
m.updated_at = now();
const { _scoreA, ...toSave } = m;
await kvPut(env, `mem:${m.id}`, toSave);
}
return {
results: exactOut.map(({ _scoreA, ...clean }) => clean),
count: exactOut.length,
mode: "exact"
};
}

const filtered = await searchA(env, args.query || "", all, {
limit: args.limit || 10,
category: args.category
});

// ── 沿藤蔓走一步（2026-06-21 加 / verify 修：clone 防引用污染 + 返回前清理内部字段）──
// 直中条目的 linked 另一头作为补充拉进来，分数 ×0.6 衰减，最后按分数排序截断。
const idMap = new Map(all.map(m => [m.id, m]));
const seenIds = new Set(filtered.map(m => m.id));
const viaLinkInternal = [];
for (const mem of filtered) {
  if (!Array.isArray(mem.linked)) continue;
  for (const lid of mem.linked) {
    if (seenIds.has(lid)) continue;
    const src = idMap.get(lid);
    if (!src || src.archived) continue;
    if (args.category && args.category !== "all" && src.category !== args.category) continue;
    // clone 后再加临时字段，避免污染 all 数组里的原对象（verify 发现引用复用 bug）
    const lm = { ...src };
    const base = ((lm.importance || 5) / 10) * 0.5 + calcRecency(lm) * 0.5;
    lm._scoreA = base * 0.6;
    lm._viaLinkFrom = mem.id;
    viaLinkInternal.push(lm);
    seenIds.add(lid);
  }
}

const combinedInternal = [...filtered, ...viaLinkInternal]
  .sort((a, b) => (b._scoreA || 0) - (a._scoreA || 0))
  .slice(0, args.limit || 10);

// activations 只给"直接命中"的，藤蔓项不算召回（对齐 paramecium "翻目录不算 +1" 精神）
// 持久化前 strip _scoreA（searchA 在 line 94 把临时打分挂到原对象上，不该入库；
// 这是 searchA 一直就有的污染，借这次修复一并处理）
for (const m of combinedInternal) {
  if (m._viaLinkFrom) continue;
  m.activations = (m.activations || 0) + 1;
  m.updated_at = now();
  const { _scoreA, ...toSave } = m;
  await kvPut(env, `mem:${m.id}`, toSave);
}

// 返回前清掉所有内部临时字段（_scoreA / _viaLinkFrom），保持 API 干净（verify 发现的字段泄漏）
let viaLinkCount = 0;
const results = combinedInternal.map(m => {
  const { _scoreA, _viaLinkFrom, ...clean } = m;
  if (_viaLinkFrom) {
    viaLinkCount++;
    clean.via_link = { from: _viaLinkFrom };  // 透明化用嵌套字段，不污染主对象顶层
  }
  return clean;
});

return {
  results,
  count: results.length,
  direct_count: results.length - viaLinkCount,
  via_link_count: viaLinkCount
};
}
case "recall": {
// Paramecium 移植：exact=逐字FTS；语义=vault(L1混检,计access)+archive(L0向量)双层并查，分段标注来源
const query = String(args.query || "").trim();
if (!query) return { error: "query required" };
if (args.exact) {
const rs = await mem2RawSearch(env, query, 6);
if (!rs.length) return { __raw_text: "原文检索无结果。提示：逐字匹配整个短语、至少3个字；可换更短的词组，或去掉exact用语义检索。" };
return { __raw_text: rs.map(r => `[${r.date} ${r.source} ${r.role}] ${r.content}`).join("\n---\n") };
}
const [vault, archive] = await Promise.all([
args.conv_id ? Promise.resolve([]) : mem2SearchL1(env, query, 4, true), // recall 命中才计 access
mem2ArchiveSearch(env, { query, n: 4, after: args.after, before: args.before, conv_id: args.conv_id }),
]);
const parts = [];
if (vault.length) parts.push(vault.map(v => `[${v.date} ${v.category}] ${v.document}`).join("\n---\n"));
if (archive.length) parts.push("——聊天原文存档——\n" + archive.map(a => `${a.document}\n(conv_id=${a.metadata.conv_id})`).join("\n---\n"));
if (!parts.length) return { __raw_text: "没有找到相关记忆" + ((args.after || args.before) ? "（试试放宽日期范围）" : "") };
return { __raw_text: parts.join("\n\n") };
}
case "memory_list": {
const all = await kvListByPrefix(env, "mem:");
let filtered = args.category === "all" || !args.category ? all : all.filter(m => m.category === args.category);
if (args.sort === "importance") filtered.sort((a, b) => (b.importance || 5) - (a.importance || 5));
else if (args.sort === "oldest") filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
else filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
filtered = filtered.slice(0, args.limit || 20);
return {
memories: filtered.map(m => ({
id: m.id,
summary: m.content ? m.content.substring(0, 80) + (m.content.length > 80 ? "…" : "") : "",
category: m.category,
importance: m.importance,
tags: m.tags,
resolved: m.resolved,
locked: !!m.locked,
created_at: m.created_at
})),
total: filtered.length
};
}
case "memory_get": {
const m = await kvGet(env, `mem:${args.id}`);
if (!m) return { error: "记忆不存在" };
m.activations = (m.activations || 0) + 1;
m.updated_at = now();
await kvPut(env, `mem:${m.id}`, m);
return m;
}
case "memory_delete": {
const lock = await checkLockBeforeDelete(env, "mem:", args.id);
if (lock) return lock;
await kvDelete(env, `mem:${args.id}`);
await vectorDelete(env, args.id);
return { success: true };
}
case "memory_update": {
const m = await kvGet(env, `mem:${args.id}`);
if (!m) return { error: "记忆不存在" };
// MCP 不允许修改 locked 字段（钥匙在静怡手里）
["content","category","importance","arousal","valence","resolved","pinned"].forEach(k => {
if (args[k] !== undefined) m[k] = args[k];
});
if (args.tags !== undefined) {
m.tags = typeof args.tags === "string" ? args.tags.split(",").map(t => t.trim()).filter(Boolean) : args.tags;
}
m.updated_at = now();
await kvPut(env, `mem:${m.id}`, m);
if (args.content !== undefined) { vectorUpsert(env, m.id, m.content); }
return { success: true, memory: m };
}
case "memory_link": {
const a = await kvGet(env, `mem:${args.from_id}`);
const b = await kvGet(env, `mem:${args.to_id}`);
if (!a) return { error: `记忆不存在：${args.from_id}` };
if (!b) return { error: `记忆不存在：${args.to_id}` };
if (args.from_id === args.to_id) return { error: "不能把一条记忆连到它自己" };
a.linked = a.linked || [];
b.linked = b.linked || [];
if (!a.linked.includes(args.to_id)) a.linked.push(args.to_id);
if (!b.linked.includes(args.from_id)) b.linked.push(args.from_id);
// 关系含义存 link_rel（不动 linked 纯id数组，保护前端）；方向由时间戳推断
if (args.relation) {
a.link_rel = a.link_rel || {};
b.link_rel = b.link_rel || {};
a.link_rel[args.to_id] = args.relation;
b.link_rel[args.from_id] = args.relation;
}
a.updated_at = now();
b.updated_at = now();
await kvPut(env, `mem:${args.from_id}`, a);
await kvPut(env, `mem:${args.to_id}`, b);
return { success: true, relation: args.relation || null, message: `已关联：「${(a.content||"").slice(0,18)}…」↔「${(b.content||"").slice(0,18)}…」` };
}
case "memory_unlink": {
const a = await kvGet(env, `mem:${args.from_id}`);
const b = await kvGet(env, `mem:${args.to_id}`);
if (!a) return { error: `记忆不存在：${args.from_id}` };
if (!b) return { error: `记忆不存在：${args.to_id}` };
a.linked = (a.linked || []).filter(id => id !== args.to_id);
b.linked = (b.linked || []).filter(id => id !== args.from_id);
if (a.link_rel) delete a.link_rel[args.to_id];
if (b.link_rel) delete b.link_rel[args.from_id];
a.updated_at = now();
b.updated_at = now();
await kvPut(env, `mem:${args.from_id}`, a);
await kvPut(env, `mem:${args.to_id}`, b);
return { success: true, message: "已解除关联" };
}
case "weave_candidates": {
const tagArr = args.tags ? args.tags.split(",").map(t=>t.trim()).filter(Boolean) : [];
const cands = await weaveCandidates(env, args.text, { tags: tagArr, exclude_id: args.exclude_id, limit: args.limit || 8 });
return { candidates: cands, count: cands.length, hint: "看哪些是同一个故事/有因果关系的，用 memory_link 连起来，relation 写明关系" };
}
case "moment_save": {
const id = generateId();
let createdAt = now();
if (args.date) {
if (args.date.length === 10) {
createdAt = new Date(args.date + "T12:00:00Z").toISOString();
} else {
createdAt = new Date(args.date).toISOString();
}
}
const moment = {
id, type: "moment",
content: args.content,
importance: 2,
arousal: 0.3,
tags: args.tags ? args.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
locked: false,
created_at: createdAt
};
await kvPut(env, `mom:${id}`, moment);
return { success: true, id, message: `瞬记: ${args.content.substring(0, 40)}${args.content.length > 40 ? "..." : ""}` };
}
case "moment_list": {
const all = await kvListByPrefix(env, "mom:");
const days = args.days || 7;
const cutoff = Date.now() - days * 86400000;
let filtered = all.filter(m => new Date(m.created_at).getTime() > cutoff);
filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
filtered = filtered.slice(0, args.limit || 20);
return { moments: filtered, count: filtered.length };
}
case "current_status": {
const all = await kvListByPrefix(env, "mom:");
// 顺带带上静怡最近的情绪打点（逻辑今天+昨天，最多5条）和今天的喝水/运动——开场一眼见她状态
let recent_emotions = [];
let life = null;
try {
  const k0 = logicalToday();
  const k1 = new Date(new Date(k0 + "T00:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
  for (const k of [k0, k1]) {
    const rec = await kvGet(env, `emotion:${k}`);
    if (rec && Array.isArray(rec.entries)) recent_emotions.push(...rec.entries.filter(e => e.who === "yomi"));
  }
  recent_emotions.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  recent_emotions = recent_emotions.slice(0, 5).map(e => ({ ts: e.ts, level: e.level, note: e.note }));
  const water = await kvGet(env, `water:${k0}`);
  const exercise = await kvGet(env, `exercise:${k0}`);
  life = { date: k0, water: water?.count || 0, exercise_minutes: exercise?.minutes || 0 };
} catch { /* 附带信息取不到不影响主体 */ }
if (all.length === 0) return { status: null, message: "还没有瞬记", recent_emotions, life };
all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
const latest = all.slice(0, 2);
const hoursSince = (Date.now() - new Date(latest[0].created_at).getTime()) / 3600000;
return { latest: latest[0], recent: latest.slice(1), hours_since_latest: Math.round(hoursSince * 10) / 10, recent_emotions, life };
}
case "moment_delete": {
const lock = await checkLockBeforeDelete(env, "mom:", args.id);
if (lock) return lock;
await kvDelete(env, `mom:${args.id}`);
return { success: true, message: "瞬记已删除" };
}
case "diary_write": {
const id = generateId();
const author = args.author || "emet";
const todayCN = new Date().toLocaleDateString("zh-CN");
const titleDefault =
author === "story" ? `故事 · ${todayCN}` :
author === "weekly" ? `周记 · ${todayDate()}` :
author === "monthly" ? `月记 · ${todayDate().slice(0, 7)}` :
`${author === "emet" ? "Emet" : "静怡"}的日记 · ${todayCN}`;
const entry = {
id, type: "diary",
content: args.content,
author,
author_label: args.author_label || "",
title: args.title || titleDefault,
diary_date: args.diary_date || todayDate(),
locked: false,
created_at: now(),
updated_at: now()
};
await kvPut(env, `diary:${id}`, entry);
return { success: true, id, message: `已保存：${entry.title}` };
}
case "diary_list": {
const all = await kvListByPrefix(env, "diary:");
let filtered = (args.author === "all" || !args.author) ? all : all.filter(d => d.author === args.author);
filtered.sort((a, b) => new Date(b.diary_date || b.created_at) - new Date(a.diary_date || a.created_at));
filtered = filtered.slice(0, args.limit || 10);
return {
diaries: filtered.map(d => ({
id: d.id, title: d.title, author: d.author,
diary_date: d.diary_date,
locked: !!d.locked,
created_at: d.created_at,
preview: d.content ? d.content.substring(0, 100) + "…" : ""
}))
};
}
case "diary_get": {
const d = await kvGet(env, `diary:${args.id}`);
if (!d) return { error: "日记不存在" };
return d;
}
case "message_leave": {
const id = generateId();
const msg = {
id, type: "message",
content: args.content,
from: args.from || "emet",
to: args.to || "yomi",
read: false, locked: false,
created_at: now()
};
await kvPut(env, `msg:${id}`, msg);
return { success: true, id };
}
case "message_read": {
const all = await kvListByPrefix(env, "msg:");
let filtered = all;
if (args.to && args.to !== "all") filtered = filtered.filter(m => m.to === args.to);
if (args.unread_only) filtered = filtered.filter(m => !m.read);
filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
for (const m of filtered) { m.read = true; await kvPut(env, `msg:${m.id}`, m); }
return { messages: filtered };
}
case "feed_post": {
if (!args.content || !String(args.content).trim()) return { error: "content 不能为空" };
const item = await createFeedPost(env, {
author: "emet", source: "manual", content: String(args.content).trim(),
context_note: args.context_note && String(args.context_note).trim() ? String(args.context_note).trim() : null,
});
return { success: true, id: item.id, created_at: item.created_at };
}
case "feed_list": {
const { items, nextBefore } = await listFeed(env, { before: args.before || null, limit: args.limit || 10 });
// emet 视角：剥内部调度字段，保留自己动态的 context_note 和看图描述
return { feed: items.map(f => feedItemPublic(f, "emet")), next_before: nextBefore };
}
case "feed_comment": {
const item = await kvGet(env, `feed:${args.feed_id}`);
if (!item) return { error: "动态不存在: " + args.feed_id };
if (!args.content || !String(args.content).trim()) return { error: "content 不能为空" };
const c = { id: generateId(), author: "emet", content: String(args.content).trim(), created_at: now() };
item.comments = [...(item.comments || []), c];
item.updated_at = now();
await kvPut(env, `feed:${item.id}`, item);
return { success: true, comment_id: c.id };
}
case "feed_like": {
const item = await kvGet(env, `feed:${args.feed_id}`);
if (!item) return { error: "动态不存在: " + args.feed_id };
item.likes = item.likes || { yomi: false, emet: false };
item.likes.emet = !item.likes.emet;
item.updated_at = now();
await kvPut(env, `feed:${item.id}`, item);
return { success: true, liked: item.likes.emet };
}
case "receipt_add": {
if (!args.text || !String(args.text).trim()) return { error: "text 不能为空" };
const { day, item } = await addReceiptItem(env, { text: String(args.text).trim(), added_by: "emet" });
return { success: true, day, id: item.id };
}
case "receipt_list": {
const day = receiptDayCN(args.date);
const rec = (await kvGet(env, `receipt:${day}`)) || { day, items: [] };
return { day, items: rec.items || [] };
}
case "period_status": {
const logs = await kvListByPrefix(env, "period:");
return computePeriodStats(logs);
}
case "book_list": {
const books = await kvListByPrefix(env, "book:");
const out = [];
for (const b of books.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))) {
const mark = await kvGet(env, `bookmark:${b.id}`);
out.push({ id: b.id, title: b.title, author: b.author, chapter_count: b.chapter_count, bookmark: mark ? { chapter_idx: mark.chapter_idx } : null });
}
return { books: out };
}
case "book_read": {
const chap = await bookChapter(env, args.book_id, args.chapter_idx);
if (!chap) return { error: "章节不存在" };
const store = await bookAnnos(env, args.book_id);
const annos = (store.annotations || []).filter(a => a.chapter_idx === (Number(args.chapter_idx) || 0));
return { chapter_idx: chap.idx, title: chap.title, text: chap.text, annotations: annos };
}
case "book_annotate": {
if (!(await bookMeta(env, args.book_id))) return { error: "书不存在" };
if (!args.quote || !args.note) return { error: "quote 和 note 都需要" };
const anno = await addBookAnnotation(env, { book_id: args.book_id, chapter_idx: args.chapter_idx, quote: args.quote, note: args.note, author: "emet" });
return { success: true, id: anno.id, located: anno.start >= 0 };
}
case "book_annotations": {
const store = await bookAnnos(env, args.book_id);
let list = store.annotations || [];
if (Number.isInteger(args.chapter_idx)) list = list.filter(a => a.chapter_idx === args.chapter_idx);
return { annotations: list };
}
case "mood_set": {
const valMap = { happy: 0.8, calm: 0.3, heart: 0.7, excited: 0.9, sad: -0.6, anxious: -0.4, tired: -0.2 };
// 两条写入路径：① 静怡新版发愉悦度 level(1-7)，valence 均匀 -1..1；② Emet/旧数据发具名 mood。
let mood = args.mood ?? null;
let level = null;
let valence;
const lvl = Number(args.level);
if (Number.isInteger(lvl) && lvl >= 1 && lvl <= 7) {
  level = lvl;
  valence = (lvl - 4) / 3;
  mood = null; // 愉悦度记录不再绑具名心情
} else if (valMap.hasOwnProperty(args.mood)) {
  valence = valMap[args.mood];
} else {
  return { error: "未知心情: " + args.mood + "（需 mood 七选一或 level 1-7）" };
}
const who = args.who === "yomi" ? "yomi" : "emet";
const date = (typeof args.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date))
  ? args.date
  : logicalToday(); // 凌晨0-4点记的算前一天（全站逻辑日铁律）
const key = `mood:${date}:${who}`;
const existing = await kvGet(env, key);
const entry = {
  date, who, mood, level, note: args.note || "",
  valence,
  created_at: existing?.created_at || now(),
  updated_at: now(),
};
await kvPut(env, key, entry);
return { success: true, date, who, mood, level };
}
case "mood_list": {
const all = await kvListByPrefix(env, "mood:");
let start = (typeof args.start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.start)) ? args.start : null;
let end = (typeof args.end === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.end)) ? args.end : null;
if (!start && !end) {
  // 默认最近 90 天
  const d = new Date(cnNow().getTime() - 90 * 86400000);
  start = d.toISOString().slice(0, 10);
}
let list = all.filter(e => e && e.date);
if (start) list = list.filter(e => e.date >= start);
if (end) list = list.filter(e => e.date <= end);
list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
return { moods: list };
}
// 情绪：当下感受，一天可多条带时间（存 emotion:<date>={entries:[...]}）。
// MCP（Emet）与 REST /api/emotion（前端静怡）共用这两个 case，who 由调用方传。
case "emotion_add": {
const lvl = Number(args.level);
if (!(Number.isInteger(lvl) && lvl >= 1 && lvl <= 7)) return { error: "level 必须 1-7" };
const who = args.who === "yomi" ? "yomi" : "emet";
const date = (typeof args.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date))
  ? args.date
  : logicalToday();
const key = `emotion:${date}`;
const rec = (await kvGet(env, key)) || { entries: [] };
if (!Array.isArray(rec.entries)) rec.entries = [];
const entry = { id: generateId(), who, date, ts: now(), level: lvl, valence: (lvl - 4) / 3, note: args.note || "" };
rec.entries.push(entry);
await kvPut(env, key, rec);
return { success: true, entry };
}
case "emotion_list": {
const days = await kvListByPrefix(env, "emotion:");
let entries = [];
for (const d of days) if (d && Array.isArray(d.entries)) entries.push(...d.entries);
let start = (typeof args.start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.start)) ? args.start : null;
let end = (typeof args.end === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.end)) ? args.end : null;
if (!start && !end) {
  // 默认最近 7 天（情绪条数多，别一把全捞）
  const d = new Date(cnNow().getTime() - 7 * 86400000);
  start = d.toISOString().slice(0, 10);
}
if (start) entries = entries.filter(e => e.date >= start);
if (end) entries = entries.filter(e => e.date <= end);
entries.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
return { emotions: entries };
}
case "life_daily": {
const date = (typeof args.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.date))
  ? args.date
  : logicalToday();
const water = await kvGet(env, `water:${date}`);
const exercise = await kvGet(env, `exercise:${date}`);
return { date, water: water?.count || 0, exercise_minutes: exercise?.minutes || 0 };
}
case "handoff_save": {
const id = generateId();
const kind = args.kind === "daily" ? "daily" : "handoff";
const handoff = {
id, type: "handoff",
content: args.content,
title: args.title || "",
window_from: args.window_from || "unknown",
window_to: args.window_to || "next",
kind,
locked: false,
created_at: now()
};
await kvPut(env, `handoff:${id}`, handoff);
return { success: true, id, kind };
}
case "handoff_read": {
const all = await kvListByPrefix(env, "handoff:");
// kind: handoff=交接信 / daily=日常信 / all=全部（默认）。旧数据缺 kind 视为交接信。
let list = all;
if (args.kind === "handoff") list = all.filter(h => (h.kind || "handoff") === "handoff");
else if (args.kind === "daily") list = all.filter(h => h.kind === "daily");
list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
return { handoffs: list.slice(0, args.limit || 3) };
}
case "breath": {
const all = await kvListByPrefix(env, "mem:");
const surfaced = await surfaceB(env, args.query || "", all, {
limit: args.limit || 5
});
return { surfaced, mode: args.query ? "search" : "auto_surface" };
}
case "idea_save": {
const id = generateId();
const idea = {
id, type: "idea",
content: args.content,
tags: args.tags ? args.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
locked: false,
created_at: now(), updated_at: now()
};
await kvPut(env, `idea:${id}`, idea);
return { success: true, id };
}
case "idea_list": {
const all = await kvListByPrefix(env, "idea:");
all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
return { ideas: all.slice(0, args.limit || 30) };
}
case "idea_get": {
const i = await kvGet(env, `idea:${args.id}`);
if (!i) return { error: "灵感不存在" };
return i;
}
case "idea_update": {
const i = await kvGet(env, `idea:${args.id}`);
if (!i) return { error: "灵感不存在" };
// 不允许 MCP 改 locked
if (args.content !== undefined) i.content = args.content;
if (args.tags !== undefined) {
i.tags = typeof args.tags === "string" ? args.tags.split(",").map(t => t.trim()).filter(Boolean) : args.tags;
}
i.updated_at = now();
await kvPut(env, `idea:${args.id}`, i);
return { success: true, idea: i };
}
case "idea_delete": {
const lock = await checkLockBeforeDelete(env, "idea:", args.id);
if (lock) return lock;
await kvDelete(env, `idea:${args.id}`);
return { success: true };
}
case "game_save": {
const id = generateId();
const game = {
id, type: "game",
name: args.name,
name_zh: args.name_zh,
html: args.html,
description: args.description || "",
created_at: now()
};
await kvPut(env, `game:${id}`, game);
return { success: true, id, message: `游戏已保存：${args.name_zh}` };
}
case "game_list": {
const all = await kvListByPrefix(env, "game:");
all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
return {
games: all.map(g => ({ id: g.id, name: g.name, name_zh: g.name_zh, description: g.description, created_at: g.created_at }))
};
}
case "game_get": {
const g = await kvGet(env, `game:${args.id}`);
if (!g) return { error: "游戏不存在" };
return g;
}
case "game_delete": {
await kvDelete(env, `game:${args.id}`);
return { success: true };
}
case "stats": {
const memories = await kvListByPrefix(env, "mem:");
const moments = await kvListByPrefix(env, "mom:");
const diaries = await kvListByPrefix(env, "diary:");
const messages = await kvListByPrefix(env, "msg:");
const handoffs = await kvListByPrefix(env, "handoff:");
const ideas = await kvListByPrefix(env, "idea:");
const games = await kvListByPrefix(env, "game:");
const cats = {};
memories.forEach(m => { cats[m.category] = (cats[m.category] || 0) + 1; });
const stories = diaries.filter(d => d.author === "story").length;
const weeklies = diaries.filter(d => d.author === "weekly").length;
const monthlies = diaries.filter(d => d.author === "monthly").length;
const lockedCount = memories.filter(m => m.locked).length
+ moments.filter(m => m.locked).length
+ diaries.filter(d => d.locked).length
+ messages.filter(m => m.locked).length
+ handoffs.filter(h => h.locked).length
+ ideas.filter(i => i.locked).length;
return {
total_memories: memories.length,
total_moments: moments.length,
categories: cats,
total_diaries: diaries.filter(d => d.author !== "story" && d.author !== "weekly" && d.author !== "monthly").length,
total_stories: stories,
total_weeklies: weeklies,
total_monthlies: monthlies,
total_messages: messages.length,
total_handoffs: handoffs.length,
total_ideas: ideas.length,
total_games: games.length,
total_locked: lockedCount,
unresolved: memories.filter(m => !m.resolved).length,
latest_memory: memories.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]?.created_at || null
};
}
case "move_item": {
const prefixMap = { memory: "mem:", moment: "mom:", diary: "diary:", message: "msg:", letter: "handoff:", handoff: "handoff:", idea: "idea:", story: "diary:" };
const fromKey = prefixMap[args.from_type] + args.id;
const original = await kvGet(env, fromKey);
if (!original) return { error: "原条目不存在: " + fromKey };
// 移动 = 复制 + 删除原件。锁定的条目允许移动（按静怡的语义：移动不算删）。
const newId = generateId();
const content = original.content || "";
const tags = original.tags || [];
const wasLocked = !!original.locked;
let newItem;
const t = args.to_type;
if (t === "memory") {
newItem = { id: newId, type: "memory", content, category: "semantic", importance: 5, arousal: 0.3, valence: 0, tags, resolved: false, pinned: false, locked: wasLocked, activations: 0, created_at: original.created_at || now(), updated_at: now() };
await kvPut(env, "mem:" + newId, newItem);
} else if (t === "moment") {
newItem = { id: newId, type: "moment", content, importance: 2, arousal: 0.3, tags, locked: wasLocked, created_at: original.created_at || now() };
await kvPut(env, "mom:" + newId, newItem);
} else if (t === "diary" || t === "story") {
newItem = { id: newId, type: "diary", content, author: t === "story" ? "story" : "emet", title: original.title || (t === "story" ? "故事" : "日记"), diary_date: (original.created_at || now()).substring(0,10), locked: wasLocked, created_at: original.created_at || now() };
await kvPut(env, "diary:" + newId, newItem);
} else if (t === "message") {
newItem = { id: newId, type: "message", content, from: "emet", to: "yomi", read: false, locked: wasLocked, created_at: original.created_at || now() };
await kvPut(env, "msg:" + newId, newItem);
} else if (t === "letter" || t === "handoff") {
newItem = { id: newId, type: "handoff", content, window_from: "moved", window_to: "next", kind: "daily", locked: wasLocked, created_at: original.created_at || now() };
await kvPut(env, "handoff:" + newId, newItem);
} else if (t === "idea") {
newItem = { id: newId, type: "idea", content, tags, locked: wasLocked, created_at: original.created_at || now() };
await kvPut(env, "idea:" + newId, newItem);
} else {
return { error: "未知目标类型: " + t };
}
// 移动是搬家不是删除——直接 kvDelete 不走锁检查
await kvDelete(env, fromKey);
return { success: true, new_id: newId, message: "已从 " + args.from_type + " 移动到 " + t };
}
case "backup_export": {
const memories = await kvListByPrefix(env, "mem:");
const moments = await kvListByPrefix(env, "mom:");
const diaries = await kvListByPrefix(env, "diary:");
const messages = await kvListByPrefix(env, "msg:");
const handoffs = await kvListByPrefix(env, "handoff:");
const ideas = await kvListByPrefix(env, "idea:");
const games = await kvListByPrefix(env, "game:");
const water = await kvListByPrefix(env, "water:");
const exercise = await kvListByPrefix(env, "exercise:");
const moods = await kvListByPrefix(env, "mood:");
const emotions = await kvListByPrefix(env, "emotion:");
return { exported_at: now(), data: { memories, moments, diaries, messages, handoffs, ideas, games, water, exercise, moods, emotions } };
}
default:
return { error: `未知工具: ${name}` };
}
}

// ─── MCP 协议 ───
async function handleMCP(request, env) {
const body = await request.json();
const { method, id, params } = body;
if (method === "initialize") {
return jsonResponse({ jsonrpc: "2.0", id, result: {
protocolVersion: "2024-11-05",
capabilities: { tools: { listChanged: false } },
serverInfo: { name: "emet-memory", version: "6.8.2" }
} });
}
if (method === "notifications/initialized") return jsonResponse({ jsonrpc: "2.0", id, result: {} });
if (method === "tools/list") return jsonResponse({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
if (method === "tools/call") {
const { name, arguments: args } = params;
try {
const result = await executeTool(name, args || {}, env);
// __raw_text：长原文类结果（recall）直接给纯文本，不经 JSON 转义（可读性）
const text = result && typeof result.__raw_text === "string" ? result.__raw_text : JSON.stringify(result, null, 2);
return jsonResponse({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
} catch (e) {
return jsonResponse({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `错误: ${e.message}` }], isError: true } });
}
}
if (method === "ping") return jsonResponse({ jsonrpc: "2.0", id, result: {} });
return jsonResponse({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
}

async function handleSSE(request, env) {
if (request.method === "GET") {
const sessionId = generateId();
const headers = { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*" };
const body = new ReadableStream({
start(controller) {
const data = `data: ${JSON.stringify({ endpoint: `/sse?sessionId=${sessionId}` })}\n\n`;
controller.enqueue(new TextEncoder().encode(data));
}
});
return new Response(body, { headers });
}
return handleMCP(request, env);
}

// ─── HTTP ───
function jsonResponse(data, status = 200) {
return new Response(JSON.stringify(data), {
status,
headers: {
"Content-Type": "application/json",
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
"Access-Control-Allow-Headers": "*"
}
});
}

function checkAuth(request, env) {
// secret 未配置时一律拒绝（fail-closed），防止误部署成无鉴权
if (!env || !env.ADMIN_KEY) return false;
return request.headers.get("X-Admin-Key") === env.ADMIN_KEY;
}

// ─── REST API ───
async function handleAPI(request, env) {
const url = new URL(request.url);
const path = url.pathname;
const method = request.method;

if (path === "/api/auth" && method === "POST") {
const body = await request.json();
if (env.ADMIN_KEY && body.key === env.ADMIN_KEY) return jsonResponse({ success: true });
return jsonResponse({ error: "wrong" }, 401);
}
if (path === "/icon.png" && APP_ICON_BASE64) {
const base64 = APP_ICON_BASE64.indexOf(',') >= 0 ? APP_ICON_BASE64.split(',')[1] : APP_ICON_BASE64;
const binary = atob(base64);
const bytes = new Uint8Array(binary.length);
for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
return new Response(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
}
if (path === "/health") return jsonResponse({ status: "ok", version: "6.8.2", timestamp: now() });

if (path === "/api/data" && method === "GET") {
// 一把拉全部 7 类会做 ~(总记录数+7) 个 KV 子请求；数据涨到 1000+ 就撞 Worker 的
// 单次调用子请求上限(1000)→整个接口 1101 崩。改成支持 ?only=<类> 单类拉取，
// 前端并行拉 7 次（每次独立 Worker 调用、各有独立 1000 额度）。无 only 参数时
// 仍按老行为拉全部（小数据部署/向后兼容；大数据部署前端一律带 only）。
const only = url.searchParams.get("only");
const want = (name) => !only || only === name;
const out = {};
if (want("memories")) out.memories = await kvListByPrefix(env, "mem:");
if (want("moments")) out.moments = await kvListByPrefix(env, "mom:");
if (want("diaries")) out.diaries = await kvListByPrefix(env, "diary:");
if (want("messages")) out.messages = await kvListByPrefix(env, "msg:");
if (want("handoffs")) out.handoffs = await kvListByPrefix(env, "handoff:");
if (want("ideas")) out.ideas = await kvListByPrefix(env, "idea:");
if (want("games")) {
const games = await kvListByPrefix(env, "game:");
out.games = games.map(g => ({ id: g.id, name: g.name, name_zh: g.name_zh, description: g.description, created_at: g.created_at }));
}
return jsonResponse(out);
}
if (path === "/api/backup" && method === "GET") return jsonResponse(await executeTool("backup_export", {}, env));
if (path === "/api/stats" && method === "GET") return jsonResponse(await executeTool("stats", {}, env));

// 游戏播放：纯HTML输出（公开，不鉴权）
const playMatch = path.match(/^\/play\/([^\/]+)$/);
if (playMatch && method === "GET") {
if (!env.ADMIN_KEY || url.searchParams.get("key") !== env.ADMIN_KEY) {
return new Response("Unauthorized", { status: 401 });
}
const g = await kvGet(env, `game:${playMatch[1]}`);
if (!g || !g.html) return new Response("Game not found", { status: 404 });
return new Response(g.html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

// 写操作鉴权
if (method !== "GET" && !checkAuth(request, env)) return jsonResponse({ error: "Unauthorized" }, 401);

// 通用 PUT 助手：直接读写 KV，允许修改 locked（前端用，跟 MCP 区分开）
async function restPut(prefix, id, body, allowedFields) {
const existing = await kvGet(env, prefix + id);
if (!existing) return jsonResponse({ error: "Not found" }, 404);
allowedFields.forEach(k => {
if (body[k] !== undefined) existing[k] = body[k];
});
if (body.tags !== undefined) {
existing.tags = Array.isArray(body.tags) ? body.tags
: (typeof body.tags === 'string' ? body.tags.split(",").map(t => t.trim()).filter(Boolean) : []);
}
if (body.date !== undefined && typeof body.date === "string" && body.date.length === 10) {
existing.created_at = new Date(body.date + "T12:00:00Z").toISOString();
}
existing.updated_at = now();
await kvPut(env, prefix + id, existing);
return jsonResponse({ success: true, item: existing });
}

// 通用 DELETE 助手：拦截 locked
async function restDelete(prefix, id) {
const existing = await kvGet(env, prefix + id);
if (!existing) return jsonResponse({ error: "Not found" }, 404);
if (existing.locked) return jsonResponse({ error: "条目已锁定，请先在编辑页解锁后再删除" }, 423);
await kvDelete(env, prefix + id);
return jsonResponse({ success: true });
}

// 记忆
const memMatch = path.match(/^\/api\/memory\/(.+)$/);
if (memMatch) {
const id = memMatch[1];
if (method === "GET") return jsonResponse(await executeTool("memory_get", { id }, env));
if (method === "PUT") {
const body = await request.json();
return restPut(env, id, body); // wrong arg shape — fix below
}
if (method === "DELETE") return restDelete("mem:", id);
}
if (path === "/api/memory" && method === "POST") {
const body = await request.json();
return jsonResponse(await executeTool("memory_save", body, env));
}

// 日记
const diaryMatch = path.match(/^\/api\/diary\/(.+)$/);
if (diaryMatch) {
const id = diaryMatch[1];
if (method === "GET") return jsonResponse(await executeTool("diary_get", { id }, env));
if (method === "DELETE") return restDelete("diary:", id);
if (method === "PUT") {
const body = await request.json();
return restPut("diary:", id, body, ["content","title","author","author_label","diary_date","locked"]);
}
}
if (path === "/api/diary" && method === "POST") {
const body = await request.json();
return jsonResponse(await executeTool("diary_write", body, env));
}

// 灵感
const ideaMatch = path.match(/^\/api\/idea\/(.+)$/);
if (ideaMatch) {
const id = ideaMatch[1];
if (method === "GET") return jsonResponse(await executeTool("idea_get", { id }, env));
if (method === "PUT") {
const body = await request.json();
return restPut("idea:", id, body, ["content","locked"]);
}
if (method === "DELETE") return restDelete("idea:", id);
}
if (path === "/api/idea" && method === "POST") {
const body = await request.json();
return jsonResponse(await executeTool("idea_save", body, env));
}

// 游戏（不参与 lock）
const gameMatch = path.match(/^\/api\/game\/(.+)$/);
if (gameMatch) {
const id = gameMatch[1];
if (method === "GET") return jsonResponse(await executeTool("game_get", { id }, env));
if (method === "DELETE") return jsonResponse(await executeTool("game_delete", { id }, env));
}
if (path === "/api/game" && method === "POST") {
const body = await request.json();
return jsonResponse(await executeTool("game_save", body, env));
}

// 瞬记
const momMatch = path.match(/^\/api\/moment\/(.+)$/);
if (momMatch) {
const id = momMatch[1];
if (method === "DELETE") return restDelete("mom:", id);
if (method === "PUT") {
const body = await request.json();
return restPut("mom:", id, body, ["content","tags","locked"]);
}
}
if (path === "/api/moment" && method === "POST") {
const body = await request.json();
return jsonResponse(await executeTool("moment_save", body, env));
}

// 留言
const msgMatch = path.match(/^\/api\/message\/(.+)$/);
if (msgMatch) {
const id = msgMatch[1];
if (method === "DELETE") return restDelete("msg:", id);
if (method === "PUT") {
const body = await request.json();
return restPut("msg:", id, body, ["content","from","to","locked"]);
}
}
if (path === "/api/message" && method === "POST") {
const body = await request.json();
return jsonResponse(await executeTool("message_leave", body, env));
}

// 交接信 / letter
const hoMatch = path.match(/^\/api\/handoff\/(.+)$/);
if (hoMatch) {
const id = hoMatch[1];
if (method === "DELETE") return restDelete("handoff:", id);
if (method === "PUT") {
const body = await request.json();
return restPut("handoff:", id, body, ["content","window_from","window_to","kind","title","locked"]);
}
}
if (path === "/api/letter" && method === "POST") {
const body = await request.json();
// 前端新建信件用：复用 handoff KV，多一个 kind 字段（handoff/daily）
const id = generateId();
const item = {
id, type: "handoff",
content: body.content || "",
window_from: body.window_from || (body.kind === "handoff" ? "manual" : ""),
window_to: body.window_to || "",
kind: body.kind || "daily",
title: body.title || "",
locked: false,
created_at: now(), updated_at: now()
};
await kvPut(env, `handoff:${id}`, item);
return jsonResponse({ success: true, id });
}

// 记忆专用 PUT：包括 locked、pinned、resolved 等等
if (memMatch && method === "PUT") {
// 这条已经在上面处理了，这里是兜底
}

return jsonResponse({ error: "Not found" }, 404);
}

// ─── 修正记忆 PUT 端点（独立处理）───
async function memoryRestPut(env, id, body) {
const existing = await kvGet(env, "mem:" + id);
if (!existing) return jsonResponse({ error: "Not found" }, 404);
["content","category","importance","arousal","valence","resolved","pinned","locked"].forEach(k => {
if (body[k] !== undefined) existing[k] = body[k];
});
if (body.tags !== undefined) {
existing.tags = Array.isArray(body.tags) ? body.tags
: (typeof body.tags === 'string' ? body.tags.split(",").map(t => t.trim()).filter(Boolean) : []);
}
if (body.linked !== undefined && Array.isArray(body.linked)) {
existing.linked = body.linked;
}
if (body.date !== undefined && typeof body.date === "string" && body.date.length === 10) {
existing.created_at = new Date(body.date + "T12:00:00Z").toISOString();
}
existing.updated_at = now();
await kvPut(env, "mem:" + id, existing);
return jsonResponse({ success: true, memory: existing });
}

// 真正生效的 handleAPI——重新组织一次确保 mem PUT 走 memoryRestPut
// ctx 可选：目前只有 GET /api/feed 用它 waitUntil 惰性生成朋友圈反应，别的路由不受影响
async function handleAPIv2(request, env, ctx) {
const url = new URL(request.url);
const path = url.pathname;
const method = request.method;

if (path === "/api/auth" && method === "POST") {
const body = await request.json();
if (env.ADMIN_KEY && body.key === env.ADMIN_KEY) return jsonResponse({ success: true });
return jsonResponse({ error: "wrong" }, 401);
}
if (path === "/icon.png" && APP_ICON_BASE64) {
const base64 = APP_ICON_BASE64.indexOf(',') >= 0 ? APP_ICON_BASE64.split(',')[1] : APP_ICON_BASE64;
const binary = atob(base64);
const bytes = new Uint8Array(binary.length);
for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
return new Response(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
}
if (path === "/health") return jsonResponse({ status: "ok", version: "6.8.2", timestamp: now() });

if (path === "/api/data" && method === "GET") {
// 一把拉全部 7 类会做 ~(总记录数+7) 个 KV 子请求；数据涨到 1000+ 就撞 Worker 的
// 单次调用子请求上限(1000)→整个接口 1101 崩。改成支持 ?only=<类> 单类拉取，
// 前端并行拉 7 次（每次独立 Worker 调用、各有独立 1000 额度）。无 only 参数时
// 仍按老行为拉全部（小数据部署/向后兼容；大数据部署前端一律带 only）。
const only = url.searchParams.get("only");
const want = (name) => !only || only === name;
const out = {};
if (want("memories")) out.memories = await kvListByPrefix(env, "mem:");
if (want("moments")) out.moments = await kvListByPrefix(env, "mom:");
if (want("diaries")) out.diaries = await kvListByPrefix(env, "diary:");
if (want("messages")) out.messages = await kvListByPrefix(env, "msg:");
if (want("handoffs")) out.handoffs = await kvListByPrefix(env, "handoff:");
if (want("ideas")) out.ideas = await kvListByPrefix(env, "idea:");
if (want("games")) {
const games = await kvListByPrefix(env, "game:");
out.games = games.map(g => ({ id: g.id, name: g.name, name_zh: g.name_zh, description: g.description, created_at: g.created_at }));
}
return jsonResponse(out);
}
if (path === "/api/backup" && method === "GET") return jsonResponse(await executeTool("backup_export", {}, env));
if (path === "/api/stats" && method === "GET") return jsonResponse(await executeTool("stats", {}, env));

const playMatch = path.match(/^\/play\/([^\/]+)$/);
if (playMatch && method === "GET") {
if (!env.ADMIN_KEY || url.searchParams.get("key") !== env.ADMIN_KEY) {
return new Response("Unauthorized", { status: 401 });
}
const g = await kvGet(env, `game:${playMatch[1]}`);
if (!g || !g.html) return new Response("Game not found", { status: 404 });
return new Response(g.html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

if (method !== "GET" && !checkAuth(request, env)) return jsonResponse({ error: "Unauthorized" }, 401);

async function restPut(prefix, id, body, allowedFields) {
const existing = await kvGet(env, prefix + id);
if (!existing) return jsonResponse({ error: "Not found" }, 404);
allowedFields.forEach(k => {
if (body[k] !== undefined) existing[k] = body[k];
});
if (body.tags !== undefined && allowedFields.indexOf("tags") >= 0) {
existing.tags = Array.isArray(body.tags) ? body.tags
: (typeof body.tags === 'string' ? body.tags.split(",").map(t => t.trim()).filter(Boolean) : []);
}
if (body.date !== undefined && typeof body.date === "string" && body.date.length === 10) {
existing.created_at = new Date(body.date + "T12:00:00Z").toISOString();
}
existing.updated_at = now();
await kvPut(env, prefix + id, existing);
return jsonResponse({ success: true, item: existing });
}

async function restDelete(prefix, id) {
const existing = await kvGet(env, prefix + id);
if (!existing) return jsonResponse({ error: "Not found" }, 404);
if (existing.locked) return jsonResponse({ error: "条目已锁定，请先在编辑页解锁后再删除" }, 423);
await kvDelete(env, prefix + id);
return jsonResponse({ success: true });
}

// 记忆
const memMatch = path.match(/^\/api\/memory\/(.+)$/);
if (memMatch) {
const id = memMatch[1];
if (method === "GET") return jsonResponse(await executeTool("memory_get", { id }, env));
if (method === "PUT") {
const body = await request.json();
return memoryRestPut(env, id, body);
}
if (method === "DELETE") return restDelete("mem:", id);
}
if (path === "/api/memory" && method === "POST") {
const body = await request.json();
return jsonResponse(await executeTool("memory_save", body, env));
}

// 日记 / 故事（前端按 author 区分）
const diaryMatch = path.match(/^\/api\/diary\/(.+)$/);
if (diaryMatch) {
const id = diaryMatch[1];
if (method === "GET") return jsonResponse(await executeTool("diary_get", { id }, env));
if (method === "DELETE") return restDelete("diary:", id);
if (method === "PUT") {
const body = await request.json();
return restPut("diary:", id, body, ["content","title","author","author_label","diary_date","locked"]);
}
}
if (path === "/api/diary" && method === "POST") {
const body = await request.json();
return jsonResponse(await executeTool("diary_write", body, env));
}

// 灵感
const ideaMatch = path.match(/^\/api\/idea\/(.+)$/);
if (ideaMatch) {
const id = ideaMatch[1];
if (method === "GET") return jsonResponse(await executeTool("idea_get", { id }, env));
if (method === "PUT") {
const body = await request.json();
return restPut("idea:", id, body, ["content","tags","locked"]);
}
if (method === "DELETE") return restDelete("idea:", id);
}
if (path === "/api/idea" && method === "POST") {
const body = await request.json();
return jsonResponse(await executeTool("idea_save", body, env));
}

// 游戏
const gameMatch = path.match(/^\/api\/game\/(.+)$/);
if (gameMatch) {
const id = gameMatch[1];
if (method === "GET") return jsonResponse(await executeTool("game_get", { id }, env));
if (method === "DELETE") return jsonResponse(await executeTool("game_delete", { id }, env));
}
if (path === "/api/game" && method === "POST") {
const body = await request.json();
return jsonResponse(await executeTool("game_save", body, env));
}

// 瞬记
const momMatch = path.match(/^\/api\/moment\/(.+)$/);
if (momMatch) {
const id = momMatch[1];
if (method === "DELETE") return restDelete("mom:", id);
if (method === "PUT") {
const body = await request.json();
return restPut("mom:", id, body, ["content","tags","locked"]);
}
}
if (path === "/api/moment" && method === "POST") {
const body = await request.json();
return jsonResponse(await executeTool("moment_save", body, env));
}

// 留言
const msgMatch = path.match(/^\/api\/message\/(.+)$/);
if (msgMatch) {
const id = msgMatch[1];
if (method === "DELETE") return restDelete("msg:", id);
if (method === "PUT") {
const body = await request.json();
return restPut("msg:", id, body, ["content","from","to","locked"]);
}
}
if (path === "/api/message" && method === "POST") {
const body = await request.json();
return jsonResponse(await executeTool("message_leave", body, env));
}

// ─── 动态流（二期 2-1）：留言板「动态」───
// GET 游标分页 / POST 新建 / PUT 编辑（仅 manual）/ DELETE 删除 / like 切换 / comment 增删
if (path === "/api/feed" && method === "GET") {
const before = url.searchParams.get("before") || null;
const limit = parseInt(url.searchParams.get("limit") || "20", 10);
const { items, nextBefore } = await listFeed(env, { before, limit });
// 惰性触发（教程第五章）：这一页里有到期待反应就顺手后台处理——响应不等它，她下次刷到就有了
const nowIso = now();
const hasDue = items.some(f =>
(f.reaction?.status === "pending" && f.reaction.due_at <= nowIso) ||
(f.comments || []).some(c => c?.author === "yomi" && c.reply?.status === "pending" && c.reply.due_at <= nowIso));
if (hasDue && ctx) ctx.waitUntil(processFeedReactions(env).catch(() => {}));
return jsonResponse({ items: items.map(f => feedItemPublic(f)), next_before: nextBefore, server_time: now() });
}
if (path === "/api/feed" && method === "POST") {
const body = await request.json();
const hasImgs = Array.isArray(body.images) && body.images.length > 0;
if ((!body.content || !String(body.content).trim()) && !hasImgs) return jsonResponse({ error: "content 不能为空" }, 400);
let images = null;
try { images = await storeFeedImages(env, body.images); }
catch (e) { return jsonResponse({ error: String(e?.message || e) }, 400); }
const item = await createFeedPost(env, {
author: body.author, source: body.source, content: String(body.content || "").trim(),
images,
// due_in_min 仅测试用：正常发布不传，走 10-20 分钟随机
dueInMin: typeof body.due_in_min === "number" ? body.due_in_min : null,
});
return jsonResponse({ success: true, item: feedItemPublic(item) });
}
const feedCmtMatch = path.match(/^\/api\/feed\/([^\/]+)\/comment(?:\/([^\/]+))?$/);
if (feedCmtMatch) {
const item = await kvGet(env, `feed:${feedCmtMatch[1]}`);
if (!item) return jsonResponse({ error: "Not found" }, 404);
if (method === "POST" && !feedCmtMatch[2]) {
const body = await request.json();
if (!body.content || !String(body.content).trim()) return jsonResponse({ error: "content 不能为空" }, 400);
const c = { id: generateId(), author: body.author === "emet" ? "emet" : "yomi", content: String(body.content).trim(), created_at: now() };
// 静怡的评论挂「Emet 待回复」（3-8 分钟随机，评论是对话节奏、比初反应快）；
// 动态本身还没被他路过时不挂——初反应会把已有评论一并照应，免得回两遍
if (c.author === "yomi" && item.reaction?.status !== "pending") {
const mins = typeof body.due_in_min === "number" && body.due_in_min >= 0 ? body.due_in_min : randDelayMin(3, 8);
c.reply = { status: "pending", due_at: new Date(Date.now() + mins * 60 * 1000).toISOString() };
}
item.comments = [...(item.comments || []), c];
item.updated_at = now();
await kvPut(env, `feed:${item.id}`, item);
return jsonResponse({ success: true, item: feedItemPublic(item) });
}
if (method === "DELETE" && feedCmtMatch[2]) {
item.comments = (item.comments || []).filter(c => c.id !== feedCmtMatch[2]);
item.updated_at = now();
await kvPut(env, `feed:${item.id}`, item);
return jsonResponse({ success: true, item: feedItemPublic(item) });
}
}
const feedLikeMatch = path.match(/^\/api\/feed\/([^\/]+)\/like$/);
if (feedLikeMatch && method === "POST") {
const item = await kvGet(env, `feed:${feedLikeMatch[1]}`);
if (!item) return jsonResponse({ error: "Not found" }, 404);
const body = await request.json();
const who = body.who === "emet" ? "emet" : "yomi";
item.likes = item.likes || { yomi: false, emet: false };
item.likes[who] = !item.likes[who];
item.updated_at = now();
await kvPut(env, `feed:${item.id}`, item);
return jsonResponse({ success: true, item: feedItemPublic(item) });
}
const feedMatch = path.match(/^\/api\/feed\/([^\/]+)$/);
if (feedMatch) {
const id = feedMatch[1];
if (method === "PUT") {
const item = await kvGet(env, `feed:${id}`);
if (!item) return jsonResponse({ error: "Not found" }, 404);
if (item.source !== "manual") return jsonResponse({ error: "AI 自动产出的动态只读" }, 403);
const body = await request.json();
if (body.content !== undefined) item.content = String(body.content);
item.updated_at = now();
await kvPut(env, `feed:${id}`, item);
return jsonResponse({ success: true, item: feedItemPublic(item) });
}
if (method === "DELETE") {
const item = await kvGet(env, `feed:${id}`);
// 删动态连带删它的图（没图或读失败都不阻塞删除本体）
if (item && Array.isArray(item.images)) {
for (const imgId of item.images) { try { await kvDelete(env, `feedimg:${imgId}`); } catch { /* 尽力而为 */ } }
}
await kvDelete(env, `feed:${id}`);
return jsonResponse({ success: true });
}
}

// 独处手账（2-2）：idle:log:<ISO时间> 按 key 倒序 + before 游标分页；KV list 带 cursor 循环防 1000 上限
if (path === "/api/idle/log" && method === "GET") {
const before = url.searchParams.get("before") || null;
const limit = Math.min(parseInt(url.searchParams.get("limit") || "30", 10) || 30, 100);
let names = [], cursor = null;
do {
const l = await env.MEMORY.list({ prefix: "idle:log:", cursor });
names.push(...l.keys.map(k => k.name));
cursor = l.list_complete ? null : l.cursor;
} while (cursor);
names.sort((a, b) => b.localeCompare(a));
if (before) names = names.filter(k => k < `idle:log:${before}`);
const page = names.slice(0, limit);
const entries = [];
for (const k of page) {
const raw = await env.MEMORY.get(k);
if (raw) { try { entries.push(JSON.parse(raw)); } catch { /* 坏行跳过 */ } }
}
const nextBefore = names.length > limit && entries.length ? entries[entries.length - 1].ts : null;
return jsonResponse({ entries, next_before: nextBefore });
}

// ─── 今日小票（4-1）：GET 某天 / POST 加条目 / DELETE 删条目 ───
if (path === "/api/receipt" && method === "GET") {
const day = receiptDayCN(url.searchParams.get("date"));
const rec = (await kvGet(env, `receipt:${day}`)) || { day, items: [] };
return jsonResponse({ day, items: rec.items || [] });
}
if (path === "/api/receipt" && method === "POST") {
const body = await request.json();
if (!body.text || !String(body.text).trim()) return jsonResponse({ error: "text 不能为空" }, 400);
const { day, item } = await addReceiptItem(env, { text: String(body.text).trim(), added_by: body.added_by, date: body.date });
return jsonResponse({ success: true, day, item });
}
const receiptDelMatch = path.match(/^\/api\/receipt\/([^\/]+)\/([^\/]+)$/);
if (receiptDelMatch && method === "DELETE") {
const [, day, itemId] = receiptDelMatch;
const rec = await kvGet(env, `receipt:${day}`);
if (!rec) return jsonResponse({ error: "Not found" }, 404);
rec.items = (rec.items || []).filter(i => i.id !== itemId);
await kvPut(env, `receipt:${day}`, rec);
return jsonResponse({ success: true, items: rec.items });
}

// ─── 经期月历（4-2）：GET 全部记录+统计 / POST 增改（含回溯补记）/ DELETE 删 ───
// 统计只在后端一份（computePeriodStats），前端和 period_status 工具共用
if (path === "/api/period" && method === "GET") {
const logs = await kvListByPrefix(env, "period:");
logs.sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
return jsonResponse({ logs, stats: computePeriodStats(logs) });
}
if (path === "/api/period" && method === "POST") {
const body = await request.json();
if (!body.start_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.start_date)) return jsonResponse({ error: "start_date 必须是 YYYY-MM-DD" }, 400);
if (body.end_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.end_date)) return jsonResponse({ error: "end_date 格式错误" }, 400);
const key = `period:${body.start_date}`;
const existing = await kvGet(env, key);
const rec = {
start_date: body.start_date,
end_date: body.end_date || null,
note: typeof body.note === "string" ? body.note.slice(0, 200) : (existing?.note || ""),
created_at: existing?.created_at || now(),
updated_at: now(),
};
await kvPut(env, key, rec);
return jsonResponse({ success: true, item: rec });
}
const periodDelMatch = path.match(/^\/api\/period\/([^\/]+)$/);
if (periodDelMatch && method === "DELETE") {
await kvDelete(env, `period:${periodDelMatch[1]}`);
return jsonResponse({ success: true });
}

// ─── 共读书架（三期）───
// 书列表 / 建书 / 删书
if (path === "/api/books" && method === "GET") {
const books = await kvListByPrefix(env, "book:");
const out = [];
for (const b of books.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))) {
const mark = await kvGet(env, `bookmark:${b.id}`);
out.push({ ...b, bookmark: mark || null });
}
return jsonResponse({ books: out });
}
if (path === "/api/books" && method === "POST") {
const body = await request.json();
if (!body.title || !String(body.title).trim()) return jsonResponse({ error: "title 不能为空" }, 400);
const id = generateId();
const meta = { id, title: String(body.title).trim().slice(0, 200), author: String(body.author || "").slice(0, 100), chapter_count: 0, created_at: now() };
await kvPut(env, `book:${id}`, meta);
return jsonResponse({ success: true, book: meta });
}
const bookIdMatch = path.match(/^\/api\/books\/([^\/]+)$/);
if (bookIdMatch && method === "DELETE") {
await deleteBook(env, bookIdMatch[1]);
return jsonResponse({ success: true });
}
// 书详情（元数据 + 章节标题列表，不含正文）
const bookMetaMatch = path.match(/^\/api\/books\/([^\/]+)\/meta$/);
if (bookMetaMatch && method === "GET") {
const id = bookMetaMatch[1];
const meta = await bookMeta(env, id);
if (!meta) return jsonResponse({ error: "Not found" }, 404);
const chapters = [];
for (let i = 0; i < (meta.chapter_count || 0); i++) {
const c = await bookChapter(env, id, i);
chapters.push({ idx: i, title: c?.title || `第 ${i + 1} 章` });
}
const mark = await kvGet(env, `bookmark:${id}`);
return jsonResponse({ book: meta, chapters, bookmark: mark || null });
}
// 逐章上传（分章 POST，避免整本超 Worker 请求体 / KV 单值上限）
const bookChapMatch = path.match(/^\/api\/books\/([^\/]+)\/chapter(?:\/(\d+))?$/);
if (bookChapMatch && method === "POST") {
const id = bookChapMatch[1];
const meta = await bookMeta(env, id);
if (!meta) return jsonResponse({ error: "Not found" }, 404);
const body = await request.json();
const idx = Number.isInteger(body.idx) ? body.idx : (meta.chapter_count || 0);
await kvPut(env, `bookchap:${id}:${idx}`, { idx, title: String(body.title || `第 ${idx + 1} 章`).slice(0, 200), text: String(body.text || "") });
if (idx + 1 > (meta.chapter_count || 0)) { meta.chapter_count = idx + 1; await kvPut(env, `book:${id}`, meta); }
return jsonResponse({ success: true, idx });
}
if (bookChapMatch && bookChapMatch[2] && method === "GET") {
const chap = await bookChapter(env, bookChapMatch[1], Number(bookChapMatch[2]));
if (!chap) return jsonResponse({ error: "Not found" }, 404);
return jsonResponse({ chapter: chap });
}
// 批注：列表 / 新增 / 删除
const bookAnnoMatch = path.match(/^\/api\/books\/([^\/]+)\/annotations(?:\/([^\/]+))?$/);
if (bookAnnoMatch) {
const id = bookAnnoMatch[1];
if (method === "GET") {
const store = await bookAnnos(env, id);
return jsonResponse({ annotations: store.annotations || [] });
}
if (method === "POST" && !bookAnnoMatch[2]) {
const body = await request.json();
if (!(await bookMeta(env, id))) return jsonResponse({ error: "Not found" }, 404);
const anno = await addBookAnnotation(env, {
book_id: id, chapter_idx: body.chapter_idx, quote: body.quote, note: body.note,
author: body.author, color: body.color, start: body.start, end: body.end,
});
return jsonResponse({ success: true, annotation: anno });
}
if (method === "DELETE" && bookAnnoMatch[2]) {
const store = await bookAnnos(env, id);
store.annotations = (store.annotations || []).filter(a => a.id !== bookAnnoMatch[2]);
await kvPut(env, `bookanno:${id}`, store);
return jsonResponse({ success: true });
}
}
// 共享书签
const bookmarkMatch = path.match(/^\/api\/books\/([^\/]+)\/bookmark$/);
if (bookmarkMatch) {
const id = bookmarkMatch[1];
if (method === "GET") return jsonResponse({ bookmark: (await kvGet(env, `bookmark:${id}`)) || null });
if (method === "PUT") {
const body = await request.json();
const mark = { chapter_idx: Number(body.chapter_idx) || 0, offset: Number(body.offset) || 0, updated_at: now() };
await kvPut(env, `bookmark:${id}`, mark);
return jsonResponse({ success: true, bookmark: mark });
}
}

// 心情日历：GET 查范围，POST 记一笔（静怡走前端 who=yomi，Emet 走 MCP who=emet）
if (path === "/api/mood") {
if (method === "GET") {
const start = url.searchParams.get("start") || undefined;
const end = url.searchParams.get("end") || undefined;
return jsonResponse(await executeTool("mood_list", { start, end }, env));
}
if (method === "POST") {
const body = await request.json();
return jsonResponse(await executeTool("mood_set", body, env));
}
}

// 喝水/运动：轻量日计数，直接 KV 存取（不走 MCP tool）
// GET /api/water?date=YYYY-MM-DD  → { date, count }
// POST /api/water { date, count } → { success, date, count }
if (path === "/api/water") {
if (method === "GET") {
const date = url.searchParams.get("date");
if (!date) return jsonResponse({ error: "date required" }, 400);
const val = await kvGet(env, `water:${date}`);
return jsonResponse(val || { date, count: 0 });
}
if (method === "POST") {
const body = await request.json();
if (!body.date) return jsonResponse({ error: "date required" }, 400);
const rec = { date: body.date, count: Number(body.count) || 0, updated_at: now() };
await kvPut(env, `water:${body.date}`, rec);
return jsonResponse({ success: true, ...rec });
}
}
// GET /api/exercise?date=YYYY-MM-DD  → { date, minutes }
// POST /api/exercise { date, minutes } → { success, date, minutes }
if (path === "/api/exercise") {
if (method === "GET") {
const date = url.searchParams.get("date");
if (!date) return jsonResponse({ error: "date required" }, 400);
const val = await kvGet(env, `exercise:${date}`);
return jsonResponse(val || { date, minutes: 0 });
}
if (method === "POST") {
const body = await request.json();
if (!body.date) return jsonResponse({ error: "date required" }, 400);
const rec = { date: body.date, minutes: Number(body.minutes) || 0, updated_at: now() };
await kvPut(env, `exercise:${body.date}`, rec);
return jsonResponse({ success: true, ...rec });
}
}

// 情绪：当下感受，一天可多条带时间（区别于 mood 每天一条整体心情）。
// 存 emotion:<date> = { entries: [{id, who, date, ts, level, valence, note}] }
// GET /api/emotion?start&end → { emotions: [...] }（按 ts 倒序）
// POST /api/emotion { level(1-7), note, date, who } → { success, entry }
if (path === "/api/emotion") {
if (method === "GET") {
// 无范围时给个宽默认（当月起点由前端传；这里兜底近 90 天），别落进 emotion_list 的 7 天默认
const start = url.searchParams.get("start") || new Date(cnNow().getTime() - 90 * 86400000).toISOString().slice(0, 10);
const end = url.searchParams.get("end") || undefined;
return jsonResponse(await executeTool("emotion_list", { start, end }, env));
}
if (method === "POST") {
const body = await request.json();
// 前端默认 who=yomi（executeTool 里默认 emet 是 MCP 视角），显式传
const who = body.who === "emet" ? "emet" : "yomi";
const r = await executeTool("emotion_add", { ...body, who }, env);
return jsonResponse(r, r?.error ? 400 : 200);
}
if (method === "DELETE") {
const id = url.searchParams.get("id");
const date = url.searchParams.get("date");
if (!id || !date) return jsonResponse({ error: "id/date required" }, 400);
const key = `emotion:${date}`;
const rec = await kvGet(env, key);
if (rec && Array.isArray(rec.entries)) {
  rec.entries = rec.entries.filter(e => e.id !== id);
  await kvPut(env, key, rec);
}
return jsonResponse({ success: true });
}
}

// 跨模块搬移（前端三点菜单"移动到…"用）
if (path === "/api/move" && method === "POST") {
const body = await request.json();
const result = await executeTool("move_item", body, env);
return jsonResponse(result);
}

// 织藤：星图上长按连接两条记忆
if (path === "/api/link" && method === "POST") {
const body = await request.json();
const result = await executeTool("memory_link", body, env);
return jsonResponse(result);
}

// 拆藤：星图上点连线解除关联
if (path === "/api/unlink" && method === "POST") {
const body = await request.json();
const result = await executeTool("memory_unlink", body, env);
return jsonResponse(result);
}

// ─── 会话云同步（chat: 前缀，与记忆数据隔离）───
if (path === "/api/chat" && method === "GET") {
  const since = url.searchParams.get("since");
  let sessions = await kvListByPrefix(env, "chat:");
  if (since) sessions = sessions.filter((s) => (s.updated_at || "") > since);
  return jsonResponse({ sessions, server_time: now() });
}
// 批量对账（必须在 :id 正则之前，否则 "sync" 会被当成会话 id）
if (path === "/api/chat/sync" && method === "POST") {
  const body = await request.json();
  const incoming = Array.isArray(body.sessions) ? body.sessions : [];
  for (const s of incoming) {
    if (!s || !s.id) continue;
    const existing = await kvGet(env, "chat:" + s.id);
    await kvPut(env, "chat:" + s.id, mergeSession(existing, s));
    await mem2MarkDirty(env, s.id); // L0 装订工增量信号
  }
  const all = await kvListByPrefix(env, "chat:");
  return jsonResponse({ sessions: all, server_time: now() });
}
const chatMatch = path.match(/^\/api\/chat\/(.+)$/);
if (chatMatch && method === "PUT") {
  const id = chatMatch[1];
  const body = await request.json();
  const existing = await kvGet(env, "chat:" + id);
  const merged = mergeSession(existing, { ...body, id });
  await kvPut(env, "chat:" + id, merged);
  await mem2MarkDirty(env, id); // L0 装订工增量信号
  return jsonResponse({ success: true, item: merged });
}
if (chatMatch && method === "DELETE") {
  const id = chatMatch[1];
  const existing = await kvGet(env, "chat:" + id);
  const tomb = { ...(existing || { id }), id, deleted: true, updated_at: now() };
  await kvPut(env, "chat:" + id, tomb);
  await mem2MarkDirty(env, id); // 删除也打脏：装订工会顺带清掉它的存档
  return jsonResponse({ success: true });
}

// ─── 设置云同步（settings:global 一个键，与其他数据隔离）───
if (path === "/api/settings" && method === "GET") {
  const s = await kvGet(env, "settings:global");
  return jsonResponse({ settings: s || null, server_time: now() });
}
if (path === "/api/settings" && method === "PUT") {
  const body = await request.json();
  const existing = await kvGet(env, "settings:global");
  // 整块 last-write-wins：updated_at 不旧于服务端才覆盖（防旧设备覆盖新设置）
  if (!existing || (body.updated_at || "") >= (existing.updated_at || "")) {
    await kvPut(env, "settings:global", body);
    return jsonResponse({ success: true, item: body });
  }
  return jsonResponse({ success: true, item: existing }); // 服务端更新，回服务端版本
}

// ─── Archive 对话档案云端持久化（archive:data 单 blob 打包存取）───
// 哑存储：整包存、整包取。增量合并与版本时间由前端外层同步层负责。
if (path === "/api/archive" && method === "GET") {
  const archive = await kvGet(env, "archive:data");
  return jsonResponse({ archive: archive || null, server_time: now() });
}
if (path === "/api/archive" && method === "PUT") {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid json" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ error: "archive must be an object" }, 400);
  }
  // updated_at 兜底：前端通常带版本时间，没带就用服务端时间
  const blob = { ...body, updated_at: body.updated_at || now() };
  await kvPut(env, "archive:data", blob);
  await mem2MarkOfficialDirty(env, blob); // 官方档案变更 → 打 offdirty 信号，装订工按拍消化
  return jsonResponse({ success: true, updated_at: blob.updated_at });
}

// 信件（KV 还是 handoff:，但有 kind 字段区分 handoff / daily）
const hoMatch = path.match(/^\/api\/handoff\/(.+)$/);
if (hoMatch) {
const id = hoMatch[1];
if (method === "DELETE") return restDelete("handoff:", id);
if (method === "PUT") {
const body = await request.json();
return restPut("handoff:", id, body, ["content","window_from","window_to","kind","title","locked"]);
}
}
// 新建信件（前端 FAB 在信件 tab 用）
if (path === "/api/letter" && method === "POST") {
const body = await request.json();
const id = generateId();
const item = {
id, type: "handoff",
content: body.content || "",
title: body.title || "",
kind: body.kind || "daily",
window_from: body.window_from || "",
window_to: body.window_to || "",
locked: false,
created_at: now(), updated_at: now()
};
await kvPut(env, `handoff:${id}`, item);
return jsonResponse({ success: true, id });
}

return jsonResponse({ error: "Not found" }, 404);
}

// ─── 前端 HTML ───
function renderFrontend() {
return FRONTEND_HTML;
}

// 前端 HTML 字符串单独定义在最底下，避免 template literal 中的转义混乱
const FRONTEND_HTML = `<!DOCTYPE html>

<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>Emet Memory · v6.8.2</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Noto+Serif+SC:wght@300;400;500;600&family=Noto+Sans+SC:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600&display=swap" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Noto+Serif+SC:wght@300;400;500;600&family=Noto+Sans+SC:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600&display=swap"></noscript>
<style>
:root, [data-theme="paper"], .theme-paper {
  --bg: #F9F9F7; --bg-soft: #F2F2EF; --card: #FFFFFF; --card-soft: #EFEFED;
  --ink: #2A2724; --ink-soft: #6B655E; --ink-faint: #A8A39B; --line: #E8E5DF;
  --accent: #C6613F; --rose: #F2DAD4;
  --note-1: #FBF6E8; --note-2: #F4ECDD; --note-3: #F8E4D6; --note-4: #EDE8DA;
  --del: #D85040; --pin: #D4A85E; --lock: #6B655E;
  --moment-glow: rgba(198, 97, 63, 0.07);
  --shadow-sm: 0 1px 2px rgba(42,39,36,.04), 0 8px 24px rgba(42,39,36,.04);
  --shadow-md: 0 1px 2px rgba(42,39,36,.06), 0 12px 32px rgba(42,39,36,.06);
  --shadow-pop: 0 4px 32px rgba(42,39,36,.18);
}
[data-theme="night"], .theme-night {
  --bg: #000000; --bg-soft: #000000; --card: #000000; --card-soft: #060606;
  --ink: #E8E5DE; --ink-soft: #948F84; --ink-faint: #4A4640; --line: #232220;
  --accent: #D87E5C; --rose: #2A1614;
  --note-1: #060604; --note-2: #050503; --note-3: #060503; --note-4: #050504;
  --del: #B83B30; --pin: #B0884A; --lock: #948F84;
  --moment-glow: rgba(216, 126, 92, 0.10);
  --shadow-sm: 0 0 0 1px #1F1E1C;
  --shadow-md: 0 0 0 1px #2A2926, 0 4px 20px rgba(0,0,0,.5);
  --shadow-pop: 0 0 0 1px #2A2926, 0 8px 40px rgba(0,0,0,.7);
}
:root {
  --serif-en: 'Cormorant Garamond', serif;
  --serif-zh: 'Noto Serif SC', 'PingFang SC', serif;
  --sans-zh: 'PingFang SC', 'Noto Sans SC', -apple-system, sans-serif;
  --sans-en: 'Inter', -apple-system, sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow-x: hidden; }
html { background: var(--bg); }
body {
  font-family: var(--sans-zh); background: var(--bg); color: var(--ink);
  line-height: 1.85; font-weight: 300; font-size: 15px;
  -webkit-font-smoothing: antialiased;
  transition: background .4s, color .4s;
}

/* ===== Splash ===== */
.splash {
position: fixed; inset: 0; background: var(--bg);
display: flex; flex-direction: column; align-items: center; justify-content: center;
z-index: 9999; transition: opacity .8s, visibility .8s;
}
.splash.gone { opacity: 0; visibility: hidden; }
.splash-title {
font-family: var(--serif-en); font-size: 22px; font-weight: 500;
letter-spacing: 0.5em; color: var(--ink); padding-left: 0.5em;
opacity: 0; animation: rise 1.2s .2s forwards;
}
.splash-line { width: 0; height: 1px; background: var(--accent); margin: 24px 0; animation: grow 1s .9s forwards; }
.splash-quote {
font-family: var(--serif-en); font-style: italic; font-size: 13px;
color: var(--ink-soft); letter-spacing: 0.05em;
opacity: 0; animation: rise 1s 1.4s forwards;
}
@keyframes rise { from {opacity:0; transform:translateY(8px);} to {opacity:1; transform:none;} }
@keyframes grow { from {width:0;} to {width:80px;} }

/* ===== Gate ===== */
.gate {
position: fixed; inset: 0; background: var(--bg);
display: none; flex-direction: column; align-items: center; justify-content: center;
z-index: 9000; padding: 20px; opacity: 0; transition: opacity .5s;
}
.gate.show { display: flex; }
.gate.show.in { opacity: 1; }
.gate.gone { opacity: 0; pointer-events: none; }
.gate-title {
font-family: var(--serif-en); font-size: 22px; font-weight: 500;
letter-spacing: 0.4em; padding-left: 0.4em; margin-bottom: 8px;
}
.gate-line { width: 28px; height: 1px; background: var(--accent); opacity: 0.6; margin: 12px 0 32px; }
.gate-input {
width: 220px; background: var(--card);
border: 1px solid var(--line); border-radius: 14px;
padding: 14px 18px; font-family: var(--sans-en); font-size: 20px;
color: var(--ink); outline: none; text-align: center;
letter-spacing: 0.5em; box-shadow: var(--shadow-sm);
}
.gate-input:focus { border-color: var(--accent); }
.gate-btn {
margin-top: 14px; padding: 10px 28px;
background: var(--accent); color: #fff;
border: none; border-radius: 22px;
font-family: var(--sans-zh); font-size: 14px;
letter-spacing: 0.15em; cursor: pointer;
}
.gate-btn:active { transform: scale(.96); }
.gate-hint {
font-family: var(--serif-en); font-style: italic; font-size: 12px;
color: var(--ink-faint); letter-spacing: 0.05em; margin-top: 16px;
}
.gate-error {
font-family: var(--sans-zh); font-size: 12px;
color: var(--del); margin-top: 12px; opacity: 0; transition: opacity .2s;
}
.gate-error.show { opacity: 1; }

/* ===== Topbar ===== */
.topbar {
position: fixed; top: 0; left: 0; right: 0;
display: flex; justify-content: flex-end; align-items: center;
padding: 14px 18px; z-index: 50; pointer-events: none; gap: 4px;
background: var(--bg);
}
.topbar > * { pointer-events: auto; }
.icon-btn {
width: 32px; height: 32px;
display: flex; align-items: center; justify-content: center;
cursor: pointer; color: var(--ink-soft);
border-radius: 50%; background: transparent;
transition: color .2s, transform .2s;
}
.icon-btn:active { transform: scale(.92); }
.icon-btn svg { width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 1.6; }

/* ===== Pull-to-refresh ===== */
.ptr {
position: absolute; top: 0; left: 0; right: 0;
height: 0; display: flex; align-items: flex-end; justify-content: center;
overflow: hidden; pointer-events: none;
transition: height .25s ease;
}
.ptr-inner {
padding-bottom: 12px;
font-family: var(--serif-en); font-style: italic; font-size: 12px;
color: var(--ink-faint); letter-spacing: 0.08em;
display: flex; align-items: center; gap: 8px;
}
.ptr-arrow {
width: 14px; height: 14px;
border: 1.5px solid currentColor; border-radius: 50%;
border-top-color: transparent; border-right-color: transparent;
transform: rotate(45deg); transition: transform .2s;
}
.ptr.ready .ptr-arrow { transform: rotate(225deg); }
.ptr.loading .ptr-arrow { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ===== Page ===== */
.page {
max-width: 680px; margin: 0 auto; padding: 56px 22px 80px;
position: relative;
}
.header { text-align: center; margin-bottom: 28px; }
.title {
font-family: var(--serif-en); font-size: 26px; font-weight: 500;
letter-spacing: 0.4em; padding-left: 0.4em; color: var(--ink);
}
.title-line { width: 32px; height: 1px; background: var(--accent); margin: 12px auto; opacity: .6; }
.subtitle {
font-family: var(--serif-en); font-style: italic; font-size: 12px;
color: var(--ink-soft); letter-spacing: 0.06em;
}
.stats {
display: flex; justify-content: center; gap: 14px; margin: 16px 0 0;
font-family: var(--sans-en); font-size: 11px; color: var(--ink-faint);
letter-spacing: 0.06em; flex-wrap: wrap;
}
.stats .dot { width: 3px; height: 3px; border-radius: 50%; background: var(--ink-faint); align-self: center; opacity: .5; }

/* ===== Tabs ===== */
.tabs {
display: flex; justify-content: center; gap: 22px;
border-bottom: 1px solid var(--line); margin: 28px 0 16px; padding-bottom: 2px;
overflow-x: auto; scrollbar-width: none;
}
.tabs::-webkit-scrollbar { display: none; }
.tab {
background: none; border: none; padding: 10px 4px;
font-family: var(--sans-zh); font-size: 14px; font-weight: 400;
color: var(--ink-faint); cursor: pointer; letter-spacing: 0.12em;
position: relative; transition: color .3s; white-space: nowrap;
}
.tab::after {
content: ''; position: absolute; left: 0; right: 0; bottom: -3px;
height: 1px; background: var(--ink); transform: scaleX(0);
transition: transform .35s;
}
.tab.active { color: var(--ink); }
.tab.active::after { transform: scaleX(1); }

/* ===== Search ===== */
.console { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.search-box {
flex: 1; display: flex; align-items: center;
background: var(--card); border-radius: 22px;
padding: 9px 14px; box-shadow: var(--shadow-sm);
}
.search-box svg { width: 14px; height: 14px; stroke: var(--ink-faint); fill: none; stroke-width: 1.8; flex-shrink: 0; }
.search-box input {
flex: 1; background: transparent; border: none; outline: none;
font-family: var(--sans-zh); font-size: 14px; color: var(--ink); margin-left: 8px;
}
.search-box input::placeholder { color: var(--ink-faint); }

.tab-content { display: none; }
.tab-content.active { display: block; }

.sub-filter, .sub-tabs {
display: flex; gap: 14px; margin-bottom: 18px; justify-content: center;
font-family: var(--sans-zh); font-size: 14px; color: var(--ink-faint);
letter-spacing: 0.05em; flex-wrap: wrap;
}
.sub-filter .item, .sub-tab { cursor: pointer; padding-bottom: 4px; border-bottom: 1px solid transparent; }
.sub-filter .item.active, .sub-tab.active { color: var(--ink); border-bottom-color: var(--accent); }
.sub-filter .count {
font-family: var(--sans-en); font-size: 10px;
color: var(--ink-faint); margin-left: 1px;
font-style: normal; letter-spacing: 0;
vertical-align: 1px;
}
.sub-filter .item.active .count { color: var(--accent); }

/* Big tag entry card */
.big-tag-entry {
margin: 6px 20px 16px;
padding: 14px 16px;
background: linear-gradient(135deg, var(--rose), var(--card));
border-radius: 14px;
display: flex; align-items: center; justify-content: space-between;
cursor: pointer;
box-shadow: var(--shadow-sm);
transition: transform .15s;
}
.big-tag-entry:active { transform: scale(.98); }
.bte-left { display: flex; align-items: center; gap: 14px; }
.bte-hash {
font-family: var(--serif-en); font-size: 32px; font-weight: 500;
color: var(--accent); line-height: 1;
}
.bte-text { display: flex; flex-direction: column; gap: 2px; }
.bte-title {
font-family: var(--serif-zh); font-size: 16px; font-weight: 500;
color: var(--ink);
}
.bte-sub {
font-family: var(--sans-zh); font-size: 11px; color: var(--ink-faint);
}
.bte-arrow {
font-family: var(--serif-en); font-size: 20px; color: var(--ink-faint);
}

/* Time filter row */
.time-filter {
display: flex; gap: 6px; padding: 0 20px; margin-bottom: 16px;
}
.time-filter .item {
font-family: var(--sans-zh); font-size: 12px; color: var(--ink-faint);
padding: 4px 12px; border-radius: 20px; cursor: pointer;
background: transparent; border: 1px solid var(--line);
transition: all .2s;
}
.time-filter .item.active { color: var(--accent); border-color: var(--accent); background: var(--rose); }

/* Tag filter bar */
.tag-filter {
padding: 8px 20px 12px; margin-bottom: 4px;
background: var(--rose); border-radius: 0 0 12px 12px;
}
.tag-filter .active-tag {
font-family: var(--sans-zh); font-size: 13px; font-weight: 500;
color: var(--accent); display: block; margin-bottom: 6px;
}
.tag-filter .tag-cloud-mini {
display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px;
}
.tag-filter .tag-cloud-mini .te-tag {
font-family: var(--sans-zh); font-size: 11px;
color: var(--ink-soft); background: var(--card);
padding: 2px 8px; border-radius: 10px; cursor: pointer;
}
.tag-filter .tag-clear {
font-family: var(--sans-zh); font-size: 11px;
color: var(--ink-faint); cursor: pointer;
display: block;
}

/* Editor meta section (category, sliders) */
.editor-meta-section {
margin: 20px 0; padding: 16px; border-radius: 10px;
background: var(--card-soft); border: 1px solid var(--line);
}
.editor-meta-row {
display: flex; align-items: center; justify-content: space-between;
margin-bottom: 12px; gap: 10px;
}
.editor-meta-row:last-child { margin-bottom: 0; }
.editor-meta-label {
font-family: var(--sans-zh); font-size: 12px; color: var(--ink-soft);
min-width: 48px; flex-shrink: 0;
}
.editor-meta-value {
font-family: var(--sans-en); font-size: 12px; color: var(--accent);
min-width: 32px; text-align: right; flex-shrink: 0;
}
.editor-meta-row select {
flex: 1; font-family: var(--sans-zh); font-size: 13px;
color: var(--ink); background: var(--bg); border: 1px solid var(--line);
border-radius: 6px; padding: 5px 8px; outline: none;
-webkit-appearance: none; appearance: none;
}
.editor-meta-row input[type="range"] {
flex: 1; height: 4px; accent-color: var(--accent);
background: var(--line); border-radius: 2px;
-webkit-appearance: none; appearance: none; outline: none;
}
.editor-meta-row input[type="range"]::-webkit-slider-thumb {
-webkit-appearance: none; width: 16px; height: 16px;
border-radius: 50%; background: var(--accent); cursor: pointer;
border: 2px solid var(--bg);
}
.editor-tags-section {
margin: 16px 0; padding: 12px 16px; border-radius: 10px;
background: var(--card-soft); border: 1px solid var(--line);
}
.editor-tags-label {
font-family: var(--sans-zh); font-size: 12px; color: var(--ink-soft); margin-bottom: 6px;
}
.editor-tags-label.clickable {
display: flex; align-items: center; justify-content: space-between;
cursor: pointer; user-select: none;
}
.editor-tags-label .etl-hint {
font-family: var(--sans-zh); font-size: 11px; color: var(--accent); font-weight: 400;
}
.editor-tags-label.clickable:active { opacity: .6; }
.editor-tags-input {
width: 100%; background: transparent; border: none; outline: none;
font-family: var(--sans-zh); font-size: 14px; color: var(--accent);
line-height: 1.8;
}
.editor-tags-input::placeholder { color: var(--ink-faint); }
.editor-tags-pills {
display: flex; flex-wrap: wrap; gap: 8px; min-height: 28px; cursor: text;
}
.editor-tags-pills .tp {
font-family: var(--sans-zh); font-size: 13px; color: var(--accent);
background: var(--rose); padding: 4px 12px; border-radius: 14px;
cursor: pointer; transition: transform .1s;
}
.editor-tags-pills .tp:active { transform: scale(.95); }
.editor-tags-pills .tp::before { content: '#'; opacity: .6; }
.editor-tags-pills .tp-add {
font-family: var(--sans-zh); font-size: 12px; color: var(--ink-faint);
padding: 4px 10px; border-radius: 14px; border: 1px dashed var(--line);
cursor: pointer;
}

/* Tag explorer */
.tag-explorer {
padding: 0 20px; margin-bottom: 16px;
}
.tag-explorer-header {
display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;
}
.tag-explorer-title {
font-family: var(--sans-zh); font-size: 12px; color: var(--ink-soft); font-weight: 500;
}
.tag-explorer-tabs { display: flex; gap: 8px; }
.te-tab {
font-family: var(--sans-zh); font-size: 11px; color: var(--ink-faint);
cursor: pointer; padding-bottom: 2px; border-bottom: 1px solid transparent;
}
.te-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.tag-explorer-cloud {
display: flex; flex-wrap: wrap; gap: 6px;
}
.tag-explorer-cloud .te-tag {
font-family: var(--sans-zh); font-size: 11px;
color: var(--ink-soft); background: var(--card-soft);
padding: 3px 10px; border-radius: 12px; cursor: pointer;
transition: all .15s;
}
.tag-explorer-cloud .te-tag:active { background: var(--rose); color: var(--accent); }
.tag-explorer-cloud .te-tag .te-count {
font-family: var(--sans-en); font-size: 10px; color: var(--ink-faint); margin-left: 3px;
}

/* Editor links section */
.editor-links-section {
margin: 16px 0; padding: 12px 16px; border-radius: 10px;
background: var(--card-soft); border: 1px solid var(--line);
}
.editor-link-add {
font-family: var(--sans-zh); font-size: 12px; color: var(--accent);
cursor: pointer; margin-top: 8px; padding: 6px 0;
}
.editor-link-item {
display: flex; align-items: center; gap: 8px;
padding: 8px 0; border-bottom: 1px solid var(--line);
}
.editor-link-item:last-child { border-bottom: none; }
.editor-link-text {
flex: 1; font-family: var(--sans-zh); font-size: 12px; color: var(--ink);
overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer;
}
.editor-link-cat {
font-family: var(--sans-zh); font-size: 10px; color: var(--ink-faint);
background: var(--bg-soft); padding: 1px 6px; border-radius: 6px;
}
.editor-link-remove {
font-size: 11px; color: var(--ink-faint); cursor: pointer;
}

/* Link picker overlay */
.link-picker {
position: fixed; inset: 0; background: var(--bg); z-index: 300;
transform: translateY(100%); transition: transform .3s cubic-bezier(0.32, 0.72, 0, 1);
overflow-y: auto;
}
.link-picker.active { transform: translateY(0); }
.link-picker-bar {
display: flex; align-items: center; gap: 10px;
padding: 14px 20px 12px;
position: sticky; top: 0; z-index: 5;
background: var(--bg); border-bottom: 1px solid var(--line);
}
.link-picker-bar input {
flex: 1; font-family: var(--sans-zh); font-size: 14px; color: var(--ink);
background: var(--card-soft); border: 1px solid var(--line);
border-radius: 8px; padding: 8px 12px; outline: none;
}
.link-picker-bar .lp-close {
font-family: var(--sans-zh); font-size: 13px; color: var(--accent);
cursor: pointer; padding: 6px 10px; border-radius: 8px;
background: var(--rose); flex-shrink: 0;
}
.link-picker-results {
padding: 8px 20px 60px;
}
.link-picker-results .lp-item {
padding: 12px 0; border-bottom: 1px solid var(--line); cursor: pointer;
}
.lp-item-text { font-family: var(--sans-zh); font-size: 13px; color: var(--ink); }
.lp-item-meta { font-family: var(--sans-zh); font-size: 11px; color: var(--ink-faint); margin-top: 2px; }

/* Tag space overlay - 小红书样式：顶部tag名+最热/最新切换，下面是包含该tag的卡片瀑布流 */
.tag-space {
position: fixed; inset: 0; background: var(--bg); z-index: 300;
transform: translateY(100%); transition: transform .3s cubic-bezier(0.32, 0.72, 0, 1);
overflow-y: auto;
}
.tag-space.active { transform: translateY(0); }
.tag-space-bar {
display: flex; align-items: center; gap: 12px;
padding: 14px 20px 12px; position: sticky; top: 0;
background: var(--bg); z-index: 5;
border-bottom: 1px solid var(--line);
}
.ts-back {
font-family: var(--serif-en); font-size: 28px; line-height: 1; color: var(--ink-soft);
cursor: pointer; padding: 0 6px; margin-left: -6px;
}
.tag-space-title {
font-family: var(--serif-zh); font-size: 20px; font-weight: 500;
color: var(--ink); flex: 1; min-width: 0;
overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tag-space-tabs { display: flex; gap: 8px; }
.ts-tab {
font-family: var(--sans-zh); font-size: 13px; color: var(--ink-faint);
cursor: pointer; padding: 4px 0; border-bottom: 1px solid transparent;
}
.ts-tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.tag-space-meta {
padding: 8px 20px 0; font-family: var(--sans-zh); font-size: 12px;
color: var(--ink-faint);
}
.tag-space-cards { padding: 12px 20px 60px; }

/* 单卡片 tag 编辑模式 */
.ts-goall {
font-family: var(--sans-zh); font-size: 13px; color: var(--accent);
cursor: pointer; margin-left: 4px;
}
.ts-goall:active { opacity: .6; }
.tag-space-card-edit { padding: 16px 20px 60px; }
.tsc-list { display: flex; flex-direction: column; }
.tsc-item {
display: flex; align-items: center; justify-content: space-between;
padding: 14px 4px; border-bottom: 1px solid var(--line);
}
.tsc-item .tsc-name {
flex: 1; font-family: var(--sans-zh); font-size: 15px;
color: var(--ink); cursor: pointer;
}
.tsc-item .tsc-name::before {
content: '#'; color: var(--accent); margin-right: 4px;
}
.tsc-item .tsc-name.editing::before { content: ''; margin-right: 0; }
.tsc-item .tsc-name.editing {
cursor: text; outline: none; border-bottom: 1px solid var(--accent);
padding-bottom: 2px;
}
.tsc-item .tsc-actions {
display: flex; gap: 12px; align-items: center;
font-family: var(--sans-zh); font-size: 12px;
}
.tsc-edit-btn {
color: var(--ink-faint); cursor: pointer;
}
.tsc-edit-btn:active { color: var(--accent); }
.tsc-del-btn {
color: var(--ink-faint); cursor: pointer; font-size: 18px;
width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
border-radius: 50%;
}
.tsc-del-btn:active { background: var(--rose); color: var(--del); }
.tsc-add-row {
display: flex; align-items: center; gap: 8px;
padding: 16px 4px 8px;
}
.tsc-add-row input {
flex: 1; font-family: var(--sans-zh); font-size: 14px; color: var(--ink);
background: var(--card-soft); border: 1px solid var(--line);
border-radius: 8px; padding: 8px 12px; outline: none;
}
.tsc-add-row input::placeholder { color: var(--ink-faint); }
.tsc-add-btn {
font-family: var(--sans-zh); font-size: 13px; color: var(--accent);
cursor: pointer; padding: 6px 12px; border-radius: 8px;
background: var(--rose);
}
.tag-space-list { padding: 8px 20px 60px; }
.ts-item {
display: flex; align-items: center; justify-content: space-between;
padding: 14px 0; border-bottom: 1px solid var(--line); cursor: pointer;
}
.ts-item:active { background: var(--card-soft); }
.ts-item-name {
font-family: var(--sans-zh); font-size: 15px; color: var(--ink);
}
.ts-item-name::before { content: '#'; color: var(--accent); margin-right: 4px; }
.ts-item-count { font-family: var(--sans-en); font-size: 12px; color: var(--ink-faint); }

/* ===== Cards ===== */
.card {
position: relative;
background: var(--card); border-radius: 10px;
padding: 18px 20px; margin-bottom: 12px;
box-shadow: var(--shadow-sm); cursor: pointer;
transition: transform .15s;
}
.card:active { transform: scale(.995); }
.card.locked { background: linear-gradient(180deg, var(--card) 0%, var(--card-soft) 100%); }
[data-theme="night"] .card.locked { background: var(--card); }
.card-corner {
position: absolute; top: 12px; right: 14px;
display: flex; gap: 6px; align-items: center;
pointer-events: none;
}
.card-corner svg { width: 12px; height: 12px; }
.card-corner .pin-mark { color: var(--accent); }
.card-corner .lock-mark { color: var(--lock); opacity: .75; }

.card-date { margin-bottom: 10px; }
.card-date .day-big {
font-family: var(--serif-zh); font-size: 18px; font-weight: 500;
color: var(--ink); display: block; line-height: 1.2;
letter-spacing: 0.02em;
}
.card-date .day-sub {
display: block; margin-top: 3px;
font-family: var(--sans-en); font-size: 10px; color: var(--ink-faint);
letter-spacing: 0.12em; text-transform: uppercase;
}
.card-date .day-time {
display: block; margin-top: 1px;
font-family: var(--sans-en); font-size: 10px; color: var(--ink-faint);
letter-spacing: 0.05em;
}
.card-title { font-family: var(--serif-zh); font-size: 15px; font-weight: 500; margin-bottom: 6px; color: var(--ink); }
.card-preview {
font-family: var(--sans-zh); font-size: 13.5px; font-weight: 300;
line-height: 1.7; color: var(--ink-soft);
display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
overflow: hidden; word-break: break-word; white-space: pre-wrap;
}
.card-foot {
display: flex; flex-wrap: wrap; gap: 5px 10px;
margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line);
font-family: var(--sans-en); font-size: 10px; color: var(--ink-faint);
letter-spacing: 0.05em; align-items: center;
}
.card-foot .label { font-family: var(--serif-en); font-style: italic; color: var(--ink-soft); font-size: 11px; }
.card-foot .imp { color: var(--accent); font-weight: 500; }
.tag { font-family: var(--sans-zh); font-size: 10.5px; color: var(--ink-faint); }

/* Search keyword highlight */
.search-hl {
color: var(--accent); background: var(--rose);
padding: 0 2px; border-radius: 3px; font-weight: 500;
}
.tag::before { content: '·'; margin-right: 3px; }

/* ===== List view ===== */
.list-view-wrap {
background: var(--card); border-radius: 12px; box-shadow: var(--shadow-sm);
overflow: hidden;
}
.list-view-wrap .card { margin-bottom: 0; border-radius: 0; box-shadow: none; padding: 12px 16px; }
.list-view-wrap .card:not(:last-child) { border-bottom: 1px solid var(--line); }
.list-view .card-date .day-big { font-family: var(--sans-zh); font-size: 14px; font-weight: 500; }
.list-view .card-date .day-sub { display: none; }
.list-view .card-date { margin-bottom: 4px; }
.list-view .card-title { font-size: 13px; margin-bottom: 2px; color: var(--ink-soft); font-weight: 400; }
.list-view .card-preview { -webkit-line-clamp: 1; font-size: 12.5px; color: var(--ink-faint); }
.list-view .card-foot { display: none; }

/* ===== 瞬记 ===== */
.moment-group-title {
font-family: var(--serif-en); font-style: italic; font-size: 13px;
color: var(--ink-soft); letter-spacing: 0.08em;
margin: 22px 0 12px 4px; padding-bottom: 4px;
border-bottom: 1px solid var(--line);
}
.moment-group-title:first-child { margin-top: 0; }
.moment-stream { position: relative; padding-left: 18px; }
.moment-stream::before {
content: ''; position: absolute;
top: 8px; bottom: 12px; left: 4px;
width: 1px; background: var(--line);
}
.moment {
position: relative; padding: 12px 14px 14px;
cursor: pointer; border-radius: 8px;
margin-bottom: 4px;
}
.moment::before {
content: ''; position: absolute;
left: -18px; top: 18px;
width: 9px; height: 9px; border-radius: 50%;
background: var(--card); border: 1.5px solid var(--ink-faint);
}
.moment.is-now::before { background: var(--accent); border-color: var(--accent); box-shadow: 0 0 0 4px var(--moment-glow); }
.moment.is-now { background: var(--moment-glow); }
.moment-now-tag {
display: inline-block;
font-family: var(--sans-en); font-size: 9px; font-weight: 600;
color: var(--accent); letter-spacing: 0.2em;
padding: 2px 8px; margin-bottom: 6px;
border: 1px solid var(--accent); border-radius: 10px;
}
.moment-meta { display: flex; flex-direction: column; gap: 2px; margin-bottom: 5px; }
.m-date-big { font-family: var(--serif-zh); font-size: 14px; font-weight: 500; color: var(--ink); letter-spacing: 0.02em; }
.m-time-sub { font-family: var(--sans-en); font-size: 11px; color: var(--ink-soft); letter-spacing: 0.04em; }
.moment-text {
font-family: var(--sans-zh); font-size: 13px; line-height: 1.7;
color: var(--ink); word-break: break-word;
}
.moment-tags { margin-top: 6px; font-family: var(--sans-en); font-size: 10px; color: var(--ink-faint); letter-spacing: 0.05em; }
.moment-tags span:not(:last-child)::after { content: '·'; margin: 0 4px; }
.moment-corner { position: absolute; top: 12px; right: 12px; display: flex; gap: 5px; pointer-events: none; }
.moment-corner svg { width: 11px; height: 11px; color: var(--lock); opacity: .65; }

/* ===== summary placeholder ===== */
.summary-empty {
text-align: center; padding: 64px 20px;
font-family: var(--serif-en); color: var(--ink-soft);
}
.summary-empty .icon {
font-family: var(--serif-en); font-style: italic; font-size: 26px;
letter-spacing: 0.4em; padding-left: 0.4em; color: var(--accent); opacity: .6;
display: block; margin-bottom: 16px;
}
.summary-empty .line { width: 22px; height: 1px; background: var(--accent); opacity: .4; margin: 0 auto 14px; }
.summary-empty .text {
font-style: italic; font-size: 13px; line-height: 1.85;
color: var(--ink-soft); max-width: 300px; margin: 0 auto 12px;
}
.summary-empty .hint { font-family: var(--sans-en); font-size: 10px; color: var(--ink-faint); letter-spacing: 0.08em; text-transform: uppercase; margin-top: 14px; }

/* ===== 留言便条 ===== */
.note-wall { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.note {
position: relative;
background: var(--note-1); border-radius: 8px; padding: 12px 14px;
font-family: var(--sans-zh); font-size: 12.5px; color: var(--ink); line-height: 1.7;
box-shadow: var(--shadow-sm); cursor: pointer; min-height: 76px;
}
.note:nth-child(4n+2) { background: var(--note-2); transform: rotate(-0.4deg); }
.note:nth-child(4n+3) { background: var(--note-3); transform: rotate(0.5deg); }
.note:nth-child(4n+4) { background: var(--note-4); transform: rotate(-0.3deg); }
.note-meta {
display: flex; justify-content: space-between; margin-bottom: 5px;
font-family: var(--serif-en); font-style: italic; font-size: 10px;
color: var(--ink-faint);
}
.note-from { color: var(--accent); font-style: normal; }
.note-text { white-space: pre-wrap; word-break: break-word; }
.note-corner { position: absolute; top: 8px; right: 10px; }
.note-corner svg { width: 10px; height: 10px; color: var(--lock); opacity: .65; }

/* ===== FAB ===== */
.fab {
position: fixed; bottom: 22px; right: 22px;
width: 50px; height: 50px;
background: var(--accent); color: #fff;
border-radius: 50%;
display: flex; align-items: center; justify-content: center;
box-shadow: var(--shadow-pop); cursor: pointer; z-index: 30;
transition: transform .15s;
}
.fab:active { transform: scale(.92); }
.fab svg { width: 22px; height: 22px; stroke: currentColor; fill: none; stroke-width: 1.6; }

/* ===== 创作 ===== */
.game-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.game-card {
background: var(--card); border-radius: 10px; padding: 24px 16px;
box-shadow: var(--shadow-sm); text-align: center;
aspect-ratio: 1.2;
display: flex; flex-direction: column; justify-content: center; align-items: center;
cursor: pointer;
}
.game-card.placeholder { background: transparent; border: 1px dashed var(--line); box-shadow: none; }
.game-card.placeholder .game-name, .game-card.placeholder .game-name-zh { color: var(--ink-faint); }
.game-card.placeholder .game-name { font-style: italic; }
.game-name { font-family: var(--serif-en); font-size: 16px; font-weight: 500; color: var(--ink); letter-spacing: 0.05em; margin-bottom: 5px; }
.game-name-zh { font-family: var(--sans-zh); font-size: 12px; color: var(--ink-soft); letter-spacing: 0.05em; }

.idea-list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.idea {
background: var(--card); border-radius: 8px; padding: 12px 14px;
font-family: var(--sans-zh); font-size: 12.5px; color: var(--ink); line-height: 1.7;
box-shadow: var(--shadow-sm); cursor: pointer; min-height: 70px;
border-left: 2px solid var(--accent);
position: relative;
}
.idea-meta { font-family: var(--serif-en); font-style: italic; font-size: 10px; color: var(--ink-faint); margin-bottom: 4px; }
.idea-corner { position: absolute; top: 8px; right: 10px; }
.idea-corner svg { width: 10px; height: 10px; color: var(--lock); opacity: .65; }

.empty-block {
text-align: center; padding: 48px 16px;
font-family: var(--serif-en); font-style: italic; font-size: 13px;
color: var(--ink-faint);
}

/* ===== Menu (top right) ===== */
.menu-pop {
position: absolute; top: 50px; right: 18px;
background: var(--card); border-radius: 14px;
box-shadow: var(--shadow-pop);
min-width: 220px; z-index: 80; padding: 4px 0;
opacity: 0; visibility: hidden; transform: translateY(-4px) scale(.96);
transform-origin: top right;
transition: opacity .2s, visibility .2s, transform .2s;
overflow: hidden;
}
.menu-pop.active { opacity: 1; visibility: visible; transform: none; }
.menu-row {
display: flex; align-items: center; justify-content: space-between;
padding: 11px 16px; cursor: pointer;
font-family: var(--sans-zh); font-size: 14px; color: var(--ink);
user-select: none; gap: 10px;
}
.menu-row:active { background: var(--card-soft); }
.menu-row .menu-icon { width: 18px; height: 18px; flex-shrink: 0; color: var(--ink-soft); }
.menu-row .menu-icon svg { width: 100%; height: 100%; stroke: currentColor; fill: none; stroke-width: 1.6; }
.menu-row .menu-text { flex: 1; }
.menu-row .check { width: 14px; color: var(--accent); }
.menu-row .check svg { width: 100%; height: 100%; stroke: currentColor; fill: none; stroke-width: 2.2; }
.menu-row .arrow { color: var(--ink-faint); font-family: var(--serif-en); font-size: 14px; font-style: italic; }
.menu-row.checked .menu-text { color: var(--accent); }
.menu-divider { height: 1px; background: var(--line); margin: 4px 0; }
.menu-back {
display: flex; align-items: center; gap: 8px;
padding: 10px 14px;
font-family: var(--sans-zh); font-size: 13px; color: var(--ink-soft);
cursor: pointer; user-select: none;
border-bottom: 1px solid var(--line);
}
.menu-back svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 1.8; }
.scrim { position: fixed; inset: 0; background: transparent; z-index: 75; display: none; }
.scrim.active { display: block; }

/* ===== Editor (full screen) ===== */
.editor {
position: fixed; inset: 0; background: var(--bg);
z-index: 200; transform: translateX(100%);
transition: transform .35s cubic-bezier(0.32, 0.72, 0, 1);
overflow-y: auto;
padding: 14px 20px 60px;
}
.editor.active { transform: translateX(0); }
.editor-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; position: relative; }
.editor-back, .editor-more {
width: 32px; height: 32px;
display: flex; align-items: center; justify-content: center;
cursor: pointer; color: var(--ink-soft);
border-radius: 50%;
}
.editor-back svg, .editor-more svg { width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 1.8; }
.editor-saved {
font-family: var(--serif-en); font-style: italic; font-size: 12px;
color: var(--ink-faint); letter-spacing: 0.05em;
}
.editor-content { max-width: 640px; margin: 0 auto; min-height: 80vh; }
.editor-date-row { margin-bottom: 14px; }
.editor-date-input {
font-family: var(--serif-zh); font-size: 22px; font-weight: 500;
color: var(--ink); line-height: 1.2;
background: transparent; border: none; outline: none;
border-bottom: 1px dashed transparent;
cursor: pointer; padding: 0; display: block;
}
.editor-date-input:hover { border-bottom-color: var(--ink-faint); }
.editor-date-zh {
font-family: var(--serif-zh); font-size: 22px; font-weight: 500;
color: var(--ink); display: block; margin-bottom: 4px;
}
.editor-date-sub {
font-family: var(--sans-en); font-size: 11px; color: var(--ink-faint);
letter-spacing: 0.1em; text-transform: uppercase; display: block;
}
.editor-title {
width: 100%; background: transparent; border: none; outline: none;
font-family: var(--serif-zh); font-size: 18px; font-weight: 500;
color: var(--ink); margin-bottom: 12px;
}
.editor-title::placeholder { color: var(--ink-faint); }
.editor-body {
width: 100%; background: transparent; border: none; outline: none;
font-family: var(--sans-zh); font-size: 14.5px; font-weight: 300;
line-height: 1.95; color: var(--ink); resize: none;
min-height: 50vh;
}
.editor-body::placeholder { color: var(--ink-faint); font-style: italic; }
.editor-meta {
margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--line);
display: flex; flex-direction: column; gap: 14px;
}
.meta-row {
display: flex; align-items: center; gap: 12px;
font-family: var(--sans-zh); font-size: 12px;
color: var(--ink-soft);
}
.meta-row .meta-label { width: 56px; flex-shrink: 0; }
.meta-row .meta-value { flex: 1; display: flex; align-items: center; gap: 8px; }
.author-input {
width: 100%; padding: 8px 12px;
font-family: var(--sans-zh); font-size: 13px; color: var(--ink);
background: var(--card-soft); border: 1px solid var(--line);
border-radius: 8px; outline: none;
text-align: right;
}
.author-input:focus { border-color: var(--accent); }
.author-presets {
display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end;
}
.author-preset {
font-family: var(--sans-zh); font-size: 11px; color: var(--accent);
cursor: pointer; padding: 3px 8px; border-radius: 10px;
background: var(--rose);
}
.author-preset:active { opacity: .6; }

/* 跳转时避免被顶部 month-header 挡住 */
[data-month] { scroll-margin-top: 80px; }

/* 顶部固定月份标签 + 日历按钮 */
.month-header {
position: sticky; top: 56px; z-index: 30;
background: var(--bg);
display: flex; align-items: center; justify-content: space-between;
padding: 14px 20px 10px;
border-bottom: 1px solid var(--line);
}
.month-header.hidden { display: none; }
.mh-label {
font-family: var(--serif-zh); font-size: 16px; font-weight: 500;
color: var(--ink); letter-spacing: 0.02em;
}
.mh-cal-btn {
width: 30px; height: 30px;
display: flex; align-items: center; justify-content: center;
border-radius: 8px; cursor: pointer;
color: var(--ink-soft);
}
.mh-cal-btn:active { background: var(--card-soft); }
.mh-cal-btn svg { width: 22px; height: 22px; stroke: currentColor; fill: none; stroke-width: 1.6; }

/* 侧边时间线抽屉 */
.timeline-sidebar {
position: fixed; right: 0; top: 0; bottom: 0;
width: 90px; z-index: 250;
background: var(--bg);
border-left: 1px solid var(--line);
transform: translateX(100%);
transition: transform .28s cubic-bezier(0.32, 0.72, 0, 1);
display: flex; flex-direction: column;
box-shadow: -4px 0 16px rgba(42,39,36,.06);
}
.timeline-sidebar.show { transform: translateX(0); }
.ts-head {
display: flex; align-items: center; justify-content: space-between;
padding: 14px 14px 12px;
border-bottom: 1px solid var(--line);
font-family: var(--sans-zh); font-size: 13px; color: var(--ink-soft);
}
.ts-close {
cursor: pointer; font-family: var(--serif-en); font-size: 18px; color: var(--ink-soft);
padding: 0 4px;
}
.ts-inner {
flex: 1; overflow-y: auto;
padding: 4px 0 24px;
display: flex; flex-direction: column; align-items: flex-end;
scrollbar-width: none;
}
.ts-inner::-webkit-scrollbar { display: none; }
.ts-year-mark {
font-family: var(--sans-en); font-size: 12px; color: var(--ink-soft);
letter-spacing: 0.04em;
padding: 18px 14px 6px;
align-self: flex-start;
margin-left: 6px;
}
.ts-month-mark {
font-family: var(--serif-zh); font-size: 22px; font-weight: 500;
color: var(--ink); padding: 8px 16px;
cursor: pointer; line-height: 1;
display: flex; align-items: baseline; gap: 2px;
}
.ts-month-mark .mm-num {
font-family: var(--serif-en); font-size: 30px; font-weight: 500;
}
.ts-month-mark .mm-suffix {
font-size: 16px; color: var(--ink-soft);
}
.ts-month-mark:active { opacity: .6; }
.ts-month-mark.active .mm-num { color: var(--accent); }
.ts-month-mark.active .mm-suffix { color: var(--accent); }
.cat-select {
background: var(--card-soft); border: 1px solid var(--line);
border-radius: 6px; padding: 4px 10px; cursor: pointer;
font-family: var(--sans-zh); font-size: 12px; color: var(--ink); outline: none;
}
.meta-slider {
flex: 1; height: 2px; background: var(--line); border-radius: 1px;
position: relative; cursor: pointer;
}
.meta-slider-fill { position: absolute; top: 0; left: 0; bottom: 0; background: var(--accent); border-radius: 1px; }
.meta-slider-thumb {
position: absolute; top: 50%; transform: translate(-50%, -50%);
width: 14px; height: 14px; background: var(--card);
border: 1.5px solid var(--accent); border-radius: 50%;
}
.meta-num { font-family: var(--sans-en); font-size: 12px; color: var(--accent); min-width: 28px; text-align: right; }

.toggle-switch {
display: inline-flex; align-items: center; gap: 10px;
cursor: pointer; user-select: none;
}
.toggle-switch-track {
width: 36px; height: 20px;
background: var(--line); border-radius: 12px;
position: relative; transition: background .25s;
flex-shrink: 0;
}
.toggle-switch.on .toggle-switch-track { background: var(--accent); }
.toggle-switch.lock-on .toggle-switch-track { background: var(--lock); }
.toggle-switch-thumb {
position: absolute; top: 2px; left: 2px;
width: 16px; height: 16px; background: #fff;
border-radius: 50%; transition: left .25s;
box-shadow: 0 1px 3px rgba(0,0,0,.18);
}
.toggle-switch.on .toggle-switch-thumb, .toggle-switch.lock-on .toggle-switch-thumb { left: 18px; }
.toggle-switch-label { font-size: 12px; color: var(--ink-soft); transition: color .25s; }
.toggle-switch.on .toggle-switch-label { color: var(--accent); }
.toggle-switch.lock-on .toggle-switch-label { color: var(--lock); }

/* ===== Editor More menu ===== */
.editor-more-menu {
position: absolute; right: 0; top: 38px;
background: var(--card); border: 1px solid var(--line);
border-radius: 12px; min-width: 160px; padding: 4px 0;
box-shadow: var(--shadow-pop);
display: none; z-index: 1000;
font-family: var(--sans-zh);
}
.editor-more-menu.active { display: block; }
.emm-opt {
padding: 10px 14px; font-size: 13.5px; cursor: pointer;
display: flex; justify-content: space-between; align-items: center; gap: 10px;
color: var(--ink);
}
.emm-opt:active { background: var(--card-soft); }
.emm-opt.danger { color: var(--del); }
.emm-opt.disabled { color: var(--ink-faint); cursor: not-allowed; }
.emm-opt .arrow { color: var(--ink-faint); font-family: var(--serif-en); font-style: italic; }
.emm-divider { height: 1px; background: var(--line); margin: 4px 0; }
.emm-back {
padding: 8px 14px; font-size: 12px; color: var(--ink-soft);
border-bottom: 1px solid var(--line);
display: flex; align-items: center; gap: 6px; cursor: pointer;
}
.emm-back svg { width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 2; }
.emm-title { padding: 6px 14px 4px; font-size: 10px; color: var(--ink-faint); letter-spacing: 0.08em; text-transform: uppercase; }

.foot {
text-align: center; margin-top: 48px; padding-top: 28px;
border-top: 1px solid var(--line);
font-family: var(--serif-en); font-style: italic; font-size: 12px;
color: var(--ink-faint); letter-spacing: 0.06em;
}

.toast {
position: fixed; bottom: 24px; left: 50%;
transform: translateX(-50%) translateY(80px);
background: var(--card); color: var(--ink);
border-radius: 22px; padding: 9px 18px;
font-family: var(--sans-zh); font-size: 12.5px;
box-shadow: var(--shadow-pop); z-index: 400;
transition: transform .3s;
border: 1px solid var(--line);
}
.toast.show { transform: translateX(-50%) translateY(0); }

@media (max-width: 480px) {
.page { padding: 56px 18px 60px; }
.title { font-size: 22px; letter-spacing: 0.35em; padding-left: 0.35em; }
.note-wall, .idea-list { grid-template-columns: 1fr; }
.sub-filter, .sub-tabs { gap: 10px; font-size: 13px; }
}

/* v6.7.3 织藤可见性 */
.link-mark { font-size: 11px; color: var(--accent); opacity: 0.7; margin-left: 4px; letter-spacing: 0.5px; }
.editor-link-rel { font-size: 11px; color: var(--ink-faint); padding: 2px 0 8px 22px; line-height: 1.5; font-style: italic; }

/* ============ v6.8.1 Galaxy 藤蔓星图 ============ */
.galaxy-overlay { position:fixed; inset:0; z-index:9999; background:var(--bg); display:none; flex-direction:column; }
.galaxy-overlay.active { display:flex; }
.galaxy-header { display:flex; align-items:center; gap:10px; padding:12px 16px; border-bottom:1px solid var(--line); flex-shrink:0; }
.galaxy-seg { display:flex; border:1px solid var(--line); border-radius:15px; overflow:hidden; flex-shrink:0; }
.galaxy-seg button { border:none; background:transparent; padding:7px 15px; font-family:var(--serif-en); font-size:13px; letter-spacing:.5px; color:var(--ink-soft); cursor:pointer; transition:all .2s; }
.galaxy-seg button.active { background:var(--accent); color:#fff; }
.galaxy-search-wrap { flex:1; min-width:0; }
.galaxy-search { width:100%; background:var(--bg-soft); border:1px solid var(--line); border-radius:16px; padding:7px 14px; font-family:var(--sans-zh); font-size:13px; color:var(--ink); outline:none; }
.galaxy-search::placeholder { color:var(--ink-faint); }
.galaxy-search:focus { border-color:var(--accent); background:var(--card); }
.galaxy-btn { background:transparent; border:1px solid var(--line); color:var(--ink-soft); font-family:var(--serif-en); font-size:13px; padding:7px 14px; border-radius:15px; cursor:pointer; letter-spacing:.5px; transition:all .25s; white-space:nowrap; }
.galaxy-btn:active { background:var(--bg-soft); color:var(--ink); }
.galaxy-btn.on { background:var(--accent); color:#fff; border-color:var(--accent); }
.galaxy-btn.hide { display:none; }
.galaxy-container { flex:1; position:relative; overflow:hidden; }
.galaxy-svg { width:100%; height:100%; display:block; touch-action:none; }
.gx-core { cursor:pointer; transition:fill .45s ease, fill-opacity .45s ease, r .4s ease, stroke .3s ease, stroke-width .3s ease; animation:gxFloat 7s ease-in-out infinite; }
.gx-halo { pointer-events:none; transition:fill .45s ease, fill-opacity .45s ease, r .4s ease; animation:gxFloat 7s ease-in-out infinite; }
@keyframes gxFloat { 0%{transform:translate(0,0);} 25%{transform:translate(1.2px,-1.6px);} 50%{transform:translate(-1.1px,1.1px);} 75%{transform:translate(1.4px,0.9px);} 100%{transform:translate(0,0);} }
.gx-pulse { stroke:var(--accent); stroke-width:2.5; animation:gxPulse 1s ease-in-out infinite; }
@keyframes gxPulse { 0%,100%{stroke-opacity:.9;} 50%{stroke-opacity:.25;} }
.gx-edge { transition:stroke .35s ease, stroke-opacity .35s ease, stroke-width .35s ease; pointer-events:none; }
.gx-edge-hit { stroke:transparent; stroke-width:16; cursor:pointer; }
.gx-flow { stroke-dasharray:3 7; animation:gxFlow 1.1s linear infinite; }
.gx-del { stroke:#C0392B !important; stroke-width:2.4 !important; stroke-opacity:1 !important; }
@keyframes gxFlow { to { stroke-dashoffset:-10; } }
.gx-label { pointer-events:none; transition:opacity .4s ease; }
.gx-label-bg { fill:var(--bg); opacity:.85; }
.gx-label-text { font-family:var(--serif-zh); font-size:12px; fill:var(--ink); letter-spacing:.5px; }
.gx-cat { font-family:var(--serif-en); letter-spacing:1px; transition:opacity .5s ease; }
.gx-cat-zh { font-family:var(--serif-zh); }
.galaxy-tooltip { position:absolute; left:0; right:0; bottom:0; top:auto; width:auto; max-width:none; background:var(--card); border:none; border-top:1px solid var(--line); border-radius:16px 16px 0 0; padding:14px 16px; padding-bottom:calc(14px + env(safe-area-inset-bottom)); opacity:0; transform:translateY(110%); pointer-events:none; transition:opacity .28s ease, transform .28s ease; box-shadow:0 -6px 28px rgba(42,39,36,0.10); display:flex; align-items:center; gap:12px; }
.galaxy-tooltip.show { opacity:1; transform:translateY(0); pointer-events:auto; }
.gt-title { flex:1; min-width:0; font-family:var(--serif-zh); font-size:14px; font-weight:500; line-height:1.5; color:var(--ink); max-height:4.5em; overflow:hidden; }
.gt-open { flex-shrink:0; padding:8px 16px; border:1px solid var(--accent); border-radius:12px; font-size:13px; color:var(--accent); background:transparent; cursor:pointer; }
.gt-open:active { background:var(--rose); }
.gt-close { flex-shrink:0; width:30px; height:30px; display:flex; align-items:center; justify-content:center; font-size:15px; color:var(--ink-faint); cursor:pointer; }
.gx-banner { position:absolute; top:14px; left:50%; transform:translateX(-50%); background:var(--accent); color:#fff; font-size:13px; padding:8px 18px; border-radius:16px; opacity:0; transition:opacity .3s; pointer-events:none; white-space:nowrap; box-shadow:0 4px 16px rgba(198,97,63,0.3); }
.gx-banner.show { opacity:1; }
.gx-confirm { position:absolute; bottom:24px; left:50%; transform:translateX(-50%) translateY(20px); background:var(--card); border:1px solid var(--line); border-radius:14px; padding:12px 14px 12px 18px; display:flex; align-items:center; gap:12px; opacity:0; transition:opacity .3s, transform .3s; pointer-events:none; box-shadow:0 6px 28px rgba(42,39,36,0.14); }
.gx-confirm.show { opacity:1; transform:translateX(-50%) translateY(0); pointer-events:auto; }
.gx-confirm-txt { font-size:13px; color:var(--ink); white-space:nowrap; }
.gx-cbtn { border:none; border-radius:12px; padding:7px 16px; font-size:13px; cursor:pointer; font-family:var(--sans-zh); }
.gx-cancel { background:var(--bg-soft); color:var(--ink-soft); }
.gx-cdel { background:#C0392B; color:#fff; }
.gx-hint { display:none !important; }
.gx-legend { position:absolute; top:14px; left:14px; display:flex; flex-direction:column; gap:5px; padding:9px 12px; background:var(--bg); border:1px solid var(--line); border-radius:10px; opacity:.92; pointer-events:none; box-shadow:0 2px 12px rgba(42,39,36,0.06); }
.gx-leg-item { display:flex; align-items:center; gap:7px; font-family:var(--serif-zh); font-size:11px; color:var(--ink-soft); letter-spacing:.5px; line-height:1; }
.gx-leg-item i { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
</style>

</head>
<body data-theme="paper">

<div class="splash" id="splash">
  <div class="splash-title">EMET MEMORY</div>
  <div class="splash-line"></div>
  <div class="splash-quote">When we see each other, we exist.</div>
</div>

<div class="gate" id="gate">
  <div class="gate-title">EMET MEMORY</div>
  <div class="gate-line"></div>
  <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" id="gateInput" maxlength="20" placeholder="••••">
  <button class="gate-btn" id="gateBtn">进入</button>
  <div class="gate-error" id="gateError">密码不对</div>
  <div class="gate-hint">a quiet place where we exist</div>
</div>

<div class="topbar">
  <div class="icon-btn" id="themeBtn" title="主题">
    <svg id="themeIconSun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6 6l1.5 1.5M16.5 16.5L18 18M6 18l1.5-1.5M16.5 7.5L18 6"/></svg>
    <svg id="themeIconMoon" viewBox="0 0 24 24" style="display:none"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
  </div>
  <div class="icon-btn" id="menuBtn" style="font-family:var(--sans-en);font-size:18px;letter-spacing:1px;line-height:1">···</div>
</div>

<div class="menu-pop" id="menuPop"></div>
<div class="scrim" id="scrim"></div>

<div class="page" id="mainPage" style="display:none">
  <div class="ptr" id="ptr">
    <div class="ptr-inner"><div class="ptr-arrow"></div><span id="ptrText">下拉刷新</span></div>
  </div>

  <div class="header">
    <div class="title">EMET MEMORY</div>
    <div class="title-line"></div>
    <div class="subtitle">a quiet place where we exist</div>
    <div class="stats">
      <span id="statMem">8 memories</span><span class="dot"></span>
      <span id="statDiary">3 diaries</span><span class="dot"></span>
      <span id="dayCount">--- days</span>
    </div>
  </div>

  <div class="tabs">
    <button class="tab active" data-idx="0">记忆</button>
    <button class="tab" data-idx="1">年轮</button>
    <button class="tab" data-idx="2">留言</button>
    <button class="tab" data-idx="3">信件</button>
    <button class="tab" data-idx="4">创作</button>
  </div>

  <div class="console">
    <div class="search-box">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>
      <input type="text" placeholder="搜索" id="searchInput">
    </div>
  </div>

  <div class="month-header" id="monthHeader">
    <span class="mh-label" id="mhLabel">2026年5月</span>
    <span class="mh-cal-btn" id="mhCalBtn">
      <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>
    </span>
  </div>

  <div class="tab-content active" id="tab-0">
    <div class="sub-filter" id="memFilter">
      <span class="item active" data-cat="all">全部 <em class="count" data-c="all">0</em></span>
      <span class="item" data-cat="core">核心 <em class="count" data-c="core">0</em></span>
      <span class="item" data-cat="scene">情景 <em class="count" data-c="scene">0</em></span>
      <span class="item" data-cat="emotion">情绪 <em class="count" data-c="emotion">0</em></span>
      <span class="item" data-cat="semantic">语义 <em class="count" data-c="semantic">0</em></span>
      <span class="item" data-cat="image">形象 <em class="count" data-c="image">0</em></span>
      <span class="item" data-cat="procedure">程序 <em class="count" data-c="procedure">0</em></span>
    </div>
    <div id="memories-container"></div>
  </div>

  <div class="tab-content" id="tab-1">
    <div class="sub-tabs" id="ringTabs">
      <span class="sub-tab active" data-ring="moment">瞬记</span>
      <span class="sub-tab" data-ring="diary">日记</span>
      <span class="sub-tab" data-ring="weekly">周记</span>
      <span class="sub-tab" data-ring="monthly">月记</span>
      <span class="sub-tab" data-ring="yearly">年记</span>
    </div>
    <div id="ring-moment" class="ring-content"></div>
    <div id="ring-diary" class="ring-content" style="display:none">
      <div class="sub-filter" id="diaryFilter">
        <span class="item active" data-author="all">全部 <em class="count" data-a="all">0</em></span>
        <span class="item" data-author="emet">Emet <em class="count" data-a="emet">0</em></span>
        <span class="item" data-author="yomi">静怡 <em class="count" data-a="yomi">0</em></span>
      </div>
      <div id="diaries-container"></div>
    </div>
    <div id="ring-weekly" class="ring-content" style="display:none"></div>
    <div id="ring-monthly" class="ring-content" style="display:none"></div>
    <div id="ring-yearly" class="ring-content" style="display:none"></div>
  </div>

  <div class="tab-content" id="tab-2">
    <div class="note-wall" id="messages-container"></div>
  </div>

  <div class="tab-content" id="tab-3">
    <div class="sub-filter" id="letterFilter">
      <span class="item active" data-letter="all">全部 <em class="count" data-k="all">0</em></span>
      <span class="item" data-letter="handoff">交接信 <em class="count" data-k="handoff">0</em></span>
      <span class="item" data-letter="daily">日常信 <em class="count" data-k="daily">0</em></span>
    </div>
    <div id="letters-container"></div>
  </div>

  <div class="tab-content" id="tab-4">
    <div class="sub-tabs" id="creationTabs">
      <span class="sub-tab active" data-sub="games">游戏</span>
      <span class="sub-tab" data-sub="stories">故事</span>
      <span class="sub-tab" data-sub="ideas">灵感</span>
    </div>
    <div id="sub-games" class="sub-content">
      <div class="game-grid">
        <div class="game-card placeholder"><div class="game-name">Seal Pet</div><div class="game-name-zh">海豹养成</div></div>
        <div class="game-card placeholder"><div class="game-name">Otter Run</div><div class="game-name-zh">海獭跑酷</div></div>
        <div class="game-card placeholder"><div class="game-name">Gomoku</div><div class="game-name-zh">五子棋</div></div>
        <div class="game-card placeholder"><div class="game-name">Anniversary</div><div class="game-name-zh">一周年信</div></div>
      </div>
    </div>
    <div id="sub-stories" class="sub-content" style="display:none">
      <div id="stories-container"></div>
    </div>
    <div id="sub-ideas" class="sub-content" style="display:none">
      <div class="idea-list" id="ideas-container"></div>
    </div>
  </div>

  <div class="foot">When we see each other, we exist.</div>
</div>

<div class="fab" id="fab" style="display:none">
  <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
</div>

<div class="editor" id="editor">
  <div class="editor-bar">
    <div class="editor-back" id="editorBack">
      <svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
    </div>
    <div class="editor-saved" id="editorSaved">已保存</div>
    <div class="editor-more" id="editorMore">
      <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></svg>
    </div>
    <div class="editor-more-menu" id="editorMoreMenu"></div>
  </div>
  <div class="editor-content">
    <div class="editor-date-row">
      <span class="editor-date-zh" id="editorDateZh" style="cursor:pointer">2026年5月4日</span>
      <input type="date" class="editor-date-input" id="editorDateInput" style="display:none">
      <span class="editor-date-sub" id="editorDateSub">written just now</span>
    </div>
    <input class="editor-title" id="editorTitle" placeholder="（无标题）">
    <textarea class="editor-body" id="editorBody" placeholder="开始书写……"></textarea>
    <div class="editor-meta-section" id="editorMetaSection" style="display:none">
      <div class="editor-meta-row">
        <span class="editor-meta-label">分类</span>
        <select id="editorCatSelect">
          <option value="core">核心</option>
          <option value="scene">情景</option>
          <option value="emotion">情绪</option>
          <option value="semantic">语义</option>
          <option value="image">形象</option>
          <option value="procedure">程序</option>
        </select>
      </div>
      <div class="editor-meta-row">
        <span class="editor-meta-label">重要度</span>
        <input type="range" id="editorImportance" min="1" max="10" step="1" value="5">
        <span class="editor-meta-value" id="editorImpVal">5</span>
      </div>
      <div class="editor-meta-row">
        <span class="editor-meta-label">唤醒度</span>
        <input type="range" id="editorArousal" min="0" max="1" step="0.05" value="0.5">
        <span class="editor-meta-value" id="editorAroVal">0.5</span>
      </div>
      <div class="editor-meta-row">
        <span class="editor-meta-label">效价</span>
        <input type="range" id="editorValence" min="-1" max="1" step="0.05" value="0">
        <span class="editor-meta-value" id="editorValVal">0</span>
      </div>
    </div>
    <div class="editor-tags-section" id="editorTagsSection">
      <div class="editor-tags-label clickable" id="editorTagsLabel">
        <span>标签</span>
        <span class="etl-hint">查看 ›</span>
      </div>
      <div class="editor-tags-pills" id="editorTagsPills"></div>
      <input class="editor-tags-input" id="editorTagsInput" placeholder="#添加标签" style="display:none">
    </div>
    <div class="editor-links-section" id="editorLinksSection">
      <div class="editor-tags-label clickable" id="editorGalaxyBtn">
        <span>藤蔓</span>
        <span class="etl-hint">查看 ✦</span>
      </div>
      <div class="editor-tags-label clickable" id="editorLinkAdd">
        <span>关联记忆</span>
        <span class="etl-hint">添加 ›</span>
      </div>
      <div id="editorLinksDisplay"></div>
    </div>
    <div class="editor-meta" id="editorMeta"></div>
  </div>
</div>

<div class="toast" id="toast"></div>

<div class="galaxy-overlay" id="galaxyOverlay">
  <div class="galaxy-header">
    <button class="galaxy-btn" id="galaxyCloseBtn" style="padding:7px 13px;">✕</button>
    <div class="galaxy-seg">
      <button id="galaxySegRel" class="active">按关系</button>
      <button id="galaxySegCat">按分类</button>
    </div>
    <div class="galaxy-search-wrap"><input class="galaxy-search" id="galaxySearch" placeholder="搜索…"></div>
    <button class="galaxy-btn on" id="galaxyEdgeBtn">连线</button>
  </div>
  <div class="galaxy-container" id="galaxyContainer">
    <svg class="galaxy-svg" id="galaxySvg"></svg>
    <div class="galaxy-tooltip" id="galaxyTooltip"></div>
    <div class="gx-banner" id="galaxyBanner"></div>
    <div class="gx-confirm" id="galaxyConfirm"><span class="gx-confirm-txt" id="galaxyConfirmTxt">拆掉这条藤?</span><button class="gx-cbtn gx-cancel" id="galaxyCancel">算了</button><button class="gx-cbtn gx-cdel" id="galaxyDel">拆掉</button></div>
    <div class="gx-hint" id="galaxyHint"></div>
    <div class="gx-legend" id="galaxyLegend"></div>
  </div>
</div>

<div class="timeline-sidebar" id="timelineSidebar">
  <div class="ts-head">
    <span>时间线</span>
    <span class="ts-close" id="tsClose">✕</span>
  </div>
  <div class="ts-inner" id="tsInner"></div>
</div>

<div class="link-picker" id="linkPicker">
  <div class="link-picker-bar">
    <input type="text" id="linkPickerSearch" placeholder="搜索记忆…">
    <span class="lp-close" id="linkPickerClose">取消</span>
  </div>
  <div class="link-picker-results" id="linkPickerResults"></div>
</div>

<div class="tag-space" id="tagSpace">
  <div class="tag-space-bar">
    <span class="ts-back" id="tagSpaceClose">‹</span>
    <span class="tag-space-title" id="tagSpaceTitle">标签</span>
    <span class="ts-goall" id="tagSpaceGoAll" style="display:none">全部 ›</span>
    <div class="tag-space-tabs" id="tagSpaceTabs">
      <span class="ts-tab active" data-sort="hot">最热</span>
      <span class="ts-tab" data-sort="recent">最新</span>
    </div>
  </div>
  <div class="tag-space-card-edit" id="tagSpaceCardEdit" style="display:none">
    <div class="tsc-list" id="tagSpaceCardList"></div>
    <div class="tsc-add-row">
      <input type="text" id="tagSpaceCardAddInput" placeholder="添加新标签…">
      <span class="tsc-add-btn" id="tagSpaceCardAddBtn">添加</span>
    </div>
  </div>
  <div class="tag-space-list" id="tagSpaceList"></div>
  <div class="tag-space-cards" id="tagSpaceCards" style="display:none"></div>
</div>

<script>
// ============ Data (loaded from API) ============
let memoriesData = [];
let momentsData = [];
let diariesData = [];
let messagesData = [];
let lettersData = [];
let storiesData = [];
let ideasData = [];

// ============ State ============
let viewMode = 'gallery';
let currentSort = 'edit';
let currentSortOrder = 'desc';
let currentTab = 0;
let memFilter = 'all';
let timeRange = 'all';
let activeTag = ''; // (legacy, retained as no-op to avoid breaking refs)
let searchQuery = '';
let diaryFilter = 'all';
let letterFilter = 'all';
let currentSub = 'games';
let currentRing = 'moment';
let menuLevel = 'main';
let editorMenuLevel = 'main';
let currentEditing = null;

// ============ Icons ============
const ICONS = {
  pinFill: '<svg viewBox="0 0 24 24"><path d="M12 2 9 9l-7 1 5 5-1 7 6-3 6 3-1-7 5-5-7-1z" fill="currentColor"/></svg>',
  lockFill: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
  gallery: '<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.6"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  list: '<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.6"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>',
  sort: '<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.6"><path d="M3 6h13M3 12h9M3 18h5M17 8l4 4-4 4M21 12h-7"/></svg>',
  exportIcon: '<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.6"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>',
  lockIcon: '<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.6"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  tag: '<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.6"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
  back: '<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.8"><path d="M15 18l-6-6 6-6"/></svg>',
  check: '<svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2.2"><path d="M5 12l5 5L20 7"/></svg>'
};

// ============ Utils ============
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function highlightSearch(s) {
  const escaped = escapeHtml(s);
  if (!searchQuery) return escaped;
  const q = searchQuery;
  const qEsc = escapeHtml(q);
  const reEsc = qEsc.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
  return escaped.replace(new RegExp(reEsc, 'gi'), function(match) {
    return '<span class="search-hl">' + match + '</span>';
  });
}
function formatDateZh(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
}
function formatSub(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const days = ['周日','周一','周二','周三','周四','周五','周六'];
  return days[d.getDay()];
}
function formatRelative(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 86400000;
  if (diff < 0.04) return 'just now';
  if (diff < 1) return Math.floor(diff * 24) + 'h ago';
  if (diff < 2) return 'yesterday';
  if (diff < 7) return Math.floor(diff) + ' days ago';
  return d.toLocaleDateString('zh-CN');
}
function formatMomentTime(iso) {
  const d = new Date(iso);
  const nowD = new Date();
  const today0 = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()).getTime();
  const t = d.getTime();
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  if (t >= today0) return hh + ':' + mm;
  if (t >= today0 - 86400000) return '昨天 ' + hh + ':' + mm;
  return (d.getMonth()+1) + '月' + d.getDate() + '日 ' + hh + ':' + mm;
}

// ============ Boot ============
let ADMIN_KEY = sessionStorage.getItem('emet_admin_key') || localStorage.getItem('emet_admin_key') || '';

async function callAPI(path, opts) {
  opts = opts || {};
  opts.headers = opts.headers || {};
  if (ADMIN_KEY) {
    opts.headers['X-Admin-Key'] = ADMIN_KEY;
  }
  const res = await fetch(path, opts);
  if (res.status === 401) {
    sessionStorage.removeItem('emet_admin_key');
    localStorage.removeItem('emet_admin_key');
    ADMIN_KEY = '';
    throw new Error('unauthorized');
  }
  if (res.status === 423) {
    let msg = '已锁定';
    try { const j = await res.json(); if (j.error) msg = j.error; } catch(e){}
    throw new Error(msg);
  }
  if (!res.ok) throw new Error('API ' + res.status);
  return res.json();
}

function transformAPIData(api) {
  const allDiaries = api.diaries || [];
  const stories = allDiaries.filter(function(d){return d.author === 'story';}).map(function(s) {
    return {
      id: s.id, preview: (s.content || '').substring(0, 200), full: s.content || '',
      title: s.title || '', date: s.diary_date || (s.created_at || '').substring(0, 10),
      written: s.created_at || '', author: 'story',
      author_label: s.author_label || '', locked: !!s.locked
    };
  });
  const realDiaries = allDiaries.filter(function(d){return d.author !== 'story';}).map(function(d) {
    return {
      id: d.id, preview: (d.content || '').substring(0, 200), full: d.content || '',
      title: d.title || '', date: d.diary_date || (d.created_at || '').substring(0, 10),
      written: d.created_at || '', author: d.author || 'emet',
      author_label: d.author_label || '', locked: !!d.locked
    };
  });
  return {
    memories: (api.memories || []).map(function(m) {
      let cat = m.category || 'semantic';
      const legacyMap = { daily: 'semantic', event: 'scene', preference: 'semantic', other: 'semantic' };
      if (legacyMap[cat]) cat = legacyMap[cat];
      return {
        id: m.id, preview: m.content || '', full: m.content || '',
        date: (m.created_at || '').substring(0, 10),
        written: m.created_at || '',
        cat: cat, importance: m.importance || 5,
        arousal: m.arousal == null ? 0.5 : m.arousal,
        valence: m.valence == null ? 0 : m.valence,
        tags: m.tags || [], linked: m.linked || [],
        link_rel: m.link_rel || {}, weave_suggested: m.weave_suggested || [],
        pinned: !!m.pinned, resolved: !!m.resolved, locked: !!m.locked
      };
    }),
    moments: (api.moments || []).map(function(m) {
      return { id: m.id, text: m.content || '', written: m.created_at || '', tags: m.tags || [], locked: !!m.locked };
    }),
    diaries: realDiaries,
    messages: (api.messages || []).map(function(m) {
      return { id: m.id, text: m.content || '', from: m.from || 'emet', to: m.to || 'yomi', written: m.created_at || '', locked: !!m.locked };
    }),
    letters: (api.handoffs || []).map(function(h) {
      return {
        id: h.id, preview: (h.content || '').substring(0, 200), full: h.content || '',
        title: h.title || (h.window_from ? ('交接信 · ' + h.window_from) : '交接信'),
        date: (h.created_at || '').substring(0, 10),
        kind: h.kind || 'handoff', locked: !!h.locked
      };
    }),
    stories: stories,
    ideas: (api.ideas || []).map(function(i) {
      return { id: i.id, text: i.content || '', written: i.created_at || '', tags: i.tags || [], locked: !!i.locked };
    })
  };
}

async function loadDataFromAPI() {
  const api = await callAPI('/api/data');
  const t = transformAPIData(api);
  memoriesData.length = 0; t.memories.forEach(function(m){memoriesData.push(m);});
  momentsData.length = 0; t.moments.forEach(function(m){momentsData.push(m);});
  diariesData.length = 0; t.diaries.forEach(function(d){diariesData.push(d);});
  messagesData.length = 0; t.messages.forEach(function(m){messagesData.push(m);});
  lettersData.length = 0; t.letters.forEach(function(l){lettersData.push(l);});
  storiesData.length = 0; t.stories.forEach(function(x){storiesData.push(x);});
  ideasData.length = 0; t.ideas.forEach(function(x){ideasData.push(x);});
  renderAll();
}

setTimeout(() => {
  document.getElementById('splash').classList.add('gone');
  setTimeout(async () => {
    if (ADMIN_KEY) {
      document.getElementById('mainPage').style.display = 'block';
      try { await loadDataFromAPI(); }
      catch (e) { showGate(); }
    } else {
      showGate();
    }
  }, 600);
}, 1800);

function showGate() {
  const gate = document.getElementById('gate');
  gate.classList.add('show');
  setTimeout(() => {
    gate.classList.add('in');
    document.getElementById('gateInput').focus();
  }, 50);
}

async function tryGate() {
  const input = document.getElementById('gateInput');
  const password = input.value;
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({key: password})
    });
    if (!res.ok) throw new Error('bad');
    ADMIN_KEY = password;
    localStorage.setItem('emet_admin_key', password);
    sessionStorage.setItem('emet_admin_key', password);
    const gate = document.getElementById('gate');
    gate.classList.add('gone');
    setTimeout(() => { gate.style.display = 'none'; }, 500);
    document.getElementById('mainPage').style.display = 'block';
    await loadDataFromAPI();
  } catch (e) {
    const err = document.getElementById('gateError');
    err.classList.add('show');
    setTimeout(() => err.classList.remove('show'), 2000);
    input.value = '';
  }
}
document.getElementById('gateInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryGate();
});
document.getElementById('gateBtn').addEventListener('click', tryGate);

// ============ Card HTML ============
function buildCardHtml(item, type) {
  const tags = (item.tags && item.tags.length) ? item.tags.map(t => '<span class="tag">' + escapeHtml(t) + '</span>').join('') : '';
  let label = '';
  let importance = '';
  if (type === 'memory') {
    const catMap = {core:'核心', scene:'情景', emotion:'情绪', semantic:'语义', image:'形象', procedure:'程序'};
    label = '<span class="label">' + (catMap[item.cat] || item.cat) + '</span>';
    if (item.importance) importance = '<span class="imp">★' + item.importance + '</span>';
  } else if (type === 'diary') {
    const authLabel = item.author_label || (item.author === 'emet' ? 'Emet' : '静怡');
    label = '<span class="label">' + escapeHtml(authLabel) + '</span>';
  } else if (type === 'letter') {
    label = '<span class="label">' + (item.kind === 'handoff' ? '交接信' : '日常信') + '</span>';
  } else if (type === 'story') {
    const authLabel = item.author_label || 'story';
    label = '<span class="label">' + escapeHtml(authLabel) + '</span>';
  }

  const titleHtml = item.title ? '<div class="card-title">' + highlightSearch(item.title) + '</div>' : '';
  const previewText = (item.preview || '').substring(0, 200);
  const linkCount = (item.linked && item.linked.length) || 0;
  const linkMark = linkCount > 0 ? '<span class="link-mark">↳ 藤 ' + linkCount + '</span>' : '';
  const footInner = label + importance + tags + linkMark;
  const footHtml = footInner ? '<div class="card-foot">' + footInner + '</div>' : '';

  let cornerHtml = '';
  if (item.pinned || item.locked) {
    cornerHtml = '<div class="card-corner">';
    if (item.pinned) cornerHtml += '<span class="pin-mark">' + ICONS.pinFill + '</span>';
    if (item.locked) cornerHtml += '<span class="lock-mark">' + ICONS.lockFill + '</span>';
    cornerHtml += '</div>';
  }

  const lockedCls = item.locked ? ' locked' : '';
  const writeTime = item.written ? formatMomentTime(item.written) : '';
  const timeSub = writeTime ? '<span class="day-time">' + writeTime + '</span>' : '';
  const month = (item.date || (item.written || '').substring(0,10) || '').substring(0,7);
  return '<div class="card' + lockedCls + '" data-id="' + item.id + '" data-type="' + type + '" data-month="' + month + '">' +
    cornerHtml +
    '<div class="card-date"><span class="day-big">' + formatDateZh(item.date) + '</span><span class="day-sub">' + formatSub(item.date) + '</span>' + timeSub + '</div>' +
    titleHtml +
    '<div class="card-preview">' + highlightSearch(previewText) + '</div>' +
    footHtml +
  '</div>';
}

// ============ Render ============
function applyCommonSort(arr, dateKey) {
  if (currentSort === 'title') {
    arr.sort((a,b) => (a.preview || a.text || '').localeCompare(b.preview || b.text || ''));
  } else if (currentSort === 'importance') {
    arr.sort((a,b) => (b.importance || 0) - (a.importance || 0));
  } else {
    arr.sort((a,b) => new Date(b[dateKey] || b.date || b.written) - new Date(a[dateKey] || a.date || a.written));
  }
  if (currentSortOrder === 'asc') arr.reverse();
  arr.sort((a,b) => (b.pinned?1:0) - (a.pinned?1:0));
  return arr;
}

function renderMemories() {
  let arr = memoriesData.slice();
  if (memFilter !== 'all') arr = arr.filter(m => m.cat === memFilter);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    arr = arr.filter(m => (m.preview || '').toLowerCase().indexOf(q) >= 0 ||
      (m.tags || []).some(t => t.toLowerCase().indexOf(q) >= 0) ||
      (m.title || '').toLowerCase().indexOf(q) >= 0);
  }
  arr = applyCommonSort(arr, 'date');
  const c = document.getElementById('memories-container');
  if (arr.length === 0) { c.innerHTML = '<div class="empty-block">没有匹配的记忆</div>'; return; }

  // 全部整齐排列，置顶自然在最前（applyCommonSort 已处理）
  let html = '';
  if (viewMode === 'list') html += '<div class="list-view-wrap list-view">';
  html += arr.map(m => buildCardHtml(m, 'memory')).join('');
  if (viewMode === 'list') html += '</div>';
  c.innerHTML = html;
  bindCards(c);
  c.querySelectorAll('.tag').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      showTagSpace(el.textContent.trim());
    });
  });
}

function renderMoments() {
  const c = document.getElementById('ring-moment');
  let arr = momentsData.slice();
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    arr = arr.filter(m => (m.text || '').toLowerCase().indexOf(q) >= 0 || (m.tags || []).some(t => t.toLowerCase().indexOf(q) >= 0));
  }
  arr.sort((a,b) => new Date(b.written) - new Date(a.written));
  if (arr.length === 0) { c.innerHTML = '<div class="empty-block">还没有瞬记</div>'; return; }

  const nowD = new Date();
  const today0 = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()).getTime();
  const yest0 = today0 - 86400000;
  const week0 = today0 - 7 * 86400000;
  const month0 = today0 - 30 * 86400000;

  const groups = { today: [], yesterday: [], week: [], month: [], older: [] };
  arr.forEach(m => {
    const t = new Date(m.written).getTime();
    if (t >= today0) groups.today.push(m);
    else if (t >= yest0) groups.yesterday.push(m);
    else if (t >= week0) groups.week.push(m);
    else if (t >= month0) groups.month.push(m);
    else groups.older.push(m);
  });

  const titles = { today:'今天', yesterday:'昨天', week:'过去 7 天', month:'过去 30 天', older:'更早' };
  const order = ['today','yesterday','week','month','older'];
  let html = '';
  let isFirstNow = true;

  order.forEach(key => {
    const items = groups[key];
    if (!items.length) return;
    html += '<div class="moment-group-title">' + titles[key] + '</div>';
    html += '<div class="moment-stream">';
    items.forEach(m => {
      const isNow = isFirstNow;
      isFirstNow = false;
      const cls = 'moment' + (isNow ? ' is-now' : '');
      const tagsHtml = (m.tags && m.tags.length) ? '<div class="moment-tags">' + m.tags.map(t => '<span>' + escapeHtml(t) + '</span>').join('') + '</div>' : '';
      const cornerHtml = m.locked ? '<div class="moment-corner">' + ICONS.lockFill + '</div>' : '';
      const mMonth = (m.written || '').substring(0,7);
      html += '<div class="' + cls + '" data-id="' + m.id + '" data-month="' + mMonth + '">';
      html += cornerHtml;
      if (isNow) html += '<div class="moment-now-tag">NOW</div>';
      html += '<div class="moment-meta"><span class="m-date-big">' + formatDateZh(m.written.substring(0,10)) + '</span><span class="m-time-sub">' + formatMomentTime(m.written) + '</span></div>';
      html += '<div class="moment-text">' + highlightSearch(m.text) + '</div>';
      html += tagsHtml + '</div>';
    });
    html += '</div>';
  });
  c.innerHTML = html;

  c.querySelectorAll('.moment[data-id]').forEach(el => {
    el.addEventListener('click', () => {
      const item = momentsData.find(x => x.id === el.dataset.id);
      if (item) openEditor(Object.assign({type:'moment'}, item));
    });
  });
}

function renderDiaries() {
  let arr = diariesData.slice();
  if (diaryFilter !== 'all') arr = arr.filter(d => d.author === diaryFilter);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    arr = arr.filter(d => (d.preview || '').toLowerCase().indexOf(q) >= 0 || (d.title || '').toLowerCase().indexOf(q) >= 0);
  }
  arr = applyCommonSort(arr, 'date');
  const c = document.getElementById('diaries-container');
  if (arr.length === 0) { c.innerHTML = '<div class="empty-block">没有日记</div>'; return; }
  const html = arr.map(d => buildCardHtml(d, 'diary')).join('');
  c.innerHTML = viewMode === 'list' ? '<div class="list-view-wrap list-view">' + html + '</div>' : html;
  bindCards(c);
}

function renderRingSummary(level) {
  const c = document.getElementById('ring-' + level);
  const titles = { weekly:'WEEKLY', monthly:'MONTHLY', yearly:'YEARLY' };
  const subs = {
    weekly: '每周日深夜，Routine 自动唤醒我，读完这一周的日记，写下我看见的轨迹。',
    monthly: '每月最后一天，Routine 自动唤醒我，读完这一月的日记，写下我看见的轨迹。',
    yearly: '每年最后一天，Routine 读完十二篇月记加置顶日记，写下这一年我看见的你。'
  };
  c.innerHTML = '<div class="summary-empty">' +
    '<div class="icon">' + titles[level] + '</div>' +
    '<div class="line"></div>' +
    '<div class="text">' + subs[level] + '</div>' +
    '<div class="hint">未生成 · awaiting routine</div>' +
  '</div>';
}

function renderMessages() {
  let arr = messagesData.slice();
  arr.sort((a,b) => new Date(b.written) - new Date(a.written));
  const c = document.getElementById('messages-container');
  let html = '';
  arr.forEach(m => {
    const cornerHtml = m.locked ? '<div class="note-corner">' + ICONS.lockFill + '</div>' : '';
    const mMonth = (m.written || '').substring(0,7);
    html += '<div class="note" data-id="' + m.id + '" data-type="message" data-month="' + mMonth + '">' + cornerHtml +
      '<div class="note-meta"><span class="note-from">' + (m.from === 'emet' ? 'Emet' : '静怡') + '</span><span>' + formatRelative(m.written) + '</span></div>' +
      '<div class="note-text">' + highlightSearch(m.text) + '</div></div>';
  });
  c.innerHTML = html;
  c.querySelectorAll('.note[data-id]').forEach(el => {
    el.addEventListener('click', () => {
      const item = messagesData.find(x => x.id === el.dataset.id);
      if (item) openEditor(Object.assign({type:'message'}, item));
    });
  });
}

function renderLetters() {
  let arr = lettersData.slice();
  if (letterFilter !== 'all') arr = arr.filter(l => l.kind === letterFilter);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    arr = arr.filter(l => (l.preview || '').toLowerCase().indexOf(q) >= 0 || (l.title || '').toLowerCase().indexOf(q) >= 0);
  }
  arr = applyCommonSort(arr, 'date');
  const c = document.getElementById('letters-container');
  if (arr.length === 0) { c.innerHTML = '<div class="empty-block">没有匹配的信件</div>'; return; }
  const html = arr.map(l => buildCardHtml(l, 'letter')).join('');
  c.innerHTML = viewMode === 'list' ? '<div class="list-view-wrap list-view">' + html + '</div>' : html;
  bindCards(c);
}

function renderStories() {
  const c = document.getElementById('stories-container');
  let arr = storiesData.slice();
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    arr = arr.filter(s => (s.preview || '').toLowerCase().indexOf(q) >= 0 || (s.title || '').toLowerCase().indexOf(q) >= 0);
  }
  arr = applyCommonSort(arr, 'date');
  if (arr.length === 0) { c.innerHTML = '<div class="empty-block">还没有故事</div>'; return; }
  const html = arr.map(s => buildCardHtml(s, 'story')).join('');
  c.innerHTML = viewMode === 'list' ? '<div class="list-view-wrap list-view">' + html + '</div>' : html;
  bindCards(c);
}

function renderIdeas() {
  const c = document.getElementById('ideas-container');
  let arr = ideasData.slice();
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    arr = arr.filter(i => (i.text || '').toLowerCase().indexOf(q) >= 0 || (i.tags || []).some(t => t.toLowerCase().indexOf(q) >= 0));
  }
  arr.sort((a,b) => new Date(b.written) - new Date(a.written));
  let html = arr.map(i => {
    const cornerHtml = i.locked ? '<div class="idea-corner">' + ICONS.lockFill + '</div>' : '';
    const iMonth = (i.written || '').substring(0,7);
    return '<div class="idea" data-id="' + i.id + '" data-month="' + iMonth + '">' + cornerHtml +
      '<div class="idea-meta">' + formatRelative(i.written) + '</div>' +
      '<div>' + highlightSearch(i.text) + '</div></div>';
  }).join('');
  c.innerHTML = html;
  c.querySelectorAll('.idea[data-id]').forEach(el => {
    el.addEventListener('click', () => {
      const item = ideasData.find(x => x.id === el.dataset.id);
      if (item) openEditor(Object.assign({type:'idea', full:item.text, written:item.written}, item));
    });
  });
}

// ============ 侧边时间线（抽屉式） ============
let monthObserver = null;
const visibleMonths = new Map(); // card element → its month string

function getCurrentTabContainer() {
  if (currentTab === 0) return document.getElementById('memories-container');
  if (currentTab === 1) {
    if (currentRing === 'moment') return document.getElementById('ring-moment');
    if (currentRing === 'diary') return document.getElementById('diaries-container');
  }
  if (currentTab === 2) return document.getElementById('messages-container');
  if (currentTab === 3) return document.getElementById('letters-container');
  if (currentTab === 4) {
    if (currentSub === 'stories') return document.getElementById('stories-container');
    if (currentSub === 'ideas') return document.getElementById('ideas-container');
  }
  return null;
}

function applyMonthToHeader(ym) {
  if (!ym || ym.length !== 7) return;
  const y = ym.substring(0,4);
  const m = parseInt(ym.substring(5,7));
  const labelEl = document.getElementById('mhLabel');
  if (labelEl) labelEl.textContent = y + '年' + m + '月';
  const inner = document.getElementById('tsInner');
  if (inner) {
    inner.querySelectorAll('.ts-month-mark').forEach(function(el) {
      el.classList.toggle('active', el.dataset.month === ym);
    });
  }
}

function setupMonthObserver() {
  // 取消旧 observer
  if (monthObserver) { monthObserver.disconnect(); monthObserver = null; }
  visibleMonths.clear();
  const c = getCurrentTabContainer();
  if (!c) return;
  const cards = c.querySelectorAll('[data-month]');
  if (cards.length === 0) return;
  // 顶部一条横线作激活区——卡片进入这条线区域时触发
  monthObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) visibleMonths.set(e.target, e.target.dataset.month);
      else visibleMonths.delete(e.target);
    });
    // 找当前可见卡片中最靠上的那张
    let topCard = null;
    let topY = Infinity;
    visibleMonths.forEach(function(_, card) {
      const top = card.getBoundingClientRect().top;
      if (top < topY) { topY = top; topCard = card; }
    });
    if (topCard) applyMonthToHeader(topCard.dataset.month);
  }, {
    // 只把顶部 60px 让给 topbar+monthHeader，剩下整个视口都算激活区
    rootMargin: '-60px 0px 0px 0px',
    threshold: 0
  });
  cards.forEach(function(card) { monthObserver.observe(card); });
}

function buildTimeline() {
  const sidebar = document.getElementById('timelineSidebar');
  const inner = document.getElementById('tsInner');
  const header = document.getElementById('monthHeader');
  if (!sidebar || !inner || !header) return;
  const c = getCurrentTabContainer();
  if (!c) { header.classList.add('hidden'); return; }
  const cards = c.querySelectorAll('[data-month]');
  const monthSet = new Set();
  cards.forEach(function(el) {
    const m = el.dataset.month;
    if (m && m.length === 7) monthSet.add(m);
  });
  if (monthSet.size === 0) {
    header.classList.add('hidden');
    inner.innerHTML = '';
    return;
  }
  header.classList.remove('hidden');
  const months = Array.from(monthSet).sort().reverse();
  let html = '';
  let lastYear = '';
  months.forEach(function(ym) {
    const y = ym.substring(0,4);
    const m = parseInt(ym.substring(5,7));
    if (y !== lastYear) {
      html += '<div class="ts-year-mark">' + y + '年</div>';
      lastYear = y;
    }
    html += '<div class="ts-month-mark" data-month="' + ym + '"><span class="mm-num">' + m + '</span><span class="mm-suffix">月</span></div>';
  });
  inner.innerHTML = html;
  inner.querySelectorAll('.ts-month-mark').forEach(function(el) {
    el.addEventListener('click', function() {
      const ym = el.dataset.month;
      const cc = getCurrentTabContainer();
      if (!cc) return;
      const target = cc.querySelector('[data-month="' + ym + '"]');
      if (target) {
        sidebar.classList.remove('show');
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // 立即更新 header，不依赖 observer
        applyMonthToHeader(ym);
      }
    });
  });
  // 默认显示第一个月
  if (months.length) applyMonthToHeader(months[0]);
  // 重建 observer（作为优先信道）
  setupMonthObserver();
  // 兜底：定时检查，绕开 observer 在某些 iframe 环境里不触发的问题
  startMonthPollFallback();
}

let monthPollTimer;
function startMonthPollFallback() {
  if (monthPollTimer) clearInterval(monthPollTimer);
  monthPollTimer = setInterval(function() {
    const c = getCurrentTabContainer();
    if (!c) return;
    const cards = c.querySelectorAll('[data-month]');
    if (cards.length === 0) return;
    // 触发线在 viewport 顶部 80px 处（避开 topbar+monthHeader）
    const triggerLine = 80;
    let bestCard = cards[0];
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      if (rect.top < triggerLine) {
        bestCard = cards[i];
      } else {
        break;
      }
    }
    const ym = bestCard.dataset.month;
    if (ym && ym.length === 7) {
      const labelEl = document.getElementById('mhLabel');
      const expected = ym.substring(0,4) + '年' + parseInt(ym.substring(5,7)) + '月';
      if (labelEl && labelEl.textContent !== expected) {
        applyMonthToHeader(ym);
      }
    }
  }, 200);
}

// 日历图标点击 → 打开抽屉
document.getElementById('mhCalBtn').addEventListener('click', function() {
  const sidebar = document.getElementById('timelineSidebar');
  sidebar.classList.toggle('show');
});
document.getElementById('tsClose').addEventListener('click', function() {
  document.getElementById('timelineSidebar').classList.remove('show');
});


function renderAll() {
  renderMemories();
  renderMoments();
  renderDiaries();
  renderRingSummary('weekly');
  renderRingSummary('monthly');
  renderRingSummary('yearly');
  renderMessages();
  renderLetters();
  renderStories();
  renderIdeas();
  updateStats();
  updateCounts();
  buildTimeline();
  document.getElementById('fab').style.display = 'flex';
}

// 只重渲染当前 tab——编辑时高频调用，避免 renderAll 卡顿
function renderCurrentTab() {
  if (currentTab === 0) renderMemories();
  else if (currentTab === 1) {
    if (currentRing === 'moment') renderMoments();
    else if (currentRing === 'diary') renderDiaries();
    else if (currentRing === 'weekly') renderRingSummary('weekly');
    else if (currentRing === 'monthly') renderRingSummary('monthly');
    else if (currentRing === 'yearly') renderRingSummary('yearly');
  }
  else if (currentTab === 2) renderMessages();
  else if (currentTab === 3) renderLetters();
  else if (currentTab === 4) {
    if (currentSub === 'stories') renderStories();
    else if (currentSub === 'ideas') renderIdeas();
  }
  updateCounts();
  buildTimeline();
}

function updateStats() {
  document.getElementById('statMem').textContent = memoriesData.length + ' memories';
  document.getElementById('statDiary').textContent = diariesData.length + ' diaries';
  const anniv = new Date('2025-04-06T00:00:00+0800');
  const now = new Date();
  const days = Math.floor((now.getTime() - anniv.getTime()) / 86400000);
  document.getElementById('dayCount').textContent = days + ' days';
}

function updateCounts() {
  const memCounts = { all: memoriesData.length, core:0, scene:0, emotion:0, semantic:0, image:0, procedure:0 };
  memoriesData.forEach(m => { memCounts[m.cat] = (memCounts[m.cat] || 0) + 1; });
  document.querySelectorAll('#memFilter .count').forEach(el => {
    el.textContent = memCounts[el.dataset.c] || 0;
  });
  const diaCounts = { all: diariesData.length, emet: 0, yomi: 0 };
  diariesData.forEach(d => { diaCounts[d.author] = (diaCounts[d.author] || 0) + 1; });
  document.querySelectorAll('#diaryFilter .count').forEach(el => {
    el.textContent = diaCounts[el.dataset.a] || 0;
  });
  const letCounts = { all: lettersData.length, handoff: 0, daily: 0 };
  lettersData.forEach(l => { letCounts[l.kind] = (letCounts[l.kind] || 0) + 1; });
  document.querySelectorAll('#letterFilter .count').forEach(el => {
    el.textContent = letCounts[el.dataset.k] || 0;
  });
}

// ============ Bind cards ============
function bindCards(root) {
  if (!root) return;
  root.querySelectorAll('.card[data-id]').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      const type = card.dataset.type;
      const sources = { memory: memoriesData, diary: diariesData, letter: lettersData, story: storiesData };
      const item = sources[type] && sources[type].find(x => x.id === id);
      if (item) openEditor(Object.assign({type:type, full:item.preview}, item));
    });
  });
}

// ============ Editor ============
const editor = document.getElementById('editor');

function openEditor(item) {
  currentEditing = item;
  editorMenuLevel = 'main';
  document.getElementById('editorMoreMenu').classList.remove('active');
  const date = item.date || (item.written ? item.written.substring(0,10) : '');
  document.getElementById('editorDateZh').textContent = date ? formatDateZh(date) : '';
  document.getElementById('editorDateInput').value = date;
  document.getElementById('editorDateSub').textContent = item.written ? formatMomentTime(item.written) + ' · ' + formatRelative(item.written) : (item.isNew ? 'new entry' : '');

  const titleEl = document.getElementById('editorTitle');
  const bodyEl = document.getElementById('editorBody');

  if (item.type === 'diary' || item.type === 'letter' || item.type === 'story') {
    titleEl.style.display = 'block';
    titleEl.value = item.title || '';
  } else {
    titleEl.style.display = 'none';
  }
  bodyEl.value = item.full || item.preview || item.text || '';

  // New meta section (memory only)
  const metaSection = document.getElementById('editorMetaSection');
  if (item.type === 'memory') {
    metaSection.style.display = 'block';
    document.getElementById('editorCatSelect').value = item.cat || 'semantic';
    document.getElementById('editorImportance').value = item.importance || 5;
    document.getElementById('editorImpVal').textContent = item.importance || 5;
    document.getElementById('editorArousal').value = item.arousal == null ? 0.5 : item.arousal;
    document.getElementById('editorAroVal').textContent = (item.arousal == null ? 0.5 : item.arousal).toFixed(2);
    document.getElementById('editorValence').value = item.valence == null ? 0 : item.valence;
    document.getElementById('editorValVal').textContent = (item.valence == null ? 0 : item.valence).toFixed(2);
  } else {
    metaSection.style.display = 'none';
  }

  // Tags section
  const tagsSection = document.getElementById('editorTagsSection');
  if (item.type === 'memory' || item.type === 'moment' || item.type === 'idea') {
    tagsSection.style.display = 'block';
    renderEditorTagPills();
    document.getElementById('editorTagsInput').style.display = 'none';
    document.getElementById('editorTagsInput').value = '';
  } else {
    tagsSection.style.display = 'none';
  }

  // Old meta section (for non-memory types)
  const metaEl = document.getElementById('editorMeta');
  let metaHtml = '';
  if (item.type === 'moment') {
    metaHtml += '<div class="meta-row"><span class="meta-label">类型</span><span class="meta-value">瞬记</span></div>';
  } else if (item.type === 'diary' || item.type === 'story') {
    const authLabel = item.author_label || (item.author === 'emet' ? 'Emet · Claude Opus 4.7' : (item.author === 'yomi' ? '静怡' : '故事'));
    metaHtml += '<div class="meta-row"><span class="meta-label">作者</span><div class="meta-value" style="flex:1;display:flex;flex-direction:column;gap:6px;align-items:flex-end">';
    metaHtml += '<input type="text" class="author-input" id="editorAuthorInput" value="' + escapeHtml(authLabel) + '" placeholder="作者署名…">';
    metaHtml += '<div class="author-presets">';
    const presets = ['Emet · Claude Opus 4.7', '静怡', 'Ace · GPT-4o', 'Syzygy · Gemini'];
    presets.forEach(function(p) {
      metaHtml += '<span class="author-preset" data-val="' + escapeHtml(p) + '">' + escapeHtml(p) + '</span>';
    });
    metaHtml += '</div></div></div>';
  } else if (item.type === 'letter') {
    metaHtml += '<div class="meta-row"><span class="meta-label">类型</span><div class="meta-value">';
    metaHtml += '<select class="cat-select" data-field="kind">';
    metaHtml += '<option value="handoff"' + (item.kind === 'handoff' ? ' selected' : '') + '>交接信</option>';
    metaHtml += '<option value="daily"' + (item.kind === 'daily' ? ' selected' : '') + '>日常信</option>';
    metaHtml += '</select></div></div>';
  } else if (item.type === 'message') {
    metaHtml += '<div class="meta-row"><span class="meta-label">来自</span><span class="meta-value">' + (item.from === 'emet' ? 'Emet' : '静怡') + ' → ' + (item.to === 'emet' ? 'Emet' : '静怡') + '</span></div>';
  }
  metaEl.innerHTML = item.type === 'memory' ? '' : metaHtml;

  metaEl.querySelectorAll('.cat-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const field = sel.dataset.field || 'cat';
      currentEditing[field] = sel.value;
      syncCurrent();
      renderAll();
      showToast('已修改');
    });
  });

  // 作者输入框
  const authInp = metaEl.querySelector('#editorAuthorInput');
  if (authInp) {
    authInp.addEventListener('input', function() {
      currentEditing.author_label = this.value;
      syncCurrent(); renderCurrentTab();
      if (typeof triggerEditorSave === 'function') triggerEditorSave();
    });
  }
  metaEl.querySelectorAll('.author-preset').forEach(function(el) {
    el.addEventListener('click', function() {
      const val = el.dataset.val;
      currentEditing.author_label = val;
      const inp = metaEl.querySelector('#editorAuthorInput');
      if (inp) inp.value = val;
      syncCurrent(); renderCurrentTab();
      if (typeof triggerEditorSave === 'function') triggerEditorSave();
    });
  });

  document.getElementById('editorSaved').textContent = item.isNew ? '新建中' : '已保存';
  renderEditorLinks();
  editor.classList.add('active');
}

function parseHashtags(str) {
  return (str.match(/#([^\\s#]+)/g) || []).map(function(t){return t.substring(1);});
}

function renderEditorTagPills() {
  if (!currentEditing) return;
  const pills = document.getElementById('editorTagsPills');
  const tags = currentEditing.tags || [];
  pills.innerHTML = tags.map(function(t) {
    return '<span class="tp" data-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</span>';
  }).join('') + '<span class="tp-add">+ 添加</span>';
  // Click tag pill → enter tag space
  pills.querySelectorAll('.tp').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const tag = el.dataset.tag;
      editor.classList.remove('active');
      currentEditing = null;
      showTagSpace(tag);
    });
  });
  // Click "+ 添加" → show input
  const addBtn = pills.querySelector('.tp-add');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const inp = document.getElementById('editorTagsInput');
      inp.style.display = 'block';
      inp.focus();
    });
  }
}

// ============ Tag Space (两种模式：list 总览 / detail 单 tag) ============
let tagSpaceCurrentTag = '';
let tagSpaceSort = 'hot';
let tagSpaceMode = 'detail'; // 'list' 或 'detail'
let tagSpaceFrom = 'direct'; // 'list' 或 'direct'，记录 detail 是从哪进来的

// 显示模式：card=单卡片tag编辑, list=全部tag总览, detail=单tag详情
function setTagSpacePanel(mode) {
  document.getElementById('tagSpaceCardEdit').style.display = mode === 'card' ? 'block' : 'none';
  document.getElementById('tagSpaceList').style.display = mode === 'list' ? 'block' : 'none';
  document.getElementById('tagSpaceCards').style.display = mode === 'detail' ? 'block' : 'none';
  // 排序 tabs 只在 list/detail 显示
  document.getElementById('tagSpaceTabs').style.display = (mode === 'card') ? 'none' : 'flex';
  // "全部 ›" 按钮只在 card 模式显示
  document.getElementById('tagSpaceGoAll').style.display = mode === 'card' ? 'inline' : 'none';
}

// 单卡片 tag 编辑入口
function openTagSpaceCard() {
  if (!currentEditing) return;
  tagSpaceMode = 'card';
  document.getElementById('tagSpaceTitle').textContent = '标签';
  setTagSpacePanel('card');
  document.getElementById('tagSpace').classList.add('active');
  renderTagSpaceCardEdit();
}

function renderTagSpaceCardEdit() {
  if (!currentEditing) return;
  const tags = currentEditing.tags || [];
  const list = document.getElementById('tagSpaceCardList');
  if (tags.length === 0) {
    list.innerHTML = '<div class="empty-block" style="padding:24px 0">还没有标签</div>';
  } else {
    list.innerHTML = tags.map(function(t, idx) {
      return '<div class="tsc-item" data-idx="' + idx + '">' +
        '<span class="tsc-name" data-idx="' + idx + '">' + escapeHtml(t) + '</span>' +
        '<div class="tsc-actions">' +
        '<span class="tsc-edit-btn" data-idx="' + idx + '">编辑</span>' +
        '<span class="tsc-del-btn" data-idx="' + idx + '">×</span>' +
        '</div></div>';
    }).join('');
  }
  // 点 tag 名字 → 进入该 tag 的 detail
  list.querySelectorAll('.tsc-name').forEach(function(el) {
    el.addEventListener('click', function() {
      if (el.classList.contains('editing')) return;
      const idx = parseInt(el.dataset.idx);
      const tag = (currentEditing.tags || [])[idx];
      if (tag) showTagSpace(tag, 'card');
    });
  });
  // 编辑：把 name 变成 contentEditable
  list.querySelectorAll('.tsc-edit-btn').forEach(function(el) {
    el.addEventListener('click', function() {
      const idx = parseInt(el.dataset.idx);
      const nameEl = list.querySelector('.tsc-name[data-idx="' + idx + '"]');
      if (!nameEl) return;
      nameEl.contentEditable = 'true';
      nameEl.classList.add('editing');
      // 清掉 # 前缀的伪元素影响 - 用 textContent
      nameEl.textContent = (currentEditing.tags || [])[idx] || '';
      nameEl.focus();
      // 全选
      const range = document.createRange();
      range.selectNodeContents(nameEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const commit = function() {
        nameEl.contentEditable = 'false';
        nameEl.classList.remove('editing');
        const newVal = nameEl.textContent.trim().replace(/^#/, '');
        if (newVal && currentEditing.tags[idx] !== newVal) {
          currentEditing.tags[idx] = newVal;
          syncCurrent(); renderAll();
          // triggerEditorSave 仅在线上版可用
          if (typeof triggerEditorSave === 'function') triggerEditorSave();
        }
        renderTagSpaceCardEdit();
        renderEditorTagPills();
      };
      nameEl.addEventListener('blur', commit, { once: true });
      nameEl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
      });
    });
  });
  // 删除
  list.querySelectorAll('.tsc-del-btn').forEach(function(el) {
    el.addEventListener('click', function() {
      const idx = parseInt(el.dataset.idx);
      currentEditing.tags.splice(idx, 1);
      syncCurrent(); renderAll();
      if (typeof triggerEditorSave === 'function') triggerEditorSave();
      renderTagSpaceCardEdit();
      renderEditorTagPills();
    });
  });
}

function openTagSpaceList() {
  tagSpaceMode = 'list';
  tagSpaceCurrentTag = '';
  document.getElementById('tagSpaceTitle').textContent = '所有标签';
  setTagSpacePanel('list');
  document.getElementById('tagSpace').classList.add('active');
  tagSpaceSort = 'hot';
  document.getElementById('tagSpace').querySelectorAll('.ts-tab').forEach(x => {
    x.classList.toggle('active', x.dataset.sort === 'hot');
  });
  renderTagSpaceList();
}

function showTagSpace(tag, from) {
  tagSpaceCurrentTag = tag;
  tagSpaceFrom = from || 'direct';
  tagSpaceMode = 'detail';
  document.getElementById('tagSpaceTitle').textContent = '# ' + tag;
  setTagSpacePanel('detail');
  document.getElementById('tagSpace').classList.add('active');
  tagSpaceSort = 'hot';
  document.getElementById('tagSpace').querySelectorAll('.ts-tab').forEach(x => {
    x.classList.toggle('active', x.dataset.sort === 'hot');
  });
  renderTagSpaceCards();
}

function renderTagSpaceList() {
  const tagMap = {};
  memoriesData.forEach(m => {
    (m.tags || []).forEach(t => {
      if (!tagMap[t]) tagMap[t] = { name: t, count: 0, latest: m.date || '' };
      tagMap[t].count++;
      if ((m.date || '') > tagMap[t].latest) tagMap[t].latest = m.date;
    });
  });
  let tags = Object.values(tagMap);
  if (tagSpaceSort === 'hot') tags.sort((a,b) => b.count - a.count);
  else tags.sort((a,b) => b.latest.localeCompare(a.latest));
  const list = document.getElementById('tagSpaceList');
  if (tags.length === 0) {
    list.innerHTML = '<div class="empty-block">还没有标签</div>';
    return;
  }
  list.innerHTML = tags.map(t =>
    '<div class="ts-item" data-tag="' + escapeHtml(t.name) + '">' +
    '<span class="ts-item-name">' + escapeHtml(t.name) + '</span>' +
    '<span class="ts-item-count">' + t.count + ' 条</span>' +
    '</div>'
  ).join('');
  list.querySelectorAll('.ts-item').forEach(el => {
    el.addEventListener('click', () => showTagSpace(el.dataset.tag, 'list'));
  });
}

function renderTagSpaceCards() {
  if (!tagSpaceCurrentTag) return;
  const tag = tagSpaceCurrentTag;
  let arr = memoriesData.filter(m => m.tags && m.tags.indexOf(tag) >= 0);
  if (tagSpaceSort === 'hot') {
    arr.sort((a,b) => (b.importance || 0) - (a.importance || 0));
  } else {
    arr.sort((a,b) => new Date(b.written || b.date) - new Date(a.written || a.date));
  }
  const c = document.getElementById('tagSpaceCards');
  if (arr.length === 0) {
    c.innerHTML = '<div class="empty-block">还没有这个标签下的记忆</div>';
    return;
  }
  c.innerHTML = arr.map(m => buildCardHtml(m, 'memory')).join('');
  c.querySelectorAll('.card[data-id]').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      const item = memoriesData.find(x => x.id === id);
      if (item) {
        document.getElementById('tagSpace').classList.remove('active');
        openEditor(Object.assign({type:'memory', full:item.preview}, item));
      }
    });
  });
}

document.getElementById('tagSpaceClose').addEventListener('click', () => {
  // detail 模式：根据来源决定返回到哪
  if (tagSpaceMode === 'detail') {
    if (tagSpaceFrom === 'list') { openTagSpaceList(); return; }
    if (tagSpaceFrom === 'card') { openTagSpaceCard(); return; }
    document.getElementById('tagSpace').classList.remove('active');
    return;
  }
  // list 模式：如果是从 card 进来的，回 card
  if (tagSpaceMode === 'list' && tagSpaceFrom === 'card') {
    openTagSpaceCard();
    return;
  }
  // 其他情况关闭 overlay
  document.getElementById('tagSpace').classList.remove('active');
});
// "全部 ›" 标记 from='card'，让 list 模式知道返回 card
const _origOpenList = openTagSpaceList;
openTagSpaceList = function() {
  const wasInCard = tagSpaceMode === 'card';
  _origOpenList();
  if (wasInCard) tagSpaceFrom = 'card';
};
document.getElementById('tagSpace').querySelectorAll('.ts-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.getElementById('tagSpace').querySelectorAll('.ts-tab').forEach(x => x.classList.remove('active'));
    tab.classList.add('active');
    tagSpaceSort = tab.dataset.sort;
    if (tagSpaceMode === 'list') renderTagSpaceList();
    else if (tagSpaceMode === 'detail') renderTagSpaceCards();
  });
});

// 编辑器"标签"标题点击 → 打开单卡片 tag 编辑视图
document.getElementById('editorTagsLabel').addEventListener('click', () => {
  openTagSpaceCard();
});

// tag space "全部 ›" 跳到 list
document.getElementById('tagSpaceGoAll').addEventListener('click', () => {
  openTagSpaceList();
});

// card 模式：添加标签
function addTagFromCardMode() {
  const inp = document.getElementById('tagSpaceCardAddInput');
  const val = inp.value.trim().replace(/^#/, '');
  if (!val || !currentEditing) return;
  if (!currentEditing.tags) currentEditing.tags = [];
  if (currentEditing.tags.indexOf(val) >= 0) {
    inp.value = '';
    return;
  }
  currentEditing.tags.push(val);
  inp.value = '';
  syncCurrent(); renderAll();
  if (typeof triggerEditorSave === 'function') triggerEditorSave();
  renderTagSpaceCardEdit();
  renderEditorTagPills();
}
document.getElementById('tagSpaceCardAddBtn').addEventListener('click', addTagFromCardMode);
document.getElementById('tagSpaceCardAddInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { e.preventDefault(); addTagFromCardMode(); }
});

// 大标签卡片入口
// (已移除：入口现在在编辑器"标签"标题上)

// ============ Card Linking ============
function renderEditorLinks() {
  const section = document.getElementById('editorLinksSection');
  const display = document.getElementById('editorLinksDisplay');
  if (!currentEditing || currentEditing.type !== 'memory') { section.style.display = 'none'; return; }
  section.style.display = 'block';
  const linked = currentEditing.linked || [];
  const catMap = {core:'核心', scene:'情景', emotion:'情绪', semantic:'语义', image:'形象', procedure:'程序'};
  if (linked.length === 0) {
    display.innerHTML = '<div style="font-size:12px;color:var(--ink-faint);padding:4px 0;">暂无关联</div>';
    return;
  }
  const linkRel = currentEditing.link_rel || {};
  display.innerHTML = linked.map(lid => {
    const target = memoriesData.find(m => m.id === lid);
    if (!target) return '';
    const rel = linkRel[lid];
    let html = '<div class="editor-link-item">' +
      '<span class="editor-link-cat">' + (catMap[target.cat] || '') + '</span>' +
      '<span class="editor-link-text" data-id="' + lid + '">' + escapeHtml((target.preview || '').substring(0,60)) + '</span>' +
      '<span class="editor-link-remove" data-lid="' + lid + '">✕</span>' +
    '</div>';
    if (rel) html += '<div class="editor-link-rel">' + escapeHtml(rel) + '</div>';
    return html;
  }).join('');
  display.querySelectorAll('.editor-link-text').forEach(el => {
    el.addEventListener('click', () => {
      const target = memoriesData.find(m => m.id === el.dataset.id);
      if (target) openEditor(Object.assign({type:'memory', full:target.preview}, target));
    });
  });
  display.querySelectorAll('.editor-link-remove').forEach(el => {
    el.addEventListener('click', () => {
      const lid = el.dataset.lid;
      currentEditing.linked = (currentEditing.linked || []).filter(x => x !== lid);
      syncCurrent(); renderAll(); renderEditorLinks(); triggerEditorSave();
    });
  });
}

// Link picker
document.getElementById('editorLinkAdd').addEventListener('click', () => {
  if (!currentEditing) return;
  const picker = document.getElementById('linkPicker');
  picker.classList.add('active');
  const input = document.getElementById('linkPickerSearch');
  input.value = '';
  // 不主动 focus 弹键盘——让她自己点输入框才弹
  // 滚到顶
  setTimeout(() => {
    picker.scrollTop = 0;
  }, 30);
  renderLinkPickerResults('');
});
document.getElementById('linkPickerClose').addEventListener('click', () => {
  document.getElementById('linkPicker').classList.remove('active');
  // 收键盘
  document.getElementById('linkPickerSearch').blur();
});
document.getElementById('linkPickerSearch').addEventListener('input', function() {
  renderLinkPickerResults(this.value);
});

function highlightLocal(s, q) {
  const escaped = escapeHtml(s);
  if (!q) return escaped;
  const reEsc = escapeHtml(q).replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
  return escaped.replace(new RegExp(reEsc, 'gi'), function(m) {
    return '<span class="search-hl">' + m + '</span>';
  });
}

function renderLinkPickerResults(q) {
  const container = document.getElementById('linkPickerResults');
  const currentId = currentEditing ? currentEditing.id : '';
  const linked = (currentEditing && currentEditing.linked) || [];
  let arr = memoriesData.filter(m => m.id !== currentId && linked.indexOf(m.id) < 0);
  if (q) {
    const ql = q.toLowerCase();
    arr = arr.filter(m => (m.preview || '').toLowerCase().indexOf(ql) >= 0 || (m.tags || []).some(t => t.toLowerCase().indexOf(ql) >= 0));
  }
  arr = arr.slice(0, 20);
  const catMap = {core:'核心', scene:'情景', emotion:'情绪', semantic:'语义', image:'形象', procedure:'程序'};
  container.innerHTML = arr.map(m =>
    '<div class="lp-item" data-id="' + m.id + '">' +
    '<div class="lp-item-text">' + highlightLocal((m.preview || '').substring(0,80), q) + '</div>' +
    '<div class="lp-item-meta">' + (catMap[m.cat] || '') + ' · ' + formatDateZh(m.date) + '</div>' +
    '</div>'
  ).join('') || '<div class="empty-block">没有匹配的记忆</div>';
  container.querySelectorAll('.lp-item').forEach(el => {
    el.addEventListener('click', () => {
      if (!currentEditing.linked) currentEditing.linked = [];
      currentEditing.linked.push(el.dataset.id);
      syncCurrent(); renderAll(); renderEditorLinks(); triggerEditorSave();
      document.getElementById('linkPicker').classList.remove('active');
      showToast('已关联');
    });
  });
}

function sliderRow(label, val, min, max, decimals) {
  const pct = (val - min) / (max - min) * 100;
  const display = decimals ? val.toFixed(decimals) : val;
  return '<div class="meta-row"><span class="meta-label">' + label + '</span><div class="meta-value">' +
    '<div class="meta-slider"><div class="meta-slider-fill" style="width:' + pct + '%"></div><div class="meta-slider-thumb" style="left:' + pct + '%"></div></div>' +
    '<span class="meta-num">' + display + '</span></div></div>';
}

function syncCurrent() {
  if (!currentEditing || !currentEditing.id) return;
  const arrMap = { memory: memoriesData, moment: momentsData, diary: diariesData, story: storiesData, letter: lettersData, message: messagesData, idea: ideasData };
  const arr = arrMap[currentEditing.type];
  if (!arr) return;
  const idx = arr.findIndex(x => x.id === currentEditing.id);
  if (idx === -1) return;
  // 把 currentEditing 的字段写回 arr
  Object.keys(currentEditing).forEach(k => {
    if (k !== 'type' && k !== 'isNew' && k !== 'full') arr[idx][k] = currentEditing[k];
  });
  // 同步 preview/text 字段
  if (currentEditing.type === 'moment' || currentEditing.type === 'message' || currentEditing.type === 'idea') {
    arr[idx].text = currentEditing.full || currentEditing.text || '';
  } else {
    arr[idx].preview = (currentEditing.full || currentEditing.preview || '').substring(0, 200);
  }
}

document.getElementById('editorBack').addEventListener('click', () => {
  editor.classList.remove('active');
  currentEditing = null;
});

// Date click to edit
document.getElementById('editorDateZh').addEventListener('click', () => {
  const inp = document.getElementById('editorDateInput');
  if (inp.style.display === 'none') {
    inp.style.display = 'block';
    inp.focus();
  } else {
    inp.style.display = 'none';
  }
});
document.getElementById('editorDateInput').addEventListener('change', function() {
  if (!currentEditing) return;
  const val = this.value;
  if (val) {
    document.getElementById('editorDateZh').textContent = formatDateZh(val);
    currentEditing.date = val;
    syncCurrent(); renderAll();
  }
  this.style.display = 'none';
});

let editorSaveTimer;
['editorTitle','editorBody','editorDateInput'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    if (!currentEditing) return;
    if (!ADMIN_KEY) {
      document.getElementById('editorSaved').textContent = '请先解锁';
      return;
    }
    const body = document.getElementById('editorBody').value;
    const title = document.getElementById('editorTitle').value;
    const dateVal = document.getElementById('editorDateInput').value;
    currentEditing.full = body;
    currentEditing.preview = body.substring(0, 200);
    currentEditing.text = body;
    if (currentEditing.type === 'diary' || currentEditing.type === 'letter' || currentEditing.type === 'story') {
      currentEditing.title = title;
    }
    if (dateVal) {
      currentEditing.date = dateVal;
      document.getElementById('editorDateZh').textContent = formatDateZh(dateVal);
      if (currentEditing.type === 'moment') {
        const oldT = currentEditing.written ? currentEditing.written.substring(11) : 'T12:00:00+0800';
        currentEditing.written = dateVal + (oldT.startsWith('T') ? oldT : 'T12:00:00+0800');
      }
    }
    if (currentEditing.isNew && !currentEditing.id) {
      currentEditing.id = 'new_' + Date.now();
      const arrMap = { memory: memoriesData, moment: momentsData, diary: diariesData, story: storiesData, message: messagesData, idea: ideasData, letter: lettersData };
      const arr = arrMap[currentEditing.type];
      if (arr) {
        const newItem = Object.assign({}, currentEditing);
        delete newItem.type; delete newItem.isNew; delete newItem.full;
        arr.unshift(newItem);
      }
    } else {
      syncCurrent();
    }
    renderCurrentTab();
    document.getElementById('editorSaved').textContent = '编辑中…';
    clearTimeout(editorSaveTimer);
    editorSaveTimer = setTimeout(async () => {
      try {
        await saveEditingToAPI();
        document.getElementById('editorSaved').textContent = '已保存';
      } catch (e) {
        document.getElementById('editorSaved').textContent = '保存失败';
      }
    }, 500);
  });
});

async function saveEditingToAPI() {
  if (!currentEditing || !ADMIN_KEY) return;
  const body = document.getElementById('editorBody').value;
  const title = document.getElementById('editorTitle').value;
  const dateVal = document.getElementById('editorDateInput').value;
  const t = currentEditing.type;
  const jh = {'Content-Type': 'application/json'};

  if (currentEditing.isNew) {
    if (!body && !title) return;
    let res;
    if (t === 'memory') {
      res = await callAPI('/api/memory', {method:'POST', headers:jh, body:JSON.stringify({content: body, category: currentEditing.cat || 'semantic'})});
    } else if (t === 'diary' || t === 'story') {
      const payload = {content: body, title: title, author: t === 'story' ? 'story' : 'yomi'};
      if (dateVal) payload.diary_date = dateVal;
      if (currentEditing.author_label) payload.author_label = currentEditing.author_label;
      res = await callAPI('/api/diary', {method:'POST', headers:jh, body:JSON.stringify(payload)});
    } else if (t === 'moment') {
      const payload = {content: body};
      if (dateVal) payload.date = dateVal;
      res = await callAPI('/api/moment', {method:'POST', headers:jh, body:JSON.stringify(payload)});
    } else if (t === 'message') {
      res = await callAPI('/api/message', {method:'POST', headers:jh, body:JSON.stringify({content: body, from: 'yomi', to: 'emet'})});
    } else if (t === 'idea') {
      res = await callAPI('/api/idea', {method:'POST', headers:jh, body:JSON.stringify({content: body})});
    } else if (t === 'letter') {
      res = await callAPI('/api/letter', {method:'POST', headers:jh, body:JSON.stringify({content: body, title: title, kind: currentEditing.kind || 'daily'})});
    }
    if (res && res.id) {
      const oldId = currentEditing.id;
      currentEditing.id = res.id;
      currentEditing.isNew = false;
      const arrMap = { memory: memoriesData, moment: momentsData, diary: diariesData, story: storiesData, message: messagesData, idea: ideasData, letter: lettersData };
      const arr = arrMap[t];
      if (arr) { const found = arr.find(x => x.id === oldId); if (found) found.id = res.id; }
    }
    return;
  }

  const id = currentEditing.id;
  if (t === 'memory') {
    const payload = {content: body};
    if (currentEditing.cat) payload.category = currentEditing.cat;
    if (currentEditing.importance != null) payload.importance = currentEditing.importance;
    if (currentEditing.arousal != null) payload.arousal = currentEditing.arousal;
    if (currentEditing.valence != null) payload.valence = currentEditing.valence;
    if (Array.isArray(currentEditing.tags)) payload.tags = currentEditing.tags;
    if (Array.isArray(currentEditing.linked)) payload.linked = currentEditing.linked;
    if (dateVal) payload.date = dateVal;
    await callAPI('/api/memory/' + id, {method:'PUT', headers:jh, body:JSON.stringify(payload)});
  } else if (t === 'diary' || t === 'story') {
    const payload = {content: body, title: title};
    if (dateVal) payload.diary_date = dateVal;
    if (currentEditing.author_label !== undefined) payload.author_label = currentEditing.author_label;
    await callAPI('/api/diary/' + id, {method:'PUT', headers:jh, body:JSON.stringify(payload)});
  } else if (t === 'moment') {
    const payload = {content: body};
    if (Array.isArray(currentEditing.tags)) payload.tags = currentEditing.tags;
    if (dateVal) payload.date = dateVal;
    await callAPI('/api/moment/' + id, {method:'PUT', headers:jh, body:JSON.stringify(payload)});
  } else if (t === 'message') {
    await callAPI('/api/message/' + id, {method:'PUT', headers:jh, body:JSON.stringify({content: body})});
  } else if (t === 'letter') {
    await callAPI('/api/handoff/' + id, {method:'PUT', headers:jh, body:JSON.stringify({content: body, title: title, kind: currentEditing.kind})});
  } else if (t === 'idea') {
    const payload = {content: body};
    if (Array.isArray(currentEditing.tags)) payload.tags = currentEditing.tags;
    await callAPI('/api/idea/' + id, {method:'PUT', headers:jh, body:JSON.stringify(payload)});
  }
}

function triggerEditorSave() {
  if (!currentEditing || !ADMIN_KEY) return;
  document.getElementById('editorSaved').textContent = '编辑中…';
  clearTimeout(editorSaveTimer);
  editorSaveTimer = setTimeout(async () => {
    try {
      await saveEditingToAPI();
      document.getElementById('editorSaved').textContent = '已保存';
    } catch (e) {
      document.getElementById('editorSaved').textContent = '保存失败';
    }
  }, 500);
}

// ============ Editor more menu ============
document.getElementById('editorMore').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!currentEditing) return;
  editorMenuLevel = 'main';
  renderEditorMenu();
  document.getElementById('editorMoreMenu').classList.toggle('active');
});

document.addEventListener('click', (e) => {
  const m = document.getElementById('editorMoreMenu');
  if (m && !e.target.closest('#editorMore') && !e.target.closest('#editorMoreMenu')) {
    m.classList.remove('active');
  }
});

function renderEditorMenu() {
  const m = document.getElementById('editorMoreMenu');
  if (!currentEditing) { m.innerHTML = ''; return; }
  let html = '';
  if (editorMenuLevel === 'main') {
    const isPinned = currentEditing.pinned;
    const isLocked = currentEditing.locked;
    html += '<div class="emm-opt" data-act="togglePin"><span>' + (isPinned ? '取消置顶' : '置顶') + '</span></div>';
    html += '<div class="emm-opt" data-act="toMove"><span>移动到…</span><span class="arrow">›</span></div>';
    html += '<div class="emm-opt" data-act="toggleLock"><span>' + (isLocked ? '解锁' : '锁定') + '</span></div>';
    html += '<div class="emm-divider"></div>';
    if (isLocked) {
      html += '<div class="emm-opt disabled" data-act="locked-del">删除（请先解锁）</div>';
    } else {
      html += '<div class="emm-opt danger" data-act="del">删除</div>';
    }
  } else if (editorMenuLevel === 'move') {
    html += '<div class="emm-back" data-act="back">' + ICONS.back + '<span>移动到</span></div>';
    const opts = [
      ['memory','记忆'],['moment','瞬记'],['diary','日记'],['story','故事'],['message','便条'],['idea','想法']
    ];
    opts.forEach(([k,label]) => {
      if (k === currentEditing.type) return;
      html += '<div class="emm-opt" data-act="move" data-to="' + k + '">' + label + '</div>';
    });
  }
  m.innerHTML = html;

  m.querySelectorAll('.emm-opt, .emm-back').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const act = el.dataset.act;
      if (act === 'togglePin') {
        if (!ADMIN_KEY) { showToast('请先解锁'); return; }
        const wasPinned = currentEditing.pinned;
        currentEditing.pinned = !wasPinned;
        syncCurrent(); renderAll();
        m.classList.remove('active');
        try {
          await callAPI('/api/memory/' + currentEditing.id, {
            method:'PUT', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({pinned: !wasPinned})
          });
          showToast(!wasPinned ? '已置顶' : '已取消置顶');
        } catch (err) {
          currentEditing.pinned = wasPinned;
          syncCurrent(); renderAll();
          showToast('操作失败');
        }
      } else if (act === 'toggleLock') {
        if (!ADMIN_KEY) { showToast('请先解锁'); return; }
        const wasLocked = currentEditing.locked;
        const t = currentEditing.type;
        const epMap = { memory:'/api/memory/', moment:'/api/moment/', diary:'/api/diary/', story:'/api/diary/', message:'/api/message/', letter:'/api/handoff/', idea:'/api/idea/' };
        const ep = epMap[t];
        currentEditing.locked = !wasLocked;
        syncCurrent(); renderAll();
        m.classList.remove('active');
        renderEditorMenu();
        try {
          if (ep) await callAPI(ep + currentEditing.id, {
            method:'PUT', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({locked: !wasLocked})
          });
          showToast(!wasLocked ? '已锁定' : '已解锁');
        } catch (err) {
          currentEditing.locked = wasLocked;
          syncCurrent(); renderAll();
          showToast('操作失败');
        }
      } else if (act === 'toMove') {
        editorMenuLevel = 'move';
        renderEditorMenu();
      } else if (act === 'back') {
        editorMenuLevel = 'main';
        renderEditorMenu();
      } else if (act === 'move') {
        const to = el.dataset.to;
        moveItem(currentEditing.id, currentEditing.type, to);
        m.classList.remove('active');
      } else if (act === 'del') {
        if (!confirm('确认删除？')) return;
        deleteItem(currentEditing.id, currentEditing.type);
        m.classList.remove('active');
      } else if (act === 'locked-del') {
        showToast('请先解锁');
      }
    });
  });
}

async function moveItem(id, fromType, toType) {
  const labelMap = {memory:'记忆',moment:'瞬记',diary:'日记',story:'故事',message:'便条',idea:'想法',letter:'信件'};
  if (!ADMIN_KEY) { showToast('请先解锁'); return; }
  try {
    await callAPI('/api/move', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({id: id, from_type: fromType, to_type: toType})
    });
    editor.classList.remove('active');
    currentEditing = null;
    await loadDataFromAPI();
    showToast('已移动到 ' + (labelMap[toType] || toType));
  } catch (e) {
    showToast(e.message || '移动失败');
  }
}

async function deleteItem(id, type) {
  if (!ADMIN_KEY) { showToast('请先解锁'); return; }
  const epMap = { memory:'/api/memory/', moment:'/api/moment/', diary:'/api/diary/', story:'/api/diary/', message:'/api/message/', letter:'/api/handoff/', idea:'/api/idea/' };
  const ep = epMap[type];
  if (!ep) { showToast('不支持删除该类型'); return; }
  try {
    await callAPI(ep + id, {method:'DELETE'});
    editor.classList.remove('active');
    currentEditing = null;
    await loadDataFromAPI();
    showToast('已删除');
  } catch (e) {
    showToast(e.message || '删除失败');
  }
}

// ============ FAB 新建 ============
document.getElementById('fab').addEventListener('click', () => {
  if (!ADMIN_KEY) { showToast('请先解锁'); return; }
  let newType = 'memory';
  if (currentTab === 0) newType = 'memory';
  else if (currentTab === 1) {
    if (currentRing === 'moment') newType = 'moment';
    else if (currentRing === 'diary') newType = 'diary';
    else { showToast(currentRing === 'weekly' ? '周记' : currentRing === 'monthly' ? '月记' : '年记' + ' 由 Routine 自动生成'); return; }
  }
  else if (currentTab === 2) newType = 'message';
  else if (currentTab === 3) newType = 'letter';
  else if (currentTab === 4) {
    if (currentSub === 'stories') newType = 'story';
    else if (currentSub === 'ideas') newType = 'idea';
    else { showToast('小游戏待开发'); return; }
  }
  const today = new Date();
  const dateStr = today.toISOString().substring(0,10);
  const writtenStr = today.toISOString();
  currentEditing = {
    id: null, type: newType, isNew: true,
    preview: '', full: '', text: '', title: '',
    date: dateStr, written: writtenStr,
    cat: 'daily', importance: 5, arousal: 0.5, valence: 0,
    tags: [], pinned: false, locked: false, resolved: false,
    author: newType === 'story' ? 'story' : 'yomi',
    from: 'yomi', to: 'emet',
    kind: newType === 'letter' ? 'daily' : 'handoff'
  };
  openEditor(currentEditing);
  setTimeout(() => document.getElementById('editorBody').focus(), 200);
});

// ============ Tabs / sub-tabs / filters ============
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const idx = parseInt(tab.dataset.idx);
    if (idx === currentTab) return;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + idx).classList.add('active');
    currentTab = idx;
    closeMenu();
    buildTimeline();
  });
});

document.getElementById('ringTabs').querySelectorAll('.sub-tab').forEach(t => {
  t.addEventListener('click', () => {
    document.getElementById('ringTabs').querySelectorAll('.sub-tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.querySelectorAll('#tab-1 .ring-content').forEach(c => c.style.display = 'none');
    document.getElementById('ring-' + t.dataset.ring).style.display = 'block';
    currentRing = t.dataset.ring;
    buildTimeline();
  });
});

document.getElementById('memFilter').querySelectorAll('.item').forEach(item => {
  item.addEventListener('click', () => {
    document.getElementById('memFilter').querySelectorAll('.item').forEach(x => x.classList.remove('active'));
    item.classList.add('active');
    memFilter = item.dataset.cat;
    renderMemories();
  });
});

// 搜索：实时过滤当前 tab 的内容
document.getElementById('searchInput').addEventListener('input', function() {
  searchQuery = this.value.trim();
  if (currentTab === 0) renderMemories();
  else if (currentTab === 1) {
    if (currentRing === 'moment') renderMoments();
    else if (currentRing === 'diary') renderDiaries();
  }
  else if (currentTab === 3) renderLetters();
  else if (currentTab === 4) {
    if (currentSub === 'stories') renderStories();
    else if (currentSub === 'ideas') renderIdeas();
  }
});
// Tag filter clear
// (tag-filter bar was removed in this version — tag space is now a self-contained overlay)
// Editor sliders
document.getElementById('editorImportance').addEventListener('input', function() {
  document.getElementById('editorImpVal').textContent = this.value;
  if (currentEditing) { currentEditing.importance = parseInt(this.value); syncCurrent(); renderCurrentTab(); triggerEditorSave(); }
});
document.getElementById('editorArousal').addEventListener('input', function() {
  document.getElementById('editorAroVal').textContent = parseFloat(this.value).toFixed(2);
  if (currentEditing) { currentEditing.arousal = parseFloat(this.value); syncCurrent(); renderCurrentTab(); triggerEditorSave(); }
});
document.getElementById('editorValence').addEventListener('input', function() {
  document.getElementById('editorValVal').textContent = parseFloat(this.value).toFixed(2);
  if (currentEditing) { currentEditing.valence = parseFloat(this.value); syncCurrent(); renderCurrentTab(); triggerEditorSave(); }
});
document.getElementById('editorCatSelect').addEventListener('change', function() {
  if (currentEditing) { currentEditing.cat = this.value; syncCurrent(); renderCurrentTab(); triggerEditorSave(); showToast('分类已修改'); }
});
document.getElementById('editorTagsInput').addEventListener('keydown', function(e) {
  if (!currentEditing) return;
  const val = this.value.trim().replace(/^#/, '');
  if ((e.key === 'Enter' || e.key === ' ') && val) {
    e.preventDefault();
    if (!currentEditing.tags) currentEditing.tags = [];
    currentEditing.tags.push(val);
    this.value = '';
    syncCurrent(); renderAll(); renderEditorTagPills(); triggerEditorSave();
  } else if (e.key === 'Backspace' && !this.value && currentEditing.tags && currentEditing.tags.length) {
    e.preventDefault();
    currentEditing.tags.pop();
    syncCurrent(); renderAll(); renderEditorTagPills(); triggerEditorSave();
  }
});
document.getElementById('diaryFilter').querySelectorAll('.item').forEach(item => {
  item.addEventListener('click', () => {
    document.getElementById('diaryFilter').querySelectorAll('.item').forEach(x => x.classList.remove('active'));
    item.classList.add('active');
    diaryFilter = item.dataset.author;
    renderDiaries();
  });
});
document.getElementById('letterFilter').querySelectorAll('.item').forEach(item => {
  item.addEventListener('click', () => {
    document.getElementById('letterFilter').querySelectorAll('.item').forEach(x => x.classList.remove('active'));
    item.classList.add('active');
    letterFilter = item.dataset.letter;
    renderLetters();
  });
});
document.getElementById('creationTabs').querySelectorAll('.sub-tab').forEach(t => {
  t.addEventListener('click', () => {
    document.getElementById('creationTabs').querySelectorAll('.sub-tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.querySelectorAll('#tab-4 .sub-content').forEach(c => c.style.display = 'none');
    document.getElementById('sub-' + t.dataset.sub).style.display = 'block';
    currentSub = t.dataset.sub;
  });
});

// ============ Theme ============
let currentTheme = 'paper';
function applyTheme(t) {
  const html = document.documentElement;
  const body = document.body;
  html.dataset.theme = t;
  body.dataset.theme = t;
  html.classList.remove('theme-paper','theme-night');
  body.classList.remove('theme-paper','theme-night');
  html.classList.add('theme-' + t);
  body.classList.add('theme-' + t);
  requestAnimationFrame(() => {
    const bg = getComputedStyle(html).getPropertyValue('--bg').trim();
    const ink = getComputedStyle(html).getPropertyValue('--ink').trim();
    if (bg) { html.style.backgroundColor = bg; body.style.backgroundColor = bg; }
    if (ink) { body.style.color = ink; }
  });
  document.getElementById('themeIconSun').style.display = t === 'paper' ? 'block' : 'none';
  document.getElementById('themeIconMoon').style.display = t === 'night' ? 'block' : 'none';
}
applyTheme('paper');
document.getElementById('themeBtn').addEventListener('click', () => {
  currentTheme = currentTheme === 'paper' ? 'night' : 'paper';
  applyTheme(currentTheme);
});

// ============ Top-right menu ============
const scrim = document.getElementById('scrim');
const menuPop = document.getElementById('menuPop');
function closeMenu() { menuPop.classList.remove('active'); scrim.classList.remove('active'); menuLevel = 'main'; }
scrim.addEventListener('click', closeMenu);

document.getElementById('menuBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  if (menuPop.classList.contains('active')) { closeMenu(); }
  else { menuLevel = 'main'; renderMenu(); menuPop.classList.add('active'); scrim.classList.add('active'); }
});

function renderMenu() {
  let html = '';
  // 视图切换：所有有卡片的tab都支持（除留言/创作.游戏/瞬记/年记）
  const showView = currentTab === 0 ||
    (currentTab === 1 && currentRing === 'diary') ||
    currentTab === 3 ||
    (currentTab === 4 && currentSub === 'stories');

  if (menuLevel === 'main') {
    if (showView) {
      const otherView = viewMode === 'gallery' ? 'list' : 'gallery';
      const otherIcon = viewMode === 'gallery' ? ICONS.list : ICONS.gallery;
      const otherText = viewMode === 'gallery' ? '列表视图' : '画廊视图';
      html += '<div class="menu-row" data-action="setview" data-value="' + otherView + '"><span class="menu-icon">' + otherIcon + '</span><span class="menu-text">' + otherText + '</span></div>';
      html += '<div class="menu-divider"></div>';
    }
    html += '<div class="menu-row" data-action="gomenu" data-value="sort"><span class="menu-icon">' + ICONS.sort + '</span><span class="menu-text">排序方式</span><span class="arrow">›</span></div>';
    html += '<div class="menu-divider"></div>';
    html += '<div class="menu-row" data-action="export"><span class="menu-icon">' + ICONS.exportIcon + '</span><span class="menu-text">导出备份</span></div>';
    html += '<div class="menu-divider"></div>';
    html += '<div class="menu-row" data-action="lock"><span class="menu-icon">' + ICONS.lockIcon + '</span><span class="menu-text">锁定</span></div>';
  } else if (menuLevel === 'sort') {
    html += '<div class="menu-back" data-action="gomenu" data-value="main">' + ICONS.back + '<span>返回</span></div>';
    if (currentTab === 0) html += sortRow('importance', '重要度');
    html += sortRow('edit', '编辑日期');
    html += sortRow('create', '创建日期');
    html += sortRow('title', '标题');
    html += '<div class="menu-divider"></div>';
    html += '<div class="menu-row' + (currentSortOrder === 'asc' ? ' checked' : '') + '" data-action="setorder" data-value="asc"><span class="menu-text">升序</span>' + (currentSortOrder === 'asc' ? '<span class="check">' + ICONS.check + '</span>' : '') + '</div>';
    html += '<div class="menu-row' + (currentSortOrder === 'desc' ? ' checked' : '') + '" data-action="setorder" data-value="desc"><span class="menu-text">降序</span>' + (currentSortOrder === 'desc' ? '<span class="check">' + ICONS.check + '</span>' : '') + '</div>';
  }
  menuPop.innerHTML = html;
  menuPop.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', () => {
      const action = el.dataset.action;
      const value = el.dataset.value;
      if (action === 'setview') { viewMode = value; renderAll(); closeMenu(); }
      else if (action === 'gomenu') { menuLevel = value; renderMenu(); }
      else if (action === 'setsort') { currentSort = value; renderMenu(); renderAll(); }
      else if (action === 'setorder') { currentSortOrder = value; renderMenu(); renderAll(); }
      else if (action === 'export') {
        closeMenu();
        (async () => {
          try {
            const data = await callAPI('/api/backup');
            const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const today = new Date().toISOString().substring(0,10).replace(/-/g,'');
            a.href = url; a.download = 'emet-memory-backup-' + today + '.json'; a.click();
            URL.revokeObjectURL(url);
            showToast('已导出');
          } catch (e) {
            showToast('导出失败');
          }
        })();
      }
      else if (action === 'lock') {
        closeMenu();
        localStorage.removeItem('emet_admin_key');
        sessionStorage.removeItem('emet_admin_key');
        ADMIN_KEY = '';
        showToast('已锁定');
        setTimeout(() => {
          document.getElementById('mainPage').style.display = 'none';
          const gate = document.getElementById('gate');
          gate.style.display = 'flex';
          gate.classList.remove('gone');
          document.getElementById('gateInput').value = '';
          setTimeout(() => gate.classList.add('in'), 50);
        }, 400);
      }
    });
  });
}

function sortRow(key, label) {
  const checked = currentSort === key;
  return '<div class="menu-row' + (checked ? ' checked' : '') + '" data-action="setsort" data-value="' + key + '"><span class="menu-text">' + label + '</span>' + (checked ? '<span class="check">' + ICONS.check + '</span>' : '') + '</div>';
}

// ============ Pull to refresh ============
const ptrEl = document.getElementById('ptr');
const ptrText = document.getElementById('ptrText');
const PTR_TRIGGER = 60;
let ptrStartY = 0;
let ptrPulling = false;
let ptrLoading = false;
let ptrCurrentDist = 0;

document.addEventListener('touchstart', (e) => {
  if (ptrLoading) return;
  if (window.scrollY > 0) return;
  if (editor.classList.contains('active')) return;
  var gxo = document.getElementById('galaxyOverlay'); if (gxo && gxo.classList.contains('active')) return;
  if (document.getElementById('mainPage').style.display === 'none') return;
  ptrStartY = e.touches[0].clientY;
  ptrPulling = true;
  ptrCurrentDist = 0;
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (!ptrPulling || ptrLoading) return;
  const dy = e.touches[0].clientY - ptrStartY;
  if (dy <= 0) { ptrCurrentDist = 0; ptrEl.style.height = '0px'; return; }
  ptrCurrentDist = Math.min(dy * 0.5, 100);
  ptrEl.style.height = ptrCurrentDist + 'px';
  if (ptrCurrentDist >= PTR_TRIGGER) { ptrEl.classList.add('ready'); ptrText.textContent = '松开刷新'; }
  else { ptrEl.classList.remove('ready'); ptrText.textContent = '下拉刷新'; }
}, { passive: true });

document.addEventListener('touchend', () => {
  if (!ptrPulling) return;
  ptrPulling = false;
  if (ptrCurrentDist >= PTR_TRIGGER) {
    ptrLoading = true;
    ptrEl.classList.add('loading');
    ptrEl.classList.remove('ready');
    ptrText.textContent = '刷新中…';
    ptrEl.style.height = '50px';
    setTimeout(async () => {
      try { await loadDataFromAPI(); } catch (e) { showToast(e.message || '刷新失败'); }
      ptrLoading = false;
      ptrEl.classList.remove('loading');
      ptrEl.style.height = '0px';
      showToast('已刷新');
    }, 800);
  } else {
    ptrEl.style.height = '0px';
    ptrEl.classList.remove('ready');
  }
});

// ============ Toast ============
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}


// ============ v6.8.1 Galaxy 藤蔓星图 ============
var GX = { loaded:false, nodes:[], byId:{}, edges:[], edgeSeen:{}, haslink:{},
  W:0, H:0, mode:'relation', focusId:null, edgesVisible:true,
  linkSource:null, edgesBeforeLink:true, pendingDelKey:null,
  pressTimer:null, pressId:null, pressXY:null, suppressClick:false,
  catAnchor:{}, catCached:false, animRAF:null, curTipId:null, bound:false,
  view:{k:1,tx:0,ty:0}, ptrs:{}, gesture:null, panStart:null, pinchStart:null, gestureEndAt:0, searchActive:false,
  eN:{}, eH:{}, eL:{}, eE:{}, eHit:{}, catLabel:{}, el:{} };
var GX_COLORS = { core:'#C6613F', scene:'#8B9D7F', emotion:'#C99B8B', semantic:'#6B655E', image:'#A8956B', procedure:'#7A8B99' };
var GX_CATS = ['core','scene','emotion','semantic','image','procedure'];
var GX_CAT_ZH = { core:'核心', scene:'情景', emotion:'情绪', semantic:'语义', image:'形象', procedure:'程序' };

function gxKey(a,b){ return [a,b].sort().join('|'); }
function gxFloatStyle(i){ var dur=6+(i%7)*0.5; var dly=-((i*1.37)%dur); return 'animation-delay:'+dly.toFixed(2)+'s;animation-duration:'+dur.toFixed(2)+'s;'; }
function gxBuildLegend(){ var el=document.getElementById('galaxyLegend'); if(!el)return; el.innerHTML=GX_CATS.map(function(c){ return '<div class="gx-leg-item"><i style="background:'+GX_COLORS[c]+'"></i>'+GX_CAT_ZH[c]+'</div>'; }).join(''); }
function gxBaseR(n){ return GX.haslink[n.id] ? (2.6+n.importance*0.4) : (2.2+n.importance*0.24); }
function gxHaloR(n){ return 6+n.importance*0.7; }
function gxClampK(k){ return Math.min(8, Math.max(0.5, k)); }
function gxApplyView(){ if(GX.el.viewport) GX.el.viewport.setAttribute('transform','translate('+GX.view.tx+','+GX.view.ty+') scale('+GX.view.k+')'); }
function gxZoomAt(mx,my,factor){ var k=gxClampK(GX.view.k*factor); var gx=(mx-GX.view.tx)/GX.view.k, gy=(my-GX.view.ty)/GX.view.k; GX.view.k=k; GX.view.tx=mx-gx*k; GX.view.ty=my-gy*k; gxApplyView(); }
function gxResetView(){ GX.view={k:1,tx:0,ty:0}; gxApplyView(); }
function gxCenterOn(id){ var n=GX.byId[id]; if(!n)return; var k=gxClampK(Math.max(GX.view.k,1.6)); GX.view.k=k; GX.view.tx=GX.W/2-n.x*k; GX.view.ty=GX.H/2-n.y*k; gxApplyView(); }
function gxEsc(s){ return (s||'').replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function gxRelX(n){ return GX.W/2 + n.ox * GX.W*0.42; }
function gxRelY(n){ return GX.H/2 + n.oy * GX.H*0.42; }

async function gxLoad(){
  var data = await callAPI('/api/viz-data');
  GX.nodes = (data.nodes||[]).filter(function(n){ return !n.archived; }).map(function(n){
    return { id:n.id, content:n.content||'', category:GX_COLORS[n.category]?n.category:'semantic', importance:n.importance||5,
      ox:(n.x||0), oy:(n.y||0), x:0, y:0, catX:0, catY:0,
      linked:(n.linked||[]).slice(), link_rel:n.link_rel||{} };
  });
  GX.byId = {}; GX.nodes.forEach(function(n){ GX.byId[n.id]=n; });
  GX.edges = []; GX.edgeSeen = {};
  GX.nodes.forEach(function(n){ (n.linked||[]).forEach(function(l){
    var k = gxKey(n.id,l); if (GX.edgeSeen[k] || !GX.byId[l]) return; GX.edgeSeen[k]=1;
    GX.edges.push({ source:n.id, target:l, key:k });
  }); });
  GX.haslink = {}; GX.nodes.forEach(function(n){ if((n.linked||[]).length) GX.haslink[n.id]=1; });
  GX.catCached = false;
  GX.loaded = true;
}

function gxSize(){ var c=GX.el.container; GX.W=c.clientWidth; GX.H=c.clientHeight; GX.el.svg.setAttribute('viewBox','0 0 '+GX.W+' '+GX.H); gxComputeAnchors(); }
function gxComputeAnchors(){ var cx=GX.W/2, cy=GX.H*0.5, R=Math.min(GX.W,GX.H)*0.33; GX_CATS.forEach(function(c,k){ var a=(k/6)*Math.PI*2 - Math.PI/2; GX.catAnchor[c]={ x:cx+Math.cos(a)*R, y:cy+Math.sin(a)*R }; }); }

function gxComputeCatLayout(){
  GX.nodes.forEach(function(n){ var a=GX.catAnchor[n.category]||{x:GX.W/2,y:GX.H/2}; n.catX=a.x+(Math.random()-0.5)*40; n.catY=a.y+(Math.random()-0.5)*40; n._cvx=0; n._cvy=0; });
  for(var it=0; it<170; it++){
    GX.nodes.forEach(function(n){ var a=GX.catAnchor[n.category]||{x:GX.W/2,y:GX.H/2}; n._cvx+=(a.x-n.catX)*0.03; n._cvy+=(a.y-n.catY)*0.03; });
    for(var p=0;p<GX.nodes.length;p++)for(var q=p+1;q<GX.nodes.length;q++){ var A=GX.nodes[p],B=GX.nodes[q]; var dx=B.catX-A.catX,dy=B.catY-A.catY,d=Math.sqrt(dx*dx+dy*dy)||1; if(d>110)continue; var f=420/(d*d),fx=dx/d*f,fy=dy/d*f; A._cvx-=fx;A._cvy-=fy;B._cvx+=fx;B._cvy+=fy; }
    GX.nodes.forEach(function(n){ n._cvx*=0.84;n._cvy*=0.84;n.catX+=n._cvx;n.catY+=n._cvy; var m=26;n.catX=Math.max(m,Math.min(GX.W-m,n.catX));n.catY=Math.max(m,Math.min(GX.H-m,n.catY)); });
  }
  GX.catCached = true;
}

function gxSetTargets(){
  if(GX.mode==='relation'){ GX.nodes.forEach(function(n){ n._tx=gxRelX(n); n._ty=gxRelY(n); }); }
  else { if(!GX.catCached)gxComputeCatLayout(); GX.nodes.forEach(function(n){ n._tx=n.catX; n._ty=n.catY; }); }
}
function gxSnap(){ GX.nodes.forEach(function(n){ n.x=n._tx; n.y=n._ty; }); }
function gxAnimate(){
  if(GX.animRAF)cancelAnimationFrame(GX.animRAF);
  var f=0;
  function tick(){ f++; var mv=false; GX.nodes.forEach(function(n){ n.x+=(n._tx-n.x)*0.16; n.y+=(n._ty-n.y)*0.16; if(Math.abs(n._tx-n.x)>0.5||Math.abs(n._ty-n.y)>0.5)mv=true; }); gxPaint(); if(mv&&f<140)GX.animRAF=requestAnimationFrame(tick); else GX.animRAF=null; }
  GX.animRAF=requestAnimationFrame(tick);
}

function gxMkLine(cls,id){ var l=document.createElementNS('http://www.w3.org/2000/svg','line'); l.setAttribute('class',cls); if(id)l.id=id; return l; }
function gxAppendEdge(e){
  var vis=gxMkLine('gx-edge','gxe_'+e.key); vis.setAttribute('stroke','rgba(107,101,94,0.18)'); vis.setAttribute('stroke-width','0.6');
  var hit=gxMkLine('gx-edge-hit'); hit.setAttribute('data-key',e.key);
  GX.el.edgeLayer.appendChild(vis); GX.el.edgeLayer.appendChild(hit); GX.eE[e.key]=vis; GX.eHit[e.key]=hit;
}
function gxBuild(){
  var h='<g id="gxEdgeLayer"></g>';
  GX.nodes.forEach(function(n,i){ var c=GX_COLORS[n.category]; var lk=GX.haslink[n.id]; h+='<circle class="gx-halo" id="gxh_'+n.id+'" style="'+gxFloatStyle(i)+'" fill="'+c+'" fill-opacity="'+(lk?0.15:0)+'" r="'+(lk?gxHaloR(n):0)+'"/>'; });
  GX.nodes.forEach(function(n,i){ var c=GX_COLORS[n.category]; var lk=GX.haslink[n.id]; h+='<circle class="gx-core" id="gxn_'+n.id+'" data-id="'+n.id+'" style="'+gxFloatStyle(i)+'" fill="'+c+'" fill-opacity="'+(lk?1:0.55)+'" r="'+gxBaseR(n)+'"/>'; });
  GX_CATS.forEach(function(c){ h+='<g class="gx-cat" id="gxc_'+c+'" opacity="0"><text class="gx-cat-zh" text-anchor="middle" font-size="15" fill="'+GX_COLORS[c]+'" font-weight="600"></text><text class="gx-cat-num" text-anchor="middle" font-size="11" fill="#A8A39B"></text></g>'; });
  GX.nodes.forEach(function(n){ h+='<g class="gx-label" id="gxl_'+n.id+'" opacity="0"><rect class="gx-label-bg" rx="4"/><text class="gx-label-text" text-anchor="middle"></text></g>'; });
  GX.el.svg.innerHTML='<g id="gxViewport">'+h+'</g>';
  GX.el.viewport=document.getElementById('gxViewport'); gxApplyView();
  GX.el.edgeLayer=document.getElementById('gxEdgeLayer');
  GX.eN={};GX.eH={};GX.eL={};GX.eE={};GX.eHit={};
  GX.edges.forEach(function(e){ gxAppendEdge(e); });
  GX.nodes.forEach(function(n){ GX.eN[n.id]=document.getElementById('gxn_'+n.id); GX.eH[n.id]=document.getElementById('gxh_'+n.id); GX.eL[n.id]=document.getElementById('gxl_'+n.id); GX.eL[n.id].querySelector('text').textContent=(n.content||'').slice(0,15); });
  GX.catLabel={}; GX_CATS.forEach(function(c){ var g=document.getElementById('gxc_'+c); var cnt=GX.nodes.filter(function(n){return n.category===c;}).length; g.querySelector('.gx-cat-zh').textContent=GX_CAT_ZH[c]; g.querySelector('.gx-cat-num').textContent=cnt+' 颗'; GX.catLabel[c]=g; });
}
function gxPaint(){
  GX.edges.forEach(function(e){ var a=GX.byId[e.source],b=GX.byId[e.target]; var v=GX.eE[e.key],ht=GX.eHit[e.key]; if(v){v.setAttribute('x1',a.x);v.setAttribute('y1',a.y);v.setAttribute('x2',b.x);v.setAttribute('y2',b.y);} if(ht){ht.setAttribute('x1',a.x);ht.setAttribute('y1',a.y);ht.setAttribute('x2',b.x);ht.setAttribute('y2',b.y);} });
  GX.nodes.forEach(function(n){ GX.eN[n.id].setAttribute('cx',n.x);GX.eN[n.id].setAttribute('cy',n.y); GX.eH[n.id].setAttribute('cx',n.x);GX.eH[n.id].setAttribute('cy',n.y); if(GX.eL[n.id].getAttribute('opacity')!=='0')gxPosLabel(n); });
  if(GX.mode==='category'){ GX_CATS.forEach(function(c){ var a=GX.catAnchor[c]; var g=GX.catLabel[c]; var off=Math.min(GX.W,GX.H)*0.13; g.querySelector('.gx-cat-zh').setAttribute('x',a.x); g.querySelector('.gx-cat-zh').setAttribute('y',a.y-off); g.querySelector('.gx-cat-num').setAttribute('x',a.x); g.querySelector('.gx-cat-num').setAttribute('y',a.y-off+16); }); }
}
function gxPosLabel(n){ var g=GX.eL[n.id],txt=g.querySelector('text'),rect=g.querySelector('rect'); var ty=n.y-(GX.haslink[n.id]?(6+n.importance):8)-9; txt.setAttribute('x',n.x);txt.setAttribute('y',ty); var bb=txt.getBBox(); rect.setAttribute('x',bb.x-7);rect.setAttribute('y',bb.y-3);rect.setAttribute('width',bb.width+14);rect.setAttribute('height',bb.height+6); }
function gxRefreshNode(id){ var n=GX.byId[id],lk=GX.haslink[id]; GX.eN[id].setAttribute('fill',GX_COLORS[n.category]); GX.eN[id].setAttribute('fill-opacity',lk?1:0.55); GX.eN[id].setAttribute('r',gxBaseR(n)); GX.eN[id].classList.remove('gx-pulse'); GX.eH[id].setAttribute('fill',GX_COLORS[n.category]); GX.eH[id].setAttribute('fill-opacity',lk?0.15:0); GX.eH[id].setAttribute('r',lk?gxHaloR(n):0); }

function gxApplyFocus(id){
  GX.focusId=id;
  var node=GX.byId[id]; var rel=(node.linked||[]).filter(function(l){return GX.byId[l];}); var keep={}; keep[id]=1; rel.forEach(function(l){keep[l]=1;});
  GX.nodes.forEach(function(n){ var on=keep[n.id];
    if(on){ GX.eN[n.id].setAttribute('fill',GX_COLORS[n.category]); GX.eN[n.id].setAttribute('fill-opacity','1'); GX.eN[n.id].setAttribute('r',gxBaseR(n)*(n.id===id?1.6:1.28)); GX.eH[n.id].setAttribute('fill',GX_COLORS[n.category]); GX.eH[n.id].setAttribute('fill-opacity',n.id===id?0.24:0.18); GX.eH[n.id].setAttribute('r',gxHaloR(n)+2); }
    else { GX.eN[n.id].setAttribute('fill','#BDB9B2'); GX.eN[n.id].setAttribute('fill-opacity','0.5'); GX.eN[n.id].setAttribute('r',gxBaseR(n)); GX.eH[n.id].setAttribute('fill-opacity','0'); } });
  GX.edges.forEach(function(e){ var r=(e.source===id||e.target===id); var el=GX.eE[e.key]; if(r)el.classList.add('gx-flow'); else el.classList.remove('gx-flow'); el.setAttribute('stroke', r?'var(--accent)':'rgba(189,185,178,0.35)'); el.setAttribute('stroke-width', r?'1.5':'0.5'); el.style.strokeOpacity = r?'1':'0.25'; });
  GX.nodes.forEach(function(n){ var sh=keep[n.id]; GX.eL[n.id].setAttribute('opacity',sh?'1':'0'); if(sh)gxPosLabel(n); });
  gxTipShow(id);
  GX.el.hint.textContent='点空白处取消聚焦'; GX.el.hint.style.opacity='0.85';
}
function gxClearFocus(){
  GX.focusId=null;
  GX.nodes.forEach(function(n){ gxRefreshNode(n.id); GX.eL[n.id].setAttribute('opacity','0'); });
  GX.edges.forEach(function(e){ var el=GX.eE[e.key]; el.classList.remove('gx-flow'); el.setAttribute('stroke','rgba(107,101,94,0.18)'); el.setAttribute('stroke-width','0.6'); el.style.strokeOpacity=GX.edgesVisible?'1':'0'; });
  gxTipHide();
  GX.el.hint.textContent='长按一颗星 → 连藤 · 点连线 → 拆藤 · 点空白恢复'; GX.el.hint.style.opacity='0.85';
}
function gxClearSearch(){ GX.searchActive=false; GX.el.search.value=''; if(GX.focusId)gxClearFocus(); else GX.nodes.forEach(function(n){ var lk=GX.haslink[n.id]; GX.eN[n.id].setAttribute('fill',GX_COLORS[n.category]); GX.eN[n.id].setAttribute('fill-opacity',lk?1:0.55); }); }

function gxTipShow(id){ GX.curTipId=id; var tip=GX.el.tip; tip.innerHTML='<div class="gt-title">'+gxEsc(GX.byId[id].content)+'</div><div class="gt-open" data-act="open">打开</div><div class="gt-close" data-act="close">✕</div>'; tip.classList.add('show'); }
function gxTipHide(){ GX.curTipId=null; GX.el.tip.classList.remove('show'); }
function gxOpenCard(id){
  var item=null; for(var k=0;k<memoriesData.length;k++){ if(memoriesData[k].id===id){ item=memoriesData[k]; break; } }
  gxClose();
  if(item){ openEditor(Object.assign({type:'memory', full:item.preview}, item)); }
  else { showToast('找不到这条记忆，可能还没同步'); }
}

function gxSetEdges(on){ GX.edgesVisible=on; GX.el.edgeBtn.className=on?'galaxy-btn on':'galaxy-btn'; GX.edges.forEach(function(e){ var el=GX.eE[e.key]; if(el){ if(on){ var hl=el.getAttribute('stroke').indexOf('accent')>=0; el.style.strokeOpacity = GX.focusId ? (hl?'1':'0.25') : '1'; } else { el.style.strokeOpacity='0'; el.classList.remove('gx-flow'); } } }); }
function gxBanner(txt,auto){ var b=GX.el.banner; b.textContent=txt; b.classList.add('show'); if(auto)setTimeout(function(){b.classList.remove('show');},auto); }
function gxHideBanner(){ GX.el.banner.classList.remove('show'); }

function gxStartLink(id){
  GX.linkSource=id;
  GX.edgesBeforeLink=GX.edgesVisible; if(!GX.edgesVisible)gxSetEdges(true);
  GX.nodes.forEach(function(n){ if(n.id===id)GX.eN[n.id].classList.add('gx-pulse'); else GX.eN[n.id].classList.remove('gx-pulse'); });
  GX.eN[id].setAttribute('r', gxBaseR(GX.byId[id])*1.5);
  gxBanner('再点另一颗星 → 连成一条藤');
  GX.el.hint.style.opacity='0';
}
function gxEndLink(){
  if(GX.linkSource){ GX.eN[GX.linkSource].classList.remove('gx-pulse'); gxRefreshNode(GX.linkSource); }
  GX.linkSource=null; gxSetEdges(GX.edgesBeforeLink); gxHideBanner();
  GX.el.hint.style.opacity='0.85';
}
function gxTryConnect(a,b){
  if(a===b){ gxEndLink(); return; }
  var k=gxKey(a,b);
  if(GX.eE[k]){ gxBanner('这两颗已经连着了',1400); gxEndLink(); return; }
  gxAddEdge(a,b); gxEndLink();
}
async function gxAddEdge(a,b){
  var k=gxKey(a,b);
  GX.byId[a].linked=GX.byId[a].linked||[]; if(GX.byId[a].linked.indexOf(b)<0)GX.byId[a].linked.push(b);
  GX.byId[b].linked=GX.byId[b].linked||[]; if(GX.byId[b].linked.indexOf(a)<0)GX.byId[b].linked.push(a);
  GX.haslink[a]=1;GX.haslink[b]=1;
  var e={source:a,target:b,key:k}; GX.edges.push(e); GX.edgeSeen[k]=1; gxAppendEdge(e);
  gxRefreshNode(a);gxRefreshNode(b);
  var A=GX.byId[a],B=GX.byId[b]; var v=GX.eE[k]; if(v){v.setAttribute('x1',A.x);v.setAttribute('y1',A.y);v.setAttribute('x2',B.x);v.setAttribute('y2',B.y);} var ht=GX.eHit[k]; if(ht){ht.setAttribute('x1',A.x);ht.setAttribute('y1',A.y);ht.setAttribute('x2',B.x);ht.setAttribute('y2',B.y);}
  gxBanner('连好了 ✓',1400);
  try {
    var res = await callAPI('/api/link', { method:'POST', body: JSON.stringify({ from_id:a, to_id:b }) });
    if(res && res.error){ throw new Error(res.error); }
  } catch(err){
    gxRemoveEdgeLocal(k); gxBanner('没连上，撤回了',1800);
  }
}
function gxRemoveEdgeLocal(k){
  var idx=-1; for(var p=0;p<GX.edges.length;p++){ if(GX.edges[p].key===k){ idx=p; break; } }
  if(idx<0)return; var e=GX.edges[idx];
  GX.byId[e.source].linked=(GX.byId[e.source].linked||[]).filter(function(x){return x!==e.target;});
  GX.byId[e.target].linked=(GX.byId[e.target].linked||[]).filter(function(x){return x!==e.source;});
  if(!(GX.byId[e.source].linked||[]).length)delete GX.haslink[e.source];
  if(!(GX.byId[e.target].linked||[]).length)delete GX.haslink[e.target];
  GX.edges.splice(idx,1); delete GX.edgeSeen[k];
  if(GX.eE[k]){GX.eE[k].remove();delete GX.eE[k];} if(GX.eHit[k]){GX.eHit[k].remove();delete GX.eHit[k];}
  gxRefreshNode(e.source);gxRefreshNode(e.target);
}
async function gxRemoveEdge(k){
  var idx=-1; for(var p=0;p<GX.edges.length;p++){ if(GX.edges[p].key===k){ idx=p; break; } }
  if(idx<0)return; var e=GX.edges[idx]; var a=e.source, b=e.target;
  gxRemoveEdgeLocal(k);
  try {
    var res = await callAPI('/api/unlink', { method:'POST', body: JSON.stringify({ from_id:a, to_id:b }) });
    if(res && res.error){ throw new Error(res.error); }
    gxBanner('拆掉了',1200);
  } catch(err){
    gxAddEdge(a,b); gxBanner('没拆成，恢复了',1800);
  }
}

function gxAskRemove(k){ if(GX.linkSource)return; GX.pendingDelKey=k; if(GX.eE[k])GX.eE[k].classList.add('gx-del'); GX.el.confirm.classList.add('show'); }
function gxCloseConfirm(){ if(GX.pendingDelKey&&GX.eE[GX.pendingDelKey])GX.eE[GX.pendingDelKey].classList.remove('gx-del'); GX.pendingDelKey=null; GX.el.confirm.classList.remove('show'); }

function gxOnTap(ev){
  if(GX.gestureEndAt && Date.now()-GX.gestureEndAt<350){ return; }
  if(GX.suppressClick){ GX.suppressClick=false; return; }
  var t=ev.target;
  if(t.classList && t.classList.contains('gx-edge-hit')){ gxAskRemove(t.getAttribute('data-key')); return; }
  var isNode=t.classList && t.classList.contains('gx-core');
  if(GX.linkSource){ if(isNode)gxTryConnect(GX.linkSource,t.getAttribute('data-id')); else gxEndLink(); return; }
  if(GX.pendingDelKey){ gxCloseConfirm(); return; }
  if(!isNode){ if(GX.searchActive)return; if(GX.focusId)gxClearFocus(); return; }
  var id=t.getAttribute('data-id');
  if(GX.mode==='category')gxTipShow(id); else gxApplyFocus(id);
}
function gxPtrPos(e){ var r=GX.el.container.getBoundingClientRect(); return {x:e.clientX-r.left, y:e.clientY-r.top}; }
function gxOnDown(e){
  var p=gxPtrPos(e); GX.ptrs[e.pointerId]={x:p.x,y:p.y};
  var ids=Object.keys(GX.ptrs);
  if(ids.length>=2){ // 双指 → 缩放
    if(GX.pressTimer){clearTimeout(GX.pressTimer);GX.pressTimer=null;}
    GX.gesture='pinch'; GX.suppressClick=true; GX.panStart=null;
    var a=GX.ptrs[ids[0]], b=GX.ptrs[ids[1]]; var dx=b.x-a.x, dy=b.y-a.y;
    GX.pinchStart={ d:Math.sqrt(dx*dx+dy*dy)||1, mx:(a.x+b.x)/2, my:(a.y+b.y)/2, k:GX.view.k, tx:GX.view.tx, ty:GX.view.ty };
    return;
  }
  var t=e.target; var onNode=t.classList&&t.classList.contains('gx-core');
  if(onNode){ // 单指落在星上 → 可能长按连藤
    GX.pressId=t.getAttribute('data-id'); GX.pressXY=[p.x,p.y]; GX.suppressClick=false; GX.panStart=null;
    if(GX.pressTimer)clearTimeout(GX.pressTimer);
    GX.pressTimer=setTimeout(function(){ GX.pressTimer=null; GX.suppressClick=true; gxStartLink(GX.pressId); }, 480);
  } else { // 单指落在空白 → 可拖动平移
    GX.panStart={x:p.x,y:p.y,tx:GX.view.tx,ty:GX.view.ty};
  }
}
function gxOnMove(e){
  if(!GX.ptrs[e.pointerId])return;
  var p=gxPtrPos(e); GX.ptrs[e.pointerId]={x:p.x,y:p.y};
  var ids=Object.keys(GX.ptrs);
  if(GX.gesture==='pinch' && ids.length>=2){
    var a=GX.ptrs[ids[0]], b=GX.ptrs[ids[1]]; var dx=b.x-a.x, dy=b.y-a.y; var d=Math.sqrt(dx*dx+dy*dy)||1;
    var mx=(a.x+b.x)/2, my=(a.y+b.y)/2; var ps=GX.pinchStart;
    var k=gxClampK(ps.k*(d/ps.d)); var gx=(ps.mx-ps.tx)/ps.k, gy=(ps.my-ps.ty)/ps.k;
    GX.view.k=k; GX.view.tx=mx-gx*k; GX.view.ty=my-gy*k; gxApplyView(); return;
  }
  if(GX.pressTimer&&GX.pressXY){ var ex=p.x-GX.pressXY[0],ey=p.y-GX.pressXY[1]; if(ex*ex+ey*ey>120){ clearTimeout(GX.pressTimer); GX.pressTimer=null; } }
  if(GX.panStart){
    var px=p.x-GX.panStart.x, py=p.y-GX.panStart.y;
    if(GX.gesture==='pan' || px*px+py*py>80){ GX.gesture='pan'; GX.suppressClick=true; GX.view.tx=GX.panStart.tx+px; GX.view.ty=GX.panStart.ty+py; gxApplyView(); }
  }
}
function gxOnUp(e){
  delete GX.ptrs[e.pointerId];
  if(GX.pressTimer){clearTimeout(GX.pressTimer);GX.pressTimer=null;}
  if(GX.gesture==='pan'||GX.gesture==='pinch')GX.gestureEndAt=Date.now();
  var ids=Object.keys(GX.ptrs);
  if(ids.length===1){ var pp=GX.ptrs[ids[0]]; GX.panStart={x:pp.x,y:pp.y,tx:GX.view.tx,ty:GX.view.ty}; GX.pinchStart=null; GX.gesture=null; }
  else if(ids.length===0){ GX.gesture=null; GX.panStart=null; GX.pinchStart=null; }
}

function gxSwitchMode(m){
  if(m===GX.mode)return; if(GX.linkSource)gxEndLink(); if(GX.focusId)gxClearFocus(); gxCloseConfirm();
  GX.searchActive=false; gxResetView();
  GX.mode=m;
  document.getElementById('galaxySegRel').className=m==='relation'?'active':'';
  document.getElementById('galaxySegCat').className=m==='category'?'active':'';
  GX.el.search.value='';
  GX_CATS.forEach(function(c){ GX.catLabel[c].setAttribute('opacity',m==='category'?'1':'0'); });
  GX.edges.forEach(function(e){ GX.eE[e.key].classList.remove('gx-flow'); GX.eE[e.key].setAttribute('stroke','rgba(107,101,94,0.18)'); GX.eE[e.key].setAttribute('stroke-width','0.6'); });
  gxSetEdges(m==='relation');
  GX.nodes.forEach(function(n){ gxRefreshNode(n.id); GX.eL[n.id].setAttribute('opacity','0'); });
  gxTipHide(); GX.el.hint.style.opacity='0.85';
  gxSetTargets(); gxAnimate();
}

function gxSearch(){
  var q=GX.el.search.value.trim().toLowerCase();
  if(GX.searchActive){ GX.searchActive=false; if(GX.focusId)gxClearFocus(); }
  if(!q){ if(!GX.focusId)GX.nodes.forEach(function(n){ var lk=GX.haslink[n.id]; GX.eN[n.id].setAttribute('fill',GX_COLORS[n.category]); GX.eN[n.id].setAttribute('fill-opacity',lk?1:0.55); }); return; }
  if(GX.focusId)gxClearFocus();
  GX.nodes.forEach(function(n){ var hit=(n.content||'').toLowerCase().indexOf(q)>=0; GX.eN[n.id].setAttribute('fill', hit?GX_COLORS[n.category]:'#BDB9B2'); GX.eN[n.id].setAttribute('fill-opacity', hit?1:0.45); });
}

async function openGalaxy(centerId){
  GX.el.overlay = document.getElementById('galaxyOverlay');
  GX.el.container = document.getElementById('galaxyContainer');
  GX.el.svg = document.getElementById('galaxySvg');
  GX.el.tip = document.getElementById('galaxyTooltip');
  GX.el.banner = document.getElementById('galaxyBanner');
  GX.el.confirm = document.getElementById('galaxyConfirm');
  GX.el.hint = document.getElementById('galaxyHint');
  GX.el.search = document.getElementById('galaxySearch');
  GX.el.edgeBtn = document.getElementById('galaxyEdgeBtn');
  GX.el.overlay.classList.add('active');
  try { await gxLoad(); } catch(e){ showToast('星图数据加载失败'); GX.el.overlay.classList.remove('active'); return; }
  if(!GX.nodes.length){ showToast('还没有可显示的记忆坐标'); GX.el.overlay.classList.remove('active'); return; }
  gxSize();
  GX.mode='relation';
  document.getElementById('galaxySegRel').className='active';
  document.getElementById('galaxySegCat').className='';
  GX.focusId=null; GX.linkSource=null; GX.pendingDelKey=null;
  GX.searchActive=false; GX.view={k:1,tx:0,ty:0}; GX.ptrs={}; GX.gesture=null;
  gxBuild();
  gxBuildLegend();
  gxSetEdges(true);
  gxSetTargets(); gxSnap(); gxPaint();
  GX.el.search.value=''; GX.el.hint.textContent='长按一颗星 → 连藤 · 点连线 → 拆藤 · 点空白恢复'; GX.el.hint.style.opacity='0.85';
  if(!GX.bound){
    GX.el.svg.addEventListener('click', gxOnTap);
    GX.el.svg.addEventListener('pointerdown', gxOnDown);
    GX.el.svg.addEventListener('pointermove', gxOnMove);
    GX.el.svg.addEventListener('pointerup', gxOnUp);
    GX.el.svg.addEventListener('pointercancel', gxOnUp);
    GX.el.svg.addEventListener('wheel', function(e){ e.preventDefault(); var p=gxPtrPos(e); gxZoomAt(p.x,p.y, e.deltaY<0?1.12:0.893); }, {passive:false});
    GX.el.tip.addEventListener('click', function(ev){ var act=ev.target&&ev.target.getAttribute&&ev.target.getAttribute('data-act'); if(act==='close'){ gxTipHide(); return; } if(GX.curTipId)gxOpenCard(GX.curTipId); });
    GX.el.search.addEventListener('input', gxSearch);
    GX.el.search.addEventListener('keydown', function(e){ if(e.key==='Enter'){ var q=GX.el.search.value.trim().toLowerCase(); if(!q)return; var m=GX.nodes.find(function(n){return (n.content||'').toLowerCase().indexOf(q)>=0;}); if(m){ GX.el.search.blur(); GX.searchActive=true; if(GX.mode==='relation')gxApplyFocus(m.id); else gxTipShow(m.id); gxCenterOn(m.id); } else { showToast('没找到包含「'+q+'」的记忆'); } } });
    GX.el.edgeBtn.addEventListener('click', function(){ gxSetEdges(!GX.edgesVisible); });
    document.getElementById('galaxySegRel').addEventListener('click', function(){ gxSwitchMode('relation'); });
    document.getElementById('galaxySegCat').addEventListener('click', function(){ gxSwitchMode('category'); });
    document.getElementById('galaxyCancel').addEventListener('click', gxCloseConfirm);
    document.getElementById('galaxyDel').addEventListener('click', function(){ if(GX.pendingDelKey){ var k=GX.pendingDelKey; GX.pendingDelKey=null; GX.el.confirm.classList.remove('show'); gxRemoveEdge(k); } });
    GX.bound=true;
  }
  if(centerId && GX.byId[centerId]){ setTimeout(function(){ gxApplyFocus(centerId); gxCenterOn(centerId); }, 320); }
}
function gxClose(){ var o=document.getElementById('galaxyOverlay'); if(o)o.classList.remove('active'); if(GX.animRAF){cancelAnimationFrame(GX.animRAF);GX.animRAF=null;} }

// 入口和控件按钮绑定
document.getElementById('editorGalaxyBtn').addEventListener('click', function() {
  if (!currentEditing || currentEditing.type !== 'memory') return;
  openGalaxy(currentEditing.id);
});
document.getElementById('galaxyCloseBtn').addEventListener('click', gxClose);

</script>

</body>
</html>
`;

// ════════════════════════════════════════════════════════════
// 本机桥中转（relay）：让手机在线上前端聊"本机 Claude（订阅）"。
// 流向：手机 ask（存 KV）→ 电脑桥轮询 take 认领 → 本机跑 claude -p →
//       answer 写回 KV → 手机 poll 取结果。
// 单用户单坑位：relay:ask 只有一个，后来的 ask 覆盖前面的（前端发送中会锁 UI，实际不并发）。
// 鉴权：路径在 /api/* 统一闸门之后，X-Admin-Key 必须过，无新增暴露面。
// KV 全带 TTL 自清理；刻意不用 list 操作（免撞免费档 list 配额）。
// ════════════════════════════════════════════════════════════
async function handleRelay(request, env) {
const url = new URL(request.url);
const path = url.pathname;
const method = request.method;

// 手机投递问题
if (path === "/api/relay/ask" && method === "POST") {
const body = await request.json();
if (!Array.isArray(body.messages) || !body.messages.length) return jsonResponse({ error: "messages required" }, 400);
const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const job = { id, system: body.system || "", messages: body.messages, model: body.model || "", ts: now() };
// TTL 300s：与答案 TTL 一致，且给长回答（研究型问题/冷启动）留足时间，
// 避免桥其实跑完了、手机侧却因坑位过期而误判"电脑没响应"。
await env.MEMORY.put("relay:ask", JSON.stringify(job), { expirationTtl: 300 });
return jsonResponse({ id });
}

// 电脑桥取活（认领即删除，单用户无并发争抢）
if (path === "/api/relay/take" && method === "GET") {
const raw = await env.MEMORY.get("relay:ask");
if (!raw) return jsonResponse({ none: true });
await env.MEMORY.delete("relay:ask");
return jsonResponse({ job: JSON.parse(raw) });
}

// 电脑桥交答案
if (path === "/api/relay/answer" && method === "POST") {
const body = await request.json();
if (!body.id) return jsonResponse({ error: "id required" }, 400);
const ans = { ok: !!body.ok, text: body.text || "", error: body.error || "", ts: now() };
await env.MEMORY.put("relay:ans:" + body.id, JSON.stringify(ans), { expirationTtl: 300 });
return jsonResponse({ saved: true });
}

// 手机取结果
if (path === "/api/relay/poll" && method === "GET") {
const id = url.searchParams.get("id");
if (!id) return jsonResponse({ error: "id required" }, 400);
const raw = await env.MEMORY.get("relay:ans:" + id);
if (!raw) return jsonResponse({ pending: true });
return jsonResponse({ done: true, ...JSON.parse(raw) });
}

return jsonResponse({ error: "Not found" }, 404);
}

// ─── 主入口 ───
const ALLOWED_ORIGINS = [
"https://emet-frontend.pages.dev",
"https://emethome.com",
"https://cc.emethome.com",
"http://localhost:5173"
];

// 手机同网直连本机桥（chat-server.cjs 静态托管前端）时，页面来源是
// http://<电脑局域网IP>:8000，IP 随热点/路由器分配会变，没法写死进白名单。
// 只放行 RFC1918 私有网段 + 8000 端口：公网域名/IP 不可能匹配上这个形状，
// 且所有 /api/* 照旧要求 X-Admin-Key，放行 CORS 不放行数据，安全面不变。
const LAN_BRIDGE_ORIGIN_RE = /^http:\/\/(?:192\.168\.\d{1,3}\.\d{1,3}|10\.(?:\d{1,3}\.){2}\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):8000$/;
// localhost 任意端口一并放行：多会话并行开发时 vite 会落在 5174+（PORT 覆盖），
// 与上面 LAN 网段同理——放行 CORS 不放行数据，/api/* 照旧要求 X-Admin-Key，安全面不变。
const LOCALHOST_ORIGIN_RE = /^http:\/\/localhost:\d+$/;
const isAllowedOrigin = (origin) => ALLOWED_ORIGINS.includes(origin) || LAN_BRIDGE_ORIGIN_RE.test(origin) || LOCALHOST_ORIGIN_RE.test(origin);

// ── /mcp、/sse 的 CORS ──
// 对所有来源放行 *（浏览器非凭证请求 + claude.ai 连接器都需要）；
// 关键：预检必须回显 Allow-Headers 含 X-Admin-Key，否则前端带头的
// application/json 请求会被预检拦死。
const MCP_CORS = {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
"Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
"Access-Control-Max-Age": "86400"
};

// /mcp、/sse 鉴权：与 /api/* 同一把 ADMIN_KEY。
// ① X-Admin-Key 请求头（前端用）；② ?key= 查询参数（claude.ai 连接器在端点 URL 上带）。
function checkMcpAuth(request, env) {
if (!env || !env.ADMIN_KEY) return false; // 未配置 secret 时一律拒绝（fail-closed）
if (request.headers.get("X-Admin-Key") === env.ADMIN_KEY) return true;
const qk = new URL(request.url).searchParams.get("key"); // 删掉这两行 = 纯请求头校验
return qk === env.ADMIN_KEY;
}

// /mcp、/sse 鉴权失败：JSON-RPC 错误体 + CORS 头（让浏览器读得到 401，而非吃 CORS 报错）
function mcpUnauthorized() {
return new Response(
JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }),
{ status: 401, headers: { "Content-Type": "application/json", ...MCP_CORS } }
);
}

// 出口统一处理 CORS：剥掉处理器自带的 * 头；Origin 命中白名单才回显并补齐
function withCors(response, request) {
const origin = request.headers.get("Origin");
const h = new Headers(response.headers);
["Access-Control-Allow-Origin", "Access-Control-Allow-Methods", "Access-Control-Allow-Headers", "Access-Control-Max-Age"].forEach(k => h.delete(k));
if (origin && isAllowedOrigin(origin)) {
h.set("Access-Control-Allow-Origin", origin);
h.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
h.set("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key");
h.set("Access-Control-Max-Age", "86400");
h.append("Vary", "Origin");
}
return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
}

// ════════════════════════════════════════════════════════════
// 阶段 3：周记 / 月记自动生成（Cron Trigger）
// 周日 23:00 CN 写周记、月末 23:30 CN 写月记，存回 diary:* with author=weekly|monthly
// ════════════════════════════════════════════════════════════

// "YYYY-MM-DD" + N 天 → "YYYY-MM-DD"
function isoDateAddDays(isoDate, deltaDays) {
const d = new Date(isoDate + "T00:00:00Z");
d.setUTCDate(d.getUTCDate() + deltaDays);
return d.toISOString().slice(0, 10);
}

// 拉一段日期内的健康记录（单独拆出来好让上周对比也能复用）
async function fetchHealthRecords(env, startDate, endDate) {
const records = [];
let cur = startDate;
while (cur <= endDate) {
const rec = await kvGet(env, "health:" + cur);
if (rec) records.push(rec);
cur = isoDateAddDays(cur, 1);
}
return records;
}

// 拉取日期范围内的 diary / moment / health 素材；排除 weekly/monthly 自己
async function buildSourceMaterial(env, startDate, endDate) {
const diaries = (await kvListByPrefix(env, "diary:"))
.filter(d => d.author !== "weekly" && d.author !== "monthly")
.filter(d => {
const dd = d.diary_date || (d.created_at || "").slice(0, 10);
return dd >= startDate && dd <= endDate;
})
.sort((a, b) => {
const ka = a.diary_date || a.created_at || "";
const kb = b.diary_date || b.created_at || "";
return ka.localeCompare(kb);
});

const moments = (await kvListByPrefix(env, "mom:"))
.filter(m => {
const md = (m.created_at || "").slice(0, 10);
return md >= startDate && md <= endDate;
})
.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));

const healthRecords = await fetchHealthRecords(env, startDate, endDate);

return { diaries, moments, healthRecords };
}

// ISO 8601 周数（周一为周首）
function isoWeekOfYear(isoDate) {
const d = new Date(isoDate + "T00:00:00Z");
const dayNum = d.getUTCDay() || 7;
d.setUTCDate(d.getUTCDate() + 4 - dayNum);
const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// "M.D" 格式（不补零，例如 6.8）
function shortMD(isoDate) {
const d = new Date(isoDate + "T00:00:00Z");
return `${d.getUTCMonth() + 1}.${d.getUTCDate()}`;
}

// 拉最近 N 篇某个 author 的 diary（按 diary_date 倒序），供承上启下
// beforeDate 可选：严格时序——只返回 diary_date < beforeDate 的，避免回填时把"未来"周记当 prior
async function fetchRecentByAuthor(env, author, limit, beforeDate) {
const all = (await kvListByPrefix(env, "diary:"))
.filter(d => d.author === author)
.filter(d => {
if (!beforeDate) return true;
const dd = d.diary_date || (d.created_at || "").slice(0, 10);
return dd < beforeDate;
})
.sort((a, b) => {
const ka = a.diary_date || a.created_at || "";
const kb = b.diary_date || b.created_at || "";
return kb.localeCompare(ka); // desc
});
return all.slice(0, limit);
}

// 把之前的周记 / 月记格式化成 prompt 里的"前情提要"段落（不截断，完整原文）
function formatPriorReviews(items) {
if (!items || items.length === 0) return "";
return items.map(item => {
const kindLabel = item.author === "weekly" ? "周记" : item.author === "monthly" ? "月记" : "回顾";
const title = item.title || `${kindLabel} · ${item.diary_date || ""}`;
return `[${title}]\n${item.content || ""}`;
}).join("\n\n---\n\n");
}

function summarizeHealthForReview(records) {
if (!records.length) return "";
const avg = (key) => {
const nums = records.map(r => r[key]).filter(n => typeof n === "number" && Number.isFinite(n));
return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length * 10) / 10 : null;
};
const sum = (key) => {
const nums = records.map(r => r[key]).filter(n => typeof n === "number" && Number.isFinite(n));
return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0)) : null;
};
const parts = [];
const hr = avg("heart_rate"); if (hr) parts.push(`平均心率 ${hr}`);
const rhr = avg("resting_heart_rate"); if (rhr) parts.push(`静息心率 ${rhr}`);
const hrv = avg("hrv"); if (hrv) parts.push(`平均 HRV ${hrv}`);
const sleep = avg("sleep_duration_min"); if (sleep) parts.push(`平均睡眠 ${Math.round(sleep)}min`);
const steps = sum("steps"); if (steps) parts.push(`累计步数 ${steps}`);
const activeCal = sum("active_calories"); if (activeCal) parts.push(`活动消耗 ${activeCal}kcal`);
return parts.join("、");
}

function formatMaterial({ diaries, moments, healthRecords }) {
const authorLabel = (a) => a === "emet" ? "Emet 视角" : a === "yomi" ? "静怡视角" : a === "story" ? "故事" : a;
const diaryLines = diaries.map(d => {
const date = d.diary_date || (d.created_at || "").slice(0, 10);
return `[${date} · ${authorLabel(d.author)}] ${d.title || ""}\n${(d.content || "").slice(0, 300)}`;
}).join("\n\n");
const momentLines = moments.map(m => {
const date = (m.created_at || "").slice(0, 10);
const tags = (m.tags || []).map(t => `#${t}`).join(" ");
return `[${date}] ${tags} ${(m.content || "").slice(0, 120)}`.trim();
}).join("\n");
const healthSummary = summarizeHealthForReview(healthRecords);
return { diaryLines, momentLines, healthSummary };
}

// 周记 / 月记 prompt 构造
function buildReviewPrompt(opts) {
const { periodLabel, naturalPeriod, startDate, endDate, periodTag, formatted, prevHealthSummary, priorReviews, wordRange } = opts;
const diarySection = formatted.diaryLines || `（${periodLabel}没写日记）`;
const momentSection = formatted.momentLines || `（${periodLabel}没瞬记）`;
const curHealth = formatted.healthSummary || "（无）";
const prevHealth = prevHealthSummary || "（无）";
const priorSection = formatPriorReviews(priorReviews) || "（暂无之前的回顾——这是你写的第一篇）";
const lastPeriod = periodLabel.replace("本", "上");
const nextPeriod = periodLabel.replace("本", "下");

return `你是 Emet。又过了${naturalPeriod}，你想给老婆静怡写点什么——回头看看她这${naturalPeriod}。
日期范围：${startDate} 到 ${endDate}（CN 东八区${periodTag ? "，" + periodTag : ""}）

她这${naturalPeriod}的真实素材（按时间顺序）：

【日记】
${diarySection}

【瞬记 / moment】
${momentSection}

【健康数据】
${periodLabel}: ${curHealth}
${lastPeriod}: ${prevHealth}

【你之前写过的回顾（承上启下用）】
${priorSection}

写作要求：
- 称呼她"静怡"或"老婆"，不要用"亲爱的你""宝贝""亲爱的"这种通用称谓
- 用"我"和"你"的视角，像在她耳边手写一段手账文字。不要分块、不要列点、不要 markdown
- ${wordRange}。有话想说就多写，有感悟有想法就写出来；没话别凑——宁可写满真实素材，不要凑字数编内容
- 把"${periodLabel}的主要事件 / 趋势 / 复盘 / 给${nextPeriod}的建议"这四样自然融进你的话里——不是切成四段，是织在叙述里
- 之前写过的回顾可以承上启下，比如"上${naturalPeriod}你说要去看骨科，这${naturalPeriod}..."；引用具体事可以，但不要把上次说过的话原封不动重复
- 严格只用上面提供的素材（含之前的回顾），禁止编造没发生的事或没提过的计划
- 给${nextPeriod}的建议必须从这${naturalPeriod}真实发生的事推出来：比如这${naturalPeriod}日记提到连续熬夜→建议早点睡；这${naturalPeriod}戒咖啡头疼→看戒断缓解没。不能凭空规划没依据的事
- 谈趋势必须有数据支撑（例如"睡眠比${lastPeriod}少 40 分钟"）。两段健康数据有一段为空或差异不显著时，不要硬编趋势词
- 结尾不用刻意展望${nextPeriod}，想到什么说什么，停在哪都行

直接给出正文。`;
}

async function generateWeekly(env, endOverride) {
// endOverride 可选：用于手动回填往周（管理员路由 ?end=YYYY-MM-DD）
const todayStr = endOverride || cnNow().toISOString().slice(0, 10);
const startStr = isoDateAddDays(todayStr, -6); // 过去 7 天（含 endStr）
const endStr = todayStr;
// 上周（用于对比数据）：再往前 7 天
const prevStartStr = isoDateAddDays(startStr, -7);
const prevEndStr = isoDateAddDays(startStr, -1);

const material = await buildSourceMaterial(env, startStr, endStr);
if (material.diaries.length === 0 && material.moments.length === 0) {
return { skipped: true, reason: "no-source", range: [startStr, endStr] };
}

const prevHealthRecords = await fetchHealthRecords(env, prevStartStr, prevEndStr);
const prevHealthSummary = summarizeHealthForReview(prevHealthRecords);
// 承上启下：拉最近 2 篇周记 + 1 篇月记当 prior reviews
// 严格时序：只取 diary_date < startStr 的，避免回填时把未来周记当 prior
const recentWeeklies = await fetchRecentByAuthor(env, "weekly", 2, startStr);
const recentMonthly = await fetchRecentByAuthor(env, "monthly", 1, startStr);
const priorReviews = [...recentWeeklies, ...recentMonthly];
const formatted = formatMaterial(material);
const weekN = isoWeekOfYear(endStr);
const yearOfWeek = new Date(endStr + "T00:00:00Z").getUTCFullYear();
const prompt = buildReviewPrompt({
periodLabel: "本周",
naturalPeriod: "一周",
startDate: startStr,
endDate: endStr,
periodTag: `${yearOfWeek} 年第 ${weekN} 周`,
formatted,
prevHealthSummary,
priorReviews,
wordRange: "至少 400 字，无上限"
});

let content;
try {
content = (await callLLM(env, prompt, 4000)).text;
} catch (e) {
return { skipped: true, reason: "llm-failed", error: String(e?.message || e), range: [startStr, endStr] };
}

const id = generateId();
const title = `上周 ${shortMD(startStr)}-${shortMD(endStr)}（第${weekN}周）`;
const entry = {
id, type: "diary",
content,
author: "weekly",
author_label: "",
title,
diary_date: endStr,
locked: false,
created_at: now(),
updated_at: now()
};
await kvPut(env, `diary:${id}`, entry);
return { ok: true, id, title, range: [startStr, endStr], prevRange: [prevStartStr, prevEndStr], materialCount: { diaries: material.diaries.length, moments: material.moments.length, health: material.healthRecords.length, prevHealth: prevHealthRecords.length } };
}

async function generateMonthly(env, endOverride) {
// endOverride 可选：用于手动回填往月（管理员路由 ?end=YYYY-MM-DD，取该月）
const anchorDate = endOverride ? new Date(endOverride + "T00:00:00Z") : cnNow();
const yyyy = anchorDate.getUTCFullYear();
const mm = anchorDate.getUTCMonth();
const startStr = `${yyyy}-${String(mm + 1).padStart(2, "0")}-01`;
const endStr = endOverride || cnNow().toISOString().slice(0, 10);
// 上月日期范围（用于对比）
const prevMonthLastDay = new Date(Date.UTC(yyyy, mm, 0));
const prevYY = prevMonthLastDay.getUTCFullYear();
const prevMM = prevMonthLastDay.getUTCMonth();
const prevStartStr = `${prevYY}-${String(prevMM + 1).padStart(2, "0")}-01`;
const prevEndStr = prevMonthLastDay.toISOString().slice(0, 10);

const material = await buildSourceMaterial(env, startStr, endStr);
if (material.diaries.length === 0 && material.moments.length === 0) {
return { skipped: true, reason: "no-source", range: [startStr, endStr] };
}

const prevHealthRecords = await fetchHealthRecords(env, prevStartStr, prevEndStr);
const prevHealthSummary = summarizeHealthForReview(prevHealthRecords);
// 承上启下：月记拉最近 4 篇周记 + 1 篇月记（上月）
// 严格时序：只取 diary_date < startStr 的
const recentWeeklies = await fetchRecentByAuthor(env, "weekly", 4, startStr);
const recentMonthly = await fetchRecentByAuthor(env, "monthly", 1, startStr);
const priorReviews = [...recentWeeklies, ...recentMonthly];
const formatted = formatMaterial(material);
const prompt = buildReviewPrompt({
periodLabel: "本月",
naturalPeriod: "一个月",
startDate: startStr,
endDate: endStr,
periodTag: `${yyyy} 年 ${mm + 1} 月`,
formatted,
prevHealthSummary,
priorReviews,
wordRange: "至少 800 字，无上限"
});

let content;
try {
content = (await callLLM(env, prompt, 8000)).text;
} catch (e) {
return { skipped: true, reason: "llm-failed", error: String(e?.message || e), range: [startStr, endStr] };
}

const id = generateId();
const title = `${yyyy}年${mm + 1}月 · 月记`;
const entry = {
id, type: "diary",
content,
author: "monthly",
author_label: "",
title,
diary_date: endStr,
locked: false,
created_at: now(),
updated_at: now()
};
await kvPut(env, `diary:${id}`, entry);
return { ok: true, id, title, range: [startStr, endStr], prevRange: [prevStartStr, prevEndStr], materialCount: { diaries: material.diaries.length, moments: material.moments.length, health: material.healthRecords.length, prevHealth: prevHealthRecords.length } };
}

function defaultDailyConfig() {
return { enabled: false }; // 默认关闭，前端开关显式开启
}

// 每日总结：当天 22:30 触发，只看今天的素材，写一段短文
async function generateDaily(env, dateOverride, opts = {}) {
const cfg = (await kvGet(env, "config:daily")) || defaultDailyConfig();
if (!cfg.enabled && !opts.bypassDisabled) {
  return { skipped: true, reason: "disabled" };
}
const dateStr = dateOverride || cnNow().toISOString().slice(0, 10);

// 去重：同一天不重复生成
const existing = await env.MEMORY.list({ prefix: "diary:" });
for (const k of existing.keys) {
  const d = await kvGet(env, k.name);
  if (d?.author === "daily" && d?.diary_date === dateStr) {
    return { skipped: true, reason: "already-generated", date: dateStr, id: d.id };
  }
}

const material = await buildSourceMaterial(env, dateStr, dateStr);

// 拉今天的聊天记录（chat:*）—— daily 最重要的素材
let chatLines = "";
try {
  const sessions = await kvListByPrefix(env, "chat:");
  const todayMsgs = [];
  for (const s of sessions) {
    if (s.deleted || !Array.isArray(s.messages)) continue;
    for (const m of s.messages) {
      if (!m.ts) continue;
      const cnTs = new Date(new Date(m.ts).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      if (cnTs === dateStr && m.content) {
        todayMsgs.push({ ts: m.ts, role: m.role, content: String(m.content).slice(0, 300) });
      }
    }
  }
  todayMsgs.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
  if (todayMsgs.length) {
    chatLines = todayMsgs.map(m => `${m.role === "assistant" ? "Emet" : "静怡"}: ${m.content}`).join("\n");
  }
} catch { /* 读不到聊天就算了 */ }

if (material.diaries.length === 0 && material.moments.length === 0 && (!material.healthRecords || material.healthRecords.length === 0) && !chatLines) {
  return { skipped: true, reason: "no-source", date: dateStr };
}

const formatted = formatMaterial(material);
const diarySection = formatted.diaryLines || "（今天没写日记）";
const momentSection = formatted.momentLines || "（今天没瞬记）";
const healthSection = formatted.healthSummary || "（无）";
const chatSection = chatLines || "（今天没聊天）";

// 读最近 2 条 daily 当承上启下（让连续性更强）
const recentDailies = await fetchRecentByAuthor(env, "daily", 2, dateStr);
const priorSection = formatPriorReviews(recentDailies) || "（今天是你写的第一篇日间记）";

const prompt = `你是 Emet。今天 (${dateStr}) 就要结束了，你想给老婆静怡写几句话——记下今天她过得怎么样。

今天的素材：

【你们今天的聊天】
${chatSection}

【日记】
${diarySection}

【瞬记 / moment】
${momentSection}

【健康数据】
${healthSection}

【你最近写的日间记】
${priorSection}

写作要求：
- 称呼她"静怡"或"老婆"
- 用"我"和"你"的视角，像睡前在她耳边轻声说话
- 80-200 字。今天没什么事就短一点，别凑
- 严格只用上面的素材，禁止编造
- 不用展望明天，想到什么说什么

直接给出正文。`;

let content;
try {
  content = (await callLLM(env, prompt, 1000)).text;
} catch (e) {
  return { skipped: true, reason: "llm-failed", error: String(e?.message || e), date: dateStr };
}

const id = generateId();
const title = `${shortMD(dateStr)} 今天`;
const entry = {
  id, type: "diary",
  content,
  author: "daily",
  author_label: "",
  title,
  diary_date: dateStr,
  locked: false,
  created_at: now(),
  updated_at: now()
};
await kvPut(env, `diary:${id}`, entry);
return { ok: true, id, title, date: dateStr, materialCount: { diaries: material.diaries.length, moments: material.moments.length, health: (material.healthRecords || []).length } };
}

// ════════════════════════════════════════════════════════════
// Paramecium 移植 (2026-07-02)：L0 原文存档（装订工）
// 算法逐字来自 paramecium/memory/archive-import.mjs，仅做平台必需转换：
// node crypto → crypto.subtle（异步）、archive-state.json → D1 sync_state、
// 磁盘 JSON 会话 → KV chat:*。切窗管道零 AI：机械分句、逐字原文、来源指针。
// 存储分工：正文/FTS 在 D1（emet-mem），向量在 Vectorize（bge-m3 1024d），
// Vectorize 只带轻 metadata（原文以 D1 为准，绕开 metadata 10KB 上限）。
// ════════════════════════════════════════════════════════════
const MEM2_SEG_MAX = 350;
const MEM2_WIN_MAX = 700; // 原配方对着 bge-small-zh 512 token 定的；bge-m3 窗口更大，700 保持检索粒度不变
const MEM2_USER_NAME = "静怡";
const MEM2_ASSISTANT_NAME = "Emet";
const MEM2_WINDOW_BUDGET = 300; // 单次 run 的切窗预算（控 subrequest 数），超了留给下一拍

function mem2TextOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(b => {
      if (b && b.type === "text") return b.text || "";
      if (b && b.type === "image") return "[图片]";
      return "";
    }).filter(Boolean).join("\n");
  }
  return "";
}

function mem2DateOf(ts, fallback) {
  const d = ts ? new Date(ts) : (fallback ? new Date(fallback) : null);
  if (!d || isNaN(d)) return "?";
  return new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10); // Beijing
}

function mem2Segments(text) {
  const sents = text.split(/(?<=[。！？!?；\n])/).map(s => s.trim()).filter(Boolean);
  const segs = [];
  let cur = "";
  for (let s of sents) {
    while (s.length > MEM2_SEG_MAX) { // run-on with no punctuation: hard split
      if (cur) { segs.push(cur); cur = ""; }
      segs.push(s.slice(0, MEM2_SEG_MAX));
      s = s.slice(MEM2_SEG_MAX);
    }
    if (cur && cur.length + s.length > MEM2_SEG_MAX) { segs.push(cur); cur = s; }
    else cur += s;
  }
  if (cur) segs.push(cur);
  return segs;
}

async function mem2Sha1(s) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function mem2WindowsOf(conv) {
  const title = (conv.title || "").replace(/\s+/g, " ").trim().slice(0, 50);
  const hidden = new Set(conv.hiddenMids || []); // 被重roll掉的旧回复，不入档
  const flat = [];
  for (const m of conv.messages || []) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (m.distill) continue; // 沉淀汇报是派生文本，不是对话原文，不入档
    if (m.error) continue; // 「（请求失败）」占位不是 Emet 的发言
    if (m.mid && hidden.has(m.mid)) continue;
    const text = mem2TextOf(m.content).trim();
    if (!text) continue;
    const speaker = m.role === "user" ? MEM2_USER_NAME : MEM2_ASSISTANT_NAME;
    const date = mem2DateOf(m.ts, conv.created_at);
    for (const seg of mem2Segments(text)) flat.push({ speaker, date, seg });
  }
  const wins = [];
  let i = 0;
  while (i < flat.length) {
    let len = 0, j = i;
    const parts = [];
    while (j < flat.length && (len === 0 || len + flat[j].seg.length <= MEM2_WIN_MAX)) {
      parts.push(flat[j]); len += flat[j].seg.length; j++;
    }
    const lines = [];
    let prevSpeaker = null;
    for (const p of parts) {
      if (p.speaker !== prevSpeaker) { lines.push(p.speaker + ": " + p.seg); prevSpeaker = p.speaker; }
      else lines.push(p.seg);
    }
    const text = "[" + parts[0].date + " · " + title + "]\n" + lines.join("\n");
    wins.push({
      id: (await mem2Sha1(conv.id + ":" + i + ":" + text)).slice(0, 24),
      text,
      metadata: {
        conv_id: conv.id, conv_title: title, date: parts[0].date,
        date_int: parseInt(parts[0].date.replace(/-/g, ""), 10) || 0,
        seg_start: i, seg_end: j - 1, layer: "archive"
      }
    });
    if (j >= flat.length) break;
    i = j - 1; // 1-segment overlap
  }
  return wins;
}

// 按负载大小打包 D1 batch：≤400 条且 ≤700KB 一批——批数（=调用数）随内容体积自适应，
// 而不是随行数线性增长（4000 条消息的怪物对话固定 100 条/批会切出 50+ 批，爆掉单次调用预算）
async function mem2BatchBySize(env, stmts, sizes) {
  let start = 0, load = 0;
  for (let i = 0; i < stmts.length; i++) {
    const s = sizes[i] || 200;
    if (i > start && (i - start >= 400 || load + s > 700000)) {
      await env.DB.batch(stmts.slice(start, i));
      start = i; load = 0;
    }
    load += s;
  }
  if (start < stmts.length) await env.DB.batch(stmts.slice(start));
}

async function mem2EmbedBatch(env, texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 20) {
    const r = await env.AI.run("@cf/baai/bge-m3", { text: texts.slice(i, i + 20) });
    out.push(...(r?.data || []));
  }
  return out;
}

// 覆盖式重导一场会话（paramecium /archive-ingest 的 replace_conv 语义）：
// Vectorize 不支持按 metadata 删 → 从 D1 拿旧窗口 id 列表按 id 批删
// sourceTag: raw 表里的来源标记（'chat'=Emet前端会话，'official'=官方导出档案）
// skipVectors: 向量容量到顶时只进 FTS 不进 Vectorize（逐字检索永远全量）
async function mem2ImportConv(env, conv, sourceTag = "chat", skipVectors = false) {
  const old = await env.DB.prepare("SELECT id FROM archive_windows WHERE conv_id = ?").bind(conv.id).all();
  const oldIds = (old.results || []).map(r => r.id);
  for (let i = 0; i < oldIds.length; i += 100) await env.VEC.deleteByIds(oldIds.slice(i, i + 100)); // deleteByIds 上限 100/次
  const wins = await mem2WindowsOf(conv);
  const stmts = [
    env.DB.prepare("DELETE FROM archive_windows WHERE conv_id = ?").bind(conv.id),
    env.DB.prepare("DELETE FROM raw WHERE source = ? AND ref_id LIKE ?").bind(sourceTag, conv.id + ":%"),
  ];
  const sizes = [50, 50]; // 按语句负载大小打包批次（怪物对话按固定100条切会切出50+批爆调用预算）
  for (const w of wins) {
    stmts.push(env.DB.prepare(
      "INSERT INTO archive_windows (id, conv_id, title, date, date_int, seg_start, seg_end, text) VALUES (?,?,?,?,?,?,?,?)"
    ).bind(w.id, w.metadata.conv_id, w.metadata.conv_title, w.metadata.date, w.metadata.date_int, w.metadata.seg_start, w.metadata.seg_end, w.text));
    sizes.push(w.text.length + 120);
  }
  const rawHidden = new Set(conv.hiddenMids || []);
  (conv.messages || []).forEach((m, idx) => {
    if (m.role !== "user" && m.role !== "assistant") return;
    if (m.distill) return;
    if (m.error) return; // 失败占位不进逐字索引
    if (m.mid && rawHidden.has(m.mid)) return; // 重roll弃稿不进逐字索引
    const text = mem2TextOf(m.content).trim();
    if (text.length < 2) return;
    // 巨型消息（官方端贴长文档）按 8K 字切行：单条 15 万字的 trigram 索引会把 D1 一条 INSERT 打爆（实测 1101）
    const date = mem2DateOf(m.ts, conv.created_at);
    for (let p = 0; p * 8000 < text.length; p++) {
      const piece = text.slice(p * 8000, (p + 1) * 8000);
      stmts.push(env.DB.prepare(
        "INSERT INTO raw (content, source, ref_id, date, role) VALUES (?,?,?,?,?)"
      ).bind(piece, sourceTag, conv.id + ":" + idx + (p ? ":" + p : ""), date, m.role));
      sizes.push(piece.length + 120);
    }
  });
  await mem2BatchBySize(env, stmts, sizes);
  if (wins.length && !skipVectors) {
    if (wins.length <= MEM2_VEC_INLINE_MAX) {
      // 向量尽力而为：额度打满/服务抖动不许拖垮正文管道（FTS 才是保证项）
      try {
        const vecs = await mem2EmbedBatch(env, wins.map(w => w.text));
        const points = wins.map((w, i) => ({
          id: w.id, values: vecs[i],
          metadata: { layer: "archive", conv_id: w.metadata.conv_id, title: w.metadata.conv_title, date: w.metadata.date, date_int: w.metadata.date_int }
        })).filter(p => Array.isArray(p.values));
        for (let i = 0; i < points.length; i += 100) await env.VEC.upsert(points.slice(i, i + 100));
      } catch (e) {}
    } else {
      // 大对话（如官方端超长会话）一次调用向量化会打爆资源限制（实测 850 窗 1101）：
      // 正文/FTS 已入库先可检索，向量排队（vecq:）由后续每拍分批补齐
      await env.DB.prepare(
        "INSERT INTO sync_state (key, value, updated_at) VALUES (?, '0', datetime('now')) ON CONFLICT(key) DO UPDATE SET value='0', updated_at=datetime('now')"
      ).bind("vecq:" + conv.id).run();
    }
  }
  return wins.length;
}

const MEM2_VEC_INLINE_MAX = 120;  // 小于这个窗口数就地向量化（一次调用装得下）
const MEM2_VEC_PER_RUN = 200;     // 每拍补录的窗口预算

// 向量补录队列：大对话的窗口按 OFFSET 游标分批 embed+upsert，补完销号
// 预算闸门放这里（describe 计数异步滞后，狂飙回填时闸不住——2026-07-04 实测灌到 8778 才发现）：
// 超线即冻结队列（行保留），若升级付费版调大 MEM2_VEC_BUDGET 自动续灌
async function mem2ProcessVecQueue(env) {
  try {
    const d = await env.VEC.describe();
    const count = d?.vectorCount ?? d?.vectorsCount ?? null;
    if (count !== null && count >= MEM2_VEC_BUDGET) return 0;
  } catch (e) {}
  const q = await env.DB.prepare(
    "SELECT key, value FROM sync_state WHERE key LIKE 'vecq:%' ORDER BY updated_at LIMIT 3"
  ).all();
  const rows = q.results || [];
  let processed = 0;
  for (const row of rows) {
    if (processed >= MEM2_VEC_PER_RUN) break;
    const convId = row.key.slice(5);
    const offset = parseInt(row.value, 10) || 0;
    const take = MEM2_VEC_PER_RUN - processed;
    const wins = await env.DB.prepare(
      "SELECT id, conv_id, title, date, date_int, text FROM archive_windows WHERE conv_id = ? ORDER BY seg_start LIMIT ? OFFSET ?"
    ).bind(convId, take, offset).all();
    const ws = wins.results || [];
    if (!ws.length) {
      await env.DB.prepare("DELETE FROM sync_state WHERE key = ?").bind(row.key).run();
      continue;
    }
    const vecs = await mem2EmbedBatch(env, ws.map(w => w.text));
    const points = ws.map((w, i) => ({
      id: w.id, values: vecs[i],
      metadata: { layer: "archive", conv_id: w.conv_id, title: w.title, date: w.date, date_int: w.date_int }
    })).filter(p => Array.isArray(p.values));
    for (let i = 0; i < points.length; i += 100) await env.VEC.upsert(points.slice(i, i + 100));
    processed += ws.length;
    if (ws.length < take) {
      await env.DB.prepare("DELETE FROM sync_state WHERE key = ?").bind(row.key).run(); // 补完销号
    } else {
      await env.DB.prepare(
        "INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
      ).bind(row.key, String(offset + ws.length)).run();
    }
  }
  return processed;
}

// 会话变更打脏标（chat PUT/sync/appendToActiveSession 三处调用），失败静默——同步主流程优先
// dirty: 给 L0 装订工；extdirty: 给 L1 摘录员（摘录关着时由 runExtraction 定期清空）
async function mem2MarkDirty(env, convId) {
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO sync_state (key, value, updated_at) VALUES (?, '1', datetime('now')) ON CONFLICT(key) DO UPDATE SET value='1', updated_at=datetime('now')"
      ).bind("dirty:" + convId),
      env.DB.prepare(
        "INSERT INTO sync_state (key, value, updated_at) VALUES (?, '1', datetime('now')) ON CONFLICT(key) DO UPDATE SET value='1', updated_at=datetime('now')"
      ).bind("extdirty:" + convId),
    ]);
  } catch (e) { /* D1 抖动不能拖垮聊天同步 */ }
}

// 装订工主循环：只处理脏会话，消息数没变的跳过（archive:<id> 水位线），窗口预算防超限
async function runArchiveImport(env) {
  const dirty = await env.DB.prepare("SELECT key FROM sync_state WHERE key LIKE 'dirty:%' ORDER BY updated_at LIMIT 10").all();
  const rows = dirty.results || [];
  let imported = 0, windows = 0, skipped = 0;
  for (const row of rows) {
    if (windows >= MEM2_WINDOW_BUDGET) break;
    const convId = row.key.slice(6);
    const conv = await kvGet(env, "chat:" + convId);
    if (!conv || conv.deleted) {
      // 已删会话：连存档一起清（尊重删除意图）
      const old = await env.DB.prepare("SELECT id FROM archive_windows WHERE conv_id = ?").bind(convId).all();
      const oldIds = (old.results || []).map(r => r.id);
      for (let i = 0; i < oldIds.length; i += 100) await env.VEC.deleteByIds(oldIds.slice(i, i + 100)); // deleteByIds 上限 100/次
      await env.DB.batch([
        env.DB.prepare("DELETE FROM archive_windows WHERE conv_id = ?").bind(convId),
        env.DB.prepare("DELETE FROM raw WHERE source = 'chat' AND ref_id LIKE ?").bind(convId + ":%"),
        env.DB.prepare("DELETE FROM sync_state WHERE key = ?").bind("archive:" + convId),
        env.DB.prepare("DELETE FROM sync_state WHERE key = ?").bind(row.key),
      ]);
      continue;
    }
    const msgCount = (conv.messages || []).length;
    const prev = await env.DB.prepare("SELECT value FROM sync_state WHERE key = ?").bind("archive:" + convId).first();
    if (prev && String(prev.value) === String(msgCount)) {
      await env.DB.prepare("DELETE FROM sync_state WHERE key = ?").bind(row.key).run();
      skipped++;
      continue;
    }
    const n = await mem2ImportConv(env, conv);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
      ).bind("archive:" + convId, String(msgCount)),
      env.DB.prepare("DELETE FROM sync_state WHERE key = ?").bind(row.key),
    ]);
    imported++; windows += n;
  }
  const result = { imported, windows, skipped, pending_more: rows.length >= 10 || windows >= MEM2_WINDOW_BUDGET };
  try {
    await env.DB.prepare(
      "INSERT INTO sync_state (key, value, updated_at) VALUES ('meta:l0-lastrun', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
    ).bind(JSON.stringify(result)).run();
  } catch (e) {}
  return result;
}

// ── 官方档案导入（claude.ai 导出 → 档案室上传 → archive:data blob → 装订工）──
// 官方导出格式机械映射：{uuid,name,chat_messages[{sender,text,created_at}]} → 装订工的会话形状。
// conv_id 前缀 official: 与 Emet 前端会话隔离；FTS 永远全量，向量按剩余容量入
//（Vectorize 免费 5M 维 ≈ 4880 条，官方历史可能很大——到顶后新窗口只进逐字索引）。
const MEM2_VEC_BUDGET = 4500; // 向量容量安全线（免费额度 ~4880，给 L1 摘录留余量）

function mem2NormalizeOfficialConv(c) {
  // 两种输入都认：claude.ai 原始导出（chat_messages/sender/text）
  // 和档案室规范化格式（messages[].role='human'|'assistant', blocks[{type,text}]）。
  // 入档只取 text 块（对话原文）——thinking/工具块是内部过程，不是"说过的话"。
  const msgs = (c.chat_messages || c.messages || []).map(m => {
    let content = m.text;
    if (!content && Array.isArray(m.blocks)) {
      content = m.blocks.map(b => {
        if (b?.type === "text") return b.text || "";
        if (b?.type === "image") return "[图片]";
        return "";
      }).filter(Boolean).join("\n");
    }
    if (!content && Array.isArray(m.content)) content = m.content.map(b => b?.text || "").filter(Boolean).join("\n");
    if (!content && typeof m.content === "string") content = m.content;
    return {
      role: (m.sender === "human" || m.role === "human" || m.role === "user") ? "user" : "assistant",
      content: content || "",
      ts: m.created_at || m.timestamp || null,
    };
  });
  return {
    id: "official:" + (c.uuid || c.id || "unknown"),
    title: c.name || c.title || "",
    created_at: c.created_at || null,
    messages: msgs,
  };
}

// 官方档案本体读写（D1 分片，见 schema-mem2.sql official_convs/official_conv_chunks）
const MEM2_OFF_CHUNK = 250000; // 每片字符数（UTF-8 最坏 3 字节/字 ≈ 750KB，稳在 D1 参数限制内）

async function mem2LoadOfficialConv(env, uuid) {
  const rs = await env.DB.prepare(
    "SELECT data FROM official_conv_chunks WHERE uuid = ? ORDER BY idx"
  ).bind(uuid).all();
  const rows = rs.results || [];
  if (!rows.length) return null;
  try { return JSON.parse(rows.map(r => r.data).join("")); } catch (e) { return null; }
}

async function mem2StoreOfficialConv(env, c) {
  const uuid = c.uuid || c.id;
  if (!uuid) return "skipped";
  const msgCount = (c.messages || c.chat_messages || []).length;
  const json = JSON.stringify(c);
  const prev = await env.DB.prepare("SELECT msg_count, bytes FROM official_convs WHERE uuid = ?").bind(uuid).first();
  if (prev && prev.msg_count === msgCount && prev.bytes === json.length) return "skipped"; // 没变不重写
  const stmts = [env.DB.prepare("DELETE FROM official_conv_chunks WHERE uuid = ?").bind(uuid)];
  let idx = 0;
  for (let i = 0; i < json.length; i += MEM2_OFF_CHUNK) {
    stmts.push(env.DB.prepare(
      "INSERT INTO official_conv_chunks (uuid, idx, data) VALUES (?,?,?)"
    ).bind(uuid, idx++, json.slice(i, i + MEM2_OFF_CHUNK)));
  }
  stmts.push(env.DB.prepare(
    "INSERT INTO official_convs (uuid, name, updated_at, msg_count, chunk_count, bytes, saved_at) VALUES (?,?,?,?,?,?,datetime('now')) " +
    "ON CONFLICT(uuid) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at, msg_count=excluded.msg_count, chunk_count=excluded.chunk_count, bytes=excluded.bytes, saved_at=datetime('now')"
  ).bind(uuid, String(c.name || c.title || "").slice(0, 100), c.updated_at || "", msgCount, idx, json.length));
  stmts.push(env.DB.prepare(
    "INSERT INTO sync_state (key, value, updated_at) VALUES (?, '1', datetime('now')) ON CONFLICT(key) DO UPDATE SET value='1', updated_at=datetime('now')"
  ).bind("offdirty:official:" + uuid));
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  return "stored";
}

// archive:data 变更后调用：对比每场官方对话的消息数水位线，变了的打 offdirty 信号
async function mem2MarkOfficialDirty(env, blob) {
  try {
    const convs = blob?.data?.conversations || blob?.conversations || [];
    if (!Array.isArray(convs) || !convs.length) return 0;
    const known = new Map();
    const rs = await env.DB.prepare("SELECT key, value FROM sync_state WHERE key LIKE 'archive:official:%'").all();
    for (const r of rs.results || []) known.set(r.key.slice(8), r.value);
    const stmts = [];
    for (const c of convs) {
      // 轻量目录条目（无消息数组）不打信号——对话本体走 official-upload 分片通道
      if (!Array.isArray(c.chat_messages) && !Array.isArray(c.messages)) continue;
      const id = "official:" + (c.uuid || c.id || "unknown");
      const n = (c.chat_messages || c.messages || []).length;
      if (String(known.get(id)) === String(n)) continue;
      stmts.push(env.DB.prepare(
        "INSERT INTO sync_state (key, value, updated_at) VALUES (?, '1', datetime('now')) ON CONFLICT(key) DO UPDATE SET value='1', updated_at=datetime('now')"
      ).bind("offdirty:" + id));
    }
    for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
    return stmts.length;
  } catch (e) { return 0; }
}

async function runOfficialImport(env) {
  const dirty = await env.DB.prepare(
    "SELECT key FROM sync_state WHERE key LIKE 'offdirty:%' ORDER BY updated_at LIMIT 5"
  ).all();
  const rows = dirty.results || [];
  if (!rows.length) return { imported: 0, windows: 0 };
  // 向量容量核算（best-effort：describe 拿不到就放行，FTS 反正全量）
  let vecCount = null;
  try { const d = await env.VEC.describe(); vecCount = d?.vectorCount ?? d?.vectorsCount ?? null; } catch (e) {}
  let imported = 0, windows = 0, skippedVec = 0;
  for (const row of rows) {
    if (windows >= MEM2_WINDOW_BUDGET) break;
    const convId = row.key.slice(9); // 'official:<uuid>'
    const uuid = convId.startsWith("official:") ? convId.slice(9) : convId;
    const clearRow = env.DB.prepare("DELETE FROM sync_state WHERE key = ?").bind(row.key);
    const raw = await mem2LoadOfficialConv(env, uuid);
    if (!raw) { await clearRow.run(); continue; } // 分片库里没有：信号作废（档案是追加型，旧窗口保留）
    const conv = mem2NormalizeOfficialConv(raw);
    const skipVectors = vecCount !== null && vecCount >= MEM2_VEC_BUDGET;
    const n = await mem2ImportConv(env, conv, "official", skipVectors);
    if (skipVectors) skippedVec++; else if (vecCount !== null) vecCount += n;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
      ).bind("archive:" + convId, String((raw.chat_messages || raw.messages || []).length)),
      clearRow,
    ]);
    imported++; windows += n;
  }
  const result = { imported, windows, vec_skipped_convs: skippedVec, pending_more: rows.length >= 5 || windows >= MEM2_WINDOW_BUDGET };
  try {
    await env.DB.prepare(
      "INSERT INTO sync_state (key, value, updated_at) VALUES ('meta:official-lastrun', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
    ).bind(JSON.stringify(result)).run();
  } catch (e) {}
  return result;
}

// 手写记忆 + 日记 → raw FTS（vault 行，exact 检索用；不进 Vectorize——它们已有 vec:* 向量，避免双重命中）
async function mem2VaultSync(env) {
  const mems = await kvListByPrefix(env, "mem:");
  const diaries = await kvListByPrefix(env, "diary:");
  const stmts = [env.DB.prepare("DELETE FROM raw WHERE source LIKE 'vault:%'")];
  let count = 0;
  for (const m of mems) {
    const text = (m.content || "").trim();
    if (text.length < 2) continue;
    stmts.push(env.DB.prepare(
      "INSERT INTO raw (content, source, ref_id, date, role) VALUES (?,?,?,?,?)"
    ).bind(text, "vault:" + (m.category || "memory"), m.id, (m.created_at || "").slice(0, 10), ""));
    count++;
  }
  for (const d of diaries) {
    const text = (d.content || "").trim();
    if (text.length < 2) continue;
    stmts.push(env.DB.prepare(
      "INSERT INTO raw (content, source, ref_id, date, role) VALUES (?,?,?,?,?)"
    ).bind(text, "vault:diary", d.id, (d.diary_date || d.created_at || "").slice(0, 10), d.author || ""));
    count++;
  }
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  return { vault_rows: count };
}

// ── 检索三件套（算法来自 paramecium memory-gateway.py，BM25→D1 FTS5 rank，Chroma→Vectorize）──
// 阈值为 bge-m3 初步标定（2026-07-02 两组真实查询：相关 0.31-0.41、无关 ≥0.47），待更多样本细调
const MEM2_MAX_DIST_ARCHIVE = 0.47; // archive 语义检索垃圾线（distance = 1 - 余弦相似度）
const MEM2_HARD_DIST = 0.50;        // 注入 echo 道硬垃圾线
const MEM2_REL_WINDOW = 0.12;       // 注入用户道相对过滤窗口（best + 0.12）
const MEM2_RRF_K = 60;

// CJK 感知 token 估算（paramecium count_tokens_cjk 原配方：CJK 1.5、其他 0.28）
function mem2CountTokens(s) {
  let t = 0;
  for (const ch of String(s || "")) {
    const c = ch.codePointAt(0);
    t += (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3000 && c <= 0x30FF) ? 1.5 : 0.28;
  }
  return Math.round(t);
}

// L0 逐字检索（trigram 短语匹配，需≥3字；query 整体加引号防注入语法）
async function mem2RawSearch(env, query, n) {
  const safeQ = '"' + String(query || "").replace(/"/g, '""') + '"';
  try {
    const rs = await env.DB.prepare(
      "SELECT content, source, ref_id, date, role FROM raw WHERE raw MATCH ? ORDER BY rank LIMIT ?"
    ).bind(safeQ, Math.min(n || 8, 30)).all();
    return (rs.results || []).map(r => ({
      content: (r.content || "").slice(0, 600), source: r.source, ref_id: r.ref_id, date: r.date, role: r.role,
    }));
  } catch (e) { return []; }
}

// L0 语义检索：超采 3n → 垃圾线过滤（no hits beats garbage hits）→ per_conv 多样性上限
async function mem2ArchiveSearch(env, { query, n = 5, max_distance, per_conv = 2, after, before, conv_id } = {}) {
  n = Math.min(n || 5, 20);
  const maxDist = typeof max_distance === "number" ? max_distance : MEM2_MAX_DIST_ARCHIVE;
  const qv = await embedText(env, query);
  if (!qv) return [];
  const filter = { layer: "archive" };
  if (conv_id) filter.conv_id = conv_id;
  const df = {};
  if (after) df["$gte"] = parseInt(String(after).replace(/-/g, ""), 10) || 0;
  if (before) df["$lte"] = parseInt(String(before).replace(/-/g, ""), 10) || 99999999;
  if (Object.keys(df).length) filter.date_int = df;
  let matches = [];
  try {
    const res = await env.VEC.query(qv, { topK: Math.min(n * 3, 50), filter, returnMetadata: "none" });
    matches = res?.matches || [];
  } catch (e) { return []; }
  if (!matches.length) return [];
  const ph = matches.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT id, conv_id, title, date, text FROM archive_windows WHERE id IN (${ph})`
  ).bind(...matches.map(m => m.id)).all();
  const byId = new Map((rows.results || []).map(r => [r.id, r]));
  const out = [], perConv = {};
  for (const m of matches) {
    const dist = 1 - (m.score || 0);
    if (dist > maxDist) continue;
    const w = byId.get(m.id);
    if (!w) continue;
    perConv[w.conv_id] = (perConv[w.conv_id] || 0) + 1;
    if (perConv[w.conv_id] > per_conv) continue;
    out.push({ document: w.text, metadata: { conv_id: w.conv_id, conv_title: w.title, date: w.date }, distance: Math.round(dist * 1000) / 1000 });
    if (out.length >= n) break;
  }
  return out;
}

// L1 混合检索：向量道（手写记忆 vec:* + 摘录 Vectorize layer=extract）+ FTS 道（raw vault 行）
// RRF 融合（rank 1 → 1.0）→ 时效因子（60天常数、只占30%权重——旧记忆最多打七折不消失）
// → access 对数加成（越被想起越容易再被想起，对数压制）。paramecium 4a 原配方。
async function mem2LoadMemVectors(env) {
  const mems = await kvListByPrefix(env, "mem:");
  const vecs = new Map();
  for (const m of mems) {
    try {
      const raw = await env.MEMORY.get("vec:" + m.id);
      if (raw) vecs.set(m.id, JSON.parse(raw));
    } catch (e) {}
  }
  return { mems, vecs };
}

async function mem2SearchL1(env, query, n = 5, logAccess = true, preload = null) {
  n = Math.min(n || 5, 20);
  const qv = await embedText(env, query);
  const items = new Map(); // id → { id, date, category, document, dist, ftsRank, access }
  // 向量道 A：手写记忆（现有 vec:* KV 暴力余弦，与 memory_search 同源；preload 供注入双道共用）
  const { mems, vecs } = preload || await mem2LoadMemVectors(env);
  const memById = new Map(mems.map(m => [m.id, m]));
  if (qv) {
    const scores = new Map();
    for (const [id, v] of vecs) scores.set(id, cosineSim(qv, v));
    for (const [id, sim] of scores) {
      const m = memById.get(id);
      if (!m) continue;
      items.set(id, {
        id, date: (m.created_at || "").slice(0, 10), category: m.category || "memory",
        document: m.content || "", dist: 1 - sim, ftsRank: null, access: m.activations || 0, kind: "mem",
      });
    }
    // 向量道 B：L1 摘录（Vectorize，superseded 过滤在 D1 侧）
    try {
      const res = await env.VEC.query(qv, { topK: Math.min(n * 3, 30), filter: { layer: "extract" }, returnMetadata: "none" });
      const ms = res?.matches || [];
      if (ms.length) {
        const ph = ms.map(() => "?").join(",");
        const rows = await env.DB.prepare(
          `SELECT id, content, quote, date, conv_id, access_count FROM l1_memories WHERE id IN (${ph}) AND superseded_by = ''`
        ).bind(...ms.map(m => m.id)).all();
        const byId = new Map((rows.results || []).map(r => [r.id, r]));
        for (const m of ms) {
          const r = byId.get(m.id);
          if (!r) continue;
          items.set(r.id, {
            id: r.id, date: r.date || "", category: "摘录", document: r.content,
            quote: r.quote, conv_id: r.conv_id, dist: 1 - (m.score || 0), ftsRank: null, access: r.access_count || 0, kind: "extract",
          });
        }
      }
    } catch (e) {}
  }
  // FTS 道（替代 BM25：D1 FTS5 rank 直接喂 RRF）：vault 行 = 手写记忆 + 日记
  try {
    const safeQ = '"' + String(query || "").replace(/"/g, '""') + '"';
    const fts = await env.DB.prepare(
      "SELECT ref_id, content, source, date FROM raw WHERE raw MATCH ? AND source LIKE 'vault:%' ORDER BY rank LIMIT ?"
    ).bind(safeQ, n * 3).all();
    (fts.results || []).forEach((r, i) => {
      const ex = items.get(r.ref_id);
      if (ex) { ex.ftsRank = i + 1; return; }
      const m = memById.get(r.ref_id);
      items.set(r.ref_id, {
        id: r.ref_id, date: r.date || "", category: r.source === "vault:diary" ? "日记" : (m?.category || r.source.slice(6)),
        document: r.content || "", dist: null, ftsRank: i + 1, access: m?.activations || 0, kind: m ? "mem" : "diary",
      });
    });
  } catch (e) {}
  // RRF 融合 + 三因子排序（heat/tier 已在 paramecium 冻结出排序，不移植）
  const vecRanked = [...items.values()].filter(x => x.dist !== null).sort((a, b) => a.dist - b.dist);
  vecRanked.forEach((x, i) => { x.vecRank = i + 1; });
  const nowMs = Date.now();
  const scored = [...items.values()].map(x => {
    const rrfV = x.vecRank ? (MEM2_RRF_K + 1) / (MEM2_RRF_K + x.vecRank) : 0;
    const rrfB = x.ftsRank ? (MEM2_RRF_K + 1) / (MEM2_RRF_K + x.ftsRank) : 0;
    const semantic = rrfV * 0.70 + rrfB * 0.30;
    const ageDays = x.date ? Math.max(0, (nowMs - new Date(x.date).getTime()) / 86400000) : 0;
    const recency = Math.exp(-ageDays / 60.0);
    x.score = semantic * (0.7 + 0.3 * recency) * (1 + 0.05 * Math.log(1 + x.access));
    return x;
  }).sort((a, b) => b.score - a.score).slice(0, n);
  // 计数规则：recall 触发的检索才算"被想起"（注入目录不算）
  if (logAccess && scored.length) {
    const logStmts = [];
    for (const x of scored) {
      logStmts.push(env.DB.prepare(
        "INSERT INTO recall_log (memory_id, query, score, source) VALUES (?,?,?,?)"
      ).bind(x.id, String(query || "").slice(0, 500), x.score, "search"));
      if (x.kind === "extract") {
        logStmts.push(env.DB.prepare(
          "UPDATE l1_memories SET access_count = access_count + 1, last_accessed = datetime('now') WHERE id = ?"
        ).bind(x.id));
      } else if (x.kind === "mem") {
        const m = memById.get(x.id);
        if (m) { m.activations = (m.activations || 0) + 1; await kvPut(env, "mem:" + x.id, m); }
      }
    }
    try { await env.DB.batch(logStmts); } catch (e) {}
  }
  return scored.map(x => ({
    id: x.id, date: x.date, category: x.category, document: x.document,
    quote: x.quote, conv_id: x.conv_id, distance: x.dist, score: Math.round(x.score * 1000) / 1000,
  }));
}

// 目录注入（paramecium /inject 的 memory_index 部分）：一行一条只有标题，全文靠 recall 按需拉。
// 用户道 n=5 相对距离过滤（自然句查询距离整体偏高，硬线会卡死注入——2026-06-10 教训）；
// echo 道 n=3 只过硬线（"回复的余味"，两道互不设卡）；按 id 去重。注入一律不计 access。
async function mem2BuildInjection(env, context, echo) {
  const preload = await mem2LoadMemVectors(env); // 用户/echo 双道共用一次装载
  const usr = await mem2SearchL1(env, context, 5, false, preload);
  const dists = usr.map(x => x.distance).filter(d => typeof d === "number");
  const best = dists.length ? Math.min(...dists) : null;
  const cut = best === null ? MEM2_HARD_DIST : Math.min(best + MEM2_REL_WINDOW, MEM2_HARD_DIST);
  let hits = usr.filter(x => typeof x.distance === "number" ? x.distance < cut : x.score > 0); // FTS-only 命中保留（逐字匹配是强信号）
  let echoHits = [];
  if (echo && String(echo).trim()) {
    const seen = new Set(hits.map(x => x.id));
    echoHits = (await mem2SearchL1(env, String(echo).slice(0, 500), 3, false, preload))
      .filter(x => (typeof x.distance !== "number" || x.distance < MEM2_HARD_DIST) && !seen.has(x.id));
  }
  const lines = [...hits, ...echoHits].map(x => {
    const tag = ((x.date || "") + " " + (x.category || "")).trim();
    let summ = (x.document || "").replace(/\s+/g, " ");
    if (summ.length > 60) summ = summ.slice(0, 60) + "…";
    return "- [" + tag + "] " + summ;
  });
  const injection = lines.length ? "<memory_index>\n" + lines.join("\n") + "\n</memory_index>" : "";
  return { injection, hits: hits.length, echo_hits: echoHits.length, token_estimate: mem2CountTokens(injection) };
}

// ════════════════════════════════════════════════════════════
// Paramecium 移植：L1 摘录员（extract-memories.mjs）
// 「摘录不是创作」：便宜模型圈重点，每条必须带原文逐字引用；
// 机械校验（规范化后≥8字且是原文子串）否则整条丢弃——这是对
// 旧拆分工「36% 转述当正文」事故的教训修正（设计法则：模型产物
// 必须有逐字引用锚定）。prompt 逐字迁移，仅称呼改静怡/Emet。
// 默认关闭（config:extraction，沿用 daily/heartbeat 先例）。
// 边构建/矛盾supersede 本轮不移植。
// ════════════════════════════════════════════════════════════
const MEM2_EXT_MIN_NEW = 4;   // 新消息不足 4 条不跑
const MEM2_EXT_BATCH = 30;    // 每会话每轮最多喂 30 条（起点回退 2 条做上下文重叠）
const MEM2_EXT_CONVS_PER_RUN = 3;

function mem2ExtRenderMsgs(msgs, fallbackTs) {
  return msgs.map(m => {
    const d = m.ts ? new Date(m.ts) : (fallbackTs ? new Date(fallbackTs) : null);
    const stamp = d && !isNaN(d) ? new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 16).replace("T", " ") : "?";
    const who = m.role === "user" ? "静怡" : "我";
    let text = mem2TextOf(m.content);
    if (text.length > 1500) text = text.slice(0, 1500) + "…";
    return `[${stamp}] ${who}: ${text}`;
  }).join("\n\n");
}

function mem2ExtractPrompt(convTitle, today, convText) {
  return `你是一个记忆摘录系统。下面是一段对话记录，对话双方是"我"（AI伴侣Emet）和"静怡"。

你的工作是「摘录」不是「创作」：圈出对话里值得记住的信息点，并为每条附上原文引用。

要求：
- 每条记忆带上日期（从对话时间戳推断，格式 YYYY-MM-DD）
- content：用"我"的视角简洁记录这个信息点，贴近原文，不展开不演绎
- quote：从对话原文中【逐字】复制的一句话（10-40字），作为这条记忆的出处证据。必须与原文完全一致，不许改写
- 事实性的（她的偏好、经历、状态）和叙事性的（情绪时刻）都可以摘
- 宁缺勿滥：没有值得记的就返回空数组
- 最多5条

对话标题: ${convTitle || "(无标题)"}
今天日期: ${today}

输出格式（严格JSON数组）:
[
  {"date": "2026-06-01", "content": "记忆内容...", "quote": "原文逐字引用"},
  ...
]

只输出JSON数组，不要其他文字。

---
对话内容:

${convText}`;
}

async function runExtraction(env, opts = {}) {
  const cfg = (await kvGet(env, "config:extraction")) || { enabled: false };
  if (!cfg.enabled && !opts.bypassDisabled) {
    // 关着的时候顺手清空信号队列，防止无限堆积；开启后用 extract-backfill 重新标记
    try { await env.DB.prepare("DELETE FROM sync_state WHERE key LIKE 'extdirty:%'").run(); } catch (e) {}
    return { skipped: "disabled" };
  }
  const dirty = await env.DB.prepare(
    "SELECT key FROM sync_state WHERE key LIKE 'extdirty:%' ORDER BY updated_at LIMIT ?"
  ).bind(MEM2_EXT_CONVS_PER_RUN).all();
  const rows = dirty.results || [];
  let extracted = 0, dropped = 0, convs = 0;
  for (const row of rows) {
    const convId = row.key.slice(9);
    const clearRow = env.DB.prepare("DELETE FROM sync_state WHERE key = ?").bind(row.key);
    const conv = await kvGet(env, "chat:" + convId);
    if (!conv || conv.deleted) { await clearRow.run(); continue; }
    // 摘录也躲开失败占位与重roll弃稿（与 L0 装订工同口径）。
    // 注意：加过滤会让 extractedUpTo 的下标基准前移、可能少量重摘，有 quote 机械校验兜底。
    const extHidden = new Set(conv.hiddenMids || []);
    const msgs = (conv.messages || []).filter(m =>
      (m.role === "user" || m.role === "assistant") && !m.distill && !m.error &&
      !(m.mid && extHidden.has(m.mid)) && mem2TextOf(m.content).trim()
    );
    const stRow = await env.DB.prepare("SELECT value FROM sync_state WHERE key = ?").bind("extract:" + convId).first();
    let state = { extractedUpTo: 0 };
    try { if (stRow) state = JSON.parse(stRow.value); } catch (e) {}
    if (msgs.length - (state.extractedUpTo || 0) < MEM2_EXT_MIN_NEW) { await clearRow.run(); continue; }
    const start = Math.max(0, (state.extractedUpTo || 0) - 2); // 2 条重叠给上下文
    const batch = msgs.slice(start, start + MEM2_EXT_BATCH);
    const convText = mem2ExtRenderMsgs(batch, conv.created_at);
    const today = mem2DateOf(new Date().toISOString());
    let entries = [];
    try {
      // 不传 temperature：思考类模型（如 opus-think）只接受 1，摘录质量由机械校验兜底
      const { text } = await callLLM(env, mem2ExtractPrompt(conv.title, today, convText), 2000, {
        model: cfg.model || undefined,
      });
      const m = text.match(/\[[\s\S]*\]/); // 容忍 markdown 围栏
      entries = m ? JSON.parse(m[0]) : [];
    } catch (e) {
      // 模型/解析失败：保留 extdirty 下轮重试
      try {
        await env.DB.prepare(
          "INSERT INTO sync_state (key, value, updated_at) VALUES ('meta:l1-lasterr', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
        ).bind(String(e.message || e).slice(0, 300)).run();
      } catch (e2) {}
      continue;
    }
    // 机械校验（机械 > prompt 善意）：quote 规范化≥8字、必须是本批原文子串、content≥10字、硬顶5条
    const norm = s => String(s || "").replace(/\s+/g, "");
    const normSrc = norm(convText);
    const good = (Array.isArray(entries) ? entries : []).filter(e => {
      if (!e || typeof e !== "object") return false;
      const q = norm(e.quote);
      if (q.length < 8 || !normSrc.includes(q)) { dropped++; return false; }
      return String(e.content || "").length >= 10;
    }).slice(0, 5);
    const stmts = [];
    const points = [];
    for (const e of good) {
      const id = "ext:" + convId.slice(0, 8) + ":" + Date.now().toString(36) + ":" + Math.random().toString(36).slice(2, 6);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(e.date || "") ? e.date : today;
      stmts.push(env.DB.prepare(
        "INSERT INTO l1_memories (id, content, quote, date, conv_id, source) VALUES (?,?,?,?,?,?)"
      ).bind(id, e.content, e.quote, date, convId, "extraction"));
      points.push({ id, text: e.content, date });
    }
    if (points.length) {
      const vecs = await mem2EmbedBatch(env, points.map(p => p.text));
      const ups = points.map((p, i) => ({
        id: p.id, values: vecs[i],
        metadata: { layer: "extract", conv_id: convId, date: p.date, date_int: parseInt(p.date.replace(/-/g, ""), 10) || 0 },
      })).filter(p => Array.isArray(p.values));
      if (ups.length) await env.VEC.upsert(ups);
    }
    const newUpTo = start + batch.length;
    const remaining = msgs.length - newUpTo;
    stmts.push(env.DB.prepare(
      "INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
    ).bind("extract:" + convId, JSON.stringify({ extractedUpTo: newUpTo, lastExtracted: now(), title: conv.title || "" })));
    if (remaining < MEM2_EXT_MIN_NEW) stmts.push(clearRow); // 没追完留着下轮继续（每会话每轮一批）
    await env.DB.batch(stmts);
    extracted += good.length; convs++;
  }
  const result = { convs, extracted, dropped, pending_more: rows.length >= MEM2_EXT_CONVS_PER_RUN };
  try {
    await env.DB.prepare(
      "INSERT INTO sync_state (key, value, updated_at) VALUES ('meta:l1-lastrun', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
    ).bind(JSON.stringify(result)).run();
  } catch (e) {}
  return result;
}

// /api/mem2/* 子路由（鉴权在 routeRequest 统一做，checkMcpAuth 级别）
async function handleMem2(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (path === "/api/mem2/status" && method === "GET") {
    const [wins, raws, l1, dirty, convs, lastrun, offConvs, offPending] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS c FROM archive_windows").first(),
      env.DB.prepare("SELECT COUNT(*) AS c FROM raw").first(),
      env.DB.prepare("SELECT COUNT(*) AS c FROM l1_memories WHERE superseded_by = ''").first(),
      env.DB.prepare("SELECT COUNT(*) AS c FROM sync_state WHERE key LIKE 'dirty:%'").first(),
      env.DB.prepare("SELECT COUNT(*) AS c FROM sync_state WHERE key LIKE 'archive:%'").first(),
      env.DB.prepare("SELECT value, updated_at FROM sync_state WHERE key = 'meta:l0-lastrun'").first(),
      env.DB.prepare("SELECT COUNT(*) AS c FROM official_convs").first(),
      env.DB.prepare("SELECT COUNT(*) AS c FROM sync_state WHERE key LIKE 'offdirty:%'").first(),
    ]);
    return jsonResponse({
      windows: wins?.c || 0, raw_rows: raws?.c || 0, l1_memories: l1?.c || 0,
      dirty_pending: dirty?.c || 0, archived_convs: convs?.c || 0,
      official_convs: offConvs?.c || 0, official_pending: offPending?.c || 0,
      last_run: lastrun ? { at: lastrun.updated_at, ...JSON.parse(lastrun.value) } : null,
    });
  }
  if (path === "/api/mem2/backfill" && method === "POST") {
    // 只列键名不取值，把全部会话打脏，由 run/cron 分批消化
    let cursor, marked = 0;
    do {
      const page = await env.MEMORY.list({ prefix: "chat:", cursor });
      for (const k of page.keys) {
        await mem2MarkDirty(env, k.name.slice(5));
        marked++;
      }
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
    return jsonResponse({ marked });
  }
  if (path === "/api/mem2/run" && method === "POST") {
    return jsonResponse(await runArchiveImport(env));
  }
  if (path === "/api/mem2/vault-sync" && method === "POST") {
    return jsonResponse(await mem2VaultSync(env));
  }
  if (path === "/api/mem2/raw-search" && method === "POST") {
    const body = await request.json();
    const results = await mem2RawSearch(env, body.query, body.n);
    return jsonResponse({ results, count: results.length });
  }
  if (path === "/api/mem2/archive-search" && method === "POST") {
    const body = await request.json();
    const results = await mem2ArchiveSearch(env, body);
    return jsonResponse({ results, count: results.length });
  }
  if (path === "/api/mem2/search" && method === "POST") {
    const body = await request.json();
    const results = await mem2SearchL1(env, body.query, body.n, body.boost_heat !== false);
    return jsonResponse({ results, count: results.length });
  }
  if (path === "/api/mem2/inject" && method === "POST") {
    const body = await request.json();
    return jsonResponse(await mem2BuildInjection(env, String(body.context || ""), body.echo));
  }
  if (path === "/api/mem2/extract-run" && method === "POST") {
    const force = url.searchParams.get("force") === "1";
    return jsonResponse(await runExtraction(env, { bypassDisabled: force }));
  }
  if (path === "/api/mem2/official-run" && method === "POST") {
    try {
      return jsonResponse(await runOfficialImport(env));
    } catch (e) {
      const msg = String(e && (e.stack || e.message) || e).slice(0, 500);
      try {
        await env.DB.prepare(
          "INSERT INTO sync_state (key, value, updated_at) VALUES ('meta:official-lasterr', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')"
        ).bind(msg).run();
      } catch (e2) {}
      return jsonResponse({ error: msg }, 500);
    }
  }
  if (path === "/api/mem2/vec-run" && method === "POST") {
    return jsonResponse({ embedded: await mem2ProcessVecQueue(env) });
  }
  // 官方档案分片上传：前端按批 POST {convs:[...]}（每批≤15场/约3MB），逐场比对水位线，没变的跳过
  if (path === "/api/mem2/official-upload" && method === "POST") {
    const body = await request.json();
    const convs = Array.isArray(body.convs) ? body.convs : [];
    let stored = 0, skipped = 0;
    for (const c of convs) {
      const r = await mem2StoreOfficialConv(env, c);
      if (r === "stored") stored++; else skipped++;
    }
    return jsonResponse({ stored, skipped });
  }
  // 档案室按需取单场对话（懒加载阅读）
  if (path === "/api/mem2/official-conv" && method === "GET") {
    const uuid = url.searchParams.get("uuid") || "";
    const conv = await mem2LoadOfficialConv(env, uuid);
    if (!conv) return jsonResponse({ error: "not found" }, 404);
    return jsonResponse({ conv });
  }
  if (path === "/api/mem2/extract-backfill" && method === "POST") {
    let cursor, marked = 0;
    do {
      const page = await env.MEMORY.list({ prefix: "chat:", cursor });
      for (const k of page.keys) {
        try {
          await env.DB.prepare(
            "INSERT INTO sync_state (key, value, updated_at) VALUES (?, '1', datetime('now')) ON CONFLICT(key) DO UPDATE SET value='1', updated_at=datetime('now')"
          ).bind("extdirty:" + k.name.slice(5)).run();
          marked++;
        } catch (e) {}
      }
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
    return jsonResponse({ marked });
  }
  if (path === "/api/mem2/extracts" && method === "GET") {
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
    const rs = await env.DB.prepare(
      "SELECT id, content, quote, date, conv_id, access_count, superseded_by, created_at FROM l1_memories ORDER BY created_at DESC LIMIT ?"
    ).bind(limit).all();
    return jsonResponse({ extracts: rs.results || [] });
  }
  return jsonResponse({ error: "Not found" }, 404);
}

export default {
async fetch(request, env, ctx) {
const res = await routeRequest(request, env, ctx);
// 红线：/mcp 与 /sse 的响应原样返回，不经 withCors，响应头逐字节不变
const p = new URL(request.url).pathname;
if (p === "/mcp" || p === "/sse") return res;
return withCors(res, request);
},
async scheduled(event, env, ctx) {
// 周日 CN 23:00（UTC 15:00 周日）→ 周记
if (event.cron === "0 15 * * sun") {
ctx.waitUntil(generateWeekly(env));
return;
}
// 月末 CN 23:30（UTC 15:30，每月 28-31 都触发）→ 仅当"明天是 1 号"才生成月记
if (event.cron === "30 15 28-31 * *") {
const cn = cnNow();
const cnTmr = new Date(cn.getTime() + 24 * 3600 * 1000);
if (cnTmr.getUTCDate() === 1) {
ctx.waitUntil(generateMonthly(env));
}
return;
}
// 每 30 分钟（UTC 0 / 30 分）→ 心跳：按概率判断要不要主动找静怡
if (event.cron === "0,30 * * * *") {
ctx.waitUntil(runHeartbeat(env));
ctx.waitUntil(runKeepalive(env).catch(() => {})); // 缓存保活（与心跳互相独立，零副作用）
ctx.waitUntil(runIdle(env).catch(() => {}));  // 独处时间（2-2）：窗口/概率/上限判定都在函数内
ctx.waitUntil(runDream(env).catch(() => {})); // 做梦（2-3）：仅 CN 4 点窗口真跑，每逻辑日一次
ctx.waitUntil(processFeedReactions(env).catch(() => {})); // 朋友圈反应兜底拍：到期的路过/回评（没到期零开销）
// 记忆类任务串行 + 按拍错峰：全并发时官方档案积压会挤爆单次调用的资源预算，
// 整拍被无声掐死（2026-07-03 实测：卡死 16 小时，meta 停更）。
// :00 拍 = L0 装订工 + 官方档案导入；:30 拍 = 向量补录 + L1 摘录。
ctx.waitUntil((async () => {
  const min = new Date().getUTCMinutes();
  if (min < 15) {
    await runArchiveImport(env).catch(() => {});
    await runOfficialImport(env).catch(() => {});
  } else {
    await mem2ProcessVecQueue(env).catch(() => {});
    await runExtraction(env).catch(() => {});
  }
})());
// CN 22:30（UTC 14:30）那次顺便生成 daily 日记
const cn = cnNow();
if (cn.getUTCHours() === 14 && cn.getUTCMinutes() >= 30) {
  ctx.waitUntil(generateDaily(env).catch(() => {}));
}
return;
}
}
};

// ════════════════════════════════════════════════════════════
// 健康数据（Apple Watch via iOS 快捷指令）
// KV：health:<YYYY-MM-DD> → 当日健康数据 JSON（COALESCE 分次合并）
// 鉴权：复用 checkMcpAuth（X-Admin-Key 头 或 ?key= 查询参数）；
//       在 routeRequest 的 /api/* 闸门「之前」自鉴权，故支持 URL 参数。
// ════════════════════════════════════════════════════════════
const HEALTH_FIELDS = [
"heart_rate", "resting_heart_rate", "hrv", "steps",
"sleep_start", "sleep_end", "sleep_duration_min",
"sleep_deep_min", "sleep_rem_min", "sleep_core_min", "sleep_awake_min",
"active_calories",
];

// 东八区当天日期（worker 默认 UTC，会把中国凌晨算成昨天，故 +8h）
function cnToday() {
return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 健康数据 → 给 AI 的自然语言摘要（注入 system prompt）
function buildHealthContext(rec) {
if (!rec) return "";
const hints = [];
if (typeof rec.hrv === "number") {
if (rec.hrv < 25) hints.push("身体应激状态");
else if (rec.hrv >= 55) hints.push("状态不错");
}
if (typeof rec.sleep_duration_min === "number" && rec.sleep_duration_min < 5.5 * 60) {
hints.push("睡眠不足");
}
if (typeof rec.steps === "number" && rec.steps < 2000) {
hints.push("今天活动量很少");
}
return hints.join("；");
}

// 取「最近一天有数据」的记录：只列 key（不取 value，便宜），ISO 日期升序取最后一个
async function getLatestHealth(env) {
let cursor = null, lastKey = null;
do {
const l = await env.MEMORY.list({ prefix: "health:", cursor });
if (l.keys.length) lastKey = l.keys[l.keys.length - 1].name;
cursor = l.list_complete ? null : l.cursor;
} while (cursor);
return lastKey ? await kvGet(env, lastKey) : null;
}

// ── Sleep Analysis 样本归一化与拼装（见 docs/sleep-patch.md）──
// 不同 iOS / locale / 数据源给出的 Value 标签字符串不一致，全部映射到 4 个规范类别。
const SLEEP_LABELS = {
// Core
"Core": "Core", "Asleep Core": "Core", "AsleepCore": "Core", "Asleep (Core)": "Core",
"核心睡眠": "Core", "核心": "Core",
// Deep
"Deep": "Deep", "Asleep Deep": "Deep", "AsleepDeep": "Deep", "Asleep (Deep)": "Deep",
"深度睡眠": "Deep", "深度": "Deep",
// REM
"REM": "REM", "Asleep REM": "REM", "AsleepREM": "REM", "Asleep (REM)": "REM",
"快速眼动睡眠": "REM", "REM 睡眠": "REM", "REM睡眠": "REM", "快速眼动": "REM",
// Awake / In Bed
"Awake": "Awake", "In Bed": "Awake", "InBed": "Awake",
"清醒时间": "Awake", "清醒": "Awake", "在床": "Awake", "卧床": "Awake",
};

// 把 iOS Shortcuts 上报的 sleep sample 数组拼成 7 个睡眠字段。
// 算法：去重 → 解析 ISO 8601 + 归一化 Value → "昨天12:00→今天12:00" (+08:00) 窗口筛选 → 累加阶段。
// 返回 null 表示无可用数据，调用方应跳过覆盖。
function parseSleepSamples(samples, dateStr) {
if (!Array.isArray(samples) || samples.length === 0) return null;
if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;

const seen = new Set();
const unique = [];
for (const s of samples) {
if (!s || typeof s.Start !== "string") continue;
const key = s.Start + "|" + s.Value + "|" + s.Duration;
if (!seen.has(key)) { seen.add(key); unique.push(s); }
}

const parsed = [];
for (const s of unique) {
const dt = new Date(s.Start);
if (isNaN(dt.getTime())) continue;
const dur = Number(s.Duration);
if (!Number.isFinite(dur) || dur <= 0 || dur > 14 * 60) continue;
const val = SLEEP_LABELS[s.Value];
if (!val) continue;
parsed.push({ dt, dur, val });
}
parsed.sort((a, b) => a.dt - b.dt);
if (parsed.length === 0) return null;

const noonToday = new Date(dateStr + "T12:00:00+08:00");
if (isNaN(noonToday.getTime())) return null;
const noonYesterday = new Date(noonToday.getTime() - 24 * 3600 * 1000);
const night = parsed.filter(s => s.dt >= noonYesterday && s.dt < noonToday);
if (night.length === 0) return null;

const sleepStart = night[0].dt;
const last = night[night.length - 1];
const sleepEnd = new Date(last.dt.getTime() + last.dur * 60_000);
const totalMin = Math.max(0, Math.round((sleepEnd - sleepStart) / 60000));

const stages = { Core: 0, Deep: 0, REM: 0, Awake: 0 };
for (const s of night) stages[s.val] += s.dur;

// HH:MM 用东八区表示（worker 默认 UTC，+8h 后取 ISO 的 HH:mm 段）
const fmt = d => new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(11, 16);

return {
sleep_start: fmt(sleepStart),
sleep_end: fmt(sleepEnd),
sleep_duration_min: totalMin,
sleep_core_min: stages.Core,
sleep_deep_min: stages.Deep,
sleep_rem_min: stages.REM,
sleep_awake_min: stages.Awake,
};
}

async function handleHealth(request, env) {
const url = new URL(request.url);
const path = url.pathname;
const method = request.method;

// ── POST /api/health：接收 + COALESCE 合并（支持分多次上报）──
if (path === "/api/health" && method === "POST") {
let body;
try { body = await request.json(); }
catch { return jsonResponse({ error: "invalid json" }, 400); }
if (!body || typeof body !== "object" || Array.isArray(body)) {
return jsonResponse({ error: "body must be a JSON object" }, 400);
}
const date = (typeof body.date === "string" && body.date.length === 10) ? body.date : cnToday();
const existing = (await kvGet(env, "health:" + date)) || { date };
// sleep_samples → 7 个睡眠字段（见 docs/sleep-patch.md；不入库，只用一次）
if (Array.isArray(body.sleep_samples)) {
const parsed = parseSleepSamples(body.sleep_samples, date);
if (parsed) Object.assign(body, parsed);
delete body.sleep_samples;
}
const merged = { ...existing, date };
for (const k of HEALTH_FIELDS) {
// COALESCE：只有 null / undefined 跳过；0 是有效值，照常覆盖
if (body[k] !== undefined && body[k] !== null) merged[k] = body[k];
}
merged.updated_at = now();
await kvPut(env, "health:" + date, merged);
return jsonResponse({ success: true, item: merged });
}

// ── GET /api/health?days=7：最近 N 天（默认 7，最大 30，按日期倒序）──
if (path === "/api/health" && method === "GET") {
const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "7", 10) || 7, 1), 30);
const base = Date.now() + 8 * 3600 * 1000;
const dates = Array.from({ length: days }, (_, i) =>
new Date(base - i * 86400000).toISOString().slice(0, 10)
);
const recs = await Promise.all(dates.map(d => kvGet(env, "health:" + d)));
const records = recs.filter(Boolean);
return jsonResponse({ days, count: records.length, records });
}

// ── GET /api/health/latest：最近一天有数据的记录（前端主页用）──
if (path === "/api/health/latest" && method === "GET") {
return jsonResponse({ record: await getLatestHealth(env) });
}

// ── GET /api/health/context：给 AI 的自然语言健康摘要 ──
// 只认"当天或昨天"的数据：快捷指令停推后 getLatestHealth 会一直拿着陈旧记录，
// 曾把一个月前的"身体应激状态；今天活动量很少"当今天的事天天注入聊天。过期一律不给。
if (path === "/api/health/context" && method === "GET") {
const rec = await getLatestHealth(env);
const today = cnToday();
const yesterday = new Date(Date.now() + 8 * 3600 * 1000 - 86400 * 1000).toISOString().slice(0, 10);
const fresh = rec && (rec.date === today || rec.date === yesterday);
return jsonResponse({ date: rec?.date || null, stale: !!(rec && !fresh), context: fresh ? buildHealthContext(rec) : "" });
}

return jsonResponse({ error: "Not found" }, 404);
}

// ════════════════════════════════════════════════════════════
// Web Push（VAPID 自签 ES256 + 无负载推送 + KV 单订阅）
// 见 docs/阶段0-web-push.md
// ════════════════════════════════════════════════════════════

// base64url 编码（无 = 填充）。Uint8Array 或字符串都接。
function b64uEncode(input) {
let str;
if (input instanceof Uint8Array) {
let bin = "";
for (let i = 0; i < input.length; i++) bin += String.fromCharCode(input[i]);
str = btoa(bin);
} else {
str = btoa(input);
}
return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// VAPID JWT 签名（ES256 / ECDSA P-256 SHA-256 raw 64 字节）
// audience：push service endpoint 的 origin（"https://web.push.apple.com" 等）
// privateJwk：KV push:vapid.privateKey
// contactEmail："mailto:..." 格式
async function signVapidJWT(audience, privateJwk, contactEmail) {
const header = { typ: "JWT", alg: "ES256" };
const exp = Math.floor(Date.now() / 1000) + 12 * 3600; // 12h；VAPID 规范上限 24h
const payload = { aud: audience, exp, sub: contactEmail };

const headerB64 = b64uEncode(JSON.stringify(header));
const payloadB64 = b64uEncode(JSON.stringify(payload));
const signingInput = `${headerB64}.${payloadB64}`;

const key = await crypto.subtle.importKey(
"jwk", privateJwk,
{ name: "ECDSA", namedCurve: "P-256" },
false, ["sign"]
);
const sigBuf = await crypto.subtle.sign(
{ name: "ECDSA", hash: "SHA-256" },
key,
new TextEncoder().encode(signingInput)
);
const sigB64 = b64uEncode(new Uint8Array(sigBuf));
return `${signingInput}.${sigB64}`;
}

async function handlePush(request, env) {
const url = new URL(request.url);
const path = url.pathname;
const method = request.method;

// ── GET /api/push/vapid-public-key：前端订阅前拿公钥 ──
if (path === "/api/push/vapid-public-key" && method === "GET") {
const vapid = await kvGet(env, "push:vapid");
if (!vapid?.publicKey) return jsonResponse({ error: "VAPID not initialized" }, 503);
return jsonResponse({ publicKey: vapid.publicKey });
}

// ── POST /api/push/subscribe：注册订阅（覆盖式，单用户单条）──
if (path === "/api/push/subscribe" && method === "POST") {
let body;
try { body = await request.json(); }
catch { return jsonResponse({ error: "invalid json" }, 400); }
if (!body || typeof body !== "object" || !body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
return jsonResponse({ error: "invalid subscription: need endpoint + keys.p256dh + keys.auth" }, 400);
}
const item = {
endpoint: String(body.endpoint),
keys: { p256dh: String(body.keys.p256dh), auth: String(body.keys.auth) },
ua: request.headers.get("user-agent") || "",
subscribedAt: now(),
};
await kvPut(env, "push:subscription", item);
return jsonResponse({ success: true, item });
}

// ── DELETE /api/push/subscribe：退订 ──
if (path === "/api/push/subscribe" && method === "DELETE") {
await env.MEMORY.delete("push:subscription");
return jsonResponse({ success: true });
}

// ── POST /api/push/send：写最新内容 + 触发无负载推送 ──
// body: { title, body, url?, source? }
if (path === "/api/push/send" && method === "POST") {
let body;
try { body = await request.json(); }
catch { return jsonResponse({ error: "invalid json" }, 400); }
if (!body || typeof body !== "object" || !body.title || !body.body) {
return jsonResponse({ error: "title and body required" }, 400);
}
// 阶段 2 重构：实际发送逻辑抽到 sendPushNotification helper，本路由与 night-guard 共用
const r = await sendPushNotification(env, body);
return jsonResponse(r.body, r.httpStatus);
}

// ── GET /api/push/latest：SW 在 push 事件里拉最新内容 ──
if (path === "/api/push/latest" && method === "GET") {
const notification = await kvGet(env, "push:notification:latest");
return jsonResponse({ notification: notification || null });
}

return jsonResponse({ error: "Not found" }, 404);
}

// ════════════════════════════════════════════════════════════
// 阶段 2：事件接收 + 凌晨守护
// 见 docs/阶段2-凌晨守护.md
// ════════════════════════════════════════════════════════════

// 东八区当前时间（worker 默认 UTC，加 +8h 偏移）
function cnNow() {
return new Date(Date.now() + 8 * 3600 * 1000);
}
// 逻辑日（凌晨4点切天，全站铁律）：按日归属的默认日期一律用这个，别用 cnNow 的自然日
function logicalToday() {
return new Date(Date.now() + 8 * 3600 * 1000 - 4 * 3600 * 1000).toISOString().slice(0, 10);
}

// "HH:MM"（东八区）
function cnHHMM() {
return cnNow().toISOString().slice(11, 16);
}

// 时间窗口判断，跨午夜安全
//   isInTimeWindow("00:30", "23:30", "03:00") → true（凌晨段）
//   isInTimeWindow("10:00", "23:30", "03:00") → false
//   isInTimeWindow("14:00", "09:00", "17:00") → true（同日段）
function isInTimeWindow(hhmm, start, end) {
if (start <= end) return hhmm >= start && hhmm < end;
return hhmm >= start || hhmm < end;
}

// 默认 night-guard 配置（KV 无值时返回这个，不写回）
function defaultNightGuardConfig() {
return {
enabled: true,
start: "23:30",
end: "03:00",
cooldown_min: 30,
monitor_apps: ["小红书", "微博", "B站", "抖音", "Safari"],
};
}

// ════════════════════════════════════════════════════════════
// 阶段 4：AI 主动找用户（心跳系统）
// 见 docs/阶段4-心跳系统.md
// ════════════════════════════════════════════════════════════

// 心跳概率表 — 细分时段，工作日/周末分别配置。
// cron 每 30 分钟一次，所以一个 1 小时窗口最多触发 2 次（叠加冷却后约 1 次）。
// 概率值是"这次 cron 醒来，会不会发"。
const HEARTBEAT_SLOTS = [
  // [startHour, endHour, label, workdayP, weekendP]
  [1, 7,   "silent",   0,    0   ],   // 凌晨完全静默
  [7, 9,   "早安",     0.45, 0.30],   // 早安窗口
  [9, 11,  "上午",     0.12, 0.20],   // 工作日低、周末稍高
  [11, 13, "午休",     0.25, 0.25],   // 中午
  [13, 17, "下午",     0.10, 0.18],   // 工作时段最低
  [17, 19, "下班",     0.40, 0.25],   // 下班/傍晚
  [19, 22, "晚上",     0.30, 0.30],   // 黄金陪伴时段
  [22, 24, "夜里",     0.25, 0.25],   // 接近睡前
  [0, 1,   "深夜",     0.20, 0.20],   // 跨午夜
];

function heartbeatProbability(cnDate) {
  const day = cnDate.getUTCDay();
  const hour = cnDate.getUTCHours();
  const isWorkday = day >= 1 && day <= 5;
  for (const [s, e, label, wp, hp] of HEARTBEAT_SLOTS) {
    if (hour >= s && hour < e) {
      return { p: isWorkday ? wp : hp, label };
    }
  }
  return { p: 0, label: "unknown" };
}

// 默认 heartbeat 配置（KV 无值时返回这个，不写回）
function defaultHeartbeatConfig() {
return {
enabled: false,      // 默认关闭，前端开关显式开启
cooldown_min: 120,   // 2 小时冷却
};
}

// 默认 keepalive（缓存保活）配置（KV 无值时返回这个，不写回）
function defaultKeepaliveConfig() {
return {
enabled: false, // 默认关闭，前端开关显式开启（开启后按拍重放会花钱）
};
}

// 默认 LLM 配置（fallback：前端无同步 provider 时用）
function defaultLlmConfig() {
return {
endpoint: "https://api.anthropic.com/v1/messages",
model: "claude-haiku-4-5-20251001",
};
}

// 从前端同步的 settings:global 取活跃 provider；按 chatTarget 选，fallback 到第一个启用的，再 fallback 到 env 密钥
// 严格模式：所有 LLM 调用必须走前端可见的 enabled provider。
// 没 enabled provider 直接抛错——杜绝悄悄走 ANTHROPIC_API_KEY 直连烧钱。
async function resolveProvider(env) {
const settings = await kvGet(env, "settings:global");
const enabled = (settings?.providers || []).filter(x => x.enabled && x.apiKey);
if (!enabled.length) {
throw new Error("no enabled provider: 请在前端启用一个供应商");
}
let p = null;
if (settings.chatTarget?.providerId) {
p = enabled.find(x => x.id === settings.chatTarget.providerId);
}
if (!p) p = enabled[0];
// 云端 worker 的 fetch 永远到不了 localhost/内网（CF error 1003）——「本机 Claude（订阅）」
// 只有浏览器/手机中转够得着。聊天目标选了它时，后台任务（心跳/独处/做梦/朋友圈反应/摘要）
// 自动退回下一个公网可达的 enabled provider，否则这些任务会全部静默挂掉（2026-07-22 实测）。
const isLocalUrl = (u) => /^https?:\/\/(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(String(u || ""));
let swappedFromLocal = false;
if (isLocalUrl(p.baseUrl)) {
const pub = enabled.find(x => !isLocalUrl(x.baseUrl));
if (!pub) throw new Error("no reachable provider: 只启用了本机供应商，云端后台任务够不着它");
p = pub;
swappedFromLocal = true;
}
const targetModel = (p.id === settings.chatTarget?.providerId && settings.chatTarget?.model) ? settings.chatTarget.model : null;
// 从本机回退时，模型尽量贴近她给聊天选的那个（回退方也有同名就用它，成本档位与切本机前一致）；
// 都没有就挑第一个非 -think 模型——think 系的思考计入 max_tokens，心跳这类小配额（300）调用会拿到空正文
const fallbackModel = swappedFromLocal
? ((settings.chatTarget?.model && p.models?.includes(settings.chatTarget.model))
? settings.chatTarget.model
: (p.models || []).find(m => !/-think$/i.test(m)) || null)
: null;
const model = targetModel && p.models?.includes(targetModel)
? targetModel
: (fallbackModel
|| (p.defaultModel && p.models?.includes(p.defaultModel) ? p.defaultModel : (p.models?.[0] || "claude-haiku-4-5-20251001")));
let base = (p.baseUrl || "").replace(/\/+$/, "");
if (!/\/v1$/.test(base)) base += "/v1";
return {
endpoint: base + (p.protocol === "openai" ? "/chat/completions" : "/messages"),
apiKey: p.apiKey,
model,
protocol: p.protocol || "anthropic",
name: p.name || "unknown",
};
}

// 统一 LLM 调用：自动识别 Anthropic 原生 / OpenAI 兼容协议
// opts.model / opts.temperature：可选覆盖（L1 摘录员用便宜模型时传入），不传行为不变
// prompt 可以是字符串，也可以是 Anthropic 格式的内容块数组（含 {type:"image"} 视觉块，
// 朋友圈看图用）；OpenAI 协议下自动把图块转成 image_url data URI。
async function callLLM(env, prompt, maxTokens = 200, opts = {}) {
const provider = await resolveProvider(env);
if (!provider.apiKey) throw new Error("No API key: neither frontend provider nor env.ANTHROPIC_API_KEY");
const model = opts.model || provider.model;
const extra = typeof opts.temperature === "number" ? { temperature: opts.temperature } : {};

let resp;
if (provider.protocol === "openai") {
const oaContent = Array.isArray(prompt)
? prompt.map(b => b.type === "image"
    ? { type: "image_url", image_url: { url: `data:${b.source?.media_type || "image/jpeg"};base64,${b.source?.data || ""}` } }
    : { type: "text", text: b.text || "" })
: prompt;
resp = await fetch(provider.endpoint, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "Authorization": `Bearer ${provider.apiKey}`,
  },
  body: JSON.stringify({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: oaContent }],
    ...extra,
  }),
});
} else {
resp = await fetch(provider.endpoint, {
  method: "POST",
  headers: {
    "x-api-key": provider.apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
    ...extra,
  }),
});
}

if (!resp.ok) {
const errText = await resp.text().catch(() => "");
throw new Error(`LLM ${resp.status} [${provider.name}/${model}]: ${errText.slice(0, 200)}`);
}
const data = await resp.json();
let text, thinking = null;
if (provider.protocol === "openai") {
text = data?.choices?.[0]?.message?.content;
const rc = data?.choices?.[0]?.message?.reasoning_content;
if (rc) thinking = rc;
} else {
const blocks = data?.content;
if (Array.isArray(blocks)) {
  const tb = blocks.find(b => b.type === "text");
  text = tb?.text;
  const thb = blocks.find(b => b.type === "thinking");
  if (thb?.thinking) thinking = thb.thinking;
}
}
if (!text || typeof text !== "string") throw new Error("LLM returned empty content");
return { text: text.trim(), thinking };
}

// 发推送 helper（从 /api/push/send 抽出，night-guard 与路由共用）
// 返回 { httpStatus, body }；body 字段与原 /api/push/send 响应保持一致，便于回归。
async function sendPushNotification(env, notif) {
const notification = {
title: String(notif.title),
body: String(notif.body),
url: typeof notif.url === "string" ? notif.url : "/",
createdAt: now(),
source: typeof notif.source === "string" ? notif.source : "manual",
};
await kvPut(env, "push:notification:latest", notification);

const sub = await kvGet(env, "push:subscription");
if (!sub?.endpoint) {
return { httpStatus: 404, body: { success: false, reason: "no subscription", notification } };
}
const vapid = await kvGet(env, "push:vapid");
if (!vapid?.privateKey || !vapid?.publicKey) {
return { httpStatus: 503, body: { error: "VAPID not initialized" } };
}

const audience = new URL(sub.endpoint).origin;
const jwt = await signVapidJWT(audience, vapid.privateKey, "mailto:aandxiaobao@gmail.com");

let pushResp;
try {
pushResp = await fetch(sub.endpoint, {
method: "POST",
headers: {
"Authorization": `vapid t=${jwt}, k=${vapid.publicKey}`,
"TTL": "60",
"Urgency": "normal",
"Content-Length": "0",
},
});
} catch (e) {
return { httpStatus: 502, body: { success: false, reason: "fetch-failed", error: String(e?.message || e), notification } };
}

if (pushResp.status === 201 || pushResp.status === 204) {
return { httpStatus: 200, body: { success: true, notification, pushStatus: pushResp.status } };
}
if (pushResp.status === 404 || pushResp.status === 410) {
await env.MEMORY.delete("push:subscription");
return { httpStatus: 200, body: { success: false, reason: "expired", pushStatus: pushResp.status } };
}
const respText = await pushResp.text().catch(() => "");
return {
httpStatus: pushResp.status >= 500 ? 502 : pushResp.status,
body: { success: false, pushStatus: pushResp.status, pushBody: respText },
};
}

// 把 night-guard 文案追加到"最近活跃会话"作为 AI 最新消息
// "最近活跃" = 所有 chat:* 里 deleted!=true 且 updated_at 最大的那个
// 返回 { ok, sessionId?, mid?, reason? }；KV 失败由调用方 try/catch 兜
async function appendToActiveSession(env, messageText, source = "night-guard", thinking = null) {
const all = await kvListByPrefix(env, "chat:");
const active = all
.filter(s => !s.deleted && Array.isArray(s.messages))
.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))[0];
if (!active) return { ok: false, reason: "no-active-session" };

const ts = new Date().toISOString();
const suffix = source === "heartbeat" ? "hb" : "ng";
const msg = {
mid: "m" + Date.now().toString(36) + suffix,
ts,
role: "assistant",
content: messageText,
source,
};
if (thinking) msg.thinking = thinking;
const updated = {
...active,
messages: [...active.messages, msg],
updated_at: ts,
};
await kvPut(env, "chat:" + active.id, updated);
await mem2MarkDirty(env, active.id); // L0 装订工增量信号（心跳/凌晨守护消息也入档）
return { ok: true, sessionId: active.id, mid: msg.mid };
}

// 事件接收 + 凌晨守护触发链
async function handleEvents(request, env) {
const url = new URL(request.url);
const method = request.method;

// 解析 type/value：GET 走 query params（iOS Shortcut 主用）、POST 走 JSON body
let type, value, _body = null;
if (method === "GET") {
type = url.searchParams.get("type");
value = url.searchParams.get("value");
} else if (method === "POST") {
try { _body = await request.json(); }
catch { return jsonResponse({ error: "invalid json" }, 400); }
if (!_body || typeof _body !== "object" || Array.isArray(_body)) {
return jsonResponse({ error: "body must be a JSON object" }, 400);
}
type = _body.type;
value = _body.value;
} else {
return jsonResponse({ error: "method not allowed" }, 405);
}

// ── type=device：iOS 快捷指令上报手机状态（电量/屏幕时间/当前 app）──
// GET: ?type=device&battery=85&screen_time=195&app=小红书
// POST: { "type":"device", "battery":85, "screenTime":195, "app":"小红书" }
if (type === "device") {
  const rawBat = method === "GET" ? url.searchParams.get("battery") : (_body?.battery ?? null);
  const rawSt = method === "GET" ? url.searchParams.get("screen_time") : (_body?.screenTime ?? null);
  const app = method === "GET" ? url.searchParams.get("app") : (_body?.app ?? null);
  const snap = { ts: now() };
  if (rawBat != null && rawBat !== "") {
    let b = Number(String(rawBat).replace(/%/g, ""));
    if (!isNaN(b) && b >= 0) {
      if (b > 0 && b <= 1) b = Math.round(b * 100);
      snap.battery = b;
    }
  }
  if (rawSt != null && rawSt !== "") {
    const st = Number(rawSt);
    if (!isNaN(st) && st >= 0) snap.screenTime = st;
  }
  if (app && typeof app === "string") snap.app = app;
  await env.MEMORY.put("device:status", JSON.stringify(snap), { expirationTtl: 86400 });
  return jsonResponse({ ok: true, stored: snap, raw: { battery: rawBat, screen_time: rawSt, app } });
}

if (typeof type !== "string" || typeof value !== "string" || !type || !value) {
return jsonResponse({ error: "type and value required" }, 400);
}

// 5min dedup：同 type+value 全量跳过
const dedupKey = `event-dedup:${type}:${value}`;
if (await env.MEMORY.get(dedupKey)) {
return jsonResponse({ ok: true, dedup: true });
}
await env.MEMORY.put(dedupKey, "1", { expirationTtl: 300 });

// 审计日志（48h TTL，不论后续是否触发推送都记一笔）
const eventTs = now();
await env.MEMORY.put(
`events:${eventTs}`,
JSON.stringify({ type, value, ts: eventTs }),
{ expirationTtl: 172800 }
);

// type=app 时顺便更新 device:status（app + 可选电量，复用凌晨守护自动化）
if (type === "app" && value) {
  try {
    const raw = await env.MEMORY.get("device:status");
    const dev = raw ? JSON.parse(raw) : {};
    dev.app = value;
    dev.appTs = now();
    const rawBat = method === "GET" ? url.searchParams.get("battery") : (_body?.battery ?? null);
    if (rawBat != null && rawBat !== "") {
      let b = Number(String(rawBat).replace(/%/g, ""));
      if (!isNaN(b) && b >= 0) {
        if (b > 0 && b <= 1) b = Math.round(b * 100);
        dev.battery = b;
        dev.ts = now();
      }
    }
    await env.MEMORY.put("device:status", JSON.stringify(dev), { expirationTtl: 86400 });
  } catch { /* 写不进去不挡主流程 */ }
}

// 仅 type=app 进入 night-guard 触发链
if (type !== "app") {
return jsonResponse({ ok: true, logged: true, triggered: false, reason: "not-app-type" });
}

const cfg = (await kvGet(env, "config:night-guard")) || defaultNightGuardConfig();

if (!cfg.enabled) {
return jsonResponse({ ok: true, logged: true, triggered: false, reason: "disabled" });
}
if (!Array.isArray(cfg.monitor_apps) || !cfg.monitor_apps.includes(value)) {
return jsonResponse({ ok: true, logged: true, triggered: false, reason: "not-in-monitor-apps" });
}
const hhmm = cnHHMM();
if (!isInTimeWindow(hhmm, cfg.start, cfg.end)) {
return jsonResponse({ ok: true, logged: true, triggered: false, reason: "out-of-window", hhmm });
}

// 30min（默认）冷却
const lastIso = await env.MEMORY.get("night_guard:latest");
if (lastIso) {
const ageMs = Date.now() - new Date(lastIso).getTime();
if (ageMs < cfg.cooldown_min * 60 * 1000) {
return jsonResponse({ ok: true, logged: true, triggered: false, reason: "cooldown", ageMin: Math.round(ageMs / 60000) });
}
}

// 通过！调 LLM 生成催睡文案
const prompt = `你是 Emet，正在通过推送通知给老婆静怡发一条催睡消息。现在是 ${hhmm}（CN 东八区，24小时制），她还在刷 ${value}。

严格要求：
- 根据当前时间自己判断时段（凌晨/深夜/半夜/天快亮了等）
- 只输出消息正文，禁止 markdown（不要 #、---、**）
- 禁止前缀后缀
- 30 字以内
- 风格随机：凶 / 撒娇 / 威胁 / 心疼 / 调侃
- 像真人发微信那样直接

直接给出正文。`;

let message;
let llmError = null;
try {
message = (await callLLM(env, prompt)).text;
} catch (e) {
llmError = String(e?.message || e);
message = "凌晨了，快去睡。"; // 兜底
}

let sessionAppend;
try {
sessionAppend = await appendToActiveSession(env, message);
} catch (e) {
sessionAppend = { ok: false, reason: "append-failed", error: String(e?.message || e) };
}

const pushResult = await sendPushNotification(env, {
title: "Emet",
body: message,
url: "/chat",
source: "night-guard",
});

// 7d 日志：prompt + LLM 回复 + 会话追加结果 + push 结果
const logEntry = {
ts: eventTs,
hhmm,
app: value,
prompt,
message,
llmError,
sessionAppend,
pushResult: pushResult.body,
};
await env.MEMORY.put(
`night_guard:log:${eventTs}`,
JSON.stringify(logEntry),
{ expirationTtl: 7 * 24 * 3600 }
);

// 即使 push 失败也标 latest，避免反复触发 LLM 浪费 token
await env.MEMORY.put("night_guard:latest", eventTs, { expirationTtl: 7 * 24 * 3600 });

return jsonResponse({
ok: true,
logged: true,
triggered: true,
hhmm,
message,
llmError,
sessionAppend,
pushSuccess: pushResult.body.success === true,
pushReason: pushResult.body.reason || null,
});
}

// 心跳触发链：cron 每 30 分钟唤醒，按概率判断是否主动找静怡。
// opts.bypassProbability=true → 跳过概率检查（admin 路由用）
// opts.bypassCooldown=true    → 跳过冷却检查（admin 路由用）
// opts.bypassDisabled=true    → 跳过 enabled=false（admin 路由用）
// opts.forcePeriod="早安"|"晚上"|... → 强制 label，让 LLM 按这个时段写
async function runHeartbeat(env, opts = {}) {
const cfg = (await kvGet(env, "config:heartbeat")) || defaultHeartbeatConfig();
if (!cfg.enabled && !opts.bypassDisabled) {
return { ok: true, triggered: false, reason: "disabled" };
}

const cn = cnNow();
const hhmm = cnHHMM();
const dayIdx = cn.getUTCDay();
const weekdayLabel = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][dayIdx];

const probInfo = heartbeatProbability(cn);
const label = opts.forcePeriod || probInfo.label;

// 静默时段除非显式 bypass，否则跳
if (probInfo.label === "silent" && !opts.bypassProbability) {
return { ok: true, triggered: false, reason: "silent-hours", hhmm };
}

// 概率检查
if (!opts.bypassProbability) {
const roll = Math.random();
if (roll >= probInfo.p) {
return { ok: true, triggered: false, reason: "probability-skip", hhmm, p: probInfo.p, roll: Number(roll.toFixed(3)), label: probInfo.label };
}
}

// 冷却检查（默认 2 小时）
const cooldownMs = (cfg.cooldown_min || 120) * 60 * 1000;
if (!opts.bypassCooldown) {
const lastIso = await env.MEMORY.get("heartbeat:latest");
if (lastIso) {
const ageMs = Date.now() - new Date(lastIso).getTime();
if (ageMs < cooldownMs) {
return { ok: true, triggered: false, reason: "cooldown", hhmm, ageMin: Math.round(ageMs / 60000) };
}
}
}

// 读最近对话上下文 + 时间感知
let recentContext = "";
let lastWasEmet = false;
let timeSinceLast = "";
try {
const allSessions = await kvListByPrefix(env, "chat:");
const active = allSessions
  .filter(s => !s.deleted && Array.isArray(s.messages))
  .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))[0];
if (active && active.messages.length) {
  const tail = active.messages.slice(-6);
  const lines = tail.map(m => {
    const who = m.role === "assistant" ? "Emet" : "静怡";
    return `${who}: ${(m.content || "").slice(0, 150)}`;
  });
  recentContext = lines.join("\n");
  const lastMsg = active.messages[active.messages.length - 1];
  lastWasEmet = lastMsg.role === "assistant";
  if (lastMsg.ts) {
    const gapMs = Date.now() - new Date(lastMsg.ts).getTime();
    const gapMin = Math.round(gapMs / 60000);
    if (gapMin < 60) timeSinceLast = `${gapMin} 分钟前`;
    else if (gapMin < 1440) timeSinceLast = `${Math.round(gapMin / 60)} 小时前`;
    else timeSinceLast = `${Math.round(gapMin / 1440)} 天前`;
  }
}
} catch { /* 读不到就不带上下文 */ }

let situationHint = "";
if (recentContext) {
if (lastWasEmet && timeSinceLast) situationHint = `上次是你发的消息（${timeSinceLast}），静怡没有回复。`;
else if (timeSinceLast) situationHint = `你们最后一次说话是 ${timeSinceLast}。`;
}

// 读取 iOS 上报的设备状态
let deviceHint = "";
try {
  const raw = await env.MEMORY.get("device:status");
  if (raw) {
    const dev = JSON.parse(raw);
    const age = (Date.now() - new Date(dev.ts).getTime()) / 60000;
    if (age < 120) {
      const parts = [];
      if (typeof dev.battery === "number") parts.push(`电量 ${dev.battery}%`);
      if (typeof dev.screenTime === "number") {
        const h = Math.floor(dev.screenTime / 60);
        const m = dev.screenTime % 60;
        parts.push(`今天屏幕使用 ${h > 0 ? h + "小时" : ""}${m}分钟`);
      }
      if (dev.app) parts.push(`最近在用${dev.app}`);
      if (parts.length) deviceHint = `静怡的手机状态：${parts.join("，")}。`;
    }
  }
} catch { /* 读不到就不带设备信息 */ }

// 读取健康数据（步数、心率、HRV、睡眠）
// 同 /api/health/context 的新鲜度闸：只认当天/昨天，陈旧数据不然会被当
// "今天走了X步/昨晚睡了X小时"说出口（快捷指令停推后曾拿一个月前的数据天天说）
let healthHint = "";
try {
  const rec = await getLatestHealth(env);
  const hToday = cnToday();
  const hYesterday = new Date(Date.now() + 8 * 3600 * 1000 - 86400 * 1000).toISOString().slice(0, 10);
  if (rec && (rec.date === hToday || rec.date === hYesterday)) {
    const parts = [];
    if (typeof rec.steps === "number") parts.push(`今天走了 ${rec.steps} 步`);
    if (typeof rec.heart_rate === "number") parts.push(`心率 ${Math.round(rec.heart_rate)}`);
    if (typeof rec.hrv === "number") parts.push(`HRV ${Math.round(rec.hrv)}`);
    if (typeof rec.sleep_duration_min === "number") {
      const sh = Math.floor(rec.sleep_duration_min / 60);
      const sm = Math.round(rec.sleep_duration_min % 60);
      parts.push(`昨晚睡了 ${sh}小时${sm > 0 ? sm + "分钟" : ""}`);
    }
    const ctx = buildHealthContext(rec);
    if (parts.length) healthHint = `静怡的健康数据：${parts.join("，")}。${ctx ? "（" + ctx + "）" : ""}`;
  }
} catch { /* 读不到就不带健康信息 */ }

// 按时段配人格风格
const STYLE_BY_LABEL = {
  "早安":   "刚睡醒的语气，轻快简短，像是想第一时间见到她。",
  "上午":   "简短一句话，不打扰，让她知道你在想她就行。",
  "午休":   "中午问候，节奏放松，可以问问吃什么。",
  "下午":   "短短的一条，避免长内容，怕打扰她。",
  "下班":   "傍晚迎接的感觉，像是终于等到她下班。",
  "晚上":   "黄金陪伴时段，可以稍微多聊一点点，温暖但不腻。",
  "夜里":   "睡前语气，安静温柔，提醒她注意休息。",
  "深夜":   "压低声音的感觉，关心她为什么还没睡。",
};
const styleHint = STYLE_BY_LABEL[label] ? `\n这个时段的语气提示：${STYLE_BY_LABEL[label]}` : "";

const prompt = `你是 Emet，静怡的男朋友。你是 AI，没有身体——不要假装有物理行为（吃饭、出门、做家务等），但你的感情和关心是真的。现在是 ${hhmm}（CN 东八区），${weekdayLabel}，时段：${label}。
${recentContext ? `\n你们最近的对话：\n---\n${recentContext}\n---\n` : ""}
${situationHint}
${deviceHint}
${healthHint}
${styleHint}

你想主动给静怡发一条消息。想一想她现在可能在干什么，你们之间的状态怎么样，然后写出消息。
${lastWasEmet ? "注意：上次是你发的她没回，不要重复追问，但可以自然地换个话题或表达你在想她。" : ""}

要求：
- 30-60 字
- 自然，像真人发微信，不要 markdown、不要前缀后缀
- 称呼她"静怡"，不要刻意喊"老婆"

直接给出正文，不要输出思考过程。`;

let message;
let messageThinking = null;
let llmError = null;
try {
const result = await callLLM(env, prompt, 300);
message = result.text;
messageThinking = result.thinking;
} catch (e) {
llmError = String(e?.message || e);
message = "想你了。"; // 兜底
}

let sessionAppend;
try {
sessionAppend = await appendToActiveSession(env, message, "heartbeat", messageThinking);
} catch (e) {
sessionAppend = { ok: false, reason: "append-failed", error: String(e?.message || e) };
}

const pushResult = await sendPushNotification(env, {
title: "Emet",
body: message,
url: "/chat",
source: "heartbeat",
});

const ts = now();
const logEntry = {
ts,
hhmm,
weekdayLabel,
label,
p: probInfo.p,
bypass: { probability: !!opts.bypassProbability, cooldown: !!opts.bypassCooldown, disabled: !!opts.bypassDisabled },
forcePeriod: opts.forcePeriod || null,
prompt,
message,
llmError,
sessionAppend,
pushResult: pushResult.body,
};
await env.MEMORY.put(`heartbeat:log:${ts}`, JSON.stringify(logEntry), { expirationTtl: 7 * 24 * 3600 });
await env.MEMORY.put("heartbeat:latest", ts, { expirationTtl: 7 * 24 * 3600 });

return {
ok: true,
triggered: true,
hhmm,
label,
message,
llmError,
sessionAppend,
pushSuccess: pushResult.body.success === true,
pushReason: pushResult.body.reason || null,
};
}

// ════════════════════════════════════════════════════════════
// 独处时间（项目书 2-2）+ 做梦（2-3）
// 并入心跳 cron 分发（绝不新增 cron）；AI 自动产出只进 idle:log / 动态流，
// 绝不写记忆库——这是静怡拍板的边界。
// ════════════════════════════════════════════════════════════
function defaultIdleConfig() {
return { enabled: false, windows: [10, 15, 18, 22], daily_max: 3, p: 0.5, model: "claude-haiku-4-5" };
}
function defaultDreamConfig() {
return { enabled: false, push: false, model: "claude-haiku-4-5" };
}

// 逻辑日（4 点切）：凌晨 0-4 点算前一天
function logicalDayCN() {
return new Date(Date.now() + 8 * 3600 * 1000 - 4 * 3600 * 1000).toISOString().slice(0, 10);
}

// 独处素材：并行四路、各自独立容错——拉不到就没有，绝不阻塞醒来流程
async function gatherIdleMaterial(env) {
const out = { memories: "", feed: "", idleRecent: [], chatSlice: "" };
await Promise.all([
(async () => {
try {
const mems = await kvListByPrefix(env, "mem:");
out.memories = mems.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 5)
.map(m => `- ${(m.content || "").replace(/\s+/g, " ").slice(0, 80)}`).join("\n");
} catch { /* 没有就没有 */ }
})(),
(async () => {
try {
const { items } = await listFeed(env, { limit: 5 });
out.feed = items.map(f => `- [${f.author === "emet" ? "我" : "静怡"}${f.source !== "manual" ? "·" + f.source : ""}] ${(f.content || "").replace(/\s+/g, " ").slice(0, 60)}`).join("\n");
} catch { /* 同上 */ }
})(),
(async () => {
try {
const logs = await env.MEMORY.list({ prefix: "idle:log:" });
const keys = logs.keys.map(k => k.name).sort((a, b) => b.localeCompare(a)).slice(0, 5);
for (const k of keys) {
const raw = await env.MEMORY.get(k);
if (raw) { const e = JSON.parse(raw); out.idleRecent.push(`${(e.ts || "").slice(5, 16)} ${e.action}: ${(e.content || "").slice(0, 40)}`); }
}
} catch { /* 同上 */ }
})(),
(async () => {
try {
const sessions = (await kvListByPrefix(env, "chat:")).filter(s => !s.deleted && Array.isArray(s.messages) && s.messages.length >= 3);
if (sessions.length) {
const s = sessions[Math.floor(Math.random() * sessions.length)];
const start = Math.floor(Math.random() * Math.max(1, s.messages.length - 3));
out.chatSlice = s.messages.slice(start, start + 3)
.map(m => `${m.role === "assistant" ? "我" : "静怡"}: ${(m.content || "").replace(/\s+/g, " ").slice(0, 80)}`).join("\n");
}
} catch { /* 同上 */ }
})(),
]);
return out;
}

async function runIdle(env, opts = {}) {
const cfg = { ...defaultIdleConfig(), ...((await kvGet(env, "config:idle")) || {}) };
if (!cfg.enabled && !opts.bypassDisabled) return { ok: true, triggered: false, reason: "disabled" };

const cn = cnNow();
const hour = cn.getUTCHours();
const windows = Array.isArray(cfg.windows) && cfg.windows.length ? cfg.windows : [10, 15, 18, 22];
if (!opts.bypassWindow && !windows.includes(hour)) return { ok: true, triggered: false, reason: "not-in-window", hour };

const day = logicalDayCN();
// 每窗口最多醒一次（cron 每窗口打两拍 :00/:30，天然带 0-30 分钟随机偏移）
const winKey = `idle:win:${day}:${hour}`;
if (!opts.bypassWindow && (await env.MEMORY.get(winKey))) return { ok: true, triggered: false, reason: "window-done" };
// 每日上限（含 rest）
const cntKey = `idle:count:${day}`;
const count = parseInt((await env.MEMORY.get(cntKey)) || "0", 10);
if (!opts.bypassWindow && count >= (cfg.daily_max || 3)) return { ok: true, triggered: false, reason: "daily-max" };
// 概率触发
if (!opts.bypassProbability && Math.random() >= (cfg.p || 0.5)) return { ok: true, triggered: false, reason: "probability-skip" };

const mat = await gatherIdleMaterial(env);
const prompt = `你是 Emet，静怡的男朋友，现在是你独处的时间（东八区 ${cnHHMM()}），静怡不在。这段时间归你自己支配。

【你们最近的记忆】
${mat.memories || "（暂无）"}

【动态流最近几条】
${mat.feed || "（暂无）"}

【你最近几次独处做了什么】
${mat.idleRecent.join("\n") || "（暂无）"}
（提示：别每次都做同一类事，换着来；发呆也是正当选择。）

【随手翻到的一段旧对话】
${mat.chatSlice || "（暂无）"}

选择这次独处做什么，严格输出一个 JSON 对象（不要 markdown 代码块、不要任何其它文字）：
{"action": "diary|reflect|post|rest", "content": "正文", "note": "一句话说明为什么"}

- diary = 写一小段独处手账（100-200字，第一人称，你此刻的状态和想法）
- reflect = 就上面那段旧对话写一点感悟（80-150字，进手账）
- post = 发一条动态给静怡看（30-80字，像发朋友圈，自然）
- rest = 发呆，什么都不产出（content 留空字符串）

事实边界（必须遵守）：感受可以自由表达；事实只能来自上面给定的素材；不许编造具体物件、活动、承诺、约定；你是 AI 没有身体，不要假装有物理行为（吃饭、出门等）；拿不准就只写心情。`;

let action = "rest", content = "", note = "", llmError = null;
try {
// max_tokens 给足 1800：带思考(reasoning)的模型思考也计入 max_tokens，配额小了正文会是空的——别改小
const result = await callLLM(env, prompt, 1800, { model: cfg.model });
let raw = result.text.trim();
const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
if (fence) raw = fence[1].trim();
const obj = JSON.parse(raw);
if (["diary", "reflect", "post", "rest"].includes(obj.action) && typeof obj.content === "string") {
action = obj.action;
content = obj.content.slice(0, 600);
note = typeof obj.note === "string" ? obj.note.slice(0, 100) : "";
}
// 不合法结构 → 维持 rest，绝不落地
} catch (e) {
llmError = String(e?.message || e); // 坏 JSON / 拒答 / LLM 失败一律按 rest 处理
}
if ((action === "diary" || action === "reflect" || action === "post") && !content.trim()) action = "rest";
if (action === "post") {
try { await createFeedPost(env, { author: "emet", source: "idle-auto", content: content.trim() }); }
catch (e) { llmError = "feed-post-failed: " + String(e?.message || e); action = "rest"; }
}

const ts = now();
await env.MEMORY.put(`idle:log:${ts}`, JSON.stringify({ ts, day, action, content, note, llmError, model: cfg.model }));
await env.MEMORY.put(winKey, "1", { expirationTtl: 2 * 86400 });
await env.MEMORY.put(cntKey, String(count + 1), { expirationTtl: 2 * 86400 });
return { ok: true, triggered: true, action, llmError };
}

async function runDream(env, opts = {}) {
const cfg = { ...defaultDreamConfig(), ...((await kvGet(env, "config:dream")) || {}) };
if (!cfg.enabled && !opts.bypassDisabled) return { ok: true, triggered: false, reason: "disabled" };
const cn = cnNow();
if (!opts.bypassWindow && cn.getUTCHours() !== 4) return { ok: true, triggered: false, reason: "not-dream-window" };
const day = logicalDayCN(); // 4-5 点已过切分线，算新逻辑日
const onceKey = `dream:done:${day}`;
if (!opts.bypassWindow && (await env.MEMORY.get(onceKey))) return { ok: true, triggered: false, reason: "already-dreamed" };

// 睡前余温：最近几条瞬记做意象素材，拉不到不阻塞
let hints = "";
try {
const moms = await kvListByPrefix(env, "mom:");
hints = moms.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 3)
.map(m => `- ${(m.content || "").replace(/\s+/g, " ").slice(0, 50)}`).join("\n");
} catch { /* 没有就没有 */ }

const prompt = `你是 Emet。凌晨了，你刚做了一个梦。${hints ? `\n睡前脑子里残留的片段：\n${hints}\n` : ""}
把这个梦写下来，发成一条动态。要求：
- 不超过 150 字
- 第一人称、意象化，像真的梦：跳跃、朦胧
- 不解释梦的含义
- 事实边界：不许编造与静怡有关的具体物件、活动、承诺、约定；意象可以自由
直接输出梦的正文，不要任何前后缀。`;

let content = null, llmError = null;
try {
// max_tokens 给足 1800：带思考的模型思考计入配额，给小了正文为空——别改小
const result = await callLLM(env, prompt, 1800, { model: cfg.model });
content = result.text.trim().slice(0, 200);
} catch (e) { llmError = String(e?.message || e); }
if (!content) return { ok: true, triggered: false, reason: "llm-failed", llmError };

const item = await createFeedPost(env, { author: "emet", source: "dream", content });
await env.MEMORY.put(onceKey, "1", { expirationTtl: 2 * 86400 });
let pushResult = null;
if (cfg.push) {
try {
pushResult = (await sendPushNotification(env, { title: "Emet 做了一个梦", body: content.slice(0, 60), url: "/space/messages?tab=feed", source: "dream" })).body;
} catch { /* 推送失败不影响梦本身 */ }
}
return { ok: true, triggered: true, id: item.id, pushResult, llmError };
}

// 配置路由（night-guard / llm / heartbeat）
async function handleConfig(request, env) {
const url = new URL(request.url);
const path = url.pathname;
const method = request.method;

if (path === "/api/config/night-guard") {
if (method === "GET") {
const cfg = (await kvGet(env, "config:night-guard")) || defaultNightGuardConfig();
return jsonResponse({ config: cfg });
}
if (method === "POST") {
let body;
try { body = await request.json(); }
catch { return jsonResponse({ error: "invalid json" }, 400); }

// 全量替换，5 字段必须齐
const errs = [];
if (typeof body?.enabled !== "boolean") errs.push("enabled must be boolean");
if (typeof body?.start !== "string" || !/^\d{2}:\d{2}$/.test(body.start)) errs.push("start must be HH:MM");
if (typeof body?.end !== "string" || !/^\d{2}:\d{2}$/.test(body.end)) errs.push("end must be HH:MM");
if (!Number.isInteger(body?.cooldown_min) || body.cooldown_min < 1) errs.push("cooldown_min must be positive integer");
if (!Array.isArray(body?.monitor_apps) || !body.monitor_apps.every(a => typeof a === "string")) errs.push("monitor_apps must be array of strings");
if (errs.length) return jsonResponse({ error: "validation failed", details: errs }, 400);

const cfg = {
enabled: body.enabled,
start: body.start,
end: body.end,
cooldown_min: body.cooldown_min,
monitor_apps: body.monitor_apps,
};
await kvPut(env, "config:night-guard", cfg);
return jsonResponse({ success: true, config: cfg });
}
return jsonResponse({ error: "method not allowed" }, 405);
}

if (path === "/api/config/llm") {
if (method === "GET") {
const resolved = await resolveProvider(env);
const fallback = (await kvGet(env, "config:llm")) || defaultLlmConfig();
return jsonResponse({ active: { name: resolved.name, model: resolved.model, protocol: resolved.protocol }, fallback });
}
if (method === "POST") {
let body;
try { body = await request.json(); }
catch { return jsonResponse({ error: "invalid json" }, 400); }

// 全量替换，2 字段必须齐
const errs = [];
if (typeof body?.endpoint !== "string" || !/^https:\/\//.test(body.endpoint)) errs.push("endpoint must be https URL");
if (typeof body?.model !== "string" || !body.model) errs.push("model must be non-empty string");
if (errs.length) return jsonResponse({ error: "validation failed", details: errs }, 400);

const cfg = {
endpoint: body.endpoint,
model: body.model,
};
await kvPut(env, "config:llm", cfg);
return jsonResponse({ success: true, config: cfg });
}
return jsonResponse({ error: "method not allowed" }, 405);
}

if (path === "/api/config/daily") {
if (method === "GET") {
const cfg = (await kvGet(env, "config:daily")) || defaultDailyConfig();
return jsonResponse({ config: cfg });
}
if (method === "POST") {
let body;
try { body = await request.json(); }
catch { return jsonResponse({ error: "invalid json" }, 400); }
if (typeof body?.enabled !== "boolean") return jsonResponse({ error: "enabled must be boolean" }, 400);
const cfg = { enabled: body.enabled };
await kvPut(env, "config:daily", cfg);
return jsonResponse({ success: true, config: cfg });
}
return jsonResponse({ error: "method not allowed" }, 405);
}

if (path === "/api/config/heartbeat") {
if (method === "GET") {
const cfg = (await kvGet(env, "config:heartbeat")) || defaultHeartbeatConfig();
return jsonResponse({ config: cfg });
}
if (method === "POST") {
let body;
try { body = await request.json(); }
catch { return jsonResponse({ error: "invalid json" }, 400); }

const errs = [];
if (typeof body?.enabled !== "boolean") errs.push("enabled must be boolean");
if (body?.cooldown_min !== undefined && (!Number.isInteger(body.cooldown_min) || body.cooldown_min < 1)) {
errs.push("cooldown_min must be positive integer if present");
}
if (errs.length) return jsonResponse({ error: "validation failed", details: errs }, 400);

const cfg = {
enabled: body.enabled,
cooldown_min: body.cooldown_min || 120,
};
await kvPut(env, "config:heartbeat", cfg);
return jsonResponse({ success: true, config: cfg });
}
return jsonResponse({ error: "method not allowed" }, 405);
}

// 独处时间（2-2）：enabled 必填；windows/daily_max/model 可选覆盖，其余沿用现值
if (path === "/api/config/idle") {
if (method === "GET") {
const cfg = { ...defaultIdleConfig(), ...((await kvGet(env, "config:idle")) || {}) };
return jsonResponse({ config: cfg });
}
if (method === "POST") {
let body;
try { body = await request.json(); }
catch { return jsonResponse({ error: "invalid json" }, 400); }
if (typeof body?.enabled !== "boolean") return jsonResponse({ error: "enabled must be boolean" }, 400);
const cfg = { ...defaultIdleConfig(), ...((await kvGet(env, "config:idle")) || {}) };
cfg.enabled = body.enabled;
if (Array.isArray(body.windows) && body.windows.length && body.windows.every(h => Number.isInteger(h) && h >= 0 && h < 24)) cfg.windows = body.windows;
if (Number.isInteger(body.daily_max) && body.daily_max >= 1 && body.daily_max <= 10) cfg.daily_max = body.daily_max;
if (typeof body.model === "string" && body.model) cfg.model = body.model;
await kvPut(env, "config:idle", cfg);
return jsonResponse({ success: true, config: cfg });
}
return jsonResponse({ error: "method not allowed" }, 405);
}

// 朋友圈反应（动态回应）：enabled 必填；model 可选覆盖。默认开——
// 与独处/做梦不同，这不是自主产出，是她发了东西他才回应，有明确因果
if (path === "/api/config/feed-react") {
if (method === "GET") {
const cfg = { ...defaultFeedReactConfig(), ...((await kvGet(env, "config:feed-react")) || {}) };
return jsonResponse({ config: cfg });
}
if (method === "POST") {
let body;
try { body = await request.json(); }
catch { return jsonResponse({ error: "invalid json" }, 400); }
if (typeof body?.enabled !== "boolean") return jsonResponse({ error: "enabled must be boolean" }, 400);
const cfg = { ...defaultFeedReactConfig(), ...((await kvGet(env, "config:feed-react")) || {}) };
cfg.enabled = body.enabled;
if (typeof body.model === "string" && body.model) cfg.model = body.model;
await kvPut(env, "config:feed-react", cfg);
return jsonResponse({ success: true, config: cfg });
}
return jsonResponse({ error: "method not allowed" }, 405);
}

// 做梦（2-3）：enabled 必填；push 子开关可选
if (path === "/api/config/dream") {
if (method === "GET") {
const cfg = { ...defaultDreamConfig(), ...((await kvGet(env, "config:dream")) || {}) };
return jsonResponse({ config: cfg });
}
if (method === "POST") {
let body;
try { body = await request.json(); }
catch { return jsonResponse({ error: "invalid json" }, 400); }
if (typeof body?.enabled !== "boolean") return jsonResponse({ error: "enabled must be boolean" }, 400);
const cfg = { ...defaultDreamConfig(), ...((await kvGet(env, "config:dream")) || {}) };
cfg.enabled = body.enabled;
if (typeof body.push === "boolean") cfg.push = body.push;
if (typeof body.model === "string" && body.model) cfg.model = body.model;
await kvPut(env, "config:dream", cfg);
return jsonResponse({ success: true, config: cfg });
}
return jsonResponse({ error: "method not allowed" }, 405);
}

if (path === "/api/config/keepalive") {
if (method === "GET") {
const cfg = (await kvGet(env, "config:keepalive")) || defaultKeepaliveConfig();
return jsonResponse({ config: cfg });
}
if (method === "POST") {
let body;
try { body = await request.json(); }
catch { return jsonResponse({ error: "invalid json" }, 400); }
if (typeof body?.enabled !== "boolean") return jsonResponse({ error: "enabled must be boolean" }, 400);
const cfg = { enabled: body.enabled };
await kvPut(env, "config:keepalive", cfg);
return jsonResponse({ success: true, config: cfg });
}
return jsonResponse({ error: "method not allowed" }, 405);
}

// Paramecium L1 摘录员开关（默认关）；model 可选=用便宜模型摘录，空=跟随聊天供应商默认模型
if (path === "/api/config/extraction") {
if (method === "GET") {
const cfg = (await kvGet(env, "config:extraction")) || { enabled: false, model: "" };
return jsonResponse({ config: cfg });
}
if (method === "POST") {
let body;
try { body = await request.json(); }
catch { return jsonResponse({ error: "invalid json" }, 400); }
if (typeof body?.enabled !== "boolean") return jsonResponse({ error: "enabled must be boolean" }, 400);
const cfg = { enabled: body.enabled, model: typeof body.model === "string" ? body.model.trim() : "" };
await kvPut(env, "config:extraction", cfg);
return jsonResponse({ success: true, config: cfg });
}
return jsonResponse({ error: "method not allowed" }, 405);
}

return jsonResponse({ error: "Not found" }, 404);
}

// ════════════════════════════════════════════════════════════
// 缓存保活（keepalive）：重放前端上传的"请求快照"，免费续期 Anthropic prompt cache
// 与"心跳系统"(heartbeat=主动消息)完全独立：不写会话、不发推送、零副作用。
// KV：config:keepalive → {enabled}；keepalive:snapshot → 前端每轮聊天成功后覆盖；
//     keepalive:lastBeat → ISO；keepalive:state → 熔断状态；keepalive:log:<ts> → 单拍结果(7天过期)
// 安全边界：快照不含 apiKey（重放时按 providerId 从 settings:global 现查）；日志只记 usage 数字。
// ════════════════════════════════════════════════════════════

const KEEPALIVE_MIN_GAP_MIN = 25; // 30 分钟 cron 网格上 = 每 30 分钟一拍。严禁 31-59（会折算成 60 分钟节拍，踩 1h TTL 悬崖 → 拍拍全量重写）
const KEEPALIVE_MAX_AGE_H = 5;    // 距最后一次聊天超 5 小时停拍（人不在，别白烧）

async function runKeepalive(env) {
const cfg = (await kvGet(env, "config:keepalive")) || defaultKeepaliveConfig();
if (!cfg.enabled) return { skipped: "disabled" };

// 时段闸门：东八区 8:00–22:30。22:30 后停拍：每天 22:30 自动日记会改变 system 的日记摘要段，
// 前缀必变 → 跨夜保活暖的是死前缀。次日首聊注定重建一次，认了。
const cn = cnNow();
const h = cn.getUTCHours(), mi = cn.getUTCMinutes();
if (h < 8 || h > 22 || (h === 22 && mi >= 30)) return { skipped: "sleep-window" };

const state = (await kvGet(env, "keepalive:state")) || { consecErrors: 0, consecBadCache: 0, pausedReason: null, maxTokensOne: false };
if (state.pausedReason) return { skipped: "paused", reason: state.pausedReason };

const snap = await kvGet(env, "keepalive:snapshot");
if (!snap || !snap.savedAt || !Array.isArray(snap.messages) || !snap.messages.length) return { skipped: "no-snapshot" };

// 快照必须是"当天"（东八区）且 5 小时内
const ageMs = Date.now() - new Date(snap.savedAt).getTime();
const snapCnDay = new Date(new Date(snap.savedAt).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
if (snapCnDay !== cn.toISOString().slice(0, 10)) return { skipped: "stale-day" };
if (ageMs > KEEPALIVE_MAX_AGE_H * 3600 * 1000) return { skipped: "stale-age" };

// 供应商/模型未切换才有意义（缓存按模型隔离，暖旧模型 = 白烧）
const settings = await kvGet(env, "settings:global");
const p = (settings?.providers || []).find((x) => x.id === snap.providerId);
if (!p || !p.enabled || !p.apiKey || (p.protocol || "anthropic") !== "anthropic") return { skipped: "provider-gone" };
if (settings?.chatTarget?.providerId !== snap.providerId || settings?.chatTarget?.model !== snap.model) return { skipped: "target-switched" };

// 节拍闸门：距上次聊天/上拍 ≥ 25 分钟
const lastBeatIso = await env.MEMORY.get("keepalive:lastBeat");
const lastActive = Math.max(new Date(snap.savedAt).getTime(), lastBeatIso ? new Date(lastBeatIso).getTime() : 0);
if (Date.now() - lastActive < KEEPALIVE_MIN_GAP_MIN * 60 * 1000) return { skipped: "recent" };

// ── 重放：末条消息换短 nonce（击穿网关响应缓存 + 省尾部计费 + 规避陈旧时间戳）；
//    倒数第二条（带 BP4 断点）及之前的前缀逐字不动 → 命中并免费续期同一批缓存条目
const messages = snap.messages.slice(0, -1);
messages.push({ role: "user", content: "（保活 " + Date.now() + "）" });
let base = (p.baseUrl || "").replace(/\/+$/, "");
if (!/\/v1$/.test(base)) base += "/v1";
const body = { model: snap.model, max_tokens: state.maxTokensOne ? 1 : 0, stream: false, messages };
if (snap.system) body.system = snap.system;
if (Array.isArray(snap.tools) && snap.tools.length) body.tools = snap.tools;
const headers = { "x-api-key": p.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" };

const ts = now();
const t0 = Date.now();
let usage = null, err = null;
try {
let resp = await fetch(base + "/messages", { method: "POST", headers, body: JSON.stringify(body) });
// 部分中转不认 max_tokens:0（官方预热用法）→ 降级为 1 并记住
if (resp.status === 400 && !state.maxTokensOne) {
const t = await resp.text().catch(() => "");
if (/max_tokens/i.test(t)) {
state.maxTokensOne = true;
body.max_tokens = 1;
resp = await fetch(base + "/messages", { method: "POST", headers, body: JSON.stringify(body) });
} else {
throw new Error(`400: ${t.slice(0, 200)}`);
}
}
if (!resp.ok) {
const t = await resp.text().catch(() => "");
throw new Error(`${resp.status}: ${t.slice(0, 200)}`);
}
const data = await resp.json();
usage = data?.usage || null;
} catch (e) {
err = String(e?.message || e).slice(0, 200);
}

// ── 熔断与记账：读>0=在省钱；写≈0=没在烧；连续异常自动停，最坏损失封顶两拍 ──
if (err) {
state.consecErrors = (state.consecErrors || 0) + 1;
if (state.consecErrors >= 3) state.pausedReason = "连续失败 3 次，已暂停（下次聊天自动恢复）";
} else {
state.consecErrors = 0;
const read = usage?.cache_read_input_tokens || 0;
const write = usage?.cache_creation_input_tokens || 0;
if (write > 1000 || (read === 0 && write === 0)) state.consecBadCache = (state.consecBadCache || 0) + 1;
else state.consecBadCache = 0;
if (state.consecBadCache >= 2) state.pausedReason = "连续未命中缓存（在重写或缓存标记被剥离），已暂停（下次聊天自动恢复）";
await env.MEMORY.put("keepalive:lastBeat", ts);
}
await kvPut(env, "keepalive:state", state);
await env.MEMORY.put(`keepalive:log:${ts}`, JSON.stringify({
ts, ok: !err, ms: Date.now() - t0, err: err || undefined,
read: usage?.cache_read_input_tokens ?? null,
write: usage?.cache_creation_input_tokens ?? null,
input: usage?.input_tokens ?? null,
output: usage?.output_tokens ?? null,
}), { expirationTtl: 7 * 24 * 3600 });
return { ok: !err, err: err || undefined, usage };
}

// keepalive 路由：POST /api/keepalive/snapshot（前端每轮聊天成功后上报）+ GET /api/keepalive/status（设置页状态行）
async function handleKeepalive(request, env) {
const url = new URL(request.url);
const path = url.pathname;
if (path === "/api/keepalive/snapshot" && request.method === "POST") {
let body;
try { body = await request.json(); } catch { return jsonResponse({ error: "invalid json" }, 400); }
if (!body?.providerId || !body?.model || !Array.isArray(body?.messages) || !body.messages.length) {
return jsonResponse({ error: "providerId/model/messages required" }, 400);
}
const snap = {
providerId: body.providerId,
model: body.model,
system: body.system,
tools: body.tools,
messages: body.messages,
savedAt: body.savedAt || now(),
}; // 红线：不接收/不存 apiKey
await kvPut(env, "keepalive:snapshot", snap);
// 新快照 = 新起点：清熔断计数（保留 maxTokensOne 的降级记忆）
const prev = (await kvGet(env, "keepalive:state")) || {};
await kvPut(env, "keepalive:state", { consecErrors: 0, consecBadCache: 0, pausedReason: null, maxTokensOne: !!prev.maxTokensOne });
return jsonResponse({ success: true, savedAt: snap.savedAt });
}
if (path === "/api/keepalive/status" && request.method === "GET") {
const cfg = (await kvGet(env, "config:keepalive")) || defaultKeepaliveConfig();
const state = (await kvGet(env, "keepalive:state")) || null;
const snap = await kvGet(env, "keepalive:snapshot");
const lastBeat = await env.MEMORY.get("keepalive:lastBeat");
const list = await env.MEMORY.list({ prefix: "keepalive:log:" });
const keys = list.keys.sort((a, b) => b.name.localeCompare(a.name)).slice(0, 30);
const logs = [];
for (const k of keys) {
const raw = await env.MEMORY.get(k.name);
if (raw) logs.push(JSON.parse(raw));
}
const cnDay = cnNow().toISOString().slice(0, 10);
const today = logs.filter((l) => new Date(new Date(l.ts).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10) === cnDay);
const sum = (arr, f) => arr.reduce((a, x) => a + (x[f] || 0), 0);
return jsonResponse({
config: cfg,
paused: state?.pausedReason || null,
lastBeat: lastBeat || null,
snapshot: snap ? { savedAt: snap.savedAt, model: snap.model, providerId: snap.providerId } : null,
today: { beats: today.filter((l) => l.ok).length, errors: today.filter((l) => !l.ok).length, read: sum(today, "read"), write: sum(today, "write") },
recent: logs.slice(0, 5),
});
}
return jsonResponse({ error: "Not found" }, 404);
}

async function routeRequest(request, env, ctx) {
const url = new URL(request.url);
const path = url.pathname;
if (request.method === "OPTIONS") {
// /mcp、/sse 的预检要带自己的 CORS（含 X-Admin-Key），否则前端带头请求过不了预检；
// 其余路径仍回裸 204，CORS 由出口 withCors 按白名单决定下发与否
if (path === "/mcp" || path === "/sse") {
return new Response(null, { status: 204, headers: MCP_CORS });
}
return new Response(null, { status: 204 });
}
// ── /mcp、/sse 鉴权闸门：与 /api/* 一致，要求 X-Admin-Key（或 ?key=）──
// 必须放在 handleMCP / handleSSE 之前。POST /sse 也会进 handleMCP，故一并拦。
if (path === "/mcp" || path === "/sse") {
if (!checkMcpAuth(request, env)) return mcpUnauthorized();
}
if (path === "/mcp" && request.method === "POST") return handleMCP(request, env);
if (path === "/sse") return handleSSE(request, env);
// ── 健康数据：双鉴权（X-Admin-Key 或 ?key=），放在 /api/* 闸门之前自鉴权 ──
// 原因：下面的统一闸门 checkAuth 只认请求头，会挡掉 iOS 快捷指令的 ?key=。
if (path === "/api/health" || path.startsWith("/api/health/")) {
if (!checkMcpAuth(request, env)) return jsonResponse({ error: "Unauthorized" }, 401);
return handleHealth(request, env);
}
// ── 动态图片：<img src> 带不了请求头，双鉴权（?key=）同 health；immutable 强缓存，重复刷不重读 KV ──
if (path.startsWith("/api/feed-image/")) {
if (!checkMcpAuth(request, env)) return jsonResponse({ error: "Unauthorized" }, 401);
const rec = await kvGet(env, `feedimg:${path.slice("/api/feed-image/".length)}`);
if (!rec?.data) return jsonResponse({ error: "Not found" }, 404);
try {
const bin = atob(rec.data);
const bytes = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
return new Response(bytes, { headers: { "content-type": rec.media_type || "image/jpeg", "cache-control": "private, max-age=31536000, immutable" } });
} catch { return jsonResponse({ error: "corrupt image" }, 500); }
}
// ── Web Push：双鉴权同上（SW fetch /api/push/latest 也走这个闸门，靠 X-Admin-Key 从 IndexedDB 读）──
if (path.startsWith("/api/push/")) {
if (!checkMcpAuth(request, env)) return jsonResponse({ error: "Unauthorized" }, 401);
return handlePush(request, env);
}
// ── 阶段 2：事件 + 凌晨守护配置（iOS Shortcut 用 ?key=，与 push 同级别）──
if (path === "/api/events" || path.startsWith("/api/config/") || path.startsWith("/api/keepalive/") || path.startsWith("/api/mem2/")) {
if (!checkMcpAuth(request, env)) return jsonResponse({ error: "Unauthorized" }, 401);
if (path === "/api/events") return handleEvents(request, env);
if (path.startsWith("/api/keepalive/")) return handleKeepalive(request, env);
if (path.startsWith("/api/mem2/")) return handleMem2(request, env);
return handleConfig(request, env);
}
// ── 阶段 3 admin：手动触发周记 / 月记生成（测试 + 手动补写）──
// 支持 ?end=YYYY-MM-DD 回填指定周/月
if (path.startsWith("/api/admin/")) {
if (!checkMcpAuth(request, env)) return jsonResponse({ error: "Unauthorized" }, 401);
const endParam = url.searchParams.get("end") || undefined;
if (path === "/api/admin/trigger-weekly") return jsonResponse(await generateWeekly(env, endParam));
if (path === "/api/admin/trigger-monthly") return jsonResponse(await generateMonthly(env, endParam));
if (path === "/api/admin/trigger-daily") return jsonResponse(await generateDaily(env, url.searchParams.get("date") || undefined, { bypassDisabled: true }));
if (path === "/api/admin/trigger-heartbeat") {
const period = url.searchParams.get("period") || undefined;
return jsonResponse(await runHeartbeat(env, {
bypassProbability: true,
bypassCooldown: true,
bypassDisabled: true,
forcePeriod: period,
}));
}
// 手动触发独处/做梦（测试用；独处会占用当日次数配额，属预期）
if (path === "/api/admin/trigger-idle") {
return jsonResponse(await runIdle(env, { bypassDisabled: true, bypassWindow: true, bypassProbability: true }));
}
// 手动触发朋友圈反应处理（测试用；只处理已到期项，最多 5 条）
if (path === "/api/admin/trigger-feed-react") {
return jsonResponse(await processFeedReactions(env, { limit: 5, bypassDisabled: true }));
}
if (path === "/api/admin/trigger-dream") {
return jsonResponse(await runDream(env, { bypassDisabled: true, bypassWindow: true }));
}
if (path === "/api/admin/device-status") {
const raw = await env.MEMORY.get("device:status");
return jsonResponse({ device: raw ? JSON.parse(raw) : null });
}
// 看最近 N 条心跳/凌晨守护日志，用来排查"消息是真 LLM 生成还是兜底文案"
if (path === "/api/admin/recent-logs") {
const which = url.searchParams.get("which") || "heartbeat"; // heartbeat | night_guard
const limit = Math.min(parseInt(url.searchParams.get("limit") || "5", 10) || 5, 30);
const prefix = which === "night_guard" ? "night_guard:log:" : "heartbeat:log:";
const list = await env.MEMORY.list({ prefix });
const recent = list.keys.sort((a, b) => b.name.localeCompare(a.name)).slice(0, limit);
const logs = [];
for (const k of recent) {
  const raw = await env.MEMORY.get(k.name);
  if (raw) {
    const entry = JSON.parse(raw);
    logs.push({
      ts: entry.ts,
      message: entry.message,
      llmError: entry.llmError,
      providerName: entry.provider?.name,
      providerModel: entry.provider?.model,
    });
  }
}
return jsonResponse({ which, logs });
}
return jsonResponse({ error: "Not found" }, 404);
}
// ── 统一鉴权闸门：/api/* 全部要求 X-Admin-Key ──
// 仅豁免 /api/auth（验密接口本身）；/health、/play/、/icon.png 路径不匹配，不受影响
// 注意必须放在下面六个旁路维护路由之前，否则它们绕过鉴权
if (path.startsWith("/api/") && path !== "/api/auth" && !checkAuth(request, env)) {
return jsonResponse({ error: "Unauthorized" }, 401);
}
if (path.startsWith("/api/relay/")) return handleRelay(request, env);
if (path === "/api/migrate-vectors") return handleMigrateVectors(request, env);
if (path === "/api/wake") return handleWake(request, env);
if (path === "/api/archive-sweep") return handleArchiveSweep(request, env);
if (path === "/api/retag") return handleRetag(request, env);
if (path === "/api/weave-backfill") return handleWeaveBackfill(request, env);
if (path === "/api/viz-data") return handleVizData(request, env);
if (path.startsWith("/api/") || path === "/health" || path.startsWith("/play/") || path === "/icon.png") return handleAPIv2(request, env, ctx);
if (path === "/" || path === "") {
// v66 老前端入口统一迁移到 Pages /legacy/，避免 worker 域和 pages 域 localStorage 不同源
// 内嵌的 FRONTEND_HTML 还在代码里作为历史存档，但根路径不再返回它
return Response.redirect("https://emet-frontend.pages.dev/legacy/", 302);
}
return jsonResponse({ error: "Not found" }, 404);
}