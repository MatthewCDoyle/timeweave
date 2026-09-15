/**
 * scripts/_dita-extractor.mjs
 * ============================================================================
 * Extracts prose text + synthetic frontmatter from a DITA file so the existing
 * markdown-oriented pods (Editor, Librarian, Strategist) can operate on
 * .dita / .ditamap sources without each implementing their own XML parser.
 *
 * The DITA-as-source ingestion path the case study has been pointing at since
 * Phase 1. The Loss-scanner (scripts/dita-loss-scanner.mjs) already understands
 * DITA-XML semantic patterns — this extractor is the input side: take a real
 * .dita file and produce something the pods can scan.
 *
 * What it produces:
 *   {
 *     synthetic frontmatter (derived from <topic>, <prolog>, file path):
 *       title, description, id, content_type, keywords (from <keyword>),
 *       author (from <prolog><author>), last_reviewed (from <critdates>)
 *     body                  — prose text with XML tags stripped, structure
 *                              markers preserved (headings, list items, table
 *                              cells separated by | so DL-01 detection works)
 *     diagnostics:
 *       sourceFormat:        'dita' | 'ditamap'
 *       topicType:           'concept' | 'task' | 'reference' | 'topic' | null
 *       extractor:           '_dita-extractor.mjs@v1'
 *       warnings:            []   // e.g., conref unresolved, missing title
 *   }
 *
 * Design rationale (this is v1, deliberately conservative):
 *   - Regex-based, not full XML parser. CMS-published DITA is usually clean
 *     enough that a stripping approach works; if it isn't, we'll find out
 *     when the validator schemas reject the synthetic frontmatter. The
 *     full-parser upgrade path is documented in
 *     .github/case-study/dita-md-conversion.md.
 *   - Map common DITA inlines to MD-shaped output so existing rule patterns
 *     match without modification:
 *       <uicontrol>X</uicontrol>  → **X**
 *       <filepath>X</filepath>    → `X`
 *       <userinput>X</userinput>  → `X`
 *       <codeph>X</codeph>        → `X`
 *       <ph>X</ph>                → X (just inline text)
 *       <keyword>X</keyword>      → X
 *   - Tables: convert <simpletable>/<table> to pipe-table form so DL-01's
 *     reconstruction heuristic doesn't fire false positives.
 *   - Steps: convert <step>/<cmd> to "1. " numbered list items.
 *   - Notes: convert <note type="X"> to ::: X / ::: admonition blocks.
 *   - Images: convert <image href="X"> to ![](X) (alt to be authored).
 *   - Conrefs: NOT resolved; emit warning and leave a placeholder.
 *
 * Zero dependencies. ESM. Pure functions (no I/O).
 */

const VERSION = '_dita-extractor.mjs@v1';

/**
 * Top-level entry point. Pass raw .dita / .ditamap content and a hint about
 * which format it is. Returns the extracted prose + synthetic frontmatter.
 *
 * @param {string} xml — raw file content
 * @param {object} opts — { sourceFormat?: 'dita'|'ditamap', filePath?: string }
 * @returns {{ frontmatter: object, body: string, diagnostics: object }}
 */
export function extractFromDita(xml, opts = {}) {
  const sourceFormat = opts.sourceFormat || inferSourceFormat(xml);
  const warnings = [];

  // ditamap is a special case — it's a navigation manifest, not a content
  // file. We extract topic references rather than prose.
  if (sourceFormat === 'ditamap') {
    return extractDitamap(xml, opts, warnings);
  }

  // Topic type (concept|task|reference|topic) — from the outer element
  const topicTypeMatch = xml.match(/<(concept|task|reference|topic)\b[^>]*>/i);
  const topicType = topicTypeMatch ? topicTypeMatch[1].toLowerCase() : null;

  // Title — first <title> outside <prolog>
  const titleMatch = xml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripInlineTags(titleMatch[1]).trim() : '';
  if (!title) warnings.push('No <title> found');

  // Description — <shortdesc> if present
  const shortdescMatch = xml.match(/<shortdesc\b[^>]*>([\s\S]*?)<\/shortdesc>/i);
  const description = shortdescMatch ? stripInlineTags(shortdescMatch[1]).trim() : '';

  // ID — outermost element's id attribute
  const idMatch = topicTypeMatch && xml.match(new RegExp(`<${topicTypeMatch[1]}\\b[^>]*\\bid="([^"]+)"`, 'i'));
  const id = idMatch ? idMatch[1] : '';

  // Keywords — <keyword> elements within <prolog>
  const prologMatch = xml.match(/<prolog\b[^>]*>([\s\S]*?)<\/prolog>/i);
  const keywords = [];
  if (prologMatch) {
    for (const m of prologMatch[1].matchAll(/<keyword\b[^>]*>([\s\S]*?)<\/keyword>/gi)) {
      const kw = stripInlineTags(m[1]).trim();
      if (kw) keywords.push(kw);
    }
  }

  // Author — <author> in <prolog>
  let author = '';
  if (prologMatch) {
    const authorMatch = prologMatch[1].match(/<author\b[^>]*>([\s\S]*?)<\/author>/i);
    if (authorMatch) author = stripInlineTags(authorMatch[1]).trim();
  }

  // Last reviewed — <revised modified="..."> in <critdates>
  let lastReviewed = '';
  if (prologMatch) {
    const revisedMatch = prologMatch[1].match(/<revised\b[^>]*\bmodified="([^"]+)"/i);
    if (revisedMatch) lastReviewed = revisedMatch[1];
  }

  // Body — <conbody>, <taskbody>, <refbody>, or <body>
  const bodyMatch = xml.match(/<(conbody|taskbody|refbody|body)\b[^>]*>([\s\S]*?)<\/\1>/i);
  const rawBody = bodyMatch ? bodyMatch[2] : '';
  if (!rawBody) warnings.push('No body element found');
  const body = ditaBodyToProse(rawBody, warnings);

  // Synthetic frontmatter — shape matches the markdown frontmatter the
  // existing Librarian / dashboard.config.js expects, so pods can operate
  // on this without knowing it came from DITA.
  const frontmatter = {
    title: title || undefined,
    description: description || undefined,
    id: id || undefined,
    content_type: contentTypeForTopic(topicType),
    keywords: keywords.length ? keywords : undefined,
    author: author || undefined,
    last_reviewed: lastReviewed || undefined,
    _source: 'dita',
    _topicType: topicType || undefined,
  };

  return {
    frontmatter: stripUndefined(frontmatter),
    body,
    diagnostics: { sourceFormat: 'dita', topicType, extractor: VERSION, warnings },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function inferSourceFormat(xml) {
  if (/<\?xml/i.test(xml) && /<map\b/i.test(xml)) return 'ditamap';
  if (/<map\b[^>]*>/i.test(xml.slice(0, 500))) return 'ditamap';
  return 'dita';
}

function contentTypeForTopic(topicType) {
  switch (topicType) {
    case 'concept':   return 'Concept';
    case 'task':      return 'Task';
    case 'reference': return 'Reference';
    case 'topic':     return 'Topic';
    default:          return undefined;
  }
}

function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

/**
 * Convert a DITA body (the content of <conbody>/<taskbody>/<refbody>/<body>)
 * into MD-shaped prose. Preserves structure markers (headings, lists, tables,
 * admonitions, images) so existing markdown rule patterns match cleanly.
 */
function ditaBodyToProse(rawBody, warnings) {
  let out = rawBody;

  // <section><title>X</title>...</section> → ## X\n\n...
  out = out.replace(/<section\b[^>]*>([\s\S]*?)<\/section>/gi, (m, inner) => {
    const titleMatch = inner.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const sectionTitle = titleMatch ? stripInlineTags(titleMatch[1]).trim() : '';
    const rest = inner.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, '').trim();
    return (sectionTitle ? `## ${sectionTitle}\n\n` : '') + rest;
  });

  // <note type="X">...</note> → :::X\n...\n:::
  out = out.replace(/<note\b([^>]*)>([\s\S]*?)<\/note>/gi, (m, attrs, inner) => {
    const typeMatch = attrs.match(/\btype="([^"]+)"/i);
    const noteType = typeMatch ? typeMatch[1].toLowerCase() : 'note';
    return `\n:::${noteType}\n${stripInlineTags(inner).trim()}\n:::\n`;
  });

  // <steps><step>X</step>...</steps> → 1. X\n2. ...\n
  out = out.replace(/<steps\b[^>]*>([\s\S]*?)<\/steps>/gi, (m, inner) => {
    let i = 0;
    const items = [];
    for (const stepMatch of inner.matchAll(/<step\b[^>]*>([\s\S]*?)<\/step>/gi)) {
      i++;
      const cmdMatch = stepMatch[1].match(/<cmd\b[^>]*>([\s\S]*?)<\/cmd>/i);
      const text = cmdMatch ? stripInlineTags(cmdMatch[1]).trim() : stripInlineTags(stepMatch[1]).trim();
      items.push(`${i}. ${text}`);
    }
    return '\n' + items.join('\n') + '\n';
  });

  // <ul><li>X</li>...</ul> and <ol><li>...</ol> → bullet / numbered lists
  out = out.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (m, inner) => {
    const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
      .map((mm) => `- ${stripInlineTags(mm[1]).trim()}`);
    return '\n' + items.join('\n') + '\n';
  });
  out = out.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (m, inner) => {
    let i = 0;
    const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
      .map((mm) => { i++; return `${i}. ${stripInlineTags(mm[1]).trim()}`; });
    return '\n' + items.join('\n') + '\n';
  });

  // <simpletable> / <table> → GFM pipe table. Maps <sthead>/<strow> with
  // <stentry>/<entry> children. Conservative: only the common 2D shape.
  out = out.replace(/<(simpletable|table)\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, tag, inner) => {
    const rows = [];
    let headerRow = null;
    for (const rowMatch of inner.matchAll(/<(sthead|strow|row)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const cells = [...rowMatch[2].matchAll(/<(stentry|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
        .map((cm) => stripInlineTags(cm[2]).trim().replace(/\|/g, '\\|'));
      const isHeader = rowMatch[1].toLowerCase() === 'sthead';
      if (isHeader) headerRow = cells;
      else rows.push(cells);
    }
    if (!headerRow && rows.length) {
      headerRow = rows.shift(); // promote first row to header
    }
    if (!headerRow) return ''; // empty table
    const lines = [`| ${headerRow.join(' | ')} |`, `| ${headerRow.map(() => '---').join(' | ')} |`];
    for (const r of rows) lines.push(`| ${r.join(' | ')} |`);
    return '\n' + lines.join('\n') + '\n';
  });

  // <codeblock outputclass="lang">...</codeblock> → ```lang ... ```
  out = out.replace(/<codeblock\b([^>]*)>([\s\S]*?)<\/codeblock>/gi, (m, attrs, inner) => {
    const langMatch = attrs.match(/\boutputclass="([^"]+)"/i);
    const lang = langMatch ? langMatch[1] : '';
    return `\n\`\`\`${lang}\n${inner.trim()}\n\`\`\`\n`;
  });

  // <image href="X" alt="Y"/> → ![Y](X) ; <image href="X"/> → ![](X)
  out = out.replace(/<image\b([^>]*)\/?>(?:<\/image>)?/gi, (m, attrs) => {
    const hrefMatch = attrs.match(/\bhref="([^"]+)"/i);
    const altMatch = attrs.match(/\balt="([^"]+)"/i);
    const href = hrefMatch ? hrefMatch[1] : '';
    const alt = altMatch ? altMatch[1] : '';
    return href ? `![${alt}](${href})` : '';
  });

  // Conrefs — emit warning, leave placeholder
  if (/conref="/i.test(out) || /conkeyref="/i.test(out)) {
    warnings.push('Unresolved conref / conkeyref in content — resolve before pod analysis');
    out = out.replace(/<[^>]*\b(conref|conkeyref)="([^"]+)"[^>]*\/?>/gi, '[[unresolved:$1=$2]]');
  }

  // Inline element mappings — apply before generic tag stripping so the
  // semantic mapping wins over plain text.
  out = mapInlineElements(out);

  // Strip remaining tags (paragraphs, miscellaneous wrappers); preserve
  // text content. Collapse whitespace runs but keep paragraph breaks.
  out = out.replace(/<p\b[^>]*>/gi, '\n\n').replace(/<\/p>/gi, '');
  out = out.replace(/<[^>]+>/g, '');

  // Decode XML entities. Keep this small — full entity decoding is unneeded.
  out = out
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

  // Normalize whitespace: trim per-line trailing space, collapse 3+ newlines
  // to 2 (paragraph break).
  out = out.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n');
  out = out.replace(/\n{3,}/g, '\n\n').trim();

  return out;
}

function mapInlineElements(text) {
  // <uicontrol>X</uicontrol> → **X**
  text = text.replace(/<uicontrol\b[^>]*>([\s\S]*?)<\/uicontrol>/gi, (m, inner) =>
    `**${stripInlineTags(inner).trim()}**`);
  // <filepath>, <userinput>, <codeph>, <varname> → `X`
  text = text.replace(/<(filepath|userinput|codeph|varname|systemoutput)\b[^>]*>([\s\S]*?)<\/\1>/gi,
    (m, tag, inner) => `\`${stripInlineTags(inner).trim()}\``);
  // <keyword>, <ph>, <term> → plain inline text (just unwrap)
  text = text.replace(/<(keyword|ph|term)\b[^>]*>([\s\S]*?)<\/\1>/gi,
    (m, tag, inner) => stripInlineTags(inner));
  return text;
}

function stripInlineTags(text) {
  return text.replace(/<[^>]+>/g, '').trim();
}

function extractDitamap(xml, opts, warnings) {
  // ditamap = navigation manifest. Extract title + topicrefs.
  const titleMatch = xml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripInlineTags(titleMatch[1]).trim() : '';
  const refs = [];
  for (const m of xml.matchAll(/<topicref\b[^>]*\bhref="([^"]+)"[^>]*\/?>/gi)) {
    refs.push(m[1]);
  }
  return {
    frontmatter: stripUndefined({
      title: title || undefined,
      _source: 'ditamap',
      _topicRefs: refs.length ? refs : undefined,
    }),
    body: '', // ditamaps don't have prose; pods that need prose should follow the topicrefs
    diagnostics: { sourceFormat: 'ditamap', topicType: null, extractor: VERSION, warnings, topicRefCount: refs.length },
  };
}
