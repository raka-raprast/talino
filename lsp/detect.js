const fs = require('fs');
const path = require('path');

const DEFAULT_SERVERS = {
  typescript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'],
  },
  python: {
    command: 'pyright-langserver',
    args: ['--stdio'],
    extensions: ['.py', '.pyi', '.pyx', '.pxd'],
  },
  rust: {
    command: 'rust-analyzer',
    args: [],
    extensions: ['.rs'],
  },
  go: {
    command: 'gopls',
    args: [],
    extensions: ['.go'],
  },
  dart: {
    command: 'dart',
    args: ['language-server', '--protocol=lsp'],
    extensions: ['.dart'],
  },
};

const ROOT_PATTERNS = {
  typescript: ['package.json', 'tsconfig.json', 'jsconfig.json'],
  python: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile'],
  rust: ['Cargo.toml'],
  go: ['go.mod'],
  dart: ['pubspec.yaml', 'analysis_options.yaml'],
};

function detectLanguages(cwd) {
  const detected = new Set();

  for (const [lang, patterns] of Object.entries(ROOT_PATTERNS)) {
    for (const pattern of patterns) {
      const fullPath = path.join(cwd, pattern);
      if (fs.existsSync(fullPath)) {
        detected.add(lang);
        break;
      }
    }
  }

  return [...detected];
}

function getLanguageConfig(lang, projectConfig) {
  const defaults = DEFAULT_SERVERS[lang];
  if (!defaults) return null;

  if (projectConfig && projectConfig.lsp && projectConfig.lsp[lang]) {
    return { ...defaults, ...projectConfig.lsp[lang] };
  }

  return defaults;
}

function languageForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  for (const [lang, cfg] of Object.entries(DEFAULT_SERVERS)) {
    if (cfg.extensions.includes(ext)) return lang;
  }
  return null;
}

function loadProjectConfig(cwd) {
  const configPath = path.join(cwd, '.omprc.json');
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error('[lsp] Failed to parse .omprc.json:', err.message);
    return null;
  }
}

module.exports = { detectLanguages, getLanguageConfig, languageForFile, loadProjectConfig };
