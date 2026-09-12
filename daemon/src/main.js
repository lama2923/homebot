import { randomUUID } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { Db } from './db.js';
import { BotRegistry } from './registry.js';
import { IpcServer } from './ipc.js';
import { compileAuthProfileFromToml } from './auth.js';

function expandTilde(path) {
  if (path.startsWith('~/') && process.env.HOME) {
    return path.replace('~', process.env.HOME);
  }
  return path;
}

function loadConfig(path) {
  if (!existsSync(path)) {
    throw new Error(`config file not found: ${path}`);
  }
  const raw = readFileSync(path, 'utf-8');
  const config = {
    general: {
      locale: 'en',
      dbPath: '~/.local/share/homebot/homebot.db',
      socketPath: '~/.local/share/homebot/homebotd.sock',
      logLevel: 'info',
    },
    antiafk: { minS: 45, maxS: 150 },
    tpa: { requestTtlS: 60, maxAcceptsPerMin: 6, playerCooldownS: 30, freezeSeconds: 2, denyOthersOnAccept: true, confirmWindowMs: 20000, denyWaitMs: 15000, acceptCmd: '/tpaccept {player}', denyCmd: '/tpdeny', requestCmd: '/tpa {player}', msgCmd: '/msg {player} {message}', rejectNonAllowlisted: false, notAllowedMessage: "You are not on this bot's allowlist; your TPA request was rejected." },
    tpaguard: { allowTpahereFrom: [] },
    authProfiles: {},
  };

  let section = null;
  let authProfileName = null;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[')) {
      section = trimmed.replace(/[[\]]/g, '');
      authProfileName = null;
      if (section.startsWith('auth_profiles.')) {
        authProfileName = section.replace('auth_profiles.', '');
        config.authProfiles[authProfileName] = {};
      }
      continue;
    }
    const [key, ...rest] = trimmed.split('=');
    if (!key || rest.length === 0) continue;
    const val = rest.join('=').trim();
    let parsed = val;
    if (val.startsWith('"') && val.endsWith('"')) {
      parsed = val.slice(1, -1);
    } else if (val.startsWith('[') && val.endsWith(']')) {
      const inner = val.slice(1, -1);
      const items = [];
      let cur = '';
      let inQuote = false;
      for (let i = 0; i < inner.length; i++) {
        const c = inner[i];
        if (c === '"') { inQuote = !inQuote; continue; }
        if (c === ',' && !inQuote) { items.push(cur.trim()); cur = ''; continue; }
        cur += c;
      }
      if (cur.trim()) items.push(cur.trim());
      parsed = items.map(s => s.replace(/"/g, '')).filter(Boolean);
    } else if (/^\d+$/.test(val)) {
      parsed = parseInt(val);
    } else if (/^(true|false)$/.test(val)) {
      parsed = val === 'true';
    }

    const rawKey = key.trim();
    const camelKey = rawKey.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (authProfileName) {
      config.authProfiles[authProfileName][rawKey] = parsed;
    } else if (section === 'general') {
      config.general[camelKey] = parsed;
    } else if (section === 'antiafk') {
      config.antiafk[camelKey] = parsed;
    } else if (section === 'tpa') {
      config.tpa[camelKey] = parsed;
    } else if (section === 'tpaguard') {
      config.tpaguard[camelKey] = parsed;
    }
  }
  return config;
}

async function main() {
  // Parse --config arg
  const args = process.argv.slice(2);
  let configPath = 'homebot.toml';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      configPath = args[i + 1];
    }
  }

  const config = loadConfig(configPath);

  // Setup DB
  const dbPath = expandTilde(config.general.dbPath);
  const db = new Db(dbPath);

  // Migrate legacy profile names (authme_en/authme_tr) → single 'default'
  db.migrateLegacyProfiles(['authme_en', 'authme_tr'], 'default');

  // Setup registry
  const registry = new BotRegistry(db);

  // Load auth profiles — TOML is the ONLY source; missing section is fatal.
  const authProfiles = new Map();
  if (config.authProfiles) {
    for (const [name, def] of Object.entries(config.authProfiles)) {
      def.name = name;
      authProfiles.set(name, compileAuthProfileFromToml(def));
      console.log(`[homebotd] auth profile loaded from TOML: ${name}`);
    }
  }
  if (!authProfiles.has('default')) {
    throw new Error(
      "no [auth_profiles.default] section found in homebot.toml — auth regex patterns MUST be defined in TOML, not code"
    );
  }

  // Auto-start enabled bots from DB
  const enabledBots = registry.loadFromDb();
  for (const bot of enabledBots) {
    const profile = authProfiles.get(bot.auth_profile) || authProfiles.get('default');
    registry.add({
      name: bot.name,
      host: bot.host,
      port: bot.port,
      password: bot.password,
      authProfile: bot.auth_profile,
    }, profile, {
      allowTpahereFrom: config.tpaguard.allowTpahereFrom || [],
      tpaRequestTtlS: config.tpa.requestTtlS,
      tpaMaxAcceptsPerMin: config.tpa.maxAcceptsPerMin,
      tpaPlayerCooldownS: config.tpa.playerCooldownS,
      tpaFreezeSeconds: config.tpa.freezeSeconds !== undefined ? config.tpa.freezeSeconds : 2,
      tpaDenyOthersOnAccept: config.tpa.denyOthersOnAccept !== undefined ? config.tpa.denyOthersOnAccept : true,
      tpaConfirmWindowMs: config.tpa.confirmWindowMs !== undefined ? config.tpa.confirmWindowMs : 20000,
      tpaDenyWaitMs: config.tpa.denyWaitMs !== undefined ? config.tpa.denyWaitMs : 15000,
      tpaAcceptCmd: config.tpa.acceptCmd || '/tpaccept {player}',
      tpaDenyCmd: config.tpa.denyCmd || '/tpdeny',
      tpaRequestCmd: config.tpa.requestCmd || '/tpa {player}',
      antiafkMinS: config.antiafk.minS,
      antiafkMaxS: config.antiafk.maxS,
      tpaRejectNonAllowlisted: config.tpa.rejectNonAllowlisted !== undefined ? !!config.tpa.rejectNonAllowlisted : false,
      tpaMsgCmd: config.tpa.msgCmd !== undefined ? config.tpa.msgCmd : '/msg {player} {message}',
      tpaNotAllowedMessage: config.tpa.notAllowedMessage || "Your TPA request was rejected: this bot only accepts its operator's allowlist. Project: https://github.com/lama2923/homebot (AGPLv3).",
    });
  }

  // Wire registry events to IPC broadcast
  registry.on('event', (event) => {
    ipc.broadcastEvent(event);
  });

  // Setup IPC
  const socketPath = expandTilde(config.general.socketPath);
  const ipc = new IpcServer(socketPath, async (req) => {
    const method = req.method;
    const params = req.params || {};

    switch (method) {
      case 'ping':
        return 'pong';

      case 'bot.list':
        return registry.list();

      case 'bot.create': {
        const { host, port, auth_profile } = params;
        // Trim guards against invisible whitespace; spaces are rejected
        // since /login takes a single word.
        const name = String(params.name ?? '').trim();
        const password = String(params.password ?? '').trim();
        if (!name || !password) throw new Error('name and password required');
        if (/\s/.test(password)) {
          throw new Error('password must not contain spaces (AuthMe reads one word only)');
        }
        const profile = authProfiles.get(auth_profile || 'default') || authProfiles.get('default');
        const id = randomUUID();
        db.insertBot({ id, name, host, port: port || 25565, password, authProfile: auth_profile || 'default', enabled: true });
        const result = registry.add({
          name, host, port: port || 25565, password, authProfile: auth_profile || 'default'
        }, profile, {
          allowTpahereFrom: config.tpaguard.allowTpahereFrom || [],
          tpaRequestTtlS: config.tpa.requestTtlS,
          tpaMaxAcceptsPerMin: config.tpa.maxAcceptsPerMin,
          tpaPlayerCooldownS: config.tpa.playerCooldownS,
          tpaFreezeSeconds: config.tpa.freezeSeconds !== undefined ? config.tpa.freezeSeconds : 2,
          tpaDenyOthersOnAccept: config.tpa.denyOthersOnAccept !== undefined ? config.tpa.denyOthersOnAccept : true,
          tpaConfirmWindowMs: config.tpa.confirmWindowMs !== undefined ? config.tpa.confirmWindowMs : 20000,
          tpaDenyWaitMs: config.tpa.denyWaitMs !== undefined ? config.tpa.denyWaitMs : 15000,
          tpaAcceptCmd: config.tpa.acceptCmd || '/tpaccept {player}',
          tpaDenyCmd: config.tpa.denyCmd || '/tpdeny',
          tpaRequestCmd: config.tpa.requestCmd || '/tpa {player}',
          antiafkMinS: config.antiafk.minS,
          antiafkMaxS: config.antiafk.maxS,
          tpaRejectNonAllowlisted: config.tpa.rejectNonAllowlisted !== undefined ? !!config.tpa.rejectNonAllowlisted : false,
          tpaMsgCmd: config.tpa.msgCmd !== undefined ? config.tpa.msgCmd : '/msg {player} {message}',
          tpaNotAllowedMessage: config.tpa.notAllowedMessage || "Your TPA request was rejected: this bot only accepts its operator's allowlist. Project: https://github.com/lama2923/homebot (AGPLv3).",
        });
        if (!result.ok) throw new Error(result.error);
        return { id: name };
      }

      case 'bot.remove': {
        registry.remove(params.name);
        db.removeBot(params.name);
        return { ok: true };
      }

      case 'bot.enable': {
        db.setBotEnabled(params.name, true);
        return { ok: true };
      }

      case 'bot.disable': {
        const runner = registry.get(params.name);
        if (runner) runner.stop();
        db.setBotEnabled(params.name, false);
        return { ok: true };
      }

      case 'bot.status': {
        const s = registry.status(params.name);
        if (!s) throw new Error(`bot not found: ${params.name}`);
        return s;
      }

      case 'bot.command': {
        const runner = registry.get(params.name);
        if (!runner) throw new Error(`bot not found: ${params.name}`);
        runner.command(params.text);
        return { ok: true };
      }

      case 'bot.tpa_to': {
        const runner = registry.get(params.name);
        if (!runner) throw new Error(`bot not found: ${params.name}`);
        runner.tpaTo(params.player);
        return { ok: true };
      }

      case 'bot.bed_register': {
        const runner = registry.get(params.name);
        if (!runner) throw new Error(`bot not found: ${params.name}`);
        return runner.registerBed(params.radius || 3);
      }

      case 'allowlist.add': {
        registry.allowlistAdd(params.player, params.bot);
        return { ok: true };
      }

      case 'allowlist.remove': {
        registry.allowlistRemove(params.player, params.bot);
        return { ok: true };
      }

      case 'allowlist.list': {
        if (params.bot) {
          return registry.allowlist.perBot;
        }
        return registry.allowlist.global;
      }

      case 'logs.events': {
        return db.queryEvents(params.bot, params.limit || 20);
      }

      case 'logs.tpa': {
        return db.queryTpaLogs(params.bot, params.limit || 20);
      }

      default:
        throw new Error(`method not found: ${method}`);
    }
  });

  await ipc.start();
  console.log(`[homebotd] daemon ready — socket: ${socketPath}, db: ${dbPath}`);
  console.log(`[homebotd] ${enabledBots.length} bot(s) auto-started from DB`);

  process.on('uncaughtException', (err) => {
    if (err && (err.code === 'EPIPE' || err.code === 'ECONNRESET')) {
      console.error('[homebotd] socket write failed (ignored):', err.code);
      return;
    }
    console.error('[homebotd] uncaught exception:', err);
    process.exit(1);
  });

  const shutdown = () => {
    console.log('[homebotd] shutting down...');
    registry.shutdownAll();
    ipc.close();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('[homebotd] fatal:', err);
  process.exit(1);
});
