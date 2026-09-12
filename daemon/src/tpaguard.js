// TPA guard: allowlist-gated, FIFO-queued, rate-limited. For servers where
// /tpaccept resolves positionally, the accept is frozen to collect racing
// requests, then re-evaluated: any rival → deny. Accept/deny commands are
// templated from TOML (acceptCmd/denyCmd).

export class TpaGuard {
  constructor(opts, getAllowlist) {
    this.requestTtlS = opts.requestTtlS || 60;
    this.maxAcceptsPerMin = opts.maxAcceptsPerMin || 6;
    this.playerCooldownS = opts.playerCooldownS || 30;
    this.allowTpahereFrom = opts.allowTpahereFrom || [];
    this.strictNamedAccept = true;
    this.denyOthersOnAccept = opts.denyOthersOnAccept !== undefined ? !!opts.denyOthersOnAccept : true;
    this.confirmWindowMs = opts.confirmWindowMs !== undefined ? opts.confirmWindowMs : 20000;
    this.denyWaitMs = opts.denyWaitMs !== undefined ? opts.denyWaitMs : 15000;
    this.freezeSeconds = opts.freezeSeconds !== undefined ? opts.freezeSeconds : 2;
    this.acceptCmd = opts.acceptCmd || '/tpaccept {player}';
    this.denyCmd = opts.denyCmd || '/tpdeny';
    this.rejectNonAllowlisted = opts.rejectNonAllowlisted !== undefined ? !!opts.rejectNonAllowlisted : false;
    this.msgCmd = opts.msgCmd || '/msg {player} {message}';
    this.notAllowedMessage = opts.notAllowedMessage || "Your TPA request was rejected: this bot only accepts its operator's allowlist. Project: lama2923/homebot (AGPLv3).";
    this.tpaRequestRegex = opts.tpaRequest || [];
    this.tpahereRequestRegex = opts.tpahereRequest || [];
    this.tpaConfirmRegex = opts.tpaConfirm || [];
    this.tpaDenyRegex = opts.tpaDeny || [];
    this.tpaExpiredRegex = opts.tpaExpired || [];
    this.getAllowlist = getAllowlist;

    this.queue = [];
    this.accepts = [];
    this.cooldowns = new Map();
    this.seenRequests = [];
    this.pendingDeferred = null;
    this.pendingConfirms = [];
  }

  parse(text) {
    const clean = text.replace(/§[0-9a-fk-or]/gi, '');

    for (const re of this.tpaRequestRegex) {
      const m = clean.match(re);
      if (m?.[1]) return { kind: 'tpa', player: m[1] };
    }
    for (const re of this.tpahereRequestRegex) {
      const m = clean.match(re);
      if (m?.[1]) return { kind: 'tpahere', player: m[1] };
    }
    return null;
  }

  handle(text, botName, bot, logCallback) {
    const observed = this.observe(text, bot, logCallback);
    if (observed) return observed;

    const parsed = this.parse(text);
    if (!parsed) return null;

    const { kind, player } = parsed;

    const nowSeen = Date.now();
    this.seenRequests.push({ player, ts: nowSeen });
    this.seenRequests = this.seenRequests.filter(r => nowSeen - r.ts < this.requestTtlS * 1000);

    if (kind === 'tpahere') {
      const allowed = this.allowTpahereFrom.some(n => n.toLowerCase() === player.toLowerCase());
      if (!allowed) {
        logCallback('tpahere', player, 'ignored_tpahere');
        return { action: 'ignored_tpahere', player, kind };
      }
    }

    const allowlist = this.getAllowlist();
    const isAllowed = [...allowlist.global, ...allowlist.perBot]
      .some(p => p.toLowerCase() === player.toLowerCase());
    if (!isAllowed) {

      if (this.rejectNonAllowlisted && bot) {
        const line = this.msgCmd
          .replaceAll('{player}', player)
          .replaceAll('{message}', this.notAllowedMessage);
        bot.chat(line);
        logCallback(kind, player, 'rejected_not_allowlisted');
        return { action: 'rejected_not_allowlisted', player, kind };
      }
      logCallback(kind, player, 'ignored_not_allowlisted');
      return { action: 'ignored_not_allowlisted', player, kind };
    }

    const now = Date.now();
    const ttlMs = this.requestTtlS * 1000;
    this.queue = this.queue.filter(r => now - r.ts < ttlMs);
    this.queue.push({ player, kind, ts: now });

    const req = this.queue.shift();
    if (!req) return null;

    if (this.strictNamedAccept) {
      if (!this.pendingDeferred) {
        this.pendingDeferred = { player: req.player, kind: req.kind, ts: now };
        logCallback(req.kind, req.player, 'deferred_freeze');
        setTimeout(() => this.executeDeferred(bot, logCallback), this.freezeSeconds * 1000);
      } else {
        logCallback(req.kind, req.player, 'deferred_hold');
      }
      return { action: 'deferred_freeze', player: req.player, kind: req.kind };
    }

    if (this.canAccept(player)) {
      bot.chat(this.acceptCmd.replaceAll('{player}', req.player));
      this.accepts.push(now);
      this.cooldowns.set(player, now + this.playerCooldownS * 1000);
      logCallback(req.kind, req.player, 'accepted');
      return { action: 'accepted', player: req.player, kind: req.kind };
    } else {
      logCallback(req.kind, req.player, 'rate_limited');
      return { action: 'rate_limited', player: req.player, kind: req.kind };
    }
  }

  observe(text, bot, logCallback) {
    const clean = text.replace(/§[0-9a-fk-or]/gi, '');
    const now = Date.now();
    this.pendingConfirms = this.pendingConfirms.filter(c => now < c.expiresAt);
    if (!this.pendingConfirms.length) return null;

    // Confirm lines name the teleporting player.
    for (const re of this.tpaConfirmRegex) {
      const m = clean.match(re);
      if (m?.[1]) {
        const named = m[1];
        const pending = this.pendingConfirms
          .slice()
          .sort((a, b) => b.expiresAt - a.expiresAt)[0];
        if (named.toLowerCase() === pending.player.toLowerCase()) {
          this.pendingConfirms = [];
          logCallback(pending.kind, pending.player, 'teleport_confirmed');
          return { action: 'teleport_confirmed', player: pending.player, kind: pending.kind };
        }
        logCallback(pending.kind, named, 'teleport_mismatch');
        return { action: 'teleport_mismatch', player: named, kind: pending.kind };
      }
    }

    // Deny/timeout lines just retire noise (no alarm, still logged by caller).
    for (const re of [...this.tpaDenyRegex, ...this.tpaExpiredRegex]) {
      if (re.test(clean)) {
        logCallback('tpa', '?', 'peer_denied_or_expired');
        return { action: 'peer_denied_or_expired', player: '?', kind: 'tpa' };
      }
    }

    // Late rival: a fresh request line while a confirm is still open.
    const req = this.parse(text);
    if (req) {
      const open = this.pendingConfirms[0];
      logCallback(req.kind, req.player, 'late_rival');
      return { action: 'late_rival', player: req.player, kind: req.kind, expected: open?.player };
    }
    return null;
  }

  executeDeferred(bot, logCallback) {
    const pending = this.pendingDeferred;
    this.pendingDeferred = null;
    if (!pending) return null;

    const now = Date.now();
    const ttlMs = this.requestTtlS * 1000;
    this.queue = this.queue.filter(r => now - r.ts < ttlMs);
    this.seenRequests = this.seenRequests.filter(r => now - r.ts < ttlMs);

    // Any other player's live request = rival → deny (never guess).
    const rivals = this.seenRequests.some(r => r.player.toLowerCase() !== pending.player.toLowerCase());
    if (rivals) {
      logCallback(pending.kind, pending.player, 'frozen_mixed_queue');
      return { action: 'frozen_mixed_queue', player: pending.player, kind: pending.kind };
    }

    if (this.canAccept(pending.player)) {
      bot.chat(this.acceptCmd.replaceAll('{player}', pending.player));
      this.accepts.push(now);
      this.cooldowns.set(pending.player, now + this.playerCooldownS * 1000);
      this.queue = this.queue.filter(r => r.player.toLowerCase() !== pending.player.toLowerCase());
      this.pendingConfirms.push({
        player: pending.player,
        kind: pending.kind,
        expiresAt: now + this.confirmWindowMs,
      });
      logCallback(pending.kind, pending.player, 'accepted_deferred');
      this.scheduleDenyOthers(bot, logCallback);
      return { action: 'accepted_deferred', player: pending.player, kind: pending.kind };
    }
    logCallback(pending.kind, pending.player, 'rate_limited');
    return { action: 'rate_limited', player: pending.player, kind: pending.kind };
  }

  scheduleDenyOthers(bot, logCallback) {
    if (!this.denyOthersOnAccept) return;
    setTimeout(() => {
      const now = Date.now();
      const ttlMs = this.requestTtlS * 1000;
      const rivals = this.seenRequests.filter(r => now - r.ts < ttlMs);
      if (!rivals.length) return;
      for (const r of rivals) {
        bot.chat(this.denyCmd);
        logCallback('tpa', r.player, 'denied_rival');
      }
      this.seenRequests = [];
    }, this.denyWaitMs);
  }

  canAccept(player) {
    const now = Date.now();
    this.accepts = this.accepts.filter(t => now - t < 60000);
    if (this.accepts.length >= this.maxAcceptsPerMin) return false;
    const cd = this.cooldowns.get(player);
    if (cd && cd > now) return false;
    return true;
  }

  updateConfig(opts) {
    if (opts.requestTtlS) this.requestTtlS = opts.requestTtlS;
    if (opts.maxAcceptsPerMin) this.maxAcceptsPerMin = opts.maxAcceptsPerMin;
    if (opts.playerCooldownS) this.playerCooldownS = opts.playerCooldownS;
    if (opts.allowTpahereFrom) this.allowTpahereFrom = opts.allowTpahereFrom;
    if (opts.freezeSeconds !== undefined) this.freezeSeconds = opts.freezeSeconds;
    if (opts.denyOthersOnAccept !== undefined) this.denyOthersOnAccept = !!opts.denyOthersOnAccept;
    if (opts.confirmWindowMs !== undefined) this.confirmWindowMs = opts.confirmWindowMs;
    if (opts.denyWaitMs !== undefined) this.denyWaitMs = opts.denyWaitMs;
    if (opts.acceptCmd) this.acceptCmd = opts.acceptCmd;
    if (opts.denyCmd) this.denyCmd = opts.denyCmd;
    if (opts.msgCmd) this.msgCmd = opts.msgCmd;
    if (opts.notAllowedMessage) this.notAllowedMessage = opts.notAllowedMessage;
    if (opts.rejectNonAllowlisted !== undefined) this.rejectNonAllowlisted = !!opts.rejectNonAllowlisted;
    if (opts.tpaRequest) this.tpaRequestRegex = opts.tpaRequest;
    if (opts.tpahereRequest) this.tpahereRequestRegex = opts.tpahereRequest;
    if (opts.tpaConfirm) this.tpaConfirmRegex = opts.tpaConfirm;
    if (opts.tpaDeny) this.tpaDenyRegex = opts.tpaDeny;
    if (opts.tpaExpired) this.tpaExpiredRegex = opts.tpaExpired;
  }
}
