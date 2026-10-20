import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccessGuard } from './access/access.guard';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { CollectorsController } from './collectors/collectors.controller';
import { DeclarationsController } from './declarations/declarations.controller';
import { FinanceController } from './finance/finance.controller';
import { LotsController } from './lots/lots.controller';
import { ReceptionController } from './reception/reception.controller';
import { StockController } from './stock/stock.controller';
import { SyncController } from './sync/sync.controller';
import { OrganizationsController } from './organizations/organizations.controller';
import { ProducersController } from './producers/producers.controller';
import { ReferentialsController } from './referentials/referentials.controller';
import { UsersController } from './users/users.controller';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    DbModule,
    AuditModule,
    AuthModule,
  ],
  controllers: [
    OrganizationsController, UsersController, ReferentialsController, ProducersController,
    CollectorsController, DeclarationsController, FinanceController,
    ReceptionController, StockController, LotsController, SyncController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule {}
