const { DapConnection, spawnDebugAdapter } = require('./protocol');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function stripJsonComments(text) {
  let out = '';
  let i = 0;
  let inString = false;
  let quote = '';
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') { out += next || ''; i += 2; continue; }
      if (c === quote) inString = false;
      i++;
      continue;
    }
    if (c === '"' || c === "'") { inString = true; quote = c; out += c; i++; continue; }
    if (c === '/' && next === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
    out += c;
    i++;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

class DebugManager extends EventEmitter {
  constructor() {
    super();
    this.conn = null;
    this.proc = null;
    this.cwd = null;
    this.breakpoints = new Map();
    this.threads = [];
    this.stoppedThreadId = null;
    this.lastStackFrames = [];
  }

  listDevices(cwd) {
    return new Promise((resolve) => {
      execFile(
        'flutter',
        ['devices', '--machine'],
        { cwd, maxBuffer: 20 * 1024 * 1024 },
        (err, stdout) => {
          if (err) { resolve([]); return; }
          try {
            const devices = JSON.parse(stdout);
            resolve(Array.isArray(devices) ? devices : []);
          } catch (_) {
            resolve([]);
          }
        }
      );
    });
  }

  isFlutterProject(cwd) {
    try {
      const pubspec = fs.readFileSync(path.join(cwd, 'pubspec.yaml'), 'utf8');
      return /sdk:\s*flutter/i.test(pubspec);
    } catch (_) {
      return false;
    }
  }

  _resolveProgram(cwd) {
    const main = path.join(cwd, 'lib', 'main.dart');
    if (fs.existsSync(main)) return main;
    try {
      for (const name of fs.readdirSync(cwd, { withFileTypes: true })) {
        if (!name.isDirectory() || name.name.startsWith('.') || name.name === 'node_modules') continue;
        const sub = path.join(cwd, name.name, 'lib', 'main.dart');
        if (fs.existsSync(sub)) return sub;
      }
    } catch (_) {}
    return null;
  }

  loadLaunchConfigs(cwd) {
    const launchPath = path.join(cwd, '.vscode', 'launch.json');
    let raw;
    try {
      raw = fs.readFileSync(launchPath, 'utf8');
    } catch (_) {
      return [];
    }
    let parsed;
    try {
      parsed = JSON.parse(stripJsonComments(raw));
    } catch (err) {
      return [{ __error: 'Failed to parse .vscode/launch.json: ' + err.message }];
    }
    const configurations = (parsed && parsed.configurations) || [];
    const supported = configurations.filter((c) => c && (c.type === 'dart' || c.type === 'flutter'));
    return supported.map((c) => this._expandConfig(c, cwd));
  }

  _expandConfig(config, cwd) {
    const expanded = {};
    for (const [k, v] of Object.entries(config)) {
      expanded[k] = this._expandValue(v, cwd);
    }
    return expanded;
  }

  _expandValue(value, cwd) {
    if (typeof value === 'string') return this._expandVars(value, cwd);
    if (Array.isArray(value)) return value.map((v) => this._expandValue(v, cwd));
    if (value && typeof value === 'object') return this._expandConfig(value, cwd);
    return value;
  }

  _expandVars(str, cwd) {
    const base = path.basename(cwd);
    return str
      .replace(/\$\{workspaceFolder\}/g, cwd)
      .replace(/\$\{workspaceFolderBasename\}/g, base)
      .replace(/\$\{fileDirname\}/g, cwd);
  }

  async start(options) {
    const cwd = options.cwd;
    if (this.conn) await this.stop();
    this.cwd = cwd;
    this._initStarted = false;

    const config = options.config || null;
    const isFlutter = (config && config.type === 'flutter') || this.isFlutterProject(cwd);

    let program = null;
    if (config && config.program) {
      program = path.isAbsolute(config.program) ? config.program : path.join(cwd, config.program);
    }
    if (!program) program = this._resolveProgram(cwd);

    if (!program) {
      this.emit('status', { phase: 'error', message: 'No entry point found (expected lib/main.dart or a program in launch.json).' });
      return false;
    }

    const deviceId = (config && config.deviceId) || options.deviceId || null;
    const launchArgs = {
      name: (config && config.name) || (isFlutter ? 'Flutter' : 'Dart'),
      cwd,
      program,
      args: (config && Array.isArray(config.args)) ? config.args.slice() : [],
      noDebug: !!options.noDebug,
    };
    if (isFlutter) launchArgs.flutterMode = (config && config.flutterMode) || 'debug';
    if (deviceId) launchArgs.deviceId = deviceId;
    if (config) {
      for (const k of ['flutterPlatform', 'toolArgs', 'vmServicePort', 'vmAdditionalExposes',
        'debugSdkLibraries', 'debugExternalLibraries', 'showMemoryUsage', 'console', 'env']) {
        if (config[k] !== undefined) launchArgs[k] = config[k];
      }
    }
    this._launchArgs = launchArgs;
    this._launchRequest = (config && config.request === 'attach') ? 'attach' : 'launch';

    const command = isFlutter ? 'flutter' : 'dart';
    const args = ['debug_adapter'];

    let proc;
    try {
      proc = spawnDebugAdapter(command, args, cwd);
    } catch (err) {
      this.emit('status', { phase: 'error', message: `Failed to start debug adapter: ${err.message}` });
      return false;
    }
    this.proc = proc;

    proc.on('error', (err) => {
      this.emit('status', { phase: 'error', message: `Failed to run '${command}': ${err.message}. Is it on your PATH?` });
    });
    proc.on('exit', (code) => {
      this._cleanup();
      this.emit('terminated', { code });
      this.emit('status', { phase: 'terminated', code });
    });
    proc.stderr.on('data', (d) => {
      const text = d.toString();
      if (text.trim()) this.emit('output', { category: 'stderr', output: text });
    });

    const conn = new DapConnection(proc);
    this.conn = conn;

    conn.onEvent('output', (body) => this.emit('output', body || {}));
    conn.onEvent('initialized', () => this._onInitialized());
    conn.onEvent('stopped', (body) => this._onStopped(body || {}));
    conn.onEvent('continued', (body) => {
      this.stoppedThreadId = null;
      this.emit('continued', body || {});
    });
    conn.onEvent('terminated', (body) => {
      this.emit('terminated', body || {});
      this.emit('status', { phase: 'terminated' });
    });
    conn.onEvent('thread', () => this._refreshThreads());
    conn.onEvent('process', (body) => this.emit('process', body || {}));

    try {
      await conn.sendRequest('initialize', {
        clientID: 'arkod',
        clientName: 'Arkod',
        adapterID: isFlutter ? 'flutter' : 'dart',
        locale: 'en-US',
        linesStartAt1: true,
        columnsStartAt1: true,
        pathFormat: 'path',
        supportsVariableType: true,
        supportsRunInTerminalRequest: false,
        supportsProgressReporting: false,
        supportsInvalidatedEvent: false,
      });
    } catch (err) {
      this.emit('status', { phase: 'error', message: `initialize failed: ${err.message}` });
      this._cleanup();
      return false;
    }

    this.emit('status', { phase: 'starting' });
    setTimeout(() => this._onInitialized(), 3000);
    return true;
  }

  async _onInitialized() {
    if (this._initStarted) return;
    this._initStarted = true;
    if (!this.conn || !this._launchArgs) return;
    await this._syncAllBreakpoints();
    const req = this._launchRequest === 'attach' ? 'attach' : 'launch';
    // Send launch and configurationDone without blocking on their responses.
    // The Dart adapter waits for configurationDone before responding to launch,
    // so awaiting launch first would deadlock. Fire both; surface errors async.
    this.conn.sendRequest(req, this._launchArgs).catch((err) => {
      this.emit('status', { phase: 'error', message: `${req} failed: ${err.message}` });
    });
    this.conn.sendRequest('configurationDone', {}).catch(() => {});
    this.emit('status', { phase: 'running' });
  }

  async _syncAllBreakpoints() {
    if (!this.conn) return;
    for (const [filePath, lines] of this.breakpoints) {
      try {
        await this.conn.sendRequest('setBreakpoints', {
          source: { path: filePath },
          breakpoints: lines.map((l) => ({ line: l })),
          lines,
        });
      } catch (_) {}
    }
  }

  async setBreakpoints(filePath, lines) {
    this.breakpoints.set(filePath, (lines || []).slice());
    if (!this.conn) return [];
    try {
      const body = await this.conn.sendRequest('setBreakpoints', {
        source: { path: filePath },
        breakpoints: (lines || []).map((l) => ({ line: l })),
        lines: lines || [],
      });
      return body ? body.breakpoints || [] : [];
    } catch (_) {
      return [];
    }
  }

  async _onStopped(body) {
    this.stoppedThreadId = body.threadId;
    let stackFrames = [];
    try {
      const stack = await this.conn.sendRequest('stackTrace', { threadId: body.threadId });
      stackFrames = stack ? stack.stackFrames || [] : [];
    } catch (_) {}
    this.lastStackFrames = stackFrames;
    this.emit('stopped', { reason: body.reason, threadId: body.threadId, stackFrames });
  }

  async _refreshThreads() {
    if (!this.conn) return;
    try {
      const res = await this.conn.sendRequest('threads', {});
      this.threads = (res && res.threads) || [];
      this.emit('threads', this.threads);
    } catch (_) {}
  }

  async continueRun(threadId) {
    if (!this.conn) return null;
    this.stoppedThreadId = null;
    return this.conn.sendRequest('continue', { threadId: threadId != null ? threadId : this._activeThread() });
  }

  next(threadId) {
    if (!this.conn) return null;
    return this.conn.sendRequest('next', { threadId: threadId != null ? threadId : this._activeThread() });
  }

  stepIn(threadId) {
    if (!this.conn) return null;
    return this.conn.sendRequest('stepIn', { threadId: threadId != null ? threadId : this._activeThread() });
  }

  stepOut(threadId) {
    if (!this.conn) return null;
    return this.conn.sendRequest('stepOut', { threadId: threadId != null ? threadId : this._activeThread() });
  }

  pause(threadId) {
    if (!this.conn) return null;
    return this.conn.sendRequest('pause', { threadId: threadId != null ? threadId : this._activeThread() });
  }

  stackTrace(threadId) { return this.conn ? this.conn.sendRequest('stackTrace', { threadId }) : null; }
  scopes(frameId) { return this.conn ? this.conn.sendRequest('scopes', { frameId }) : null; }
  variables(variablesReference) { return this.conn ? this.conn.sendRequest('variables', { variablesReference }) : null; }
  threads() { return this.conn ? this.conn.sendRequest('threads', {}) : null; }

  _activeThread() {
    return this.stoppedThreadId != null ? this.stoppedThreadId : (this.threads[0] && this.threads[0].id);
  }

  async hotReload() {
    if (!this.conn) return false;
    try { await this.conn.sendRequest('hotReload', { reason: 'manual' }); return true; }
    catch (err) { this.emit('status', { phase: 'error', message: `hot reload failed: ${err.message}` }); return false; }
  }

  async hotRestart() {
    if (!this.conn) return false;
    try { await this.conn.sendRequest('hotRestart', { reason: 'manual' }); return true; }
    catch (err) { this.emit('status', { phase: 'error', message: `hot restart failed: ${err.message}` }); return false; }
  }

  async stop() {
    if (this.conn) {
      try { await this.conn.sendRequest('disconnect', { terminateDebuggee: true }); } catch (_) {}
    }
    this._cleanup();
    this.emit('status', { phase: 'stopped' });
  }

  _cleanup() {
    if (this.conn) { try { this.conn.dispose(); } catch (_) {} this.conn = null; }
    if (this.proc) { try { this.proc.kill(); } catch (_) {} }
    this.proc = null;
    this.stoppedThreadId = null;
    this.lastStackFrames = [];
    this.threads = [];
    this._initStarted = false;
  }

  isActive() { return !!this.conn; }
}

module.exports = DebugManager;
