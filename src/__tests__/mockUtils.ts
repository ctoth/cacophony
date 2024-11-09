import { AudioBuffer, AudioContext } from "standardized-audio-context-mock";
import { vi } from "vitest";

export const createMockArrayBuffer = (size = 8) => new ArrayBuffer(size);

export const createMockAudioBuffer = (options: {
  length?: number;
  sampleRate?: number;
  numberOfChannels?: number;
} = {}) => 
  new AudioBuffer({ 
    length: options.length || 100, 
    sampleRate: options.sampleRate || 44100,
    numberOfChannels: options.numberOfChannels || 1
  });

export const mockResponses = {
  success: (arrayBuffer: ArrayBuffer, headers: Record<string, string> = {}) => ({
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(arrayBuffer),
    clone: function() { 
      return mockResponses.success(arrayBuffer, headers);
    },
    headers: new Headers({
      'ETag': 'W/"123"',
      'Last-Modified': new Date().toUTCString(),
      'Date': new Date().toUTCString(),
      ...headers
    })
  }),

  notModified: (headers: Record<string, string> = {}) => ({
    ok: true,
    status: 304,
    clone: function() { return this; },
    headers: new Headers(headers)
  }),

  error: (status = 404, statusText = 'Not Found', headers: Record<string, string> = {}) => ({
    ok: false,
    status,
    statusText,
    clone: function() { 
      return mockResponses.error(status, statusText, headers);
    },
    headers: new Headers({
      'Date': new Date().toUTCString(),
      ...headers
    })
  })
};

export const mockCache = () => ({
  match: vi.fn(),
  put: vi.fn(),
  delete: vi.fn()
});

export const mockCacheStorage = () => ({
  open: vi.fn().mockResolvedValue(mockCache())
});

// Helper to simulate network conditions
export const mockNetworkConditions = {
  timeout: () => new Promise((_, reject) => {
    reject(new Error('Network timeout'));
  }),
  offline: () => Promise.reject(new Error('Network error: offline')),
  slow: async () => {
    await new Promise(resolve => setTimeout(resolve, 2000));
    return mockResponses.success(createMockArrayBuffer());
  }
};

// Helper to create test audio data
export const createTestAudioData = {
  small: () => createMockArrayBuffer(1024), // 1KB
  medium: () => createMockArrayBuffer(1024 * 1024), // 1MB
  large: () => createMockArrayBuffer(10 * 1024 * 1024), // 10MB
  invalid: () => new ArrayBuffer(0)
};

// Helper to create test URLs
export const createTestUrls = {
  audio: (id: number | string) => `https://example.com/audio${id}.mp3`,
  dataUrl: (content: string) => `data:audio/wav;base64,${btoa(content)}`,
  invalid: () => 'invalid://url',
  expired: (id: number | string) => `https://example.com/expired${id}.mp3`
};

// Helper to create cache metadata
export const createMetadata = (url: string, options: {
  etag?: string;
  lastModified?: string;
  timestamp?: number;
} = {}) => ({
  url,
  etag: options.etag || 'W/"123"',
  lastModified: options.lastModified || new Date().toUTCString(),
  timestamp: options.timestamp || Date.now()
});

// Helper to simulate cache states
export const createCacheState = {
  empty: () => mockCache(),
  withEntry: (url: string, arrayBuffer: ArrayBuffer, metadata: any) => {
    const cache = mockCache();
    cache.match.mockImplementation((key: string) => {
      if (key === url) {
        return Promise.resolve(mockResponses.success(arrayBuffer));
      }
      if (key === `${url}:meta`) {
        return Promise.resolve(new Response(JSON.stringify(metadata)));
      }
      return Promise.resolve(undefined);
    });
    return cache;
  },
  corrupted: (url: string) => {
    const cache = mockCache();
    cache.match.mockImplementation((key: string) => {
      if (key === url) {
        return Promise.resolve(new Response(null, { status: 500 }));
      }
      return Promise.resolve(undefined);
    });
    return cache;
  },
  expired: (url: string, arrayBuffer: ArrayBuffer) => {
    const expiredMetadata = createMetadata(url, {
      timestamp: Date.now() - (25 * 60 * 60 * 1000) // 25 hours ago
    });
    return createCacheState.withEntry(url, arrayBuffer, expiredMetadata);
  }
};

// Helper to simulate error conditions
export const simulateError = {
  network: () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
  },
  decode: (context: AudioContext) => {
    vi.spyOn(context, 'decodeAudioData')
      .mockRejectedValue(new Error('Decode error'));
  },
  cache: () => {
    const error = new Error('Cache error');
    return {
      match: vi.fn().mockRejectedValue(error),
      put: vi.fn().mockRejectedValue(error),
      delete: vi.fn().mockRejectedValue(error)
    };
  },
  storage: () => {
    const error = new DOMException('Quota exceeded', 'QuotaExceededError');
    return {
      match: vi.fn().mockRejectedValue(error),
      put: vi.fn().mockRejectedValue(error),
      delete: vi.fn()
    };
  }
};
