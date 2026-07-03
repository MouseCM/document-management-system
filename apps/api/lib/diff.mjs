import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

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

/**
 * Extract human-readable text from a PDF file.
 *
 * Strategy (in order of preference):
 * 1. Parse BT...ET text blocks from the raw PDF stream and decode all Tj/TJ operators.
 * 2. If that yields nothing useful, fall back to extracting all printable ASCII
 *    runs from the raw bytes (filtering out binary garbage and control characters).
 *
 * This produces clean, diffable text even when the PDF uses compressed streams
 * (FlateDecode, etc.) — in those cases the binary blobs are simply skipped and
 * only the human-readable metadata / uncompressed sections are returned.
 */
function decodePdfOctalEscapes(value) {
  return value.replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function decodePdfStringLiteral(value) {
  return decodePdfOctalEscapes(
    value
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\b/g, '\b')
      .replace(/\\f/g, '\f')
      .replace(/\\\\/g, '\\')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')'),
  );
}

function extractPdfText(filePath) {
  const bytes = readFileSync(filePath);
  // Work with latin1 so we can index raw bytes as characters
  const raw = bytes.toString('latin1');

  // ── Pass 1: parse BT...ET text blocks ───────────────────────────────────────
  // Collect text from Tj and TJ operators inside text blocks.
  const lines = [];
  
  // Extract FlateDecode streams
  const decompressedStreams = [];
  const streamRegex = /stream(?:\r\n|\n)([\s\S]*?)(?:\r\n|\n)?endstream/g;
  let streamMatch;
  while ((streamMatch = streamRegex.exec(raw)) !== null) {
    try {
      const buffer = Buffer.from(streamMatch[1], 'latin1');
      decompressedStreams.push(zlib.unzipSync(buffer).toString('latin1'));
    } catch (e) {
      // Ignore decompression errors (e.g., non-FlateDecode streams)
    }
  }

  const contentsToSearch = [raw, ...decompressedStreams];
  
  for (const content of contentsToSearch) {
    const btBlocks = content.matchAll(/BT\s*([\s\S]*?)\s*ET/g);
    for (const block of btBlocks) {
      const blockContent = block[1];
      // Match both (string) Tj and [(string|number)...] TJ forms
      const tjOps = blockContent.matchAll(/\((?:\\.|[^\\()])*\)\s*Tj|(\[(?:[^\]]*)\]\s*TJ)/g);
      for (const op of tjOps) {
        const opText = op[0];
        // Extract all string literals from this operator
        const strMatches = opText.matchAll(/\((?:\\.|[^\\()])*\)/g);
        const parts = [];
        for (const s of strMatches) {
          const decoded = decodePdfStringLiteral(s[0].slice(1, -1));
          // Skip decoded strings that are mostly binary/non-printable
          const printableRatio = (decoded.match(/[\x20-\x7E\n\r\t]/g) || []).length / Math.max(decoded.length, 1);
          if (printableRatio > 0.7) {
            parts.push(decoded.trim());
          }
        }
        if (parts.length) {
          lines.push(parts.join(' '));
        }
      }
    }
  }

  // ── Pass 2: grab document-level string literals (Title, Author, Subject, etc.) ─
  // These are often uncompressed and readable
  const metaKeys = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer'];
  for (const key of metaKeys) {
    const metaRegex = new RegExp(`/${key}\\s*\\(([^)]+)\\)`, 'g');
    const matches = raw.matchAll(metaRegex);
    for (const m of matches) {
      const decoded = decodePdfStringLiteral(m[1]);
      if (decoded.trim()) lines.push(`[${key}: ${decoded.trim()}]`);
    }
  }

  // ── Merge and clean Pass 1+2 results ────────────────────────────────────────
  if (lines.length > 0) {
    const result = lines
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
    if (result.length > 20) return result;
  }

  // ── Pass 3: printable ASCII fallback ────────────────────────────────────────
  // If structured extraction found nothing useful, extract all printable ASCII
  // runs of length ≥ 4 characters, which skips binary blobs entirely.
  const asciiRuns = raw.match(/[\x20-\x7E]{4,}/g) || [];
  const meaningful = asciiRuns
    .map((run) => run.trim())
    .filter((run) => {
      // Keep runs that look like natural language (contain spaces or word chars)
      const wordChars = (run.match(/[a-zA-Z]/g) || []).length;
      return wordChars / Math.max(run.length, 1) > 0.3;
    })
    .join('\n');

  return meaningful || '[No readable text could be extracted from this PDF]';
}

/**
 * Raw PDF extraction — intentionally unfiltered.
 * Returns the full latin1 representation of the PDF bytes including binary
 * stream data. This reproduces the "raw" view: compressed chunks appear as
 * garbled characters (¥h!5;yq~...) which is exactly what was produced before
 * the structured extractor was added. Useful for low-level debugging and
 * side-by-side comparison against the clean text extraction.
 */
function extractPdfRaw(filePath) {
  const bytes = readFileSync(filePath);
  // Decode every byte as latin1 — no filtering whatsoever.
  // Compressed binary streams will appear as non-printable / garbled characters.
  return bytes.toString('latin1');
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

/** Same as extractComparableText but forces raw (unfiltered latin1) for PDFs. */
function extractComparableRaw(version) {
  const fileName = version.fileName || '';
  const mimeType = version.mimeType || '';
  if (fileName.endsWith('.pdf') || mimeType === 'application/pdf') {
    return { kind: 'pdf-raw', text: extractPdfRaw(version.storagePath) };
  }
  // For non-PDF files the raw extraction is identical to the text extraction.
  return extractComparableText(version);
}

export function compareVersions(fromVersion, toVersion) {
  const left = extractComparableText(fromVersion);
  const right = extractComparableText(toVersion);
  const changes = buildDiff(left.text, right.text);

  const isPdf =
    (fromVersion.fileName || '').endsWith('.pdf') ||
    fromVersion.mimeType === 'application/pdf' ||
    (toVersion.fileName || '').endsWith('.pdf') ||
    toVersion.mimeType === 'application/pdf';

  // For PDFs, also compute the raw (unfiltered) diff so the UI can offer both views.
  let rawChanges = null;
  let rawSummary = null;
  if (isPdf) {
    const leftRaw = extractComparableRaw(fromVersion);
    const rightRaw = extractComparableRaw(toVersion);
    rawChanges = buildDiff(leftRaw.text, rightRaw.text);
    rawSummary = {
      added: rawChanges.filter((c) => c.type === 'added').length,
      removed: rawChanges.filter((c) => c.type === 'removed').length,
      same: rawChanges.filter((c) => c.type === 'same').length,
    };
  }

  return {
    fromVersionId: fromVersion.id,
    toVersionId: toVersion.id,
    kind: left.kind === right.kind ? left.kind : `${left.kind}:${right.kind}`,
    isPdf,
    truncated: left.text.split('\n').length > MAX_LCS_LINES || right.text.split('\n').length > MAX_LCS_LINES,
    summary: {
      added: changes.filter((c) => c.type === 'added').length,
      removed: changes.filter((c) => c.type === 'removed').length,
      same: changes.filter((c) => c.type === 'same').length,
    },
    changes,
    rawChanges,
    rawSummary,
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
