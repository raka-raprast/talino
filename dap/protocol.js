const { spawn } = require('child_process');
const { StreamMessageReader, StreamMessageWriter } = require('vscode-jsonrpc/node');

class DapConnection {
  constructor(proc) {
    this.proc = proc;
    this.reader = new StreamMessageReader(proc.stdout);
    this.writer = new StreamMessageWriter(proc.stdin);
    this.nextSeq = 1;
    this.pending = new Map();
    this._eventHandlers = new Map();
    this._disposed = false;

    this.reader.listen((msg) => this._handle(msg));
  }

  sendRequest(command, args) {
    const seq = this.nextSeq++;
    return new Promise((resolve, reject) => {
      this.pending.set(seq, { resolve, reject });
      this.writer.write({ seq, type: 'request', command, arguments: args || {} });
    });
  }

  sendCommand(command, args) {
    const seq = this.nextSeq++;
    this.writer.write({ seq, type: 'request', command, arguments: args || {} });
  }

  onEvent(event, handler) {
    if (!this._eventHandlers.has(event)) this._eventHandlers.set(event, []);
    this._eventHandlers.get(event).push(handler);
  }

  _handle(msg) {
    if (!msg || !msg.type) return;

    if (msg.type === 'response') {
      const entry = this.pending.get(msg.request_seq);
      if (entry) {
        this.pending.delete(msg.request_seq);
        if (msg.success === false) {
          entry.reject(new Error(msg.message || `DAP request '${msg.command}' failed`));
        } else {
          entry.resolve(msg.body);
        }
      }
    } else if (msg.type === 'event') {
      const handlers = this._eventHandlers.get(msg.event);
      if (handlers) {
        for (const h of handlers) {
          try { h(msg.body || {}, msg.event); } catch (_) {}
        }
      }
    } else if (msg.type === 'request') {
      this.writer.write({
        seq: this.nextSeq++,
        type: 'response',
        request_seq: msg.seq,
        success: false,
        command: msg.command,
        message: 'not supported',
      });
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const { reject } of this.pending.values()) {
      try { reject(new Error('disposed')); } catch (_) {}
    }
    this.pending.clear();
    try { this.reader.dispose(); } catch (_) {}
    try { this.proc.kill(); } catch (_) {}
  }
}

function spawnDebugAdapter(command, args, cwd, env) {
  return spawn(command, args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: env || { ...process.env },
  });
}

module.exports = { DapConnection, spawnDebugAdapter };
