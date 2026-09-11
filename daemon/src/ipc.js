import net from 'net';
import fs from 'fs';
import { unlinkSync } from 'fs';

const JSONRPC_VERSION = '2.0';
let nextId = 1;

export class IpcServer {
  constructor(socketPath, handler) {
    this.socketPath = socketPath;
    this.handler = handler;
    this.eventSubscribers = new Set();
  }

  async start() {
    if (fs.existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }

    this.server = net.createServer((socket) => {
      let buffer = '';

      socket.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.trim()) {
            this.handleLine(socket, line.trim());
          }
        }
      });

      socket.on('end', () => {
        this.eventSubscribers.delete(socket);
      });

      socket.on('error', () => {
        this.eventSubscribers.delete(socket);
      });
    });

    await new Promise((resolve, reject) => {
      this.server.listen(this.socketPath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    fs.chmodSync(this.socketPath, 0o600);
    return this.socketPath;
  }

  close() {
    if (fs.existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }
    this.server?.close();
  }

  handleLine(socket, line) {
    let req;
    try {
      req = JSON.parse(line);
    } catch (e) {
      this.sendResponse(socket, 0, -32700, `parse error: ${e.message}`);
      return;
    }

    // events.subscribe: respond ok, then stream events
    if (req.method === 'events.subscribe') {
      this.sendResponse(socket, req.id, null, { ok: true });
      this.eventSubscribers.add(socket);
      return;
    }

    const result = this.handler(req);
    if (result instanceof Promise) {
      result.then(r => this.sendResponse(socket, req.id, null, r),
                  e => this.sendResponse(socket, req.id, -32000, e.message || String(e)));
    } else {
      this.sendResponse(socket, req.id, null, result);
    }
  }

  sendResponse(socket, id, error, result) {
    const resp = { jsonrpc: JSONRPC_VERSION, id };
    if (error) {
      resp.error = { code: error, message: typeof result === 'string' ? result : result.message };
    } else {
      resp.result = result;
    }
    socket.write(JSON.stringify(resp) + '\n');
  }

  broadcastEvent(event) {
    const msg = { jsonrpc: JSONRPC_VERSION, id: 0, result: event };
    const json = JSON.stringify(msg) + '\n';
    for (const socket of this.eventSubscribers) {
      try {
        socket.write(json);
      } catch {
        this.eventSubscribers.delete(socket);
      }
    }
  }
}
