/**
 * Decode base64 string, works in both Node.js and browser
 */
export function decodeBase64(str: string): string {
  if (typeof window === 'undefined') {
    // Node.js environment
    try {
      // @ts-ignore - require is needed for Node.js environment
      // eslint-disable-next-line
      const Buffer = require('buffer').Buffer;
      return Buffer.from(str, 'base64').toString('utf-8');
    } catch {
      return str;
    }
  } else {
    // Browser environment
    try {
      return atob(str);
    } catch {
      return str;
    }
  }
}

/**
 * Check if string looks like base64
 */
export function isBase64(str: string): boolean {
  return str.length > 20 && /^[A-Za-z0-9+/=]+$/.test(str);
}

