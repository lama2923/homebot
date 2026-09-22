import { EventEmitter } from 'events';
import { BotRunner } from './bot.js';

export class BotRegistry extends EventEmitter {
  constructor(db) {
    super();
    this.db = db;
    this.bots = new Map();
    this.allowlist = { global: [], perBot: {} };
    this.spawnpoints = new Map();
    this.eventSubscribers = [];
  }

  loadFromDb() {
    const bots = this.db.loadEnabledBots();
    const al = this.db.loadAllowlist();
    this.allowlist = al;
    for (const sp of this.db.loadSpawnpoints()) {
      this.spawnpoints.set(sp.bot_name, {
        set: true,
        x: sp.x, y: sp.y, z: sp.z,
        bed: { x: sp.bed_x, y: sp.bed_y, z: sp.bed_z },
      });
    }
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
      if (spawn.set) {
        this.spawnpoints.set(config.name, spawn);
        this.db.saveSpawnpoint(config.name, spawn, spawn.bed);
      } else {
        this.spawnpoints.set(config.name, { set: false });
        this.db.deactivateSpawnpoint(config.name);
      }
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

  currentPosition(runner) {
    const p = runner.bot?.entity?.position;
    if (!p) return null;
    return { x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1) };
  }

  list() {
    return Array.from(this.bots.entries()).map(([name, runner]) => ({
      name,
      host: runner.config.host,
      port: runner.config.port,
      state: runner.state,
      spawn: this.spawnpoints.get(name) || { set: false },
      position: this.currentPosition(runner),
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
      position: this.currentPosition(runner),
    };
  }

  allowlistAdd(player, botName) {
    if (botName) {
      const list = this.allowlist.perBot[botName] || [];
      if (!list.some(p => p.toLowerCase() === player.toLowerCase())) list.push(player);
      this.allowlist.perBot[botName] = list;
    } else {
      if (!this.allowlist.global.some(p => p.toLowerCase() === player.toLowerCase())) {
        this.allowlist.global.push(player);
      }
    }
    this.db.allowlistAdd(player, botName);
    this.updateBotAllowlists();
  }

  allowlistRemove(player, botName) {
    if (botName) {
      this.allowlist.perBot[botName] = (this.allowlist.perBot[botName] || [])
        .filter(p => p.toLowerCase() !== player.toLowerCase());
    } else {
      this.allowlist.global = this.allowlist.global.filter(p => p.toLowerCase() !== player.toLowerCase());
    }
    this.db.allowlistRemove(player, botName);
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
