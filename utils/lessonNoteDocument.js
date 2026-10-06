export const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const safeLink = value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
};

const renderInline = (value, attributes = {}) => {
  let html = escapeHtml(value);
  if (attributes.code) html = `<code>${html}</code>`;
  if (attributes.bold) html = `<strong>${html}</strong>`;
  if (attributes.italic) html = `<em>${html}</em>`;
  if (attributes.underline) html = `<u>${html}</u>`;
  if (attributes.strike) html = `<s>${html}</s>`;
  if (attributes.script === 'sub') html = `<sub>${html}</sub>`;
  if (attributes.script === 'super') html = `<sup>${html}</sup>`;

  const styles = [];
  if (/^#[\da-f]{3,8}$/i.test(attributes.color || '')) styles.push(`color:${attributes.color}`);
  if (/^#[\da-f]{3,8}$/i.test(attributes.background || '')) styles.push(`background-color:${attributes.background}`);
  if (attributes.font === 'serif') styles.push('font-family:serif');
  if (attributes.font === 'monospace') styles.push('font-family:monospace');
  if (['small', 'large', 'huge'].includes(attributes.size)) {
    styles.push(`font-size:${{ small: '0.75em', large: '1.5em', huge: '2.5em' }[attributes.size]}`);
  }
  if (styles.length) html = `<span style="${styles.join(';')}">${html}</span>`;

  const href = attributes.link ? safeLink(attributes.link) : '';
  return href ? `<a href="${escapeHtml(href)}">${html}</a>` : html;
};

const blockHtml = (content, attributes = {}) => {
  const alignment = ['center', 'right', 'justify'].includes(attributes.align)
    ? ` style="text-align:${attributes.align}"`
    : '';
  const indent = Number(attributes.indent);
  const indentStyle = Number.isInteger(indent) && indent > 0 && indent <= 8
    ? ` style="margin-left:${indent * 2}em"`
    : '';
  const style = alignment && indentStyle
    ? ` style="text-align:${attributes.align};margin-left:${indent * 2}em"`
    : alignment || indentStyle;

  if (attributes.header) {
    const level = Math.min(Math.max(Number(attributes.header), 1), 6);
    return `<h${level}${style}>${content || '<br>'}</h${level}>`;
  }
  if (attributes.blockquote) return `<blockquote${style}>${content || '<br>'}</blockquote>`;
  if (attributes['code-block']) return `<pre${style}><code>${content}</code></pre>`;
  if (attributes.list === 'ordered') return `<ol${style}><li>${content}</li></ol>`;
  if (attributes.list === 'bullet') return `<ul${style}><li>${content}</li></ul>`;
  return `<p${style}>${content || '<br>'}</p>`;
};

export const lessonNoteContentHtml = storedContent => {
  let delta;
  try {
    delta = typeof storedContent === 'string' ? JSON.parse(storedContent) : storedContent;
  } catch {
    return '';
  }

  if (!delta || !Array.isArray(delta.ops)) return '';

  const blocks = [];
  let current = '';
  for (const operation of delta.ops) {
    if (typeof operation.insert === 'string') {
      const pieces = operation.insert.split('\n');
      pieces.forEach((piece, index) => {
        if (piece) current += renderInline(piece, operation.attributes);
        if (index < pieces.length - 1) {
          blocks.push(blockHtml(current, operation.attributes));
          current = '';
        }
      });
    } else if (operation.insert?.image) {
      const source = String(operation.insert.image);
      if (/^(https?:\/\/|data:image\/(png|jpeg|gif|webp);base64,)/i.test(source)) {
        current += `<img src="${escapeHtml(source)}" alt="Lesson note image" style="max-width:100%">`;
      }
    }
  }
  if (current) blocks.push(blockHtml(current));

  return blocks.join('');
};

const lessonPlanSubjectName = note => {
  const subjectName = String(note.subject_name || 'Learning Area').trim();
  return /\slesson plan$/i.test(subjectName) ? subjectName : `${subjectName} Lesson Plan`;
};

export const lessonNoteDocumentHtml = note => {
  const subjectName = lessonPlanSubjectName(note);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(subjectName)}</title>
<style>body{font-family:Calibri,Arial,sans-serif;line-height:1.5;margin:2cm;color:#222}h1{font-size:22pt}h2{font-size:16pt}table{border-collapse:collapse}img{max-width:100%}blockquote{border-left:3px solid #888;margin-left:0;padding-left:1em;color:#555}pre{white-space:pre-wrap;background:#f4f4f4;padding:1em}</style>
</head><body><h1>${escapeHtml(note.school_name || subjectName)}</h1>
${note.school_name ? `<h2>${escapeHtml(subjectName)}</h2>` : ''}
<p><strong>Name:</strong> ${escapeHtml(note.school_name || '')} &nbsp; <strong>Grade:</strong> ${escapeHtml(note.grade)} &nbsp; <strong>Term:</strong> ${escapeHtml(note.term)} &nbsp; <strong>Week:</strong> ${escapeHtml(note.week_no)} &nbsp; <strong>Lesson:</strong> ${escapeHtml(note.lesson_no)} &nbsp; <strong>Roll:</strong> ${escapeHtml(note.roll || '')} &nbsp; <strong>Time:</strong> ${escapeHtml(note.lesson_time || '')}</p>
<p><strong>Strand:</strong> ${escapeHtml(note.strand)}<br><strong>Sub-Strand:</strong> ${escapeHtml(note.sub_strand)}</p>
<hr>${lessonNoteContentHtml(note.lesson_content)}</body></html>`;
};

export const lessonNoteFilename = note => {
  const safeSubject = String(note.subject_name || 'learning-area')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `lesson-plan-grade-${note.grade}-${safeSubject}-term-${note.term}.doc`;
};