import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { DATABASE } from '../database';
import { Principal } from '../identity/session.guard';
import { AttachmentMalwareScanner } from './attachment-malware-scanner';

type ResourceType = 'shipment' | 'return';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const types = ['image/jpeg','image/png','application/pdf'] as const;
const extensions: Record<string, string[]> = { 'image/jpeg': ['jpg','jpeg'], 'image/png': ['png'], 'application/pdf': ['pdf'] };

function validSignature(content: Buffer, mediaType: string) {
  if (mediaType === 'image/jpeg') return content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  if (mediaType === 'image/png') return content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  return content.length >= 5 && content.subarray(0, 5).toString('ascii') === '%PDF-';
}

@Injectable()
export class AttachmentService {
  constructor(@Inject(DATABASE) private readonly pool: Pool,private readonly malwareScanner:AttachmentMalwareScanner) {}

  async list(principal: Principal, resourceTypeValue: string, resourceId: string) {
    const resourceType = this.target(resourceTypeValue, resourceId);
    try {
      await this.authorize(this.pool, principal, resourceType, resourceId, false);
      return (await this.pool.query(`SELECT a.id,a.resource_type AS "resourceType",a.resource_id AS "resourceId",a.filename,a.media_type AS "mediaType",a.byte_size AS "byteSize",a.sha256,a.created_at AS "createdAt",u.email AS "uploadedBy" FROM business_attachments a JOIN users u ON u.id=a.uploaded_by WHERE a.resource_type=$1 AND a.resource_id=$2 ORDER BY a.created_at,a.id`, [resourceType, resourceId])).rows;
    } catch (error) { this.rethrow(error); }
  }

  async upload(principal: Principal, resourceTypeValue: string, resourceId: string, filenameValue: string | undefined, mediaTypeValue: string | undefined, content: unknown) {
    const resourceType = this.target(resourceTypeValue, resourceId);
    const filename = filenameValue?.normalize('NFC').trim() ?? '';
    const mediaType = mediaTypeValue?.split(';', 1)[0].trim().toLowerCase() ?? '';
    if (!filename || filename.length > 180 || /[\\/\x00-\x1f\x7f]/.test(filename) || !types.includes(mediaType as never)) throw new BadRequestException('Invalid attachment metadata');
    const extension = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
    if (!extensions[mediaType].includes(extension)) throw new BadRequestException('Filename extension does not match content type');
    if (!Buffer.isBuffer(content) || !content.length || content.length > 10 * 1024 * 1024 || !validSignature(content, mediaType)) throw new BadRequestException('Attachment content is invalid');
    try{await this.authorize(this.pool,principal,resourceType,resourceId,true);}catch(error){this.rethrow(error);}
    await this.malwareScanner.assertSafe(content);
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const customerId = await this.authorize(db, principal, resourceType, resourceId, true);
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`attachment:${resourceType}:${resourceId}`]);
      const count = Number((await db.query('SELECT count(*)::int count FROM business_attachments WHERE resource_type=$1 AND resource_id=$2', [resourceType, resourceId])).rows[0].count);
      if (count >= 5) throw new ConflictException('A business record can have at most five attachments');
      const sha256 = createHash('sha256').update(content).digest('hex');
      const id = randomUUID();
      const inserted = await db.query(`INSERT INTO business_attachments(id,resource_type,resource_id,customer_id,filename,media_type,byte_size,sha256,content,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(resource_type,resource_id,sha256) DO NOTHING RETURNING id`, [id, resourceType, resourceId, customerId, filename, mediaType, content.length, sha256, content, principal.id]);
      if (!inserted.rowCount) throw new ConflictException('The same attachment already exists');
      await db.query('COMMIT');
      return { id, resourceType, resourceId, filename, mediaType, byteSize: content.length, sha256 };
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof ForbiddenException || error instanceof NotFoundException) throw error;
      throw new ServiceUnavailableException('Attachment upload unavailable');
    } finally { db.release(); }
  }

  async content(principal: Principal, id: string) {
    if (!uuid.test(id)) throw new BadRequestException('Invalid attachment ID');
    try {
      const result = await this.pool.query('SELECT id,resource_type,resource_id,filename,media_type,byte_size,content FROM business_attachments WHERE id=$1', [id]);
      if (!result.rowCount) throw new NotFoundException('Attachment unavailable');
      const row = result.rows[0];
      await this.authorize(this.pool, principal, row.resource_type, row.resource_id, false);
      return { filename: row.filename as string, mediaType: row.media_type as string, byteSize: row.byte_size as number, content: row.content as Buffer };
    } catch (error) { this.rethrow(error); }
  }

  private target(resourceType: string, resourceId: string): ResourceType {
    if (!['shipment','return'].includes(resourceType) || !uuid.test(resourceId)) throw new BadRequestException('Invalid attachment target');
    return resourceType as ResourceType;
  }

  private async authorize(db: Pool | PoolClient, principal: Principal, type: ResourceType, id: string, write: boolean) {
    const sql = type === 'shipment'
      ? 'SELECT o.customer_id FROM shipments s JOIN orders o ON o.id=s.order_id WHERE s.id=$1'
      : 'SELECT customer_id FROM returns WHERE id=$1';
    const result = await db.query(sql, [id]);
    if (!result.rowCount) throw new NotFoundException('Attachment target unavailable');
    const customerId = result.rows[0].customer_id as string;
    if (principal.roles.includes('customer')) {
      if (type !== 'return' && write) throw new ForbiddenException('Customer cannot upload shipment evidence');
      if (principal.customerId !== customerId) throw new ForbiddenException('Attachment belongs to another customer');
      return customerId;
    }
    if (principal.roles.includes('warehouse')) return customerId;
    if (principal.mfaVerified && principal.roles.some(role => role === 'system' || role === 'operations')) return customerId;
    throw new ForbiddenException('Attachment role required');
  }

  private rethrow(error: unknown): never {
    if (error instanceof BadRequestException || error instanceof ForbiddenException || error instanceof NotFoundException) throw error;
    throw new ServiceUnavailableException('Attachment unavailable');
  }
}
