import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODERATION_MESSAGES, moderate, moderateText, refusalMessage } from './moderate';

afterEach(() => vi.unstubAllGlobals());

const okBody = { flagged: false, categories: [], results: [{ flagged: false, categories: [] }] };

describe('moderate', () => {
  it('sends the inputs to the same-origin endpoint and returns ok', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(okBody), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await moderateText('a lovely ridge walk');
    expect(result.verdict).toBe('ok');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/moderate');
    expect(JSON.parse(String(init.body))).toEqual({ inputs: [{ type: 'text', text: 'a lovely ridge walk' }] });
  });

  it('reports flagged with per-input flags in order', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      flagged: true,
      categories: ['harassment'],
      results: [{ flagged: false, categories: [] }, { flagged: true, categories: { harassment: true } }],
    }), { status: 200 })));
    const result = await moderate([
      { type: 'image', base64: 'AAAA' },
      { type: 'text', text: 'nasty words' },
    ]);
    expect(result).toEqual({ verdict: 'flagged', flagged: [false, true] });
  });

  it('answers unknown, never a block, when the endpoint is missing or fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    expect((await moderateText('x')).verdict).toBe('unknown');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect((await moderateText('x')).verdict).toBe('unknown');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));
    expect((await moderateText('x')).verdict).toBe('unknown');
  });

  it('answers ok without a call for empty input', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await moderate([])).verdict).toBe('ok');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('refusalMessage', () => {
  it('picks the sentence for the flagged input', () => {
    const flagged = { verdict: 'flagged' as const, flagged: [true, false] };
    expect(refusalMessage(flagged, [MODERATION_MESSAGES.photo, MODERATION_MESSAGES.caption])).toBe(MODERATION_MESSAGES.photo);
    expect(refusalMessage({ verdict: 'flagged', flagged: [false, true] }, [MODERATION_MESSAGES.photo, MODERATION_MESSAGES.caption])).toBe(MODERATION_MESSAGES.caption);
  });

  it('falls back to the first sentence when flags are missing', () => {
    expect(refusalMessage({ verdict: 'flagged', flagged: null }, [MODERATION_MESSAGES.comment])).toBe(MODERATION_MESSAGES.comment);
  });

  it('is null for ok and unknown verdicts', () => {
    expect(refusalMessage({ verdict: 'ok', flagged: [false] }, [MODERATION_MESSAGES.comment])).toBeNull();
    expect(refusalMessage({ verdict: 'unknown', flagged: null }, [MODERATION_MESSAGES.comment])).toBeNull();
  });
});
