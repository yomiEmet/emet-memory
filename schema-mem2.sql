-- Paramecium 移植：D1 库 emet-mem 表结构（id 94e20980-9004-4c06-ae49-d298de57c96d）
-- 执行：wrangler d1 execute emet-mem --remote --file schema-mem2.sql

-- L0 原文窗口（正文以 D1 为准，Vectorize 只存向量+轻 metadata）
CREATE TABLE IF NOT EXISTS archive_windows (
  id TEXT PRIMARY KEY,
  conv_id TEXT NOT NULL,
  title TEXT DEFAULT '',
  date TEXT DEFAULT '?',
  date_int INTEGER DEFAULT 0,
  seg_start INTEGER DEFAULT 0,
  seg_end INTEGER DEFAULT 0,
  text TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_win_conv ON archive_windows(conv_id);
CREATE INDEX IF NOT EXISTS idx_win_date ON archive_windows(date_int);

-- L0 逐字检索（FTS5 trigram 短语匹配，已在远程实测中文命中）
CREATE VIRTUAL TABLE IF NOT EXISTS raw USING fts5(
  content, source UNINDEXED, ref_id UNINDEXED, date UNINDEXED, role UNINDEXED,
  tokenize='trigram'
);

-- L1 摘录（自动提取、逐字引用锚定；与手写记忆 mem:* 完全隔离，不混入）
CREATE TABLE IF NOT EXISTS l1_memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  quote TEXT DEFAULT '',
  date TEXT DEFAULT '',
  conv_id TEXT DEFAULT '',
  source TEXT DEFAULT 'extraction',
  access_count INTEGER DEFAULT 0,
  last_accessed TEXT DEFAULT '',
  superseded_by TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

-- 增量水位线（archive:<conv_id> → 消息数；extract:<conv_id> → json；exthash:<sha256> → 1）
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 召回日志（注入目录不计 access，recall 命中才计——paramecium 计数规则）
CREATE TABLE IF NOT EXISTS recall_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  query TEXT NOT NULL,
  score REAL,
  ts TEXT DEFAULT (datetime('now')),
  source TEXT DEFAULT 'search'
);
CREATE INDEX IF NOT EXISTS idx_recall_memory ON recall_log(memory_id);

-- 官方档案本体（claude.ai 导出太大进不了 KV 25MB 单值：按对话分片存 D1，5GB 免费额度）
-- 前端上传时按场分片写入；档案室阅读按需取单场；装订工按 offdirty 信号增量入档
CREATE TABLE IF NOT EXISTS official_convs (
  uuid TEXT PRIMARY KEY,
  name TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  msg_count INTEGER DEFAULT 0,
  chunk_count INTEGER DEFAULT 0,
  bytes INTEGER DEFAULT 0,
  saved_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS official_conv_chunks (
  uuid TEXT NOT NULL,
  idx INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (uuid, idx)
);

DROP TABLE IF EXISTS fts_test;
