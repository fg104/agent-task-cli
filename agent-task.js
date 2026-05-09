'use strict';
const fs = require('fs');
const path = require('path');

// =============================================================================
// Configuration
// =============================================================================

const CONFIG = {
  EPIC_DIR: 'epics',
  TASK_DIR: 'tasks',
  INDEX_FILE: '.agent-task-index.json',
  VALID_STATUSES: ['open', 'in_progress', 'in_review', 'done'],
  DONE_STATUS: 'done',
  MARKDOWN_EXTENSIONS: ['.md', '.markdown'],
  MARKDOWN_EXCLUDE_FILES: ['TEMPLATE.md'],
  MAX_TITLE_STRING_WIDTH: 40,
  ALLOW_ANSI_COLOR: true,
  VERBOSE_MODE: false,
};

// =============================================================================
// ANSI colors and logging
// =============================================================================

const ANSI = CONFIG.ALLOW_ANSI_COLOR ? {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
} : {
  reset: '', bold: '', dim: '', red: '', green: '', yellow: '', blue: '', cyan: '', gray: ''
};

function color(text, name) {
  return `${ANSI[name] || ''}${text}${ANSI.reset}`;
}

function logSuccess(message) {
  console.log(color(`✅ ${message}`, 'green'));
}

function logError(message) {
  console.error(color(`❌ ${message}`, 'red'));
}

function logWarning(message) {
  console.warn(color(`⚠️  ${message}`, 'yellow'));
}

function logInfo(message) {
  console.log(color(`ℹ️  ${message}`, 'blue'));
}

function logVerbose(message) {
  if (CONFIG.VERBOSE_MODE) console.log(color(`🔎 ${message}`, 'gray'));
}

// =============================================================================
// CLI argument parsing
// =============================================================================

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0] && !args[0].startsWith('--') ? args[0] : 'help';
  const options = {
    withDone: false,
    verbose: false,
    help: false,
    epic: null,
    noEpic: false
  };

  const optionStartIndex = args[0] && !args[0].startsWith('--') ? 1 : 0;
  for (let i = optionStartIndex; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--with-done') {
      options.withDone = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
      CONFIG.VERBOSE_MODE = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--epic') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--epic requires an Epic ID.');
      }
      options.epic = value;
      i += 1;
    } else if (arg === '--no-epic') {
      options.noEpic = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.epic && options.noEpic) {
    throw new Error('--epic and --no-epic cannot be used together.');
  }

  return { command, options };
}

// =============================================================================
// File utilities
// =============================================================================

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function walkMarkdownFiles(dir) {
  if (!exists(dir)) {
    logVerbose(`Directory not found, skipping: ${dir}`);
    return [];
  }

  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkMarkdownFiles(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (CONFIG.MARKDOWN_EXTENSIONS.includes(ext) && !CONFIG.MARKDOWN_EXCLUDE_FILES.includes(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  return results.sort();
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data)}\n`, 'utf8');
}

function readIndex() {
  if (!exists(CONFIG.INDEX_FILE)) {
    throw new Error(`Index file not found: ${CONFIG.INDEX_FILE}. Run update-index first.`);
  }

  try {
    return JSON.parse(readText(CONFIG.INDEX_FILE));
  } catch (error) {
    throw new Error(`Failed to read index file: ${CONFIG.INDEX_FILE}. ${error.message}`);
  }
}

// =============================================================================
// Markdown frontmatter parsing
// =============================================================================

function parseFrontmatter(markdown, filePath, allowedKeys) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    throw new Error(`Missing frontmatter: ${filePath}`);
  }

  const raw = match[1];
  const metadata = {};

  raw.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) {
      throw new Error(`Invalid frontmatter line ${index + 1} in ${filePath}: ${line}`);
    }

    const key = trimmed.slice(0, colonIndex).trim();
    let value = trimmed.slice(colonIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    metadata[key] = value;
  });
  
  const filteredMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([key, value]) => allowedKeys.includes(key))
  );

  return filteredMetadata;
}

function validateCommonMetadata(meta, expectedType, filePath) {
  const required = ['id', 'type', 'title', 'status', 'updated_at'];
  for (const key of required) {
    if (!meta[key]) {
      throw new Error(`Missing required metadata '${key}' in ${filePath}`);
    }
  }

  if (meta.type !== expectedType) {
    throw new Error(`Invalid type in ${filePath}: expected '${expectedType}', got '${meta.type}'`);
  }

  if (!CONFIG.VALID_STATUSES.includes(meta.status)) {
    throw new Error(
      `Invalid status in ${filePath}: '${meta.status}'. Valid statuses: ${CONFIG.VALID_STATUSES.join(', ')}`
    );
  }
}

function parseEpicFile(filePath) {
  const allowedKeys = ['id', 'type', 'title', 'status', 'updated_at'];
  const meta = parseFrontmatter(readText(filePath), filePath, allowedKeys);
  validateCommonMetadata(meta, 'epic', filePath);

  return {
    ...meta,
    type: 'epic',
    path: toPosixPath(filePath)
  };
}

function parseTaskFile(filePath) {
  const allowedKeys = ['id', 'type', 'title', 'status', 'epic_id', 'updated_at'];
  const meta = parseFrontmatter(readText(filePath), filePath, allowedKeys);
  validateCommonMetadata(meta, 'task', filePath);

  const task = {
    ...meta,
    type: 'task',
    path: toPosixPath(filePath)
  };

  return task;
}

// =============================================================================
// Validation
// =============================================================================

class ValidationError extends Error {
  constructor(errors) {
    super(errors.join('\n'));
    this.errors = errors;
  }
}

function ensureUniqueIds(items, label) {
  const seen = new Map();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new Error(
        `Duplicate ${label} ID '${item.id}': ${seen.get(item.id)} and ${item.path}`
      );
    }
    seen.set(item.id, item.path);
  }
}

function validateEpicReferences(epics, tasks) {
  const epicIds = new Set(epics.map((epic) => epic.id));
  const errors = [];

  for (const task of tasks) {
    if (task.epic_id && !epicIds.has(task.epic_id)) {
      errors.push(`Task '${task.id}' references missing Epic '${task.epic_id}': ${task.path}`);
    }
  }
  if (0 < errors.length) throw new ValidationError(errors);
}

function validateIndexShape(index) {
  if (!index || !Array.isArray(index.epics) || !Array.isArray(index.tasks)) {
    throw new Error(`Invalid index shape: ${CONFIG.INDEX_FILE}`);
  }
}

function outputValidationError(validationError) {
  validationError.errors.map(logError);
}

// =============================================================================
// Index operations
// =============================================================================

function buildIndex(options) {
  const epicFiles = walkMarkdownFiles(CONFIG.EPIC_DIR);
  const taskFiles = walkMarkdownFiles(CONFIG.TASK_DIR);

  logVerbose(`Found ${epicFiles.length} Epic markdown file(s).`);
  logVerbose(`Found ${taskFiles.length} Task markdown file(s).`);

  const epics = epicFiles.map((file) => {
    logVerbose(`Parsing Epic: ${file}`);
    return parseEpicFile(file);
  }).filter((v) => !!v);

  const tasks = taskFiles.map((file) => {
    logVerbose(`Parsing Task: ${file}`);
    return parseTaskFile(file);
  }).filter((v) => !!v);

  ensureUniqueIds(epics, 'Epic');
  ensureUniqueIds(tasks, 'Task');
  validateEpicReferences(epics, tasks);

  return {
    generated_at: new Date().toISOString(),
    epics,
    tasks
  };
}

function updateIndex(options) {
  const index = buildIndex(options);
  writeJson(CONFIG.INDEX_FILE, index);
  logSuccess(`Index updated: ${CONFIG.INDEX_FILE}`);
  logInfo(`Indexed ${index.epics.length} Epic(s), ${index.tasks.length} Task(s).`);
}

function loadValidatedIndex() {
  const index = readIndex();
  validateIndexShape(index);
  ensureUniqueIds(index.epics, 'Epic');
  ensureUniqueIds(index.tasks, 'Task');
  validateEpicReferences(index.epics, index.tasks);
  return index;
}

function checkIndexFileStaled() {
  const indexStat = fs.statSync(CONFIG.INDEX_FILE);
  const indexMtime = indexStat.mtimeMs;

  const dirs = [CONFIG.EPIC_DIR, CONFIG.TASK_DIR];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        const ext = path.extname(file).toLowerCase();
        if (CONFIG.MARKDOWN_EXTENSIONS.includes(ext) && !CONFIG.MARKDOWN_EXCLUDE_FILES.includes(file)) {
          if (stat.mtimeMs > indexMtime) {
            logInfo('Index is stale. Running update-index automatically...');
            return true;
            break;
          }
        }
      }
    }
  }
  return false;
}

function autoUpdateIndexIfNeeded() {
  try {
    let shouldUpdate = false;

    if (!fs.existsSync(CONFIG.INDEX_FILE)) {
      logInfo('Index not found. Running update-index automatically...');
      shouldUpdate = true;
    } else {
      shouldUpdate = checkIndexFileStaled();
    }

    if (shouldUpdate) {
      updateIndex({});
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      outputValidationError(error);
    } else {
      logError(error.message);
    }
    logWarning('Auto index update failed. Please run update-index manually.');
  }
}

// =============================================================================
// Display helpers
// =============================================================================

function trimString(string) {
  let remain = CONFIG.MAX_TITLE_STRING_WIDTH;
  let output = '';

  for (let i = 0; i < string.length; i++) {
    const width = (string.charCodeAt(i) < 0xFF) ? 1 : 2;
    if ((remain - width) < 2) break;
    output += string[i];
    remain -= width;
  }
  return (output.length < string.length) ? `${output}..` : output;
}

function isVisibleByDoneStatus(item, withDone) {
  return withDone || item.status !== CONFIG.DONE_STATUS;
}

function statusLabel(status) {
  const colorTable = {
    'open': 'blue',
    'in_progress': 'cyan',
    'in_review': 'yellow',
    'done': 'green',
  };
  return color(`[${status}]`, (status in colorTable) ? colorTable[status] : colorTable['open']);
}

function sortByUpdatedThenId(a, b) {
  const dateCompare = String(b.updated_at).localeCompare(String(a.updated_at));
  if (dateCompare !== 0) return dateCompare;
  return String(a.id).localeCompare(String(b.id));
}

function printEpic(epic) {
  const title = trimString(epic.title);
  console.log(`📦 ${color(epic.id, 'bold')} ${statusLabel(epic.status)} ${color(epic.updated_at, 'gray')} ${epic.path} ${title}`);
}

function printTask(task, showEpicPart = true, indent = '') {
  const title = trimString(task.title);
  const epicPart = task.epic_id ? color(` epic:${task.epic_id}`, 'gray') : color(' no-epic', 'gray');
  console.log(`${indent}📝 ${color(task.id, 'bold')} ${statusLabel(task.status)} ${color(task.updated_at, 'gray')}${showEpicPart ? epicPart : ''} ${task.path} ${title}`);
}

function listEpics(options) {
  const index = loadValidatedIndex();
  const epics = index.epics
    .filter((epic) => isVisibleByDoneStatus(epic, options.withDone))
    .sort(sortByUpdatedThenId);

  logVerbose(`Displaying ${epics.length} Epic(s).`);

  if (epics.length === 0) {
    logWarning('No Epic matched the current filters.');
    return;
  }

  epics.forEach(printEpic);
}

function listTasks(options) {
  const index = loadValidatedIndex();
  let tasks = index.tasks.filter((task) => isVisibleByDoneStatus(task, options.withDone));

  if (options.epic) {
    tasks = tasks.filter((task) => task.epic_id === options.epic);
  }

  if (options.noEpic) {
    tasks = tasks.filter((task) => !task.epic_id);
  }

  tasks = tasks.sort(sortByUpdatedThenId);

  logVerbose(`Displaying ${tasks.length} Task(s).`);

  if (tasks.length === 0) {
    logWarning('No Task matched the current filters.');
    return;
  }

  tasks.forEach((v) => printTask(v));
}

function printTree(options) {
  const index = loadValidatedIndex();
  const visibleEpics = index.epics
    .filter((epic) => isVisibleByDoneStatus(epic, options.withDone))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const visibleTasks = index.tasks
    .filter((task) => isVisibleByDoneStatus(task, options.withDone))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const tasksByEpic = new Map();
  const noEpicTasks = [];

  for (const task of visibleTasks) {
    if (task.epic_id) {
      if (!tasksByEpic.has(task.epic_id)) tasksByEpic.set(task.epic_id, []);
      tasksByEpic.get(task.epic_id).push(task);
    } else {
      noEpicTasks.push(task);
    }
  }

  logVerbose(`Displaying tree with ${visibleEpics.length} Epic(s) and ${visibleTasks.length} Task(s).`);

  if (visibleEpics.length === 0 && noEpicTasks.length === 0) {
    logWarning('No Epic or Task matched the current filters.');
    return;
  }

  for (const epic of visibleEpics) {
    printEpic(epic);
    const children = tasksByEpic.get(epic.id) || [];
    children.forEach((task, index) => {
      const branch = index === children.length - 1 ? '└─' : '├─';
      printTask(task, false, `  ${branch} `);
    });
    console.log('');
  }

  if (noEpicTasks.length > 0) {
    console.log(`📦 ${color('No Epic', 'bold')}`);
    noEpicTasks.forEach((task, index) => {
      const branch = index === noEpicTasks.length - 1 ? '└─' : '├─';
      printTask(task, false, `  ${branch} `);
    });
  }
}

// =============================================================================
// Help
// =============================================================================

function printHelp() {
  console.log(`
${color('Agent Task Manager', 'bold')}

Usage:
  node agent-task.js <command> [options]

Commands:
  update-index         Read Markdown files and update ${CONFIG.INDEX_FILE}
  list-epics           List Epics
  list-tasks           List Tasks
  tree                 Show Epic / Task tree
  help                 Show help

Options:
  --with-done          Include items with status 'done'
  --epic <EPIC_ID>     Filter Tasks by Epic ID
  --no-epic            Show only Tasks without an Epic
  --verbose            Show verbose logs
  --help, -h           Show help

Statuses:
  ${CONFIG.VALID_STATUSES.join(', ')}

Examples:
  node agent-task.js update-index
  node agent-task.js list-epics
  node agent-task.js list-tasks --epic EPIC-001
  node agent-task.js list-tasks --no-epic
  node agent-task.js tree --with-done
`);
}

// =============================================================================
// Main
// =============================================================================

function main() {
  const commandTable = {
    'update-index': updateIndex,
    'list-epics': listEpics,
    'list-tasks': listTasks,
    'tree': printTree,
  };
  try {
    const { command, options } = parseArgs(process.argv);

    if (options.help || command === 'help') {
      printHelp();
      return;
    }
    process.chdir(__dirname);

    if (command in commandTable) {
      // Auto index update (if missing or stale)
      if (command !== 'update-index') autoUpdateIndexIfNeeded();
      // Execute command
      commandTable[command](options);
    } else {
      throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      outputValidationError(error);
    } else {
      logError(error.message);
    }
    process.exitCode = 1;
  }
}

main();
