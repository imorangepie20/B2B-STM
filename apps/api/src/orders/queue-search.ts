import { BadRequestException } from '@nestjs/common';

export function parseQueueSearch(value?: string) {
  const query = value?.trim() ?? '';
  if (query.length > 100) throw new BadRequestException('Invalid queue search');
  return query;
}
