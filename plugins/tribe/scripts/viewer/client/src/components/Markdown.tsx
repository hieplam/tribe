// client/src/components/Markdown.tsx — maps `MdToken[]` to real React elements (spec §4, §8.1).
// There is NO HTML string anywhere in the client: no raw-HTML injection sink, no string
// concatenation into markup. The server already parsed the transcript into tokens; this component
// only chooses an element per token, so the structural wall (§12.6.2) holds by construction.
import type { ReactNode } from 'react';
import type { MdToken } from '../../../core/model.ts';

/** A conservative client-side href gate (`fail-closed-edges`). The server already gates link hrefs
 * (§4: "href gated exactly as today"), but the client refuses to emit an `href` attribute it cannot
 * itself prove safe — a `javascript:`/`data:` URL renders as its label text with no link. Absolute
 * `http(s)`/`mailto:` and same-document relative (`/`, `#`, `./`, `../`) references pass. */
function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^(https?:|mailto:)/i.test(h)) return h;
  if (/^(\/|#|\.\/|\.\.\/)/.test(h)) return h;
  return null;
}

function renderToken(token: MdToken, key: number): ReactNode {
  switch (token.t) {
    case 'text':
      return <span key={key}>{token.v}</span>;
    case 'code':
      return (
        <pre key={key} style={{ background: 'var(--surface)', fontFamily: 'var(--font-mono)' }}>
          <code data-lang={token.lang ?? undefined}>{token.v}</code>
        </pre>
      );
    case 'inline-code':
      return (
        <code key={key} style={{ background: 'var(--surface)', fontFamily: 'var(--font-mono)' }}>
          {token.v}
        </code>
      );
    case 'strong':
      return <strong key={key}>{renderTokens(token.c)}</strong>;
    case 'em':
      return <em key={key}>{renderTokens(token.c)}</em>;
    case 'link': {
      const href = safeHref(token.href);
      if (href === null) return <span key={key}>{renderTokens(token.c)}</span>;
      return (
        <a key={key} href={href} style={{ color: 'var(--accent)' }}>
          {renderTokens(token.c)}
        </a>
      );
    }
    case 'heading': {
      const H = `h${token.level}` as const;
      return <H key={key}>{renderTokens(token.c)}</H>;
    }
    case 'li':
      return <li key={key} data-ordered={token.ordered ? 'true' : 'false'}>{renderTokens(token.c)}</li>;
    case 'br':
      return <br key={key} />;
  }
}

function renderTokens(tokens: MdToken[]): ReactNode {
  return tokens.map((t, i) => renderToken(t, i));
}

export function Markdown({ tokens }: { tokens: MdToken[] }) {
  return <span className="md">{renderTokens(tokens)}</span>;
}
