import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 25565,
  password TEXT NOT NULL,
  auth_profile TEXT NOT NULL DEFAULT 'default',
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS spawnpoints (
  id INTEGER PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL,
  x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL,
  bed_x INTEGER NOT NULL, bed_y INTEGER NOT NULL, bed_z INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  set_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS allowlist_global (
  id INTEGER PRIMARY KEY,
  player TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS allowlist_bot (
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  player TEXT NOT NULL,
  PRIMARY KEY (bot_id, player)
);

CREATE TABLE IF NOT EXISTS tpa_log (
  id INTEGER PRIMARY KEY,
  bot_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  req_type TEXT NOT NULL,
  player TEXT NOT NULL,
  action TEXT NOT NULL,
  ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events_log (
  id INTEGER PRIMARY KEY,
  bot_id TEXT,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  ts INTEGER NOT NULL
);
`;

export class Db {
  constructor(dbPath) {
    if (dbPath.startsWith('~')) {
      dbPath = dbPath.replace('~', process.env.HOME || '');
    }
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(SCHEMA);
  }

  insertBot({ id, name, host, port, password, authProfile, enabled }) {
    this.db.prepare(
      `INSERT INTO bots (id, name, host, port, password, auth_profile, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET host=?, port=?, password=?, auth_profile=?, enabled=?`
    ).run(id, name, host, port, password, authProfile, enabled ? 1 : 0, Date.now(),
      host, port, password, authProfile, enabled ? 1 : 0);
  }

  removeBot(name) {
    this.db.prepare('DELETE FROM bots WHERE name=?').run(name);
  }

  setBotEnabled(name, enabled) {
    this.db.prepare('UPDATE bots SET enabled=? WHERE name=?').run(enabled ? 1 : 0, name);
  }

  loadEnabledBots() {
    return this.db.prepare(
      'SELECT id, name, host, port, password, auth_profile, enabled FROM bots WHERE enabled=1'
    ).all().map(r => ({ ...r, enabled: r.enabled !== 0 }));
  }

  /** One-time migration: legacy per-locale profile names → merged default. */
  migrateLegacyProfiles(legacyNames, target) {
    const placeholders = legacyNames.map(() => '?').join(',');
    this.db.prepare(
      `UPDATE bots SET auth_profile=? WHERE auth_profile IN (${placeholders})`
    ).run(target, ...legacyNames);
  }

  loadAllowlist() {
    const global = this.db.prepare('SELECT player FROM allowlist_global').all().map(r => r.player);
    const perBot = this.db.prepare('SELECT player FROM allowlist_bot').all().map(r => r.player);
    return { global, perBot };
  }

  allowlistAdd(player, botId) {
    if (botId) {
      this.db.prepare('INSERT OR IGNORE INTO allowlist_bot (bot_id, player) VALUES (?, ?)').run(botId, player);
    } else {
      this.db.prepare('INSERT OR IGNORE INTO allowlist_global (player) VALUES (?)').run(player);
    }
  }

  allowlistRemove(player, botId) {
    if (botId) {
      this.db.prepare('DELETE FROM allowlist_bot WHERE bot_id=? AND player=?').run(botId, player);
    } else {
      this.db.prepare('DELETE FROM allowlist_global WHERE player=?').run(player);
    }
  }

  insertTpaLog({ botId, direction, reqType, player, action }) {
    this.db.prepare(
      'INSERT INTO tpa_log (bot_id, direction, req_type, player, action, ts) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(botId, direction, reqType, player, action, Date.now());
  }

  insertEventLog({ botId, level, message }) {
    this.db.prepare(
      'INSERT INTO events_log (bot_id, level, message, ts) VALUES (?, ?, ?, ?)'
    ).run(botId, level, message, Date.now());
  }

  queryEvents(bot, limit) {
    limit = Math.min(Math.max(limit, 1), 200);
    if (bot) {
      return this.db.prepare(
        'SELECT id, bot_id as bot, level, message, ts FROM events_log WHERE bot_id=? ORDER BY id DESC LIMIT ?'
      ).all(bot, limit);
    }
    return this.db.prepare(
      'SELECT id, bot_id as bot, level, message, ts FROM events_log ORDER BY id DESC LIMIT ?'
    ).all(limit);
  }

  queryTpaLogs(bot, limit) {
    limit = Math.min(Math.max(limit, 1), 200);
    if (bot) {
      return this.db.prepare(
        'SELECT id, bot_id as bot, direction, req_type, player, action, ts FROM tpa_log WHERE bot_id=? ORDER BY id DESC LIMIT ?'
      ).all(bot, limit);
    }
    return this.db.prepare(
      'SELECT id, bot_id as bot, direction, req_type, player, action, ts FROM tpa_log ORDER BY id DESC LIMIT ?'
    ).all(limit);
  }

  close() {
    this.db.close();
  }
}
