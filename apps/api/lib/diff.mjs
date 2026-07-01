import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * Maximum number of lines fed into the O(n²) LCS algorithm.
 * Documents beyond this threshold fall back to a fast linear diff.
 */
const MAX_LCS_LINES = 2000;

function normalizeLines(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

function lcsMatrix(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      matrix[i][j] = a[i] === b[j] ? matrix[i + 1][j + 1] + 1 : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
    }
  }
  return matrix;
}

/** Full LCS-based diff — accurate but O(n²) in time and memory. */
function lcsBasedDiff(left, right) {
  const matrix = lcsMatrix(left, right);
  const output = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      output.push({ type: 'same', text: left[i] });
      i += 1;
      j += 1;
      continue;
    }
    if (matrix[i + 1][j] >= matrix[i][j + 1]) {
      output.push({ type: 'removed', text: left[i] });
      i += 1;
    } else {
      output.push({ type: 'added', text: right[j] });
      j += 1;
    }
  }
  while (i < left.length) {
    output.push({ type: 'removed', text: left[i] });
    i += 1;
  }
  while (j < right.length) {
    output.push({ type: 'added', text: right[j] });
    j += 1;
  }
  return output;
}

/**
 * Fast linear diff used when either side exceeds MAX_LCS_LINES.
 * Walks lines in parallel; changed lines emit removed+added pairs.
 */
function linearDiff(left, right) {
  const output = [];
  const maxLen = Math.max(left.length, right.length);
  for (let i = 0; i < maxLen; i += 1) {
    if (i >= left.length) {
      output.push({ type: 'added', text: right[i] });
    } else if (i >= right.length) {
      output.push({ type: 'removed', text: left[i] });
    } else if (left[i] === right[i]) {
      output.push({ type: 'same', text: left[i] });
    } else {
      output.push({ type: 'removed', text: left[i] });
      output.push({ type: 'added', text: right[i] });
    }
  }
  return output;
}

function buildDiff(a, b) {
  const left = normalizeLines(a);
  const right = normalizeLines(b);
  if (left.length > MAX_LCS_LINES || right.length > MAX_LCS_LINES) {
    return linearDiff(left, right);
  }
  return lcsBasedDiff(left, right);
}

// ─── Format extractors ────────────────────────────────────────────────────────

function decodePdfStringLiteral(value) {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b')
    .replace(/\\f/g, '\f')
    .replace(/\\\\/g, '\\')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')');
}

function extractPdfText(filePath) {
  const bytes = readFileSync(filePath);
  const text = bytes.toString('latin1');
  const literals = [];
  const stringRegex = /\((?:\\.|[^\\()])*\)/g;
  let match;
  while ((match = stringRegex.exec(text)) !== null) {
    literals.push(decodePdfStringLiteral(match[0].slice(1, -1)));
  }
  const operatorRegex = /(\[(?:[^\]]|\n|\r)*\]\s*TJ)|(\((?:\\.|[^\\()])*\)\s*Tj)/g;
  while ((match = operatorRegex.exec(text)) !== null) {
    literals.push(match[0].replace(/[\[\]TJtj]/g, ' ').trim());
  }
  return literals.join('\n').trim() || text.replace(/[^\x09\x0A\x0D\x20-\x7E]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractDocxDocumentXml(filePath) {
  if (!existsSync(filePath)) return '';
  try {
    return execFileSync('unzip', ['-p', filePath, 'word/document.xml'], { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
  } catch {
    return '';
  }
}

function xmlToLines(xml) {
  return xml
    .replace(/></g, '>\n<')
    .replace(/\s+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function extractComparableText(version) {
  const fileName = version.fileName || '';
  const mimeType = version.mimeType || '';
  if (fileName.endsWith('.docx') || mimeType.includes('word')) {
    return { kind: 'docx-xml', text: xmlToLines(extractDocxDocumentXml(version.storagePath)).join('\n') };
  }
  if (fileName.endsWith('.pdf') || mimeType === 'application/pdf') {
    return { kind: 'pdf-text', text: extractPdfText(version.storagePath) };
  }
  const bytes = readFileSync(version.storagePath);
  return { kind: 'text', text: bytes.toString('utf8') };
}

export function compareVersions(fromVersion, toVersion) {
  const left = extractComparableText(fromVersion);
  const right = extractComparableText(toVersion);
  const changes = buildDiff(left.text, right.text);
  return {
    fromVersionId: fromVersion.id,
    toVersionId: toVersion.id,
    kind: left.kind === right.kind ? left.kind : `${left.kind}:${right.kind}`,
    truncated: left.text.split('\n').length > MAX_LCS_LINES || right.text.split('\n').length > MAX_LCS_LINES,
    summary: {
      added: changes.filter((c) => c.type === 'added').length,
      removed: changes.filter((c) => c.type === 'removed').length,
      same: changes.filter((c) => c.type === 'same').length,
    },
    changes,
    leftText: left.text,
    rightText: right.text,
  };
}

// ─── HTML renderers ───────────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Unified diff renderer with line numbers. */
export function renderUnifiedDiff(diffResult) {
  let leftNo = 1;
  let rightNo = 1;
  return diffResult.changes
    .map((change) => {
      if (change.type === 'same') {
        const html = `<div class="diff-row diff-same"><span class="diff-ln">${leftNo}</span><span class="diff-ln">${rightNo}</span><span class="diff-mark"> </span><pre>${escapeHtml(change.text)}</pre></div>`;
        leftNo += 1;
        rightNo += 1;
        return html;
      }
      if (change.type === 'added') {
        const html = `<div class="diff-row diff-added"><span class="diff-ln"></span><span class="diff-ln">${rightNo}</span><span class="diff-mark">+</span><pre>${escapeHtml(change.text)}</pre></div>`;
        rightNo += 1;
        return html;
      }
      // removed
      const html = `<div class="diff-row diff-removed"><span class="diff-ln">${leftNo}</span><span class="diff-ln"></span><span class="diff-mark">−</span><pre>${escapeHtml(change.text)}</pre></div>`;
      leftNo += 1;
      return html;
    })
    .join('');
}

/**
 * Side-by-side diff renderer.
 * Pairs consecutive removed/added blocks into aligned left/right columns.
 */
export function renderSideBySideDiff(diffResult) {
  const rows = buildSideBySideRows(diffResult.changes);
  const leftLines = rows
    .map((row) => {
      if (!row.left) {
        return `<div class="diff-line diff-empty"><span class="diff-ln"></span><pre></pre></div>`;
      }
      return `<div class="diff-line ${row.type}"><span class="diff-ln">${row.left.no}</span><pre>${escapeHtml(row.left.text)}</pre></div>`;
    })
    .join('');
  const rightLines = rows
    .map((row) => {
      if (!row.right) {
        return `<div class="diff-line diff-empty"><span class="diff-ln"></span><pre></pre></div>`;
      }
      return `<div class="diff-line ${row.type}"><span class="diff-ln">${row.right.no}</span><pre>${escapeHtml(row.right.text)}</pre></div>`;
    })
    .join('');

  const fromLabel = escapeHtml(`v${diffResult.fromVersion || ''}`);
  const toLabel = escapeHtml(`v${diffResult.toVersion || ''}`);

  return `
    <div class="diff-sbs">
      <div class="diff-pane diff-pane-left">
        <div class="diff-pane-header"><span class="diff-pane-badge removed">Before</span></div>
        <div class="diff-lines">${leftLines}</div>
      </div>
      <div class="diff-pane diff-pane-right">
        <div class="diff-pane-header"><span class="diff-pane-badge added">After</span></div>
        <div class="diff-lines">${rightLines}</div>
      </div>
    </div>
  `;
}

function buildSideBySideRows(changes) {
  const rows = [];
  let leftNo = 1;
  let rightNo = 1;
  let i = 0;

  while (i < changes.length) {
    if (changes[i].type === 'same') {
      rows.push({
        type: 'same',
        left: { no: leftNo++, text: changes[i].text },
        right: { no: rightNo++, text: changes[i].text },
      });
      i += 1;
      continue;
    }

    const removedBlock = [];
    while (i < changes.length && changes[i].type === 'removed') {
      removedBlock.push(changes[i].text);
      i += 1;
    }
    const addedBlock = [];
    while (i < changes.length && changes[i].type === 'added') {
      addedBlock.push(changes[i].text);
      i += 1;
    }

    const len = Math.max(removedBlock.length, addedBlock.length);
    for (let j = 0; j < len; j += 1) {
      const hasLeft = j < removedBlock.length;
      const hasRight = j < addedBlock.length;
      rows.push({
        type: hasLeft && hasRight ? 'changed' : hasLeft ? 'removed' : 'added',
        left: hasLeft ? { no: leftNo++, text: removedBlock[j] } : null,
        right: hasRight ? { no: rightNo++, text: addedBlock[j] } : null,
      });
    }
  }

  return rows;
}
