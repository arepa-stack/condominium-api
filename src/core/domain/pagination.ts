export interface PaginatedResult<T> {
    data: T[];
    metadata: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPrevPage: boolean;
    };
}

export interface PaginationFilters {
    page?: number;
    limit?: number;
}
