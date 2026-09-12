import { createBot } from 'mineflayer';
import { EventEmitter } from 'events';
import { TpaGuard } from './tpaguard.js';

const BACKOFF_STEPS = [1000, 2000, 5000, 10000, 30000, 60000];
const MAX_AUTH_ATTEMPTS = 3;
const BED_CLICK_RETRY = 3;
const RESPAWN_SET_TIMEOUT_MS = 5000;
const DEATH_RESPAWN_CHECK_RADIUS = 12;

export class BotRunner extends EventEmitter {
  constructor(config, authProfile, opts = {}) {
    super();
    this.config = config;
    this.authProfile = authProfile;
    this.opts = opts;
    this.bot = null;
    this.state = 'DISABLED';
    this.spawnSet = false;
    this.spawnPos = null;
    this.bedPos = null;
    this.wrongAttempts = 0;
    this.registerSent = false;
    this.loginSent = false;
    this.authEpoch = 0;
    this.retryCount = 0;
    this.tempKick = false;
    this.rateLimitUntil = 0;
    this.alive = false;
    this.shuttingDown = false;

    this.tpaGuard = new TpaGuard({
      requestTtlS: opts.tpaRequestTtlS || 60,
      maxAcceptsPerMin: opts.tpaMaxAcceptsPerMin || 6,
      playerCooldownS: opts.tpaPlayerCooldownS || 30,
      freezeSeconds: opts.tpaFreezeSeconds !== undefined ? opts.tpaFreezeSeconds : 2,
      denyOthersOnAccept: opts.tpaDenyOthersOnAccept !== undefined ? !!opts.tpaDenyOthersOnAccept : true,
      confirmWindowMs: opts.tpaConfirmWindowMs !== undefined ? opts.tpaConfirmWindowMs : 20000,
      denyWaitMs: opts.tpaDenyWaitMs !== undefined ? opts.tpaDenyWaitMs : 15000,
      acceptCmd: opts.tpaAcceptCmd || '/tpaccept {player}',
      denyCmd: opts.tpaDenyCmd || '/tpdeny',
      rejectNonAllowlisted: opts.tpaRejectNonAllowlisted !== undefined ? !!opts.tpaRejectNonAllowlisted : false,
      msgCmd: opts.tpaMsgCmd !== undefined ? opts.tpaMsgCmd : '/msg {player} {message}',
      notAllowedMessage: opts.tpaNotAllowedMessage || "Your TPA request was rejected: this bot only accepts its operator's allowlist. Project: lama2923/homebot (AGPLv3).",
      allowTpahereFrom: opts.allowTpahereFrom || [],
      tpaRequest: authProfile.tpaRequest,
      tpahereRequest: authProfile.tpahereRequest,
      tpaConfirm: authProfile.tpaConfirm || [],
      tpaDeny: authProfile.tpaDeny || [],
      tpaExpired: authProfile.tpaExpired || [],
    }, () => opts.allowlist || { global: [], perBot: [] });

    this.tpaLogCb = (kind, player, action) => {
      this.emit('tpaLog', kind, player, action);
    };
  }

  setState(state) {
    this.state = state;
    this.emit('stateChanged', state);
  }

  updateAllowlist(allowlist) {
    this.opts.allowlist = allowlist;
  }

  updateConfig(opts) {
    this.tpaGuard.updateConfig(opts);
  }

  async start() {
    this.shuttingDown = false;
    this.registerSent = false;
    this.loginSent = false;
    this.wrongAttempts = 0;
    this.setState('CONNECTING');

    // TCP probe
    const net = await import('net');
    const probeOk = await new Promise((resolve) => {
      const sock = net.connect(this.config.port, this.config.host, () => { sock.destroy(); resolve(true); });
      sock.on('error', () => resolve(false));
      sock.setTimeout(3000, () => { sock.destroy(); resolve(false); });
    });
    if (!probeOk) {
      this.emit('log', 'warn', 'TCP probe failed');
      this.scheduleReconnect();
      return;
    }

    this.bot = createBot({
      username: this.config.name,
      host: this.config.host,
      port: this.config.port,
      version: '1.21.1',
      auth: 'offline',
      hideErrors: true,
    });

    const pw = this.config.password || '';
    this.emit('log', 'info', `password check: length=${pw.length}, ascii=${/^[\x20-\x7e]+$/.test(pw)}, spaces=${/\s/.test(pw)}`);

    this.bot.once('spawn', () => this.onSpawn());
    this.bot.on('chat', (username, message) => this.onChat(username, message));
    this.bot.on('message', (msg, position) => this.onMessage(msg, position));
    this.bot.on('kicked', (reason) => this.onKicked(reason));
    this.bot.on('end', () => this.onEnd());
    this.bot.on('death', () => this.onDeath());
    this.bot.on('respawn', () => this.onRespawn());
    this.bot.on('error', (err) => this.emit('log', 'error', `bot error: ${err.message}`));
    this.alive = true;
  }

  onSpawn() {
    const cameFromBackoff = this.state === 'BACKOFF';
    this.setState('AUTHENTICATING');
    this.emit('log', 'info', 'spawned, waiting for AuthMe prompt');
    if (!cameFromBackoff) this.retryCount = 0;

    if (!this.loginSent) {
      setTimeout(() => {
        if (this.shuttingDown || !this.bot) return;
        if (this.state !== 'AUTHENTICATING' || this.loginSent) return;
        this.sendLogin('spawn fallback');
      }, 500);
    }

    if (this.bedPos) {
      setTimeout(() => this.clickBed(), 2000);
    }
  }

  onMessage(msg, position) {
    const text = (typeof msg === 'string' ? msg : msg?.toString() || '').trim();
    if (!text) return;

    const clean = text.replace(/§[0-9a-fk-or]/gi, '');
    // mineflayer fires 'chat' for player lines too — 'message' handles
    // system lines only here so the same line is never emitted twice.
    const isSystem = position !== 'chat';
    if (!isSystem) return;

    this.emit('chat', { system: true, sender: null, content: clean });

    this.handleAuth(clean);

    try {
      const res = this.tpaGuard.handle(clean, this.config.name, { chat: (t) => this.safeChat(t) }, this.tpaLogCb);
      this.onTpaGuardResult(res);
    } catch (err) {
      this.emit('log', 'error', `tpa parse error: ${err.message}`);
    }
  }

  // Auth-gate channel unlock: join → 2 moves + jump so /msg works.
  async unlockChatChannel() {
    if (!this.bot || !this.alive) return;
    try {
      this.bot.setControlState('forward', true);
      await new Promise(r => setTimeout(r, 350));
      this.bot.setControlState('forward', false);
      this.bot.setControlState('jump', true);
      await new Promise(r => setTimeout(r, 350));
      this.bot.setControlState('jump', false);
      this.emit('log', 'info', 'chat channel warmup done (moved+jumped for /msg unlock)');
    } catch (err) {
      this.emit('log', 'warn', `chat warmup failed: ${err.message}`);
    }
  }

  startAntiAfk() {
    if (this.antiafkTimer || this.shuttingDown) return;
    const minS = this.opts.antiafkMinS || 45;
    const maxS = this.opts.antiafkMaxS || minS + 105;
    this.antiafkTimer = setInterval(() => {
      if (this.shuttingDown || !this.bot || !this.alive) return;
      try {
        const moves = ['forward', 'back', 'left', 'right'];
        const mv = moves[Math.floor(Math.random() * moves.length)];
        this.bot.setControlState(mv, true);
        setTimeout(() => {
          if (!this.bot) return;
          this.bot.setControlState(mv, false);
          try {
            this.bot.look(Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.6);
          } catch {}
        }, 400 + Math.random() * 400);
        this.emit('log', 'info', `anti-afk: move ${mv} + look`);
      } catch (err) {
        this.emit('log', 'warn', `anti-afk failed: ${err.message}`);
      }
    }, minS * 1000 + Math.random() * (maxS - minS) * 1000);
  }

  stopAntiAfk() {
    if (this.antiafkTimer) {
      clearInterval(this.antiafkTimer);
      this.antiafkTimer = null;
    }
  }

  onChat(username, message) {
    this.emit('chat', { system: false, sender: username, content: message });
  }

  handleAuth(text) {
    if (this.state === 'ACTIVE' || this.state === 'DISABLED') return;

    const p = this.authProfile;
    const pw = this.config.password;

    // Wrong password
    if (p.wrongPassword.some(r => r.test(text))) {
      this.wrongAttempts++;
      this.loginSent = false;
      if (this.wrongAttempts >= MAX_AUTH_ATTEMPTS) {
        this.emit('log', 'error', `auth failed after ${MAX_AUTH_ATTEMPTS} attempts`);
        this.setState('AUTH_FAILED');
        this.stop();
        return;
      }
      this.emit('log', 'warn', `wrong password (attempt ${this.wrongAttempts})`);
      this.sendLogin('wrong password retry');
      return;
    }

    // Already logged in / successful login
    if (p.alreadyLogged.some(r => r.test(text))) {
      this.setState('ACTIVE');
      this.unlockChatChannel();
      this.startAntiAfk();
      this.emit('authResult', true, 'already logged in');
      return;
    }

    // Already registered → send /login
    if (p.alreadyRegistered?.some(r => r.test(text))) {
      if (!this.loginSent) this.sendLogin('already registered');
      return;
    }

    // Register prompt
    if (p.registerPrompt.some(r => r.test(text)) && !this.registerSent) {
      this.safeChat(p.registerCmd.replaceAll('{p}', pw));
      this.registerSent = true;
      this.emit('log', 'info', 'register prompt; sending /register');
      return;
    }

    // Login prompt
    if (p.loginPrompt.some(r => r.test(text)) && !this.loginSent) {
      this.sendLogin('login prompt');
      return;
    }

    if (p.respawnSet.some(r => r.test(text))) {
      this.spawnSet = true;
      if (this.bot?.entity?.position) {
        this.spawnPos = this.bot.entity.position.clone();
        this.emit('log', 'info', `respawn point set at (${this.spawnPos.x.toFixed(1)}, ${this.spawnPos.y.toFixed(1)}, ${this.spawnPos.z.toFixed(1)})`);
        this.emit('spawnChanged', { set: true, x: this.spawnPos.x, y: this.spawnPos.y, z: this.spawnPos.z });
      }
      if (this.bot && this.bot.isSleeping) {
        this.bot.wake();
        this.emit('log', 'info', 'woke up from bed');
      }
    }

    // Bed missing / obstructed
    if (p.bedMissing?.some(r => r.test(text))) {
      this.spawnSet = false;
      this.bedPos = null;
      this.emit('log', 'warn', 'SPAWN_LOST: bed missing');
      this.emit('spawnChanged', { set: false, lost: true });
    }

    if (p.kickBanned.some(r => r.test(text))) {
      this.emit('log', 'error', 'banned kick detected');
      this.setState('DISABLED');
      this.shuttingDown = true;
    }
  }

  onKicked(reason) {
    const text = typeof reason === 'string' ? reason : JSON.stringify(reason);
    const clean = text.replace(/§[0-9a-fk-or]/gi, '');

    if (this.authProfile.kickBanned.some(r => r.test(clean))) {
      this.emit('log', 'error', 'banned; disabling');
      this.setState('DISABLED');
      this.shuttingDown = true;
      return;
    }

    if (this.authProfile.wrongPassword.some(r => r.test(clean)) || /too\s*many\s*(wrong|login)/i.test(clean)) {
      this.wrongAttempts++;
      this.retryCount = Math.max(this.retryCount, BACKOFF_STEPS.length - 2);
      if (this.wrongAttempts >= MAX_AUTH_ATTEMPTS) {
        this.emit('log', 'error', `auth kick x${this.wrongAttempts}; stopping bot (check password in config)`);
        this.setState('AUTH_FAILED');
        this.shuttingDown = true;
        return;
      }
      this.emit('log', 'warn', `auth-related kick; long backoff (auth failure ${this.wrongAttempts}/${MAX_AUTH_ATTEMPTS})`);
      this.setState('BACKOFF');
    } else if (/giri[şs]\s*s[üu]resi\s*doldu|login\s*timeout|took\s*too\s*long/i.test(clean)) {
      this.tempKick = true;
      this.emit('log', 'warn', 'login timeout kick (we were too slow); short backoff');
    }

    if (/too\s*fast|h[ıi]zlı|typing|please\s*wait|be[şk]le|already\s*connected|zaten\s*ba[ğg]l/i.test(clean)) {
      this.tempKick = true;
      this.emit('log', 'warn', 'temporary kick detected; short backoff');
    }

    const waitMatch = clean.match(/(\d+)\s*(dakika|dk|saniye|sn)/i);
    if (/çok\s*fazla|hatal[ıi]\s*deneme|too\s*many\s*(attempts|login)|beklemeli|wait\s*\d+|rate\s*limit/i.test(clean) || waitMatch) {
      const mins = waitMatch && /dakika|dk/i.test(waitMatch[2]) ? parseInt(waitMatch[1]) : 0;
      const secs = waitMatch && /saniye|sn/i.test(waitMatch[2]) ? parseInt(waitMatch[1]) : 0;
      const waitMs = mins ? mins * 60000 : secs ? secs * 1000 : 600000;
      this.retryCount = BACKOFF_STEPS.length - 1;
      this.rateLimitUntil = Date.now() + waitMs;
      this.emit('log', 'warn', `rate-limit kick; server says wait ${mins ? mins + 'm' : (secs || 600) + 's'}`);
    }

    this.emit('log', 'warn', `kicked: ${clean}`);
  }

  onEnd() {
    this.alive = false;
    this.stopAntiAfk();
    const dead = this.bot;
    this.bot = null;
    if (dead) {
      try { dead.quit(); } catch {}
    }
    if (this.shuttingDown) {
      this.emit('log', 'info', 'disconnected (local shutdown)');
      return;
    }
    this.emit('log', 'warn', 'disconnected; supervisor will reconnect');
    this.scheduleReconnect();
  }

  onDeath() {
    this.emit('log', 'info', 'bot died');

    if (this.bedPos) {
      setTimeout(() => {
        if (!this.bot || !this.bot.entity) return;
        const pos = this.bot.entity.position;
        const dist = Math.sqrt(
          (this.bedPos.x - pos.x) ** 2 +
          (this.bedPos.y - pos.y) ** 2 +
          (this.bedPos.z - pos.z) ** 2
        );
        if (dist <= DEATH_RESPAWN_CHECK_RADIUS) {
          this.clickBed();
        } else {
          this.emit('log', 'warn', 'SPAWN_LOST: respawned far from bed');
          this.emit('spawnChanged', { set: false, lost: true });
        }
      }, 2000);
    }
  }

  sendLogin(reason = 'fallback') {
    if (!this.bot || this.shuttingDown || this.loginSent) return;
    try {
      const cmd = this.authProfile.loginCmd.replaceAll('{p}', this.config.password);
      this.safeChat(cmd);
      this.emit('log', 'info', `login cmd sent: len=${cmd.length}, cmd_len_no_pw=${this.authProfile.loginCmd.replaceAll('{p}', '').length}`);
    } catch {
      return;
    }
    this.loginSent = true;
    const epoch = ++this.authEpoch;
    this.emit('log', 'info', `sending /login (${reason})`);
    setTimeout(() => {
      if (this.shuttingDown || epoch !== this.authEpoch) return;
      if (this.state === 'AUTHENTICATING' || this.state === 'CONNECTING') {
        this.setState('ACTIVE');
        this.unlockChatChannel();
        this.startAntiAfk();
        this.emit('authResult', true, 'login sent');
      }
    }, 2500);
  }

  onRespawn() {
    this.emit('log', 'info', 'respawned');
    if (this.state === 'AUTHENTICATING' || this.state === 'CONNECTING') return;
    this.setState('ACTIVE');
    this.startAntiAfk();
  }

  clickBed() {
    if (!this.bedPos || !this.bot) return;
    const block = this.bot.blockAt(this.bedPos);
    if (!block || !block.name.includes('bed')) {
      this.emit('log', 'warn', 'bed missing');
      this.emit('spawnChanged', { set: false, lost: true });
      return;
    }
    this.bot.activateBlock(block);
    this.emit('log', 'info', 'clicked bed');
    setTimeout(() => {
      if (this.bot && this.bot.isSleeping) {
        this.bot.wake();
        this.emit('log', 'info', 'woke up from bed');
      }
    }, 500);
  }

  registerBed(radius = 3) {
    if (!this.bot) return { ok: false, error: 'bot not connected' };

    const pos = this.bot.entity.position;
    const found = this.bot.findBlocks({
      matching: (block) => block.name.includes('bed'),
      maxDistance: radius,
      count: 1,
    });

    if (!found || found.length === 0) {
      return { ok: false, error: 'no bed found in range' };
    }

    this.bedPos = found[0];

    let attempts = 0;
    const tryClick = () => {
      if (attempts >= BED_CLICK_RETRY) {
        this.emit('log', 'error', 'bed register failed: respawn-set timeout');
        return;
      }
      attempts++;
      const block = this.bot.blockAt(this.bedPos);
      if (!block || !block.name.includes('bed')) {
        this.emit('log', 'warn', 'bed missing during register');
        return;
      }
      this.bot.activateBlock(block);
    };

    tryClick();
    return { ok: true, bed: this.bedPos };
  }

  safeChat(text) {
    if (!this.bot || !this.alive) return false;
    try {
      this.bot.chat(text);
      const pw = this.config.password || '';
      const shown = pw ? text.split(pw).join('••••••') : text;
      this.emit('commandSent', shown);
      return true;
    } catch (err) {
      this.emit('log', 'warn', `chat write failed (${err.code || err.message}); ignoring`);
      return false;
    }
  }

  chat(text) {
    this.safeChat(text);
  }

  command(cmd) {
    this.safeChat(cmd);
  }

  tpaTo(player) {
    const cmd = (this.opts.tpaRequestCmd || '/tpa {player}').replaceAll('{player}', player);
    if (this.safeChat(cmd)) this.emit('tpaLog', 'tpa', player, 'sent');
  }


  sabotageTeleport(reason) {
    if (!this.bot || !this.alive) return;
    this.emit('log', 'error', `teleport sabotage (${reason}): moving to cancel in-flight teleport`);
    this.emit('spawnCompromised', { reason });
    try {
      this.bot.setControlState('forward', true);
      this.bot.setControlState('jump', true);
      this.bot.setControlState('left', true);
      setTimeout(() => {
        if (!this.bot) return;
        this.bot.setControlState('forward', false);
        this.bot.setControlState('jump', false);
        this.bot.setControlState('left', false);
      }, 700);
    } catch (err) {
      this.emit('log', 'error', `sabotage movement failed: ${err.message}`);
    }
  }


  disableForCompromise(reason) {
    this.emit('log', 'error', `compromise response (${reason}): DISABLING bot`);
    this.shuttingDown = true;
    this.alive = false;
    if (this.bot) {
      try { this.bot.quit(); } catch {}
      this.bot = null;
    }
    this.setState('DISABLED');
  }

  onTpaGuardResult(result) {
    if (!result) return;
    if (result.action === 'teleport_mismatch') {
      this.sabotageTeleport('teleport_mismatch');
      this.disableForCompromise(`teleport_mismatch by '${result.player}'`);
    } else if (result.action === 'late_rival') {
      this.sabotageTeleport('late_rival');
    }
  }

  stop() {
    this.shuttingDown = true;
    this.stopAntiAfk();
    if (this.bot) {
      try { this.bot.quit(); } catch {}
      this.bot = null;
    }
    this.setState('DISABLED');
  }

  scheduleReconnect() {
    if (this.shuttingDown) return;

    if (this.rateLimitUntil && Date.now() < this.rateLimitUntil) {
      const wait = this.rateLimitUntil - Date.now();
      this.emit('log', 'info', `rate-limited; waiting ${Math.ceil(wait / 1000)}s before reconnect`);
      this.setState('BACKOFF');
      setTimeout(() => {
        if (!this.shuttingDown) { this.rateLimitUntil = 0; this.start(); }
      }, wait);
      return;
    }

    let delay;
    if (this.tempKick) {
      this.tempKick = false;
      delay = 3000;
    } else {
      delay = BACKOFF_STEPS[Math.min(this.retryCount, BACKOFF_STEPS.length - 1)];
      this.retryCount++;
    }
    this.setState('BACKOFF');
    this.emit('log', 'info', `reconnecting in ${delay}ms`);
    setTimeout(() => {
      if (!this.shuttingDown) this.start();
    }, delay);
  }
}
