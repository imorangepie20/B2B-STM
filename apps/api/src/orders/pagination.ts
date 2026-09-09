import { BadRequestException } from '@nestjs/common';

export type Pagination = { page: number; pageSize: number; offset: number };

export function parsePagination(pageValue?: string, pageSizeValue?: string): Pagination {
  if ((pageValue === undefined) !== (pageSizeValue === undefined)) throw new BadRequestException('Invalid pagination');
  const page = pageValue === undefined ? 1 : Number(pageValue);
  const pageSize = pageSizeValue === undefined ? 50 : Number(pageSizeValue);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new BadRequestException('Invalid pagination');
  }
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function pageResult<T>(items: T[], total: number, pagination: Pagination) {
  return {
    items,
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages: Math.ceil(total / pagination.pageSize),
  };
}
