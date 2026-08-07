import { useId, useState } from 'react';
import { lookupTerm } from './glossary';

/**
 * A dashed-underline term that reveals its plain-language definition.
 *
 * Keyboard and screen-reader accessible: it is a real button with the
 * definition associated by `aria-describedby`, so the explanation is available
 * without a pointer.
 */
export function Jargon({ term, children }: { term: string; children?: React.ReactNode }) {
  const entry = lookupTerm(term);
  const [open, setOpen] = useState(false);
  const id = useId();

  if (!entry) return <>{children ?? term}</>;

  return (
    <span className="jargon-wrap">
      <button
        type="button"
        className="jargon"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen(true)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {children ?? entry.term}
      </button>
      {open && (
        <span role="tooltip" id={id} className="jargon-tip">
          <strong>{entry.term}</strong>
          <span>{entry.long}</span>
        </span>
      )}
    </span>
  );
}

/**
 * Renders text with any known glossary terms wrapped as tooltips, so
 * explanations can be authored as plain strings without markup.
 */
export function AnnotatedText({ text, terms }: { text: string; terms: readonly string[] }) {
  if (terms.length === 0) return <>{text}</>;

  const pattern = new RegExp(`\\b(${terms.map(escapeRegExp).join('|')})\\b`, 'gi');
  const pieces: React.ReactNode[] = [];
  let lastIndex = 0;
  let match = pattern.exec(text);
  let key = 0;

  while (match) {
    if (match.index > lastIndex) pieces.push(text.slice(lastIndex, match.index));
    pieces.push(<Jargon key={`t${key += 1}`} term={match[0]}>{match[0]}</Jargon>);
    lastIndex = match.index + match[0].length;
    match = pattern.exec(text);
  }
  if (lastIndex < text.length) pieces.push(text.slice(lastIndex));
  return <>{pieces}</>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
