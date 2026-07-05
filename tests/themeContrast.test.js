/**
 * WCAG AA contrast guard for the light theme (#13).
 *
 * The site defaults to the dark theme, but JS flips <html> to
 * data-theme="light" when the OS prefers light. Several light-theme text
 * tokens (--muted, --accent, tier colors) used to fall below WCAG AA, so the
 * page looked worse with JS enabled than with it disabled. This test parses
 * the light-theme token block out of base.css and asserts that every token
 * used as text clears AA (>=4.5:1) against the primary light surfaces.
 */
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(
  path.join(__dirname, '..', 'css', 'shared', 'base.css'),
  'utf8'
);

// Pull the first `[data-theme="light"] { ... }` block - the token overrides.
function lightTokenBlock() {
  const start = CSS.indexOf('[data-theme="light"]');
  expect(start).toBeGreaterThan(-1);
  const open = CSS.indexOf('{', start);
  const close = CSS.indexOf('}', open);
  return CSS.slice(open + 1, close);
}

function parseTokens(block) {
  const tokens = {};
  const re = /--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    tokens[m[1]] = m[2];
  }
  return tokens;
}

function luminance(hex) {
  const h = hex.replace('#', '');
  const chan = (i) => {
    let c = parseInt(h.slice(i, i + 2), 16) / 255;
    c = c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    return c;
  };
  return 0.2126 * chan(0) + 0.7152 * chan(2) + 0.0722 * chan(4);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const tokens = parseTokens(lightTokenBlock());

// Surfaces text can land on in the light theme.
const SURFACES = {
  bg: () => tokens.bg,
  s1: () => tokens.s1,
};

// Every token below is used as `color:` somewhere on light surfaces.
const TEXT_TOKENS = ['text', 'muted', 'accent', 'green', 'green-hi', 'gold', 'silver', 'bronze', 'red'];

const AA = 4.5;

describe('light theme WCAG AA contrast (#13)', () => {
  it('parses the light-theme token block', () => {
    expect(tokens.bg).toBeDefined();
    expect(tokens.s1).toBeDefined();
    expect(tokens.muted).toBeDefined();
  });

  for (const name of TEXT_TOKENS) {
    for (const [surfName, surf] of Object.entries(SURFACES)) {
      it(`--${name} clears AA on ${surfName}`, () => {
        const fg = tokens[name];
        expect(fg).toBeDefined();
        const ratio = contrast(fg, surf());
        expect(ratio).toBeGreaterThanOrEqual(AA);
      });
    }
  }
});
