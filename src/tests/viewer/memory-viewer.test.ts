import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExpress, mockUse, mockGet, mockPost } = vi.hoisted(() => {
    const mockUse = vi.fn();
    const mockGet = vi.fn();
    const mockPost = vi.fn();
    const mockApp = {
        use: mockUse,
        get: mockGet,
        post: mockPost,
        listen: vi.fn(),
    };
    const mockExpress = vi.fn(() => mockApp);
    (mockExpress as any).json = vi.fn();
    (mockExpress as any).urlencoded = vi.fn();

    return { mockExpress, mockUse, mockGet, mockPost };
});

vi.mock('express', () => ({
    default: mockExpress,
}));

import { MemoryViewer } from '../../viewer/memory-viewer.js';
import type { ViewerConfig } from '../../viewer/types.js';
import type { Request, Response, NextFunction } from 'express';

describe('MemoryViewer Auth', () => {
    let mockPool: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockPool = {
            query: vi.fn(),
            end: vi.fn(),
        };
    });

    it('should throw error if authEnabled is true but authToken is missing', () => {
        const config: ViewerConfig = {
            port: 3000,
            authEnabled: true,
            authToken: undefined,
            pool: mockPool,
        };

        expect(() => new MemoryViewer(config)).toThrow('Authentication is enabled but authToken is missing or empty');
    });

    it('should throw error if authEnabled is true but authToken is empty string', () => {
        const config: ViewerConfig = {
            port: 3000,
            authEnabled: true,
            authToken: '',
            pool: mockPool,
        };

        expect(() => new MemoryViewer(config)).toThrow('Authentication is enabled but authToken is missing or empty');
    });

    it('should throw error if authEnabled is true but authToken is whitespace', () => {
        const config: ViewerConfig = {
            port: 3000,
            authEnabled: true,
            authToken: '   ',
            pool: mockPool,
        };

        expect(() => new MemoryViewer(config)).toThrow('Authentication is enabled but authToken is missing or empty');
    });

    it('should not throw error if authEnabled is false', () => {
        const config: ViewerConfig = {
            port: 3000,
            authEnabled: false,
            authToken: undefined,
            pool: mockPool,
        };

        expect(() => new MemoryViewer(config)).not.toThrow();
    });

    // Helper to get auth middleware
    const getAuthMiddleware = () => {
        // Find the middleware that takes 3 arguments (req, res, next)
        // Note: express.json() and urlencoded() might also return handlers, 
        // but usually they are registered first. 
        // In MemoryViewer:
        // this.app.use(express.json());
        // this.app.use(express.urlencoded({ extended: true }));
        // if (authEnabled) this.setupAuth(); -> this.app.use(middleware)

        // So it should be the 3rd call to use? Or we can check function signature.
        // The auth middleware is an arrow function in setupAuth, so it has length 3.
        // express.json() returns a function with length 3 too usually.
        // But we can check behavior or just assume order.
        // Let's iterate and find the one that behaves like our auth middleware?
        // Or simpler: we know it's added last in constructor if authEnabled.
        // Actually setupRoutes is called after setupAuth.

        // Let's filter for functions.
        const calls = mockUse.mock.calls;
        // We expect at least 3 calls: json, urlencoded, auth.
        // The auth one is defined inline in setupAuth.

        // Let's just try the last one that is a function.
        for (let i = calls.length - 1; i >= 0; i--) {
            const arg = calls[i][0];
            if (typeof arg === 'function' && arg.length === 3) {
                return arg;
            }
        }
        return undefined;
    };

    it('middleware should accept valid token', () => {
        const config: ViewerConfig = {
            port: 3000,
            authEnabled: true,
            authToken: 'valid-token',
            pool: mockPool,
        };
        new MemoryViewer(config);

        const authMiddleware = getAuthMiddleware();
        expect(authMiddleware).toBeDefined();

        const req = {
            path: '/memories',
            headers: { authorization: 'Bearer valid-token' }
        } as unknown as Request;
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        } as unknown as Response;
        const next = vi.fn();

        authMiddleware!(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('middleware should reject invalid token', () => {
        const config: ViewerConfig = {
            port: 3000,
            authEnabled: true,
            authToken: 'valid-token',
            pool: mockPool,
        };
        new MemoryViewer(config);

        const authMiddleware = getAuthMiddleware();

        const req = {
            path: '/memories',
            headers: { authorization: 'Bearer invalid' }
        } as unknown as Request;
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        } as unknown as Response;
        const next = vi.fn();

        authMiddleware!(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: Invalid token' });
    });

    it('middleware should reject missing header', () => {
        const config: ViewerConfig = {
            port: 3000,
            authEnabled: true,
            authToken: 'valid-token',
            pool: mockPool,
        };
        new MemoryViewer(config);

        const authMiddleware = getAuthMiddleware();

        const req = {
            path: '/memories',
            headers: {}
        } as unknown as Request;
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        } as unknown as Response;
        const next = vi.fn();

        authMiddleware!(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: No authorization header' });
    });

    it('middleware should reject empty token', () => {
        const config: ViewerConfig = {
            port: 3000,
            authEnabled: true,
            authToken: 'valid-token',
            pool: mockPool,
        };
        new MemoryViewer(config);

        const authMiddleware = getAuthMiddleware();

        const req = {
            path: '/memories',
            headers: { authorization: 'Bearer ' }
        } as unknown as Request;
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        } as unknown as Response;
        const next = vi.fn();

        authMiddleware!(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('middleware should handle buffer length mismatch gracefully', () => {
        const config: ViewerConfig = {
            port: 3000,
            authEnabled: true,
            authToken: 'abc', // 3 bytes
            pool: mockPool,
        };
        new MemoryViewer(config);

        const authMiddleware = getAuthMiddleware();

        const req = {
            path: '/memories',
            headers: { authorization: 'Bearer ab©' } // 3 chars, 4 bytes
        } as unknown as Request;
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        } as unknown as Response;
        const next = vi.fn();

        authMiddleware!(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('middleware should allow health check without token', () => {
        const config: ViewerConfig = {
            port: 3000,
            authEnabled: true,
            authToken: 'valid-token',
            pool: mockPool,
        };
        new MemoryViewer(config);

        const authMiddleware = getAuthMiddleware();

        const req = {
            path: '/health',
            headers: {}
        } as unknown as Request;
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        } as unknown as Response;
        const next = vi.fn();

        authMiddleware!(req, res, next);
        expect(next).toHaveBeenCalled();
    });
});
