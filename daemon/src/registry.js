import { EventEmitter } from 'events';
import { BotRunner } from './bot.js';

export class BotRegistry extends EventEmitter {
  constructor(db) {
    super();
    this.db = db;
    this.bots = new Map();
    this.allowlist = { global: [], perBot: [] };
    this.spawnpoints = new Map();
    this.eventSubscribers = [];
  }

  loadFromDb() {
    const bots = this.db.loadEnabledBots();
    const al = this.db.loadAllowlist();
    this.allowlist = al;
    return bots;
  }

  add(config, authProfile, opts) {
    if (this.bots.has(config.name)) {
      return { ok: false, error: `bot ${config.name} already exists` };
    }

    const runner = new BotRunner(config, authProfile, {
      ...opts,
      allowlist: this.allowlist,
    });

    // Wire events
    runner.on('stateChanged', (state) => {
      this.db.insertEventLog({ botId: config.name, level: 'info', message: state });
      this.emit('event', { type: 'StateChanged', bot: config.name, state });
    });

    runner.on('log', (level, message) => {
      this.db.insertEventLog({ botId: config.name, level, message });
      this.emit('event', { type: 'Log', bot: config.name, level, message });
    });

    runner.on('commandSent', (text) => {
      this.db.insertEventLog({ botId: config.name, level: 'cmd', message: `⇒ ${text}` });
      this.emit('event', { type: 'Log', bot: config.name, level: 'cmd', message: `⇒ ${text}` });
    });

    runner.on('chat', (chat) => {
      this.emit('event', { type: 'Chat', bot: config.name, ...chat });
    });

    runner.on('authResult', (ok, detail) => {
      this.emit('event', { type: 'AuthResult', bot: config.name, ok, detail });
    });

    runner.on('spawnChanged', (spawn) => {
      this.spawnpoints.set(config.name, spawn);
      this.emit('event', { type: 'SpawnChanged', bot: config.name, spawn });
    });

    runner.on('tpaLog', (kind, player, action) => {
      this.db.insertTpaLog({
        botId: config.name,
        direction: 'in',
        reqType: kind,
        player,
        action,
      });
      this.emit('event', { type: 'TpaLog', bot: config.name, kind, player, action });
    });

    runner.on('spawnCompromised', (info) => {
      this.db.insertEventLog({ botId: config.name, level: 'error', message: `SPAWN_COMPROMISED: ${info.reason}` });
      this.emit('event', { type: 'SpawnCompromised', bot: config.name, reason: info.reason });
    });

    this.bots.set(config.name, runner);
    runner.start();
    return { ok: true };
  }

  get(name) {
    return this.bots.get(name);
  }

  remove(name) {
    const runner = this.bots.get(name);
    if (runner) {
      runner.stop();
      this.bots.delete(name);
    }
    return runner != null;
  }

  list() {
    return Array.from(this.bots.entries()).map(([name, runner]) => ({
      name,
      host: runner.config.host,
      port: runner.config.port,
      state: runner.state,
      spawn: this.spawnpoints.get(name) || { set: false },
    }));
  }

  status(name) {
    const runner = this.bots.get(name);
    if (!runner) return null;
    return {
      name,
      host: runner.config.host,
      port: runner.config.port,
      state: runner.state,
      spawn: this.spawnpoints.get(name) || { set: false },
    };
  }

  allowlistAdd(player, botId) {
    if (botId) {
      this.allowlist.perBot.push(player);
    } else {
      this.allowlist.global.push(player);
    }
    this.db.allowlistAdd(player, botId);
    this.updateBotAllowlists();
  }

  allowlistRemove(player, botId) {
    if (botId) {
      this.allowlist.perBot = this.allowlist.perBot.filter(p => p.toLowerCase() !== player.toLowerCase());
    } else {
      this.allowlist.global = this.allowlist.global.filter(p => p.toLowerCase() !== player.toLowerCase());
    }
    this.db.allowlistRemove(player, botId);
    this.updateBotAllowlists();
  }

  updateBotAllowlists() {
    for (const runner of this.bots.values()) {
      runner.opts.allowlist = this.allowlist;
    }
  }

  shutdownAll() {
    for (const runner of this.bots.values()) {
      runner.stop();
    }
    this.bots.clear();
  }
}
