// Plain text from provider HTML: the normalization behind the seeded 10-K quotes (from
// spike/checks/01-sec.ts htmlToText). Source.text is stored this way, and the T08 and T14
// quote checks compare against text normalized with this same function.

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  mdash: '—',
  ndash: '–',
  amp: '&',
};

// One pass over every entity, so an escaped entity (&amp;lt;) decodes only once.
const ENTITY = /&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi;

export function normalizeText(html: string): string {
  return html
    .replace(/<ix:header>[\s\S]*?<\/ix:header>/gi, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(ENTITY, (entity: string, hex?: string, decimal?: string, name?: string) => {
      if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
      const code = hex ? parseInt(hex, 16) : Number(decimal);
      // Untrusted input: an out of range code point stays as written instead of throwing.
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    })
    .replace(/\s+/g, ' ')
    .trim();
}
