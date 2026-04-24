import { describe, it, expect } from 'bun:test';
import {
    parsePaginationFilters,
    toRange,
    buildPaginatedResult,
    ALL_LIMIT_CAP,
    DEFAULT_PAGE,
    DEFAULT_LIMIT,
    MAX_NUMERIC_LIMIT,
} from '@/core/domain/pagination';

describe('parsePaginationFilters', () => {
    it('applies defaults when input is missing', () => {
        const p = parsePaginationFilters(undefined);
        expect(p.page).toBe(DEFAULT_PAGE);
        expect(p.limit).toBe(DEFAULT_LIMIT);
        expect(p.isAll).toBe(false);
    });

    it('accepts numeric page and limit within range', () => {
        const p = parsePaginationFilters({ page: 3, limit: 50 });
        expect(p.page).toBe(3);
        expect(p.limit).toBe(50);
        expect(p.isAll).toBe(false);
    });

    it('coerces numeric strings', () => {
        const p = parsePaginationFilters({ page: '4' as any, limit: '25' as any });
        expect(p.page).toBe(4);
        expect(p.limit).toBe(25);
    });

    it('clamps numeric limit above MAX_NUMERIC_LIMIT', () => {
        const p = parsePaginationFilters({ limit: 500 });
        expect(p.limit).toBe(MAX_NUMERIC_LIMIT);
    });

    it('clamps numeric limit below 1', () => {
        const p = parsePaginationFilters({ limit: 0 });
        expect(p.limit).toBe(1);
    });

    it('floors negative page to 1', () => {
        const p = parsePaginationFilters({ page: -5 });
        expect(p.page).toBe(1);
    });

    it('recognizes limit="all" case-insensitively', () => {
        expect(parsePaginationFilters({ limit: 'all' }).isAll).toBe(true);
        expect(parsePaginationFilters({ limit: 'ALL' }).isAll).toBe(true);
        expect(parsePaginationFilters({ limit: 'AlL' }).isAll).toBe(true);
    });

    it('sets limit to ALL_LIMIT_CAP when isAll', () => {
        const p = parsePaginationFilters({ limit: 'all' });
        expect(p.limit).toBe(ALL_LIMIT_CAP);
        expect(p.isAll).toBe(true);
    });
});

describe('toRange', () => {
    it('computes 0-based [from,to] for page 1', () => {
        const { from, to } = toRange({ page: 1, limit: 20, isAll: false });
        expect(from).toBe(0);
        expect(to).toBe(19);
    });

    it('computes bounds for a later page', () => {
        const { from, to } = toRange({ page: 3, limit: 10, isAll: false });
        expect(from).toBe(20);
        expect(to).toBe(29);
    });
});

describe('buildPaginatedResult — numeric limit', () => {
    it('wraps items with standard metadata', () => {
        const items = [1, 2, 3];
        const r = buildPaginatedResult(items, 50, { page: 2, limit: 3, isAll: false });

        expect(r.data).toEqual(items);
        expect(r.metadata).toEqual({
            total: 50,
            page: 2,
            limit: 3,
            total_pages: 17,
            has_next_page: true,
            has_prev_page: true,
        });
    });

    it('reports total_pages=0 and has_next_page=false when total=0', () => {
        const r = buildPaginatedResult<number>([], 0, { page: 1, limit: 20, isAll: false });
        expect(r.metadata.total).toBe(0);
        expect(r.metadata.total_pages).toBe(0);
        expect(r.metadata.has_next_page).toBe(false);
        expect(r.metadata.has_prev_page).toBe(false);
    });

    it('handles page past the end — data can be empty but metadata still accurate', () => {
        const r = buildPaginatedResult<number>([], 15, { page: 10, limit: 20, isAll: false });
        expect(r.data).toEqual([]);
        expect(r.metadata.total).toBe(15);
        expect(r.metadata.total_pages).toBe(1);
        expect(r.metadata.has_next_page).toBe(false);
        expect(r.metadata.has_prev_page).toBe(true); // page=10 > 1
    });
});

describe('buildPaginatedResult — limit=all', () => {
    it('when total fits under cap, reports 1 page and limit=items.length', () => {
        const items = Array.from({ length: 42 }, (_, i) => i);
        const r = buildPaginatedResult(items, 42, { page: 1, limit: ALL_LIMIT_CAP, isAll: true });

        expect(r.metadata.total).toBe(42);
        expect(r.metadata.page).toBe(1);
        expect(r.metadata.limit).toBe(42);
        expect(r.metadata.total_pages).toBe(1);
        expect(r.metadata.has_next_page).toBe(false);
    });

    it('when total exceeds cap, flags has_next_page=true so the client knows it was truncated', () => {
        const items = Array.from({ length: ALL_LIMIT_CAP }, (_, i) => i);
        const r = buildPaginatedResult(items, 15_000, { page: 1, limit: ALL_LIMIT_CAP, isAll: true });

        expect(r.data.length).toBe(ALL_LIMIT_CAP);
        expect(r.metadata.total).toBe(15_000);
        expect(r.metadata.limit).toBe(ALL_LIMIT_CAP);
        expect(r.metadata.total_pages).toBe(2); // ceil(15000 / 10000)
        expect(r.metadata.has_next_page).toBe(true);
    });

    it('empty result with isAll still produces well-formed metadata', () => {
        const r = buildPaginatedResult<number>([], 0, { page: 1, limit: ALL_LIMIT_CAP, isAll: true });
        expect(r.metadata.total).toBe(0);
        expect(r.metadata.total_pages).toBe(0);
        expect(r.metadata.has_next_page).toBe(false);
        expect(r.metadata.limit).toBe(0);
    });
});
