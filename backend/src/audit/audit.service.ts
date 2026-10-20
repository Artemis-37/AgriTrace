import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

export interface AuditEntry {
  organizationId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ip?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  async log(e: AuditEntry): Promise<void> {
    await this.db.tx(e.organizationId ?? null, (c) =>
      c.query(
        `INSERT INTO audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, details, ip)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          e.organizationId ?? null,
          e.actorUserId ?? null,
          e.action,
          e.entityType ?? null,
          e.entityId ?? null,
          JSON.stringify(e.details ?? {}),
          e.ip ?? null,
        ],
      ),
    );
  }

  list(orgId: string, limit = 100, offset = 0) {
    return this.db.tx(orgId, async (c) => {
      const r = await c.query(
        `SELECT id, actor_user_id, action, entity_type, entity_id, details, created_at
           FROM audit_logs WHERE organization_id = $1
          ORDER BY id DESC LIMIT $2 OFFSET $3`,
        [orgId, Math.min(limit, 500), offset],
      );
      return r.rows;
    });
  }
}
