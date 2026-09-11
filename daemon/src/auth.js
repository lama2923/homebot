// Auth profile compilation — all regex patterns live in homebot.toml,
// never in code. A missing/empty key is a fatal config error.

const REQUIRED_REGEX_KEYS = [
  'register_prompt',
  'login_prompt',
  'wrong_password',
  'already_logged',
  'already_registered',
  'tpa_request',
  'tpahere_request',
  'respawn_set',
  'tp_success',
  'bed_missing',
  'kick_banned',
  'tpa_confirm',
  'tpa_deny',
  'tpa_expired',
];

const REQUIRED_STRING_KEYS = ['register_cmd', 'login_cmd'];

// TOML double-backslash → single backslash for the RegExp compiler.
const unescape = (s) => s.replace(/\\\\/g, '\\');

/** Compile raw TOML values (strings → RegExp); throws on missing keys. */
export function compileAuthProfileFromToml(def) {
  const missing = [
    ...REQUIRED_REGEX_KEYS.filter(k => !Array.isArray(def[k]) || def[k].length === 0),
    ...REQUIRED_STRING_KEYS.filter(k => typeof def[k] !== 'string' || def[k].length === 0),
  ];
  if (missing.length) {
    throw new Error(
      `auth profile '${def.name || '?'}' is missing required TOML keys in homebot.toml: ${missing.join(', ')}`
    );
  }

  const toRegex = (arr) => {
    return arr.map(s => {
      try {
        return new RegExp(unescape(s), 'i');
      } catch (e) {
        throw new Error(`auth profile '${def.name}': invalid regex '${s}': ${e.message}`);
      }
    });
  };

  return {
    name: def.name,
    registerPrompt: toRegex(def.register_prompt),
    loginPrompt: toRegex(def.login_prompt),
    wrongPassword: toRegex(def.wrong_password),
    alreadyLogged: toRegex(def.already_logged),
    alreadyRegistered: toRegex(def.already_registered),
    registerCmd: def.register_cmd,
    loginCmd: def.login_cmd,
    tpaRequest: toRegex(def.tpa_request),
    tpahereRequest: toRegex(def.tpahere_request),
    respawnSet: toRegex(def.respawn_set),
    tpSuccess: toRegex(def.tp_success),
    tpaConfirm: toRegex(def.tpa_confirm),
    tpaDeny: toRegex(def.tpa_deny),
    tpaExpired: toRegex(def.tpa_expired),
    bedMissing: toRegex(def.bed_missing),
    kickBanned: toRegex(def.kick_banned),
  };
}
