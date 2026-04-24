/**
 * Uniform pagination contract for every list endpoint that returns a
 * collection.
 *
 * Route query shape (standard):
 *   ?page=<number, 1-indexed>         default 1
 *   ?limit=<number | "all">           default 20, clamp [1..100], "all" up to 10_000
 *
 * Response shape:
 *   { data: T[], metadata: { total, page, limit, total_pages, has_next_page, has_prev_page } }
 *
 * The helpers here encapsulate:
 *   1. Normalizing the raw page/limit input (parsePaginationFilters).
 *   2. Computing the page range for the repo (toRange).
 *   3. Building the response wrapper once we have the items + total
 *      (buildPaginatedResult).
 *
 * Every paginated endpoint MUST go through these helpers so the
 * defaults / clamping / metadata math stays consistent.
 */

export interface PaginatedResult<T> {
    data: T[];
    metadata: {
        total: number;
        page: number;
        limit: number;
        total_pages: number;
        has_next_page: boolean;
        has_prev_page: boolean;
    };
}

/**
 * Raw, untrusted pagination input coming in from a request query.
 * `limit` can be a number or the literal "all" string. Everything is
 * optional — missing fields fall back to the defaults.
 */
export interface PaginationInput {
    page?: number | string;
    limit?: number | string;
}

/**
 * Normalized, domain-internal filter. After parsePaginationFilters()
 * these are trustworthy values: page is >= 1, limit is one of
 * "bounded integer" or the "all" sentinel.
 */
export interface PaginationFilters {
    page: number;
    limit: number;      // the effective numeric limit (up to cap). 'all' is represented by ALL_LIMIT_CAP.
    isAll: boolean;     // true if the caller asked for limit=all — the route may want to reflect this in metadata.limit.
}

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_NUMERIC_LIMIT = 100;
/** Hard cap for `limit=all`. Requests beyond this get truncated; the metadata signals there is more. */
export const ALL_LIMIT_CAP = 10_000;

/**
 * Turn the raw query input into trustworthy numeric values.
 *
 * Rules:
 *  - page: coerced to int. < 1 or not parseable → 1.
 *  - limit = "all" → capped to ALL_LIMIT_CAP, isAll=true.
 *  - limit numeric out of [1..MAX_NUMERIC_LIMIT] → silently clamped.
 *  - limit not parseable → DEFAULT_LIMIT.
 *
 * We DO NOT throw on bad input; Elysia's schema layer is expected to
 * catch non-numeric / non-"all" values before we get here.
 */
export function parsePaginationFilters(input: PaginationInput | undefined): PaginationFilters {
    const rawPage = input?.page;
    const rawLimit = input?.limit;

    let page = DEFAULT_PAGE;
    if (typeof rawPage === 'number' && Number.isFinite(rawPage)) {
        page = Math.max(1, Math.floor(rawPage));
    } else if (typeof rawPage === 'string' && rawPage.trim() !== '') {
        const parsed = Number.parseInt(rawPage, 10);
        if (Number.isFinite(parsed)) page = Math.max(1, parsed);
    }

    let limit = DEFAULT_LIMIT;
    let isAll = false;

    if (typeof rawLimit === 'string' && rawLimit.toLowerCase() === 'all') {
        limit = ALL_LIMIT_CAP;
        isAll = true;
    } else if (typeof rawLimit === 'number' && Number.isFinite(rawLimit)) {
        limit = clampNumericLimit(Math.floor(rawLimit));
    } else if (typeof rawLimit === 'string' && rawLimit.trim() !== '') {
        const parsed = Number.parseInt(rawLimit, 10);
        if (Number.isFinite(parsed)) limit = clampNumericLimit(parsed);
    }

    return { page, limit, isAll };
}

function clampNumericLimit(n: number): number {
    if (n < 1) return 1;
    if (n > MAX_NUMERIC_LIMIT) return MAX_NUMERIC_LIMIT;
    return n;
}

/**
 * 0-based [from, to] inclusive bounds for a Supabase `.range()` call
 * built from the normalized filters.
 */
export function toRange(filters: PaginationFilters): { from: number; to: number } {
    const from = (filters.page - 1) * filters.limit;
    const to = from + filters.limit - 1;
    return { from, to };
}

/**
 * Assemble the standardized { data, metadata } wrapper.
 *
 * `items` is whatever the repo returned; `total` is the count of rows
 * matching the filters BEFORE pagination. `filters` is the normalized
 * pagination input used to fetch `items`.
 *
 * When isAll was requested:
 *   - metadata.limit reflects how many rows were actually sent
 *     (= items.length). That's the usual client-intuitive value.
 *   - If `total` > ALL_LIMIT_CAP, items got truncated. metadata then
 *     reports total_pages = Math.ceil(total / ALL_LIMIT_CAP) and
 *     has_next_page = true, signalling "there is more — page again".
 *
 * When isAll=false (normal numeric limit):
 *   - metadata.limit = filters.limit (the effective cap applied).
 *   - total_pages = Math.ceil(total / limit). If total===0, total_pages=0.
 */
export function buildPaginatedResult<T>(
    items: T[],
    total: number,
    filters: PaginationFilters
): PaginatedResult<T> {
    const safeTotal = Math.max(0, total);

    if (filters.isAll) {
        // For limit=all, the metadata.limit reflects the actual number
        // of rows delivered, not the internal cap.
        const effectiveLimit = items.length;
        const totalPages = safeTotal === 0
            ? 0
            : Math.ceil(safeTotal / ALL_LIMIT_CAP);
        return {
            data: items,
            metadata: {
                total: safeTotal,
                page: filters.page,
                limit: effectiveLimit,
                total_pages: totalPages,
                has_next_page: safeTotal > ALL_LIMIT_CAP,
                has_prev_page: filters.page > 1,
            },
        };
    }

    const totalPages = safeTotal === 0
        ? 0
        : Math.ceil(safeTotal / filters.limit);

    return {
        data: items,
        metadata: {
            total: safeTotal,
            page: filters.page,
            limit: filters.limit,
            total_pages: totalPages,
            has_next_page: filters.page < totalPages,
            has_prev_page: filters.page > 1,
        },
    };
}

/**
 * Schema fragment to spread into every paginated endpoint's Elysia
 * query object. Co-located here so routes don't reinvent it.
 *
 * Example:
 *   query: t.Object({
 *     ...paginationQuerySchema,
 *     status: t.Optional(t.String()),
 *   })
 */
export const paginationQuerySchemaShape = {
    // Elysia's `t.Numeric()` coerces "2" -> 2 but rejects "all".
    // We accept both Numeric AND literal 'all', so the client can pass
    // either ?limit=50 or ?limit=all.
    // NOTE: intentional string to keep a single schema-source-of-truth.
    // Import it via `import { t } from 'elysia'` next to routes and use
    // the object shape below.
};

/**
 * The types here are the canonical pair that routes use to:
 *   const pag = parsePaginationFilters(rawQuery);
 *   const { from, to } = toRange(pag);
 *   return buildPaginatedResult(items, total, pag);
 */
