/**
 * Unit tests — reference-link parsing (issue #90 review R2/R3).
 *
 * One parser backs save, open and display. `new URL()` is the platform
 * parser: it rejects malformed authorities and invalid ports, normalizes
 * IDNs and default ports. A stored row can predate this check, so the parser
 * must return null (not throw) for anything unusable.
 */
import { parseReferenceUrl, referenceDomain } from './reference-url';

describe('parseReferenceUrl', () => {
  it('accepts absolute http(s) links', () => {
    expect(parseReferenceUrl('https://example.com/thesis')?.domain).toBe('example.com');
    expect(parseReferenceUrl('http://example.com')?.domain).toBe('example.com');
    expect(parseReferenceUrl('HTTPS://EXAMPLE.COM')?.url.protocol).toBe('https:');
  });

  it('keeps a non-default port in the display domain', () => {
    expect(parseReferenceUrl('https://www.Example.com:8443/x')?.domain).toBe(
      'example.com:8443',
    );
    expect(parseReferenceUrl('https://example.com:443/x')?.domain).toBe('example.com');
  });

  it('accepts IP hosts, single-label hosts and IDN hosts', () => {
    expect(parseReferenceUrl('https://127.0.0.1:8080/x')?.domain).toBe('127.0.0.1:8080');
    expect(parseReferenceUrl('https://[::1]/x')?.domain).toBe('[::1]');
    expect(parseReferenceUrl('https://example')?.domain).toBe('example');
    // Browsers normalize the Unicode host to punycode; React Native's URL
    // polyfill keeps it. Both are a valid parse of the same address.
    const idn = parseReferenceUrl('https://例子.测试/文档');
    expect(idn).not.toBeNull();
    expect(['例子.测试', 'xn--fsqu00a.xn--0zwm56d']).toContain(idn?.domain);
  });

  it('rejects unsupported schemes and missing schemes', () => {
    expect(parseReferenceUrl('ftp://example.com/file')).toBeNull();
    expect(parseReferenceUrl('file:///tmp/reference.txt')).toBeNull();
    expect(parseReferenceUrl('javascript:alert(1)')).toBeNull();
    expect(parseReferenceUrl('example.com')).toBeNull();
  });

  it('rejects malformed authorities and invalid ports', () => {
    expect(parseReferenceUrl('')).toBeNull();
    expect(parseReferenceUrl('   ')).toBeNull();
    expect(parseReferenceUrl('https://')).toBeNull();
    expect(parseReferenceUrl('https://exa mple.com')).toBeNull();
    expect(parseReferenceUrl('https://example.com:invalid-port/path')).toBeNull();
    expect(parseReferenceUrl('https://example.com:99999/')).toBeNull();
  });
});

describe('referenceDomain', () => {
  it('returns null for a missing or invalid link', () => {
    expect(referenceDomain(undefined)).toBeNull();
    expect(referenceDomain('')).toBeNull();
    expect(referenceDomain('file:///tmp/x')).toBeNull();
  });

  it('returns the parsed domain for a usable link', () => {
    expect(referenceDomain('https://www.example.com/x')).toBe('example.com');
  });
});
