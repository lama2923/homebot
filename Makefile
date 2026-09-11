# HomeBot — Makefile

DAEMON_DIR := daemon
UI_DIR := crates/ui
CONFIG ?= $(HOME)/.config/homebot/homebot.toml
PREFIX ?= $(HOME)/.local
SYSTEMD_DIR := $(HOME)/.config/systemd/user

.PHONY: all daemon gui install uninstall test clean run-daemon run-gui stop

all: daemon gui

daemon:
	cd $(DAEMON_DIR) && npm install

gui:
	cd $(UI_DIR) && cargo build --release

install: install-daemon install-gui install-systemd install-config

install-daemon:
	@mkdir -p $(PREFIX)/share/homebot/daemon
	@cp -r $(DAEMON_DIR)/* $(PREFIX)/share/homebot/daemon/
	@cd $(PREFIX)/share/homebot/daemon && npm install --omit=dev
	@echo "daemon installed to $(PREFIX)/share/homebot/daemon"

install-gui:
	@mkdir -p $(PREFIX)/bin
	@cd $(UI_DIR) && cargo build --release
	@cp $(UI_DIR)/target/release/homebot-ui $(PREFIX)/bin/homebot-ui
	@echo "GUI installed to $(PREFIX)/bin/homebot-ui"

install-config:
	@mkdir -p $(HOME)/.config/homebot
	@if [ ! -f $(HOME)/.config/homebot/homebot.toml ]; then \
		cp config.example.toml $(HOME)/.config/homebot/homebot.toml; \
		echo "config installed to $(HOME)/.config/homebot/homebot.toml"; \
	else \
		echo "config already exists, skipping"; \
	fi

install-systemd:
	@mkdir -p $(SYSTEMD_DIR)
	@cp systemd/homebotd.service $(SYSTEMD_DIR)/
	@systemctl --user daemon-reload
	@echo "systemd service installed, run: systemctl --user enable homebotd"

uninstall:
	@rm -rf $(PREFIX)/share/homebot $(PREFIX)/bin/homebot-ui
	@rm -f $(SYSTEMD_DIR)/homebotd.service
	@systemctl --user daemon-reload
	@echo "uninstalled"

run-daemon:
	node $(DAEMON_DIR)/src/main.js --config $(CONFIG)

run-gui:
	cd $(UI_DIR) && cargo run

stop:
	@pkill -f 'node.*main.js' 2>/dev/null || true
	@systemctl --user stop homebotd 2>/dev/null || true

test:
	@echo "Running daemon syntax checks..."
	@for f in $(DAEMON_DIR)/src/*.js; do node --check $$f || exit 1; done
	@echo "Running E2E tests..."
	@if [ -f tests/e2e.sh ]; then chmod +x tests/e2e.sh && ./tests/e2e.sh; fi

clean:
	@rm -rf $(UI_DIR)/target $(DAEMON_DIR)/node_modules
	@echo "cleaned"
