function computeDiff(before, after) {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');

  const lcs = longestCommonSubsequence(beforeLines, afterLines);
  const hunks = buildHunks(beforeLines, afterLines, lcs);

  return hunks.map(formatHunk).join('\n');
}

function longestCommonSubsequence(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift({ old: i - 1, new: j - 1 });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return result;
}

function buildHunks(beforeLines, afterLines, lcs) {
  const ops = [];
  let bi = 0, ai = 0;

  for (const { old: oi, new: ni } of lcs) {
    while (bi < oi && ai < ni) {
      ops.push({ type: 'replace', old: beforeLines[bi], new: afterLines[ai] });
      bi++;
      ai++;
    }
    while (bi < oi) {
      ops.push({ type: 'remove', old: beforeLines[bi] });
      bi++;
    }
    while (ai < ni) {
      ops.push({ type: 'add', new: afterLines[ai] });
      ai++;
    }
    ops.push({ type: 'equal', line: beforeLines[oi] });
    bi = oi + 1;
    ai = ni + 1;
  }

  while (bi < beforeLines.length && ai < afterLines.length) {
    ops.push({ type: 'replace', old: beforeLines[bi], new: afterLines[ai] });
    bi++;
    ai++;
  }
  while (bi < beforeLines.length) {
    ops.push({ type: 'remove', old: beforeLines[bi] });
    bi++;
  }
  while (ai < afterLines.length) {
    ops.push({ type: 'add', new: afterLines[ai] });
    ai++;
  }

  const hunks = [];
  const context = 3;
  let pos = 0;

  while (pos < ops.length) {
    while (pos < ops.length && ops[pos].type === 'equal') pos++;
    if (pos >= ops.length) break;

    const hunkStart = Math.max(0, pos - context);
    let hunkEnd = pos;
    while (hunkEnd < ops.length && ops[hunkEnd].type !== 'equal') hunkEnd++;
    hunkEnd = Math.min(ops.length, hunkEnd + context);

    let oldStart = 1, newStart = 1;
    let oldLines = 0, newLines = 0;

    for (let k = 0; k < hunkStart; k++) {
      if (ops[k].type !== 'add') oldStart++;
      if (ops[k].type !== 'remove') newStart++;
    }

    const lines = [];

    for (let j = hunkStart; j < hunkEnd; j++) {
      const op = ops[j];
      if (op.type === 'equal') {
        lines.push({ sign: ' ', line: op.line });
        oldLines++;
        newLines++;
      } else if (op.type === 'remove') {
        lines.push({ sign: '-', line: op.old });
        oldLines++;
      } else if (op.type === 'add') {
        lines.push({ sign: '+', line: op.new });
        newLines++;
      } else if (op.type === 'replace') {
        lines.push({ sign: '-', line: op.old });
        lines.push({ sign: '+', line: op.new });
        oldLines++;
        newLines++;
      }
    }

    hunks.push({ oldStart, oldLines, newStart, newLines, lines });
    pos = hunkEnd;
  }

  return hunks;
}

function formatHunk(hunk) {
  const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
  const lines = hunk.lines.map(l => `${l.sign}${l.line}`).join('\n');
  return header + '\n' + lines;
}

function unifiedDiff(before, after) {
  return computeDiff(before, after);
}

function computeFileDiff(filePath, beforeText, afterText) {
  const diff = computeDiff(beforeText, afterText);
  if (!diff) return null;
  return {
    filePath,
    diff,
    before: beforeText,
    after: afterText,
  };
}

module.exports = { computeDiff, unifiedDiff, computeFileDiff };
