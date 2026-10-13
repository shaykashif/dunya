// Incremental 64-bit (two 32-bit lanes) hash over the event stream.
// Pure JS so the engine stays free of Node or browser APIs.

export class StreamHasher {
  private h1 = 0x811c9dc5 | 0;
  private h2 = 0x9747b28c | 0;
  private length = 0;

  update(s: string): void {
    let h1 = this.h1, h2 = this.h2;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193);
      h2 = Math.imul(h2 ^ c, 0x5bd1e995);
      h2 ^= h2 >>> 15;
    }
    this.h1 = h1;
    this.h2 = h2;
    this.length += s.length;
  }

  digest(): string {
    let a = this.h1 ^ this.length, b = this.h2;
    a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
    b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
    return (b >>> 0).toString(16).padStart(8, "0") + (a >>> 0).toString(16).padStart(8, "0");
  }
}

export function hashLines(lines: Iterable<string>): string {
  const h = new StreamHasher();
  for (const line of lines) {
    h.update(line);
    h.update("\n");
  }
  return h.digest();
}
