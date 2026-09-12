use std::collections::HashMap;
use std::fs;

use homebot_protocol::{Request, Response};
use iced::widget::{button, column, container, pick_list, row, scrollable, text, text_input, Space, toggler};
use iced::{Element, Length, Subscription, Task, Theme};

fn main() -> iced::Result {
    iced::application("HomeBot", HomeBotUi::update, HomeBotUi::view)
        .subscription(HomeBotUi::subscription)
        .theme(|app| if app.dark_mode { Theme::Dark } else { Theme::Light })
        .run()
}

// ─── I18n ───────────────────────────────────────────────
/// Interface languages (TR intentionally last). New language = new variant,
/// a row extension in `T`, and entries in LANGS.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    En,
    De,
    Es,
    Fr,
    Ru,
    Tr,
}

pub const LANGS: [(&str, &str); 6] = [
    ("en", "English"),
    ("de", "Deutsch"),
    ("es", "Español"),
    ("fr", "Français"),
    ("ru", "Русский"),
    ("tr", "Türkçe"),
];

impl std::fmt::Display for Lang {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.label())
    }
}

impl Lang {
    pub const ALL: [Lang; 6] = [Lang::En, Lang::De, Lang::Es, Lang::Fr, Lang::Ru, Lang::Tr];

    pub fn index(&self) -> usize {
        match self { Lang::En => 0, Lang::De => 1, Lang::Es => 2, Lang::Fr => 3, Lang::Ru => 4, Lang::Tr => 5 }
    }

    pub fn label(&self) -> &'static str {
        LANGS[self.index()].1
    }

    pub fn code(&self) -> &'static str {
        LANGS[self.index()].0
    }

    pub fn from_code(code: &str) -> Lang {
        match code { "de" => Lang::De, "es" => Lang::Es, "fr" => Lang::Fr, "ru" => Lang::Ru, "tr" => Lang::Tr, _ => Lang::En }
    }

    pub fn t(&self, key: &str) -> &'static str {
        const T: &[(&str, [&str; 6])] = &[
            ("app_title", ["HomeBot", "HomeBot", "HomeBot", "HomeBot", "HomeBot", "HomeBot"]),
            ("connect", ["Connect", "Verbinden", "Conectar", "Connexion", "Подключить", "Bağlan"]),
            ("connected", ["Connected", "Verbunden", "Conectado", "Connecté", "Подключено", "Bağlandı"]),
            ("connecting", ["Connecting...", "Verbinde...", "Conectando...", "Connexion...", "Подключение...", "Bağlanıyor..."]),
            ("not_connected", ["Not connected", "Nicht verbunden", "Sin conexión", "Non connecté", "Нет подключения", "Bağlı değil"]),
            ("socket_unreachable", ["socket unreachable", "Socket nicht erreichbar", "socket inaccesible", "socket inaccessible", "сокет недоступен", "sokete ulaşılamadı"]),
            ("dark", ["Dark", "Dunkel", "Oscuro", "Sombre", "Тёмная", "Koyu"]),
            ("tab_bots", ["Bots", "Bots", "Bots", "Bots", "Боты", "Botlar"]),
            ("tab_allowlist", ["Allowlist", "Whitelist", "Lista permitida", "Autorisations", "Белый список", "İzin listesi"]),
            ("tab_logs", ["Logs", "Protokolle", "Registros", "Journaux", "Журналы", "Kayıtlar"]),
            ("tab_settings", ["Settings", "Einstellungen", "Ajustes", "Paramètres", "Настройки", "Ayarlar"]),
            ("tab_detail", ["Detail", "Details", "Detalle", "Détails", "Детали", "Detay"]),
            ("create_new_bot", ["Create New Bot", "Neuen Bot erstellen", "Crear nuevo bot", "Créer un bot", "Создать бота", "Yeni Bot Oluştur"]),
            ("name", ["Name", "Name", "Nombre", "Nom", "Имя", "İsim"]),
            ("host", ["Host", "Server", "Servidor", "Serveur", "Сервер", "Sunucu"]),
            ("port", ["Port", "Port", "Puerto", "Port", "Порт", "Port"]),
            ("password", ["Password", "Passwort", "Contraseña", "Mot de passe", "Пароль", "Şifre"]),
            ("create", ["Create", "Erstellen", "Crear", "Créer", "Создать", "Oluştur"]),
            ("state", ["State", "Status", "Estado", "État", "Состояние", "Durum"]),
            ("spawn", ["Spawn", "Spawn", "Spawn", "Spawn", "Спавн", "Doğma"]),
            ("actions", ["Actions", "Aktionen", "Acciones", "Actions", "Действия", "İşlemler"]),
            ("remove", ["Remove", "Entfernen", "Quitar", "Supprimer", "Удалить", "Kaldır"]),
            ("enable", ["Enable", "Aktivieren", "Activar", "Activer", "Включить", "Etkinleştir"]),
            ("disable", ["Disable", "Deaktivieren", "Desactivar", "Désactiver", "Отключить", "Devre dışı"]),
            ("name_password_required", ["Name and password required", "Name und Passwort erforderlich", "Se requieren nombre y contraseña", "Nom et mot de passe requis", "Требуются имя и пароль", "İsim ve şifre gerekli"]),
            ("creating", ["Creating", "Erstelle", "Creando", "Création", "Создание", "Oluşturuluyor"]),
            ("create_error", ["Create error", "Erstellungsfehler", "Error al crear", "Erreur de création", "Ошибка создания", "Oluşturma hatası"]),
            ("remove_error", ["Remove error", "Entfernungsfehler", "Error al quitar", "Erreur de suppression", "Ошибка удаления", "Kaldırma hatası"]),
            ("error", ["Error", "Fehler", "Error", "Erreur", "Ошибка", "Hata"]),
            ("bots", ["Bots", "Bots", "Bots", "Bots", "Боты", "Botlar"]),
            ("select_bot_hint", ["Select a bot from the Bots tab", "Wähle einen Bot im Bots-Tab", "Elige un bot en la pestaña Bots", "Choisis un bot dans l'onglet Bots", "Выберите бота на вкладке «Боты»", "Botlar sekmesinden bir bot seçin"]),
            ("bot_detail", ["Bot Detail", "Botdetails", "Detalle del bot", "Détails du bot", "Детали бота", "Bot Detayı"]),
            ("loading", ["Loading...", "Lade...", "Cargando...", "Chargement...", "Загрузка...", "Yükleniyor..."]),
            ("not_set", ["not set", "nicht gesetzt", "sin definir", "non défini", "не задано", "ayarlanmadı"]),
            ("send_command", ["Send Command", "Befehl senden", "Enviar comando", "Envoyer une commande", "Отправить команду", "Komut Gönder"]),
            ("command_hint", ["/command or message", "Befehl oder Nachricht", "comando o mensaje", "commande ou message", "команда или сообщение", "/komut veya mesaj"]),
            ("send", ["Send", "Senden", "Enviar", "Envoyer", "Отправить", "Gönder"]),
            ("command_sent", ["Command sent", "Befehl gesendet", "Comando enviado", "Commande envoyée", "Команда отправлена", "Komut gönderildi"]),
            ("tpa_to_player", ["TPA To Player", "TPA an Spieler", "TPA a jugador", "TPA vers joueur", "TPA к игроку", "Oyuncuya TPA"]),
            ("player_name", ["player name", "Spielername", "nombre del jugador", "nom du joueur", "имя игрока", "oyuncu adı"]),
            ("send_tpa", ["Send TPA", "TPA senden", "Enviar TPA", "Envoyer TPA", "Отправить TPA", "TPA Gönder"]),
            ("tpa_sent", ["TPA sent", "TPA gesendet", "TPA enviado", "TPA envoyé", "TPA отправлен", "TPA gönderildi"]),
            ("bed_register", ["Bed Register", "Bett registrieren", "Registrar cama", "Enregistrer lit", "Регистрация кровати", "Yatak Kaydı"]),
            ("radius", ["radius", "Radius", "radio", "rayon", "радиус", "yarıçap"]),
            ("register_bed", ["Register Bed", "Bett registrieren", "Registrar cama", "Enregistrer le lit", "Зарегистрировать кровать", "Yatak Kaydet"]),
            ("bed_register_sent", ["Bed register sent", "Bett registriert", "Cama registrada", "Lit enregistré", "Кровать зарегистрирована", "Yatak kaydı gönderildi"]),
            ("chat_log", ["Chat Log", "Chat-Protokoll", "Registro de chat", "Journal de chat", "Журнал чата", "Sohbet Kaydı"]),
            ("no_chat_events", ["No chat events", "Keine Chat-Ereignisse", "Sin eventos de chat", "Aucun événement de chat", "Нет событий чата", "Sohbet olayı yok"]),
            ("back_to_list", ["Back to List", "Zur Liste", "Volver a la lista", "Retour à la liste", "Назад к списку", "Listeye Dön"]),
            ("status_error", ["Status error", "Statusfehler", "Error de estado", "Erreur d'état", "Ошибка статуса", "Durum hatası"]),
            ("allowlist_editor", ["Allowlist Editor", "Whitelist-Editor", "Editor de lista", "Éditeur de liste", "Редактор списка", "İzin Listesi Düzenleyici"]),
            ("global_allowlist", ["Global allowlist", "Globale Whitelist", "Lista global", "Liste globale", "Глобальный список", "Genel izin listesi"]),
            ("bot_allowlist", ["allowlist", "Whitelist", "lista", "liste", "список", "izin listesi"]),
            ("bot_filter_hint", ["bot filter (empty=global)", "Bot-Filter (leer=global)", "filtro de bot (vacío=global)", "filtre de bot (vide=global)", "фильтр бота (пусто=глобальный)", "bot filtresi (boş=genel)"]),
            ("add", ["Add", "Hinzufügen", "Añadir", "Ajouter", "Добавить", "Ekle"]),
            ("refresh", ["Refresh", "Aktualisieren", "Actualizar", "Rafraîchir", "Обновить", "Yenile"]),
            ("added", ["Added", "Hinzugefügt", "Añadido", "Ajouté", "Добавлено", "Eklendi"]),
            ("removed", ["Removed", "Entfernt", "Quitado", "Supprimé", "Удалено", "Kaldırıldı"]),
            ("entries", ["entries", "Einträge", "entradas", "entrées", "записей", "kayıt"]),
            ("no_entries", ["No entries — add a player above", "Keine Einträge — oben Spieler hinzufügen", "Sin entradas — añade un jugador arriba", "Aucune entrée — ajoute un joueur ci-dessus", "Нет записей — добавьте игрока выше", "Kayıt yok — yukarıdan oyuncu ekleyin"]),
            ("allowlist_error", ["Allowlist error", "Whitelist-Fehler", "Error de lista", "Erreur de liste", "Ошибка списка", "İzin listesi hatası"]),
            ("log_type", ["Log type:", "Protokolltyp:", "Tipo de registro:", "Type de journal :", "Тип журнала:", "Kayıt türü:"]),
            ("bot_filter", ["Bot filter:", "Bot-Filter:", "Filtro de bot:", "Filtre de bot :", "Фильтр бота:", "Bot filtresi:"]),
            ("all_bots", ["(all bots)", "(alle Bots)", "(todos los bots)", "(tous les bots)", "(все боты)", "(tüm botlar)"]),
            ("events", ["Events", "Ereignisse", "Eventos", "Événements", "События", "Olaylar"]),
            ("tpa", ["TPA", "TPA", "TPA", "TPA", "TPA", "TPA"]),
            ("no_logs", ["No logs", "Keine Protokolle", "Sin registros", "Aucun journal", "Нет журналов", "Kayıt yok"]),
            ("logs_error", ["Logs error", "Protokollfehler", "Error de registros", "Erreur de journal", "Ошибка журналов", "Kayıt hatası"]),
            ("settings_title", ["Settings — homebot.toml", "Einstellungen — homebot.toml", "Ajustes — homebot.toml", "Paramètres — homebot.toml", "Настройки — homebot.toml", "Ayarlar — homebot.toml"]),
            ("config_path", ["Config path:", "Konfigurationspfad:", "Ruta de configuración:", "Chemin de config :", "Путь к конфигу:", "Yapılandırma yolu:"]),
            ("read_config", ["Read", "Lesen", "Leer", "Lire", "Читать", "Oku"]),
            ("write_config", ["Write", "Schreiben", "Escribir", "Écrire", "Записать", "Yaz"]),
            ("config_read", ["Config read", "Konfiguration gelesen", "Configuración leída", "Config lue", "Конфигурация прочитана", "Yapılandırma okundu"]),
            ("config_written", ["Config written", "Konfiguration geschrieben", "Configuración escrita", "Config écrite", "Конфигурация записана", "Yapılandırma yazıldı"]),
            ("config_read_error", ["Config read error", "Lesefehler", "Error al leer", "Erreur de lecture", "Ошибка чтения", "Yapılandırma okuma hatası"]),
            ("config_write_error", ["Config write error", "Schreibfehler", "Error al escribir", "Erreur d'écriture", "Ошибка записи", "Yapılandırma yazma hatası"]),
            ("sec_general", ["General", "Allgemein", "General", "Général", "Общее", "Genel"]),
            ("sec_antiafk", ["Anti-AFK", "Anti-AFK", "Anti-AFK", "Anti-AFK", "Анти-АФК", "Anti-AFK"]),
            ("sec_tpa", ["TPA", "TPA", "TPA", "TPA", "TPA", "TPA"]),
            ("sec_tpaguard", ["TPA Guard", "TPA-Schutz", "Protección TPA", "Protection TPA", "Защита TPA", "TPA Koruması"]),
            ("locale", ["Locale", "Sprache", "Idioma", "Langue", "Язык", "Dil"]),
            ("db_path", ["DB path", "DB-Pfad", "Ruta de DB", "Chemin DB", "Путь к БД", "DB yolu"]),
            ("socket_path_cfg", ["Socket path", "Socket-Pfad", "Ruta del socket", "Chemin du socket", "Путь к сокету", "Soket yolu"]),
            ("log_level", ["Log level", "Log-Level", "Nivel de log", "Niveau de log", "Уровень журнала", "Kayıt seviyesi"]),
            ("min_s", ["min (s)", "min (s)", "mín (s)", "min (s)", "мин (с)", "min (sn)"]),
            ("max_s", ["max (s)", "max (s)", "máx (s)", "max (s)", "макс (с)", "max (sn)"]),
            ("request_ttl_s", ["request TTL (s)", "TTL (s)", "TTL de solicitud (s)", "TTL de requête (s)", "TTL запроса (с)", "istek TTL (sn)"]),
            ("max_accepts_per_min", ["max accepts/min", "max. Annahmen/min", "aceptaciones máx/min", "acceptations max/min", "макс. принятий/мин", "kabul/dk"]),
            ("player_cooldown_s", ["player cooldown (s)", "Spieler-Cooldown (s)", "enfriamiento (s)", "temps d'attente (s)", "кулдаун игрока (с)", "oyuncu bekleme (sn)"]),
            ("freeze_seconds", ["freeze (s)", "Einfrieren (s)", "congelar (s)", "gel (s)", "заморозка (с)", "donma (sn)"]),
            ("deny_others_on_accept", ["deny others after accept", "andere ablehnen nach Annahme", "denegar a otros tras aceptar", "refuser les autres après accept", "отклонять остальных после принятия", "kabulden sonra diğerlerini reddet"]),
            ("deny_wait_ms", ["deny wait (ms)", "Ablehnungswarte (ms)", "espera de rechazo (ms)", "attente refus (ms)", "ожидание отказа (мс)", "ret bekleme (ms)"]),
            ("confirm_window_ms", ["confirm window (ms)", "Bestätigungsfenster (ms)", "ventana de confirmación (ms)", "fenêtre de confirmation (ms)", "окно подтверждения (мс)", "onay penceresi (ms)"]),
            ("allow_tpahere_from", ["allow /tpahere from", "/tpahere erlauben von", "permitir /tpahere de", "autoriser /tpahere de", "разрешить /tpahere от", "/tpahere izinli"]),
            ("socket_path_label", ["socket path", "Socket-Pfad", "ruta del socket", "chemin du socket", "путь к сокету", "soket yolu"]),
        ];
        let i = self.index();
        T.iter().find(|(k, _)| *k == key).map(|(_, v)| v[i]).unwrap_or("")
    }
}

#[derive(Debug, Clone)]
pub struct I18n {
    strings: HashMap<String, String>,
}

const EN_TOML: &str = include_str!("../../../locales/en.toml");
const DE_TOML: &str = include_str!("../../../locales/de.toml");
const ES_TOML: &str = include_str!("../../../locales/es.toml");
const FR_TOML: &str = include_str!("../../../locales/fr.toml");
const RU_TOML: &str = include_str!("../../../locales/ru.toml");
const TR_TOML: &str = include_str!("../../../locales/tr.toml");

fn parse_locale(content: &str) -> HashMap<String, String> {
    let mut strings = HashMap::new();
    if let Ok(toml) = toml::from_str::<toml::Value>(content) {
        if let toml::Value::Table(table) = toml {
            for (k, v) in table {
                if let toml::Value::String(s) = v {
                    strings.insert(k, s);
                }
            }
        }
    }
    strings
}

impl I18n {
    pub fn load(lang: Lang) -> Self {
        // EN is always the base: any key missing from a locale file falls
        // back to English instead of rendering empty.
        let mut strings = parse_locale(EN_TOML);
        if lang.code() != "en" {
            let embedded = match lang.code() {
                "de" => DE_TOML,
                "es" => ES_TOML,
                "fr" => FR_TOML,
                "ru" => RU_TOML,
                "tr" => TR_TOML,
                _ => EN_TOML,
            };
            for (k, v) in parse_locale(embedded) {
                strings.insert(k, v);
            }
        }
        // Optional runtime override: <cwd>/locales/<code>.toml wins if present.
        let path = format!("locales/{}.toml", lang.code());
        if let Ok(content) = fs::read_to_string(&path) {
            for (k, v) in parse_locale(&content) {
                strings.insert(k, v);
            }
        }
        Self { strings }
    }

    pub fn t(&self, key: &str) -> &str {
        self.strings.get(key).map(|s| s.as_str()).unwrap_or("")
    }
}

// ─── Views ─────────────────────────────────────────────
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tab {
    Bots,
    BotDetail,
    Allowlist,
    Logs,
    Settings,
}

// ─── Messages ──────────────────────────────────────────
#[derive(Debug, Clone)]
struct BotInfo {
    name: String,
    host: String,
    port: u16,
    state: String,
    spawn_set: bool,
    spawn_x: f64,
    spawn_y: f64,
    spawn_z: f64,
}

#[derive(Debug, Clone)]
enum Message {
    // global
    TabChanged(Tab),
    SocketPathChanged(String),
    ConnectPressed,
    Connected,
    Tick,
    DarkModeToggled(bool),
    Status(String),
    // bots
    BotListPressed,
    BotSelected(String),
    BotCreatePressed,
    BotNameChanged(String),
    BotHostChanged(String),
    BotPortChanged(String),
    BotPasswordChanged(String),
    BotRemovePressed(String),
    BotEnablePressed(String),
    BotDisablePressed(String),
    BotListRefreshed(Result<Vec<BotInfo>, String>),
    // bot detail
    DetailCommandChanged(String),
    DetailSendCommand,
    DetailTpaPlayerChanged(String),
    DetailTpaSend,
    DetailBedRadiusChanged(String),
    DetailBedRegister,
    DetailStatusRefreshed(Result<BotInfo, String>),
    // allowlist
    AllowlistPlayerChanged(String),
    AllowlistBotChanged(String),
    AllowlistAddPressed,
    AllowlistRemovePressed(String),
    AllowlistRefreshPressed,
    AllowlistRefreshed(Result<Vec<String>, String>),
    // settings
    // logs
    LogsRefreshed(Result<Vec<LogEntry>, String>),
    LogsTypeChanged(LogType),
    LogsBotFilterChanged(String),
    // settings
    LangChanged(Lang),
    ConfigPathChanged(String),
    ConfigReadPressed,
    ConfigWritePressed,
    ConfigReadDone(Result<ConfigState, String>),
    ConfigWriteDone(Result<bool, String>),
    CfgGeneralChanged(&'static str, String),
    CfgAntiafkChanged(&'static str, String),
    CfgTpaChanged(&'static str, String),
    CfgTpaguardChanged(String),
    // events
    EventReceived(String),
}

/// Editable view of homebot.toml. Read with `toml`, written back
/// preserving unknown sections (e.g. auth_profiles regex tables).
#[derive(Debug, Clone, Default)]
struct ConfigState {
    // [general]
    locale: String,
    db_path: String,
    socket_path: String,
    log_level: String,
    // [antiafk]
    antiafk_min_s: String,
    antiafk_max_s: String,
    // [tpa]
    tpa_request_ttl_s: String,
    tpa_max_accepts_per_min: String,
    tpa_player_cooldown_s: String,
    tpa_freeze_seconds: String,
    tpa_deny_others_on_accept: String,
    tpa_deny_wait_ms: String,
    tpa_confirm_window_ms: String,
    // [tpaguard]
    allow_tpahere_from: String,
    // raw full document — kept so unknown sections survive a write
    raw: String,
}

impl ConfigState {
    fn from_toml_str(raw: &str) -> Result<Self, String> {
        let val: toml::Value = toml::from_str(raw).map_err(|e| e.to_string())?;
        let get = |sec: &str, key: &str| -> String {
            val.get(sec)
                .and_then(|s| s.get(key))
                .map(|v| match v {
                    toml::Value::String(s) => s.clone(),
                    toml::Value::Integer(i) => i.to_string(),
                    toml::Value::Float(f) => f.to_string(),
                    toml::Value::Boolean(b) => b.to_string(),
                    other => other.to_string(),
                })
                .unwrap_or_default()
        };
        let arr = val.get("tpaguard")
            .and_then(|s| s.get("allow_tpahere_from"))
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect::<Vec<_>>().join(", "))
            .unwrap_or_default();
        Ok(ConfigState {
            locale: get("general", "locale"),
            db_path: get("general", "db_path"),
            socket_path: get("general", "socket_path"),
            log_level: get("general", "log_level"),
            antiafk_min_s: get("antiafk", "min_s"),
            antiafk_max_s: get("antiafk", "max_s"),
            tpa_request_ttl_s: get("tpa", "request_ttl_s"),
            tpa_max_accepts_per_min: get("tpa", "max_accepts_per_min"),
            tpa_player_cooldown_s: get("tpa", "player_cooldown_s"),
            tpa_freeze_seconds: get("tpa", "freeze_seconds"),
            tpa_deny_others_on_accept: get("tpa", "deny_others_on_accept"),
            tpa_deny_wait_ms: get("tpa", "deny_wait_ms"),
            tpa_confirm_window_ms: get("tpa", "confirm_window_ms"),
            allow_tpahere_from: arr,
            raw: raw.to_string(),
        })
    }

    /// Serialize back to TOML. Unknown sections (auth_profiles etc.) are
    /// preserved from the raw document; the editable keys override only
    /// the values the GUI edits.
    fn to_toml_str(&self) -> String {
        let mut val: toml::Value = toml::from_str(&self.raw).unwrap_or_else(|_| toml::Value::Table(toml::Table::new()));
        let table = val.as_table_mut().expect("toml root must be a table");
        let set = |t: &mut toml::Table, sec: &str, key: &str, v: &str| {
            let entry = t.entry(sec).or_insert_with(|| toml::Value::Table(toml::Table::new()));
            if let toml::Value::Table(st) = entry {
                // keep numbers numeric where the key is numeric
                if let Ok(i) = v.parse::<i64>() {
                    st.insert(key.into(), toml::Value::Integer(i));
                } else if v.is_empty() {
                    st.remove(key);
                } else {
                    st.insert(key.into(), toml::Value::String(v.into()));
                }
            }
        };
        if !self.locale.is_empty() { set(table, "general", "locale", &self.locale); }
        if !self.db_path.is_empty() { set(table, "general", "db_path", &self.db_path); }
        if !self.socket_path.is_empty() { set(table, "general", "socket_path", &self.socket_path); }
        if !self.log_level.is_empty() { set(table, "general", "log_level", &self.log_level); }
        set(table, "antiafk", "min_s", &self.antiafk_min_s);
        set(table, "antiafk", "max_s", &self.antiafk_max_s);
        set(table, "tpa", "request_ttl_s", &self.tpa_request_ttl_s);
        set(table, "tpa", "max_accepts_per_min", &self.tpa_max_accepts_per_min);
        set(table, "tpa", "player_cooldown_s", &self.tpa_player_cooldown_s);
        set(table, "tpa", "freeze_seconds", &self.tpa_freeze_seconds);
        set(table, "tpa", "deny_others_on_accept", &self.tpa_deny_others_on_accept);
        set(table, "tpa", "deny_wait_ms", &self.tpa_deny_wait_ms);
        set(table, "tpa", "confirm_window_ms", &self.tpa_confirm_window_ms);
        if let toml::Value::Table(st) = table.entry("tpaguard").or_insert_with(|| toml::Value::Table(toml::Table::new())) {
            let list: Vec<toml::Value> = self.allow_tpahere_from
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .map(toml::Value::String)
                .collect();
            st.insert("allow_tpahere_from".into(), toml::Value::Array(list));
        }
        toml::to_string(&val).unwrap_or_default()
    }
}

pub fn default_config_path() -> String {
    dirs::home_dir()
        .map(|h| h.join(".config/homebot/homebot.toml").to_string_lossy().to_string())
        .unwrap_or_else(|| "~/.config/homebot/homebot.toml".into())
}

pub fn default_socket_path() -> String {
    dirs::home_dir()
        .map(|h| h.join(".local/share/homebot/homebotd.sock").to_string_lossy().to_string())
        .unwrap_or_else(|| "~/.local/share/homebot/homebotd.sock".into())
}

#[derive(Debug, Clone)]
struct LogEntry {
    id: i64,
    bot: Option<String>,
    level: String,
    message: String,
    ts: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LogType {
    Events,
    Tpa,
}

#[derive(Debug, Clone)]

// ─── State ─────────────────────────────────────────────
struct HomeBotUi {
    socket_path: String,
    connected: bool,
    dark_mode: bool,
    tab: Tab,
    status_line: String,
    lang: Lang,
    i18n: I18n,
    // bots
    bots: Vec<BotInfo>,
    selected_bot: String,
    new_bot_name: String,
    new_bot_host: String,
    new_bot_port: String,
    new_bot_password: String,
    // bot detail
    detail_command: String,
    detail_tpa_player: String,
    detail_bed_radius: String,
    detail_bot: Option<BotInfo>,
    // allowlist
    allowlist: Vec<String>,
    allowlist_player: String,
    allowlist_bot: String,
    // settings
    // logs
    logs: Vec<LogEntry>,
    log_type: LogType,
    logs_bot_filter: String,
    // settings
    config_path: String,
    cfg: ConfigState,
    // events
    events: Vec<String>,
    chat_log: Vec<String>,
}

impl Default for HomeBotUi {
    fn default() -> Self {
        Self {
            socket_path: default_socket_path(),
            connected: false,
            dark_mode: true,
            tab: Tab::Bots,
            status_line: "Not connected".into(),
            bots: Vec::new(),
            selected_bot: String::new(),
            new_bot_name: String::new(),
            new_bot_host: "127.0.0.1".into(),
            new_bot_port: "25565".into(),
            new_bot_password: String::new(),
            detail_command: String::new(),
            detail_tpa_player: String::new(),
            detail_bed_radius: "3".into(),
            detail_bot: None,
            allowlist: Vec::new(),
            allowlist_player: String::new(),
            allowlist_bot: String::new(),
            logs: Vec::new(),
            log_type: LogType::Events,
            logs_bot_filter: String::new(),
            lang: Lang::En,
            i18n: I18n::load(Lang::En),
            config_path: default_config_path(),
            cfg: ConfigState::default(),
            events: Vec::new(),
            chat_log: Vec::new(),
        }
    }
}

impl HomeBotUi {
    fn new() -> Self { Self::default() }

    // ─── Update ────────────────────────────────────────
    fn update(&mut self, msg: Message) -> Task<Message> {
        match msg {
            // global
            Message::TabChanged(t) => {
                self.tab = t;
                return match t {
                    Tab::Bots => self.refresh_bots(),
                    Tab::BotDetail => self.refresh_detail(),
                    Tab::Allowlist => self.refresh_allowlist(),
                    Tab::Logs => self.refresh_logs(),
                    Tab::Settings => Task::none(),
                };
            }
            Message::SocketPathChanged(p) => self.socket_path = p,
            Message::ConnectPressed => {
                self.status_line = "Connecting...".into();
                let sock = self.socket_path.clone();
                return Task::perform(async move { check_socket(&sock).await }, |ok| {
                    if ok { Message::Connected } else { Message::Status("socket unreachable".into()) }
                });
            }
            Message::Connected => {
                self.connected = true;
                self.status_line = "Connected".into();
                return self.refresh_bots();
            }
            Message::Tick => {
                if self.connected {
                    return match self.tab {
                        Tab::Bots => self.refresh_bots(),
                        Tab::BotDetail => self.refresh_detail(),
                        _ => Task::none(),
                    };
                }
            }
            Message::DarkModeToggled(v) => self.dark_mode = v,
            Message::Status(s) => self.status_line = s,

            // bots
            Message::BotListPressed => return self.refresh_bots(),
            Message::BotSelected(name) => {
                self.selected_bot = name.clone();
                self.tab = Tab::BotDetail;
                return self.refresh_detail();
            }
            Message::BotCreatePressed => {
                let name = self.new_bot_name.clone();
                if name.is_empty() || self.new_bot_password.is_empty() {
                    self.status_line = "Name and password required".into();
                    return Task::none();
                }
                let host = self.new_bot_host.clone();
                let port: u64 = self.new_bot_port.parse().unwrap_or(25565);
                let password = self.new_bot_password.clone();
                let sock = self.socket_path.clone();
                self.status_line = format!("Creating {name}...");
                self.new_bot_name.clear();
                self.new_bot_password.clear();
                return Task::perform(
                    async move {
                        rpc_send(&sock, "bot.create", serde_json::json!({"name": name, "host": host, "port": port, "password": password})).await
                    },
                    |r| match r {
                        Ok(_) => Message::BotListPressed,
                        Err(e) => Message::Status(format!("Create error: {e}")),
                    },
                );
            }
            Message::BotNameChanged(v) => self.new_bot_name = v,
            Message::BotHostChanged(v) => self.new_bot_host = v,
            Message::BotPortChanged(v) => self.new_bot_port = v,
            Message::BotPasswordChanged(v) => self.new_bot_password = v,
            Message::BotRemovePressed(name) => {
                let sock = self.socket_path.clone();
                return Task::perform(
                    async move { rpc_send(&sock, "bot.remove", serde_json::json!({"name": name})).await },
                    |r| match r {
                        Ok(_) => Message::BotListPressed,
                        Err(e) => Message::Status(format!("Remove error: {e}")),
                    },
                );
            }
            Message::BotEnablePressed(name) => {
                let sock = self.socket_path.clone();
                return Task::perform(
                    async move { rpc_send(&sock, "bot.enable", serde_json::json!({"name": name})).await },
                    |r| match r { Ok(_) => Message::BotListPressed, Err(e) => Message::Status(e) },
                );
            }
            Message::BotDisablePressed(name) => {
                let sock = self.socket_path.clone();
                return Task::perform(
                    async move { rpc_send(&sock, "bot.disable", serde_json::json!({"name": name})).await },
                    |r| match r { Ok(_) => Message::BotListPressed, Err(e) => Message::Status(e) },
                );
            }
            Message::BotListRefreshed(Ok(bots)) => {
                self.bots = bots;
                self.status_line = format!("{} bot(s)", self.bots.len());
            }
            Message::BotListRefreshed(Err(e)) => {
                self.connected = false;
                self.status_line = format!("Error: {e}");
            }

            // bot detail
            Message::DetailCommandChanged(v) => self.detail_command = v,
            Message::DetailSendCommand => {
                let name = self.selected_bot.clone();
                let cmd = self.detail_command.clone();
                let sock = self.socket_path.clone();
                self.detail_command.clear();
                return Task::perform(
                    async move { rpc_send(&sock, "bot.command", serde_json::json!({"name": name, "text": cmd})).await },
                    |r| match r { Ok(_) => Message::Status("Command sent".into()), Err(e) => Message::Status(e) },
                );
            }
            Message::DetailTpaPlayerChanged(v) => self.detail_tpa_player = v,
            Message::DetailTpaSend => {
                let name = self.selected_bot.clone();
                let player = self.detail_tpa_player.clone();
                let sock = self.socket_path.clone();
                self.detail_tpa_player.clear();
                return Task::perform(
                    async move { rpc_send(&sock, "bot.tpa_to", serde_json::json!({"name": name, "player": player})).await },
                    |r| match r { Ok(_) => Message::Status("TPA sent".into()), Err(e) => Message::Status(e) },
                );
            }
            Message::DetailBedRadiusChanged(v) => self.detail_bed_radius = v,
            Message::DetailBedRegister => {
                let name = self.selected_bot.clone();
                let radius: u64 = self.detail_bed_radius.parse().unwrap_or(3);
                let sock = self.socket_path.clone();
                return Task::perform(
                    async move { rpc_send(&sock, "bot.bed_register", serde_json::json!({"name": name, "radius": radius})).await },
                    |r| match r { Ok(_) => Message::Status("Bed register sent".into()), Err(e) => Message::Status(e) },
                );
            }
            Message::DetailStatusRefreshed(Ok(bot)) => {
                self.detail_bot = Some(bot);
            }
            Message::DetailStatusRefreshed(Err(e)) => {
                self.status_line = format!("Status error: {e}");
            }

            // allowlist
            Message::AllowlistPlayerChanged(v) => self.allowlist_player = v,
            Message::AllowlistBotChanged(v) => self.allowlist_bot = v,
            Message::AllowlistAddPressed => {
                let player = self.allowlist_player.clone();
                if player.is_empty() { return Task::none(); }
                let bot = if self.allowlist_bot.is_empty() { None } else { Some(self.allowlist_bot.clone()) };
                let sock = self.socket_path.clone();
                self.allowlist_player.clear();
                let add_task = Task::perform(
                    async move { rpc_send(&sock, "allowlist.add", serde_json::json!({"player": player, "bot": bot})).await },
                    |r| match r { Ok(_) => Message::Status("Added".into()), Err(e) => Message::Status(e) },
                );
                let refresh_task = self.refresh_allowlist_task();
                return Task::batch([add_task, refresh_task]);
            }
            Message::AllowlistRemovePressed(player) => {
                let bot = if self.allowlist_bot.is_empty() { None } else { Some(self.allowlist_bot.clone()) };
                let sock = self.socket_path.clone();
                let rm_task = Task::perform(
                    async move { rpc_send(&sock, "allowlist.remove", serde_json::json!({"player": player, "bot": bot})).await },
                    |r| match r { Ok(_) => Message::Status("Removed".into()), Err(e) => Message::Status(e) },
                );
                let refresh_task = self.refresh_allowlist_task();
                return Task::batch([rm_task, refresh_task]);
            }
            Message::AllowlistRefreshPressed => return self.refresh_allowlist_task(),
            Message::AllowlistRefreshed(Ok(list)) => {
                self.allowlist = list;
            }
            Message::AllowlistRefreshed(Err(e)) => {
                self.status_line = format!("Allowlist error: {e}");
            }

            // logs
            Message::LogsRefreshed(Ok(logs)) => {
                self.logs = logs;
            }
            Message::LogsRefreshed(Err(e)) => {
                self.status_line = format!("Logs error: {e}");
            }
            Message::LogsTypeChanged(t) => {
                self.log_type = t;
                return self.refresh_logs();
            }
            Message::LogsBotFilterChanged(v) => self.logs_bot_filter = v,

            // settings / i18n
            Message::LangChanged(l) => {
                self.lang = l;
                self.i18n = I18n::load(l);
            }
            Message::ConfigPathChanged(p) => self.config_path = p,
            Message::ConfigReadPressed => {
                let path = self.config_path.clone();
                return Task::perform(
                    async move {
                        let raw = tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
                        ConfigState::from_toml_str(&raw)
                    },
                    Message::ConfigReadDone,
                );
            }
            Message::ConfigReadDone(Ok(cfg)) => {
                self.cfg = cfg;
                self.status_line = self.lang.t("config_read").into();
            }
            Message::ConfigReadDone(Err(e)) => {
                self.status_line = format!("{}: {e}", self.lang.t("config_read_error"));
            }
            Message::ConfigWritePressed => {
                let path = self.config_path.clone();
                let out = self.cfg.to_toml_str();
                return Task::perform(
                    async move { tokio::fs::write(&path, out).await.map(|_| true).map_err(|e| e.to_string()) },
                    Message::ConfigWriteDone,
                );
            }
            Message::ConfigWriteDone(Ok(_)) => {
                self.status_line = self.lang.t("config_written").into();
            }
            Message::ConfigWriteDone(Err(e)) => {
                self.status_line = format!("{}: {e}", self.lang.t("config_write_error"));
            }
            Message::CfgGeneralChanged(key, v) => {
                match key {
                    "locale" => self.cfg.locale = v,
                    "db_path" => self.cfg.db_path = v,
                    "socket_path" => self.cfg.socket_path = v,
                    "log_level" => self.cfg.log_level = v,
                    _ => {}
                }
            }
            Message::CfgAntiafkChanged(key, v) => {
                match key {
                    "min_s" => self.cfg.antiafk_min_s = v,
                    "max_s" => self.cfg.antiafk_max_s = v,
                    _ => {}
                }
            }
            Message::CfgTpaChanged(key, v) => {
                match key {
                    "request_ttl_s" => self.cfg.tpa_request_ttl_s = v,
                    "max_accepts_per_min" => self.cfg.tpa_max_accepts_per_min = v,
                    "player_cooldown_s" => self.cfg.tpa_player_cooldown_s = v,
                    "freeze_seconds" => self.cfg.tpa_freeze_seconds = v,
                    "deny_others_on_accept" => self.cfg.tpa_deny_others_on_accept = v,
                    "deny_wait_ms" => self.cfg.tpa_deny_wait_ms = v,
                    "confirm_window_ms" => self.cfg.tpa_confirm_window_ms = v,
                    _ => {}
                }
            }
            Message::CfgTpaguardChanged(v) => self.cfg.allow_tpahere_from = v,

            // events
            Message::EventReceived(ev) => {
                self.events.push(ev.clone());
                if self.events.len() > 100 { self.events.remove(0); }
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&ev) {
                    if let Some(result) = v.get("result") {
                        let event_bot = result.get("bot").and_then(|b| b.as_str()).unwrap_or("");
                        // Only render events of the bot currently selected in
                        // the detail view; a global feed would duplicate the
                        // same server line once per bot.
                        if self.selected_bot.is_empty() || event_bot == self.selected_bot {
                            let content = result.get("content").and_then(|c| c.as_str()).unwrap_or("");
                            let sender = result.get("sender").and_then(|s| s.as_str()).unwrap_or("");
                            let level = result.get("level").and_then(|l| l.as_str()).unwrap_or("info");
                            let msg = result.get("message").and_then(|m| m.as_str());
                            let kind = result.get("type").and_then(|t| t.as_str()).unwrap_or("");
                            if let Some(msg) = msg {
                                // Log events carry runtime noise (anti-afk,
                                // auth retries, warmups) — keep them out of
                                // the chat transcript.
                                if level != "cmd" && kind != "Log" {
                                    self.chat_log.push(format!("[{}] {}", event_bot, msg));
                                }
                            } else if !content.is_empty() {
                                if sender.is_empty() {
                                    self.chat_log.push(format!("[{}] {}", event_bot, content));
                                } else {
                                    self.chat_log.push(format!("[{}] <{}> {}", event_bot, sender, content));
                                }
                            }
                            if self.chat_log.len() > 50 { self.chat_log.remove(0); }
                        }
                    }
                }
            }
        }
        Task::none()
    }

    // ─── Tasks ─────────────────────────────────────────
    fn refresh_bots(&self) -> Task<Message> {
        let sock = self.socket_path.clone();
        Task::perform(
            async move { rpc_send(&sock, "bot.list", serde_json::json!({})).await },
            |r| match r {
                Ok(v) => {
                    let arr = v.get("result").and_then(|r| r.as_array()).cloned().unwrap_or_default();
                    let bots: Vec<BotInfo> = arr.into_iter().filter_map(|b| {
                        let spawn = b.get("spawn").cloned().unwrap_or(serde_json::Value::Null);
                        Some(BotInfo {
                            name: b.get("name")?.as_str()?.to_string(),
                            host: b.get("host")?.as_str()?.to_string(),
                            port: b.get("port")?.as_u64()? as u16,
                            state: b.get("state")?.as_str()?.to_string(),
                            spawn_set: spawn.get("set").and_then(|s| s.as_bool()).unwrap_or(false),
                            spawn_x: spawn.get("x").and_then(|s| s.as_f64()).unwrap_or(0.0),
                            spawn_y: spawn.get("y").and_then(|s| s.as_f64()).unwrap_or(0.0),
                            spawn_z: spawn.get("z").and_then(|s| s.as_f64()).unwrap_or(0.0),
                        })
                    }).collect();
                    Message::BotListRefreshed(Ok(bots))
                }
                Err(e) => Message::BotListRefreshed(Err(e)),
            },
        )
    }

    fn refresh_detail(&self) -> Task<Message> {
        if self.selected_bot.is_empty() { return Task::none(); }
        let sock = self.socket_path.clone();
        let name = self.selected_bot.clone();
        Task::perform(
            async move { rpc_send(&sock, "bot.status", serde_json::json!({"name": name})).await },
            |r| match r {
                Ok(v) => {
                    let r = v.get("result").cloned().unwrap_or(serde_json::Value::Null);
                    let spawn = r.get("spawn").cloned().unwrap_or(serde_json::Value::Null);
                    Message::DetailStatusRefreshed(Ok(BotInfo {
                        name: r.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string(),
                        host: r.get("host").and_then(|n| n.as_str()).unwrap_or("").to_string(),
                        port: r.get("port").and_then(|n| n.as_u64()).unwrap_or(0) as u16,
                        state: r.get("state").and_then(|n| n.as_str()).unwrap_or("").to_string(),
                        spawn_set: spawn.get("set").and_then(|s| s.as_bool()).unwrap_or(false),
                        spawn_x: spawn.get("x").and_then(|s| s.as_f64()).unwrap_or(0.0),
                        spawn_y: spawn.get("y").and_then(|s| s.as_f64()).unwrap_or(0.0),
                        spawn_z: spawn.get("z").and_then(|s| s.as_f64()).unwrap_or(0.0),
                    }))
                }
                Err(e) => Message::DetailStatusRefreshed(Err(e)),
            },
        )
    }

    fn refresh_allowlist(&self) -> Task<Message> {
        self.refresh_allowlist_task()
    }

    fn refresh_allowlist_task(&self) -> Task<Message> {
        let sock = self.socket_path.clone();
        let bot = if self.allowlist_bot.is_empty() { None } else { Some(self.allowlist_bot.clone()) };
        Task::perform(
            async move { rpc_send(&sock, "allowlist.list", serde_json::json!({"bot": bot})).await },
            |r| match r {
                Ok(v) => {
                    let arr = v.get("result").and_then(|r| r.as_array()).cloned().unwrap_or_default();
                    let list: Vec<String> = arr.into_iter().filter_map(|s| s.as_str().map(|s| s.to_string())).collect();
                    Message::AllowlistRefreshed(Ok(list))
                }
                Err(e) => Message::AllowlistRefreshed(Err(e)),
            },
        )
    }

    fn refresh_logs(&self) -> Task<Message> {
        let sock = self.socket_path.clone();
        let method = match self.log_type { LogType::Events => "logs.events", LogType::Tpa => "logs.tpa" };
        let bot = if self.logs_bot_filter.is_empty() { None } else { Some(self.logs_bot_filter.clone()) };
        Task::perform(
            async move { rpc_send(&sock, method, serde_json::json!({"bot": bot, "limit": 50u64})).await },
            |r| match r {
                Ok(v) => {
                    let arr = v.get("result").and_then(|r| r.as_array()).cloned().unwrap_or_default();
                    let logs: Vec<LogEntry> = arr.into_iter().filter_map(|l| {
                        Some(LogEntry {
                            id: l.get("id")?.as_i64()?,
                            bot: l.get("bot").and_then(|b| b.as_str()).map(|s| s.to_string()),
                            level: l.get("level")?.as_str()?.to_string(),
                            message: l.get("message")?.as_str()?.to_string(),
                            ts: l.get("ts")?.as_i64()?,
                        })
                    }).collect();
                    Message::LogsRefreshed(Ok(logs))
                }
                Err(e) => Message::LogsRefreshed(Err(e)),
            },
        )
    }

    // ─── View ──────────────────────────────────────────
    fn view(&self) -> Element<Message> {
        let t = |key: &str| self.i18n.t(key);

        // Top bar
        let top = row!(
            text(t("app_title")).size(20),
            Space::new(Length::Fill, 0),
            pick_list(Lang::ALL, Some(self.lang), Message::LangChanged).width(120),
            Space::new(0, 8),
            text_input(t("socket_path_label"), &self.socket_path)
                .on_input(Message::SocketPathChanged)
                .width(200),
            button(t("connect")).on_press(Message::ConnectPressed),
            toggler(self.dark_mode).label(t("dark")).on_toggle(Message::DarkModeToggled),
        )
        .spacing(8)
        .align_y(iced::Alignment::Center);

        // Tabs
        let tabs = row!(
            tab_button(t("tab_bots"), Tab::Bots, self.tab),
            tab_button(t("tab_allowlist"), Tab::Allowlist, self.tab),
            tab_button(t("tab_logs"), Tab::Logs, self.tab),
            tab_button(t("tab_settings"), Tab::Settings, self.tab),
        )
        .spacing(4);

        let status = text(&self.status_line);

        let content = match self.tab {
            Tab::Bots => self.view_bots(),
            Tab::BotDetail => self.view_bot_detail(),
            Tab::Allowlist => self.view_allowlist(),
            Tab::Logs => self.view_logs(),
            Tab::Settings => self.view_settings(),
        };

        let layout = column!(
            top,
            tabs,
            status,
            Space::new(0, 4),
            scrollable(content),
        )
        .spacing(8)
        .padding(16);

        container(layout).width(Length::Fill).height(Length::Fill).into()
    }

    // ─── View ──────────────────────────────────────────
    fn view_settings(&self) -> Element<Message> {
        let t = |key: &str| self.i18n.t(key);
        let gen_row = |label: &'static str, value: &str| -> Element<Message> {
            row!(
                text(t(label)).width(160),
                text_input(label, value)
                    .on_input(move |v| Message::CfgGeneralChanged(label, v))
                    .width(Length::Fill),
            ).spacing(8).into()
        };
        let num_row = |label: &'static str, value: &str, msg: fn(&'static str, String) -> Message| -> Element<Message> {
            row!(
                text(t(label)).width(160),
                text_input(label, value).on_input(move |v| msg(label, v)).width(120),
            ).spacing(8).into()
        };

        let general = column!(
            text(t("sec_general")).size(14),
            gen_row("locale", &self.cfg.locale),
            gen_row("db_path", &self.cfg.db_path),
            gen_row("socket_path_cfg", &self.cfg.socket_path),
            gen_row("log_level", &self.cfg.log_level),
        ).spacing(4);

        let antiafk = column!(
            text(t("sec_antiafk")).size(14),
            num_row("min_s", &self.cfg.antiafk_min_s, Message::CfgAntiafkChanged),
            num_row("max_s", &self.cfg.antiafk_max_s, Message::CfgAntiafkChanged),
        ).spacing(4);

        let tpa_sec = column!(
            text(t("sec_tpa")).size(14),
            num_row("request_ttl_s", &self.cfg.tpa_request_ttl_s, Message::CfgTpaChanged),
            num_row("max_accepts_per_min", &self.cfg.tpa_max_accepts_per_min, Message::CfgTpaChanged),
            num_row("player_cooldown_s", &self.cfg.tpa_player_cooldown_s, Message::CfgTpaChanged),
            num_row("freeze_seconds", &self.cfg.tpa_freeze_seconds, Message::CfgTpaChanged),
            num_row("deny_others_on_accept", &self.cfg.tpa_deny_others_on_accept, Message::CfgTpaChanged),
            num_row("deny_wait_ms", &self.cfg.tpa_deny_wait_ms, Message::CfgTpaChanged),
            num_row("confirm_window_ms", &self.cfg.tpa_confirm_window_ms, Message::CfgTpaChanged),
        ).spacing(4);

        let tpaguard = column!(
            text(t("sec_tpaguard")).size(14),
            row!(
                text(t("allow_tpahere_from")).width(160),
                text_input(t("allow_tpahere_from"), &self.cfg.allow_tpahere_from)
                    .on_input(Message::CfgTpaguardChanged)
                    .width(Length::Fill),
            ).spacing(8),
        ).spacing(4);

        let toolbar = row!(
            text(t("config_path")).width(140),
            text_input("homebot.toml", &self.config_path)
                .on_input(Message::ConfigPathChanged)
                .width(Length::Fill),
            button(t("read_config")).on_press(Message::ConfigReadPressed),
            button(t("write_config")).on_press(Message::ConfigWritePressed),
        ).spacing(8);

        column!(
            text(t("settings_title")).size(18),
            Space::new(0, 8),
            toolbar,
            Space::new(0, 12),
            general,
            Space::new(0, 10),
            antiafk,
            Space::new(0, 10),
            tpa_sec,
            Space::new(0, 10),
            tpaguard,
            Space::new(0, 10),
            text(t("no_entries")).size(12),
        ).spacing(4).into()
    }

    fn view_bots(&self) -> Element<Message> {
        let t = |key: &str| self.i18n.t(key);
        // Create form
        let create_form = column!(
            text(t("create_new_bot")).size(16),
            row!(
                text_input(t("name"), &self.new_bot_name).on_input(Message::BotNameChanged),
                text_input(t("host"), &self.new_bot_host).on_input(Message::BotHostChanged),
                text_input(t("port"), &self.new_bot_port).on_input(Message::BotPortChanged),
                text_input(t("password"), &self.new_bot_password).on_input(Message::BotPasswordChanged).secure(true),
                button(t("create")).on_press(Message::BotCreatePressed),
            ).spacing(6),
        ).spacing(4);

        // Bot list
        let mut bot_rows: Vec<Element<Message>> = Vec::new();
        bot_rows.push(row!(
            text(t("name")).width(120),
            text(t("host")).width(120),
            text(t("port")).width(60),
            text(t("state")).width(100),
            text(t("spawn")).width(120),
            text(t("actions")).width(160),
        ).spacing(8).into());

        for b in &self.bots {
            let spawn_text = if b.spawn_set {
                format!("({:.0},{:.0},{:.0})", b.spawn_x, b.spawn_y, b.spawn_z)
            } else {
                "-".into()
            };
            let is_active = b.state == "ACTIVE";
            let is_disabled = b.state == "DISABLED";
            let mut actions = row!(button(t("remove")).on_press(Message::BotRemovePressed(b.name.clone()))).spacing(4);
            if is_active {
                actions = actions.push(button(t("disable")).on_press(Message::BotDisablePressed(b.name.clone())));
            } else if is_disabled {
                actions = actions.push(button(t("enable")).on_press(Message::BotEnablePressed(b.name.clone())));
            }
            bot_rows.push(row!(
                button(text(format!("{}", b.name))).on_press(Message::BotSelected(b.name.clone())).width(120),
                text(format!("{}", b.host)).width(120),
                text(format!("{}", b.port)).width(60),
                text(format!("{}", b.state)).width(100),
                text(spawn_text).width(120),
                actions,
            ).spacing(8).align_y(iced::Alignment::Center).into());
        }

        let list = iced::widget::column!().extend(bot_rows);

        column!(
            create_form,
            Space::new(0, 12),
            text(t("bots")).size(16),
            list,
        ).spacing(8).into()
    }

    fn view_bot_detail(&self) -> Element<Message> {
        let t = |key: &str| self.i18n.t(key);
        if self.selected_bot.is_empty() {
            return text(t("select_bot_hint")).into();
        }
        let b = self.detail_bot.as_ref();
        let info = if let Some(b) = b {
            column!(
                row!(text(t("name")), text(&b.name)).spacing(8),
                row!(text(t("host")), text(format!("{}:{}", b.host, b.port))).spacing(8),
                row!(text(t("state")), text(&b.state)).spacing(8),
                row!(text(t("spawn")), text(if b.spawn_set {
                    format!("({:.1},{:.1},{:.1})", b.spawn_x, b.spawn_y, b.spawn_z)
                } else { t("not_set").into() })).spacing(8),
            ).spacing(4)
        } else {
            column!(text(t("loading")))
        };

        // Command panel
        let cmd_panel = column!(
            text(t("send_command")).size(14),
            row!(
                text_input(t("command_hint"), &self.detail_command)
                    .on_input(Message::DetailCommandChanged)
                    .on_submit(Message::DetailSendCommand)
                    .width(Length::Fill),
                button(t("send")).on_press(Message::DetailSendCommand),
            ).spacing(6),
        ).spacing(4);

        // TPA panel
        let tpa_panel = column!(
            text(t("tpa_to_player")).size(14),
            row!(
                text_input(t("player_name"), &self.detail_tpa_player)
                    .on_input(Message::DetailTpaPlayerChanged)
                    .on_submit(Message::DetailTpaSend)
                    .width(Length::Fill),
                button(t("send_tpa")).on_press(Message::DetailTpaSend),
            ).spacing(6),
        ).spacing(4);

        // Bed register panel
        let bed_panel = column!(
            text(t("bed_register")).size(14),
            row!(
                text_input(t("radius"), &self.detail_bed_radius)
                    .on_input(Message::DetailBedRadiusChanged)
                    .width(60),
                button(t("register_bed")).on_press(Message::DetailBedRegister),
            ).spacing(6),
        ).spacing(4);

        // Chat log panel
        let chat_rows: Vec<Element<Message>> = self.chat_log.iter().rev().take(15)
            .map(|e| text(e).into()).collect();
        let chat_panel = if chat_rows.is_empty() {
            column!(text(t("no_chat_events")))
        } else {
            iced::widget::column!().extend(chat_rows)
        };

        // Enable/Disable/Remove
        let lifecycle = row!(
            if b.map(|b| b.state == "ACTIVE").unwrap_or(false) {
                button(t("disable")).on_press(Message::BotDisablePressed(self.selected_bot.clone()))
            } else {
                button(t("enable")).on_press(Message::BotEnablePressed(self.selected_bot.clone()))
            },
            button(t("remove")).on_press(Message::BotRemovePressed(self.selected_bot.clone())),
            button(t("back_to_list")).on_press(Message::TabChanged(Tab::Bots)),
        ).spacing(6);

        column!(
            row!(text(t("bot_detail")).size(18), Space::new(Length::Fill, 0), lifecycle).align_y(iced::Alignment::Center),
            Space::new(0, 8),
            info,
            Space::new(0, 12),
            cmd_panel,
            Space::new(0, 8),
            tpa_panel,
            Space::new(0, 8),
            bed_panel,
            Space::new(0, 8),
            text(t("chat_log")).size(14),
            scrollable(chat_panel),
        ).spacing(4).into()
    }

    fn view_allowlist(&self) -> Element<Message> {
        let t = |key: &str| self.i18n.t(key);
        let scope_label: String = if self.allowlist_bot.is_empty() {
            t("global_allowlist").to_string()
        } else {
            format!("'{}' {}", self.allowlist_bot, t("bot_allowlist"))
        };

        let add_form = row!(
            text_input(t("player_name"), &self.allowlist_player)
                .on_input(Message::AllowlistPlayerChanged)
                .on_submit(Message::AllowlistAddPressed)
                .width(Length::Fill),
            text_input(t("bot_filter_hint"), &self.allowlist_bot)
                .on_input(Message::AllowlistBotChanged)
                .width(160),
            button(t("add")).on_press(Message::AllowlistAddPressed),
            button(t("refresh")).on_press(Message::AllowlistRefreshPressed),
        ).spacing(6);

        let header = row!(
            text(scope_label).size(14),
            Space::new(Length::Fill, 0),
            text(format!("{} {}", self.allowlist.len(), t("entries"))),
        ).spacing(8);

        let mut rows: Vec<Element<Message>> = Vec::new();
        for (i, p) in self.allowlist.iter().enumerate() {
            rows.push(
                row!(
                    text(format!("{:3}.", i + 1)),
                    text(p),
                    Space::new(Length::Fill, 0),
                    button(t("remove")).on_press(Message::AllowlistRemovePressed(p.clone())),
                )
                .spacing(12)
                .align_y(iced::Alignment::Center)
                .into()
            );
        }
        if rows.is_empty() {
            rows.push(text(t("no_entries")).into());
        }

        let list = iced::widget::column!().extend(rows);

        column!(
            text(t("allowlist_editor")).size(18),
            Space::new(0, 8),
            header,
            Space::new(0, 8),
            add_form,
            Space::new(0, 12),
            scrollable(list),
        ).spacing(4).into()
    }

    fn view_logs(&self) -> Element<Message> {
        let t = |key: &str| self.i18n.t(key);
        let log_type_labels = [t("events"), t("tpa")];
        let current_label = match self.log_type { LogType::Events => t("events"), LogType::Tpa => t("tpa") };

        let events_label = t("events");
        let type_picker = row!(
            text(t("log_type")),
            pick_list(log_type_labels, Some(current_label), move |v| {
                Message::LogsTypeChanged(if v == events_label { LogType::Events } else { LogType::Tpa })
            }),
            text(t("bot_filter")),
            text_input(t("all_bots"), &self.logs_bot_filter).on_input(Message::LogsBotFilterChanged),
            button(t("refresh")).on_press(Message::LogsRefreshed(Ok(vec![]))),
        ).spacing(6);

        let mut rows: Vec<Element<Message>> = Vec::new();
        for l in &self.logs {
            let bot = l.bot.as_deref().unwrap_or("-");
            rows.push(row!(
                text(format!("[{}]", l.level)).width(60),
                text(format!("{:12}", bot)).width(100),
                text(&l.message),
            ).spacing(8).into());
        }
        if rows.is_empty() { rows.push(text(t("no_logs")).into()); }

        let list = iced::widget::column!().extend(rows);

        column!(
            text(t("tab_logs")).size(18),
            Space::new(0, 8),
            type_picker,
            Space::new(0, 8),
            scrollable(list),
        ).spacing(4).into()
    }

    fn subscription(&self) -> Subscription<Message> {
        let tick = iced::time::every(std::time::Duration::from_secs(5)).map(|_| Message::Tick);

        if self.connected {
            let sock = self.socket_path.clone();
            let event_stream = Subscription::run_with_id(
                "events",
                async_stream::stream! {
                    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
                    match tokio::net::UnixStream::connect(&sock).await {
                        Ok(stream) => {
                            let (rx, mut tx) = stream.into_split();
                            let req = Request { jsonrpc: "2.0".into(), id: 0, method: "events.subscribe".into(), params: serde_json::json!({}) };
                            let mut json = serde_json::to_string(&req).unwrap_or_default();
                            json.push('\n');
                            let _ = tx.write_all(json.as_bytes()).await;
                            let _ = tx.flush().await;
                            let mut reader = BufReader::new(rx);
                            let mut line = String::new();
                            loop {
                                line.clear();
                                match reader.read_line(&mut line).await {
                                    Ok(0) => break,
                                    Ok(_) => {
                                        if !line.trim().is_empty() {
                                            yield Message::EventReceived(line.trim().to_string());
                                        }
                                    }
                                    Err(_) => break,
                                }
                            }
                        }
                        Err(_) => {}
                    }
                },
            );
            Subscription::batch([tick, event_stream])
        } else {
            tick
        }
    }
}

// ─── Helpers ───────────────────────────────────────────
fn tab_button(label: &str, tab: Tab, current: Tab) -> Element<Message> {
    if current == tab {
        button(label).on_press(Message::TabChanged(tab)).style(iced::widget::button::primary).into()
    } else {
        button(label).on_press(Message::TabChanged(tab)).into()
    }
}

async fn check_socket(path: &str) -> bool {
    tokio::net::UnixStream::connect(path).await.is_ok()
}

async fn rpc_send(socket: &str, method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let stream = tokio::net::UnixStream::connect(socket).await.map_err(|e| e.to_string())?;
    let (rx, mut tx) = stream.into_split();
    let req = Request { jsonrpc: "2.0".into(), id: 1, method: method.into(), params };
    let mut json = serde_json::to_string(&req).map_err(|e| e.to_string())?;
    json.push('\n');
    tx.write_all(json.as_bytes()).await.map_err(|e| e.to_string())?;
    tx.flush().await.map_err(|e| e.to_string())?;

    let mut reader = BufReader::new(rx);
    let mut line = String::new();
    reader.read_line(&mut line).await.map_err(|e| e.to_string())?;
    let resp: Response = serde_json::from_str(line.trim()).map_err(|e| e.to_string())?;
    serde_json::to_value(resp).map_err(|e| e.to_string())
}
