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
import { LogoController } from './organizations/logo.controller';
import { PhotosController } from './organizations/photos.controller';
import { ProducersController } from './producers/producers.controller';
import { ReferentialsController } from './referentials/referentials.controller';
import { AccountingController } from './accounting/accounting.controller';
import { LoansController } from './loans/loans.controller';
import { PaymentsController } from './payments/payments.controller';
import { ComplianceController } from './compliance/compliance.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { AccessAdminController } from './users/access-admin.controller';
import { ProducerStatusController } from './producers/producer-status.controller';
import { PrefinancingController } from './finance/prefinancing.controller';
import { StockCountController } from './stock/stock-count.controller';
import { LogisticsController } from './logistics/logistics.controller';
import { SalesController } from './sales/sales.controller';
import { TasksController } from './tasks/tasks.controller';
import { FieldRecordsController } from './field-records/field-records.controller';
import { TrainingController } from './training/training.controller';
import { TrainingExchangeController } from './training/training-exchange.controller';
import { DispatchController } from './dispatch/dispatch.controller';
import { DeliveriesController } from './deliveries/deliveries.controller';
import { AuditsController } from './audits/audits.controller';
import { ProducerAssignmentsController } from './training/producer-assignments.controller';
import { QuestionnairesController } from './training/questionnaires.controller';
import { QualityController } from './quality/quality.controller';
import { ParcelsController } from './parcels/parcels.controller';
import { MeController } from './users/me.controller';
import { OpsController } from './ops/ops.controller';
import { AppUpdateController } from './ops/app-update.controller';
import { MapPacksController } from './ops/map-packs.controller';
import { GeoController } from './geo/geo.controller';
import { ReferenceLayersController } from './geo/reference-layers.controller';
import { GeoImportService } from './geo/geo-import.service';
import { GeoService } from './geo/geo.service';
import { UsersController } from './users/users.controller';
import { ConvoysController } from './convoys/convoys.controller';
import { ProductsController } from './products/products.controller';
import { DuesController } from './dues/dues.controller';
import { SavingsController } from './convoys/savings.controller';
import { ProfileController } from './organizations/profile.controller';
import { BankStatementsController } from './payments/bank-statements.controller';
import { ReportScheduler, ReportSchedulesController } from './reports/schedules';
import { PushService, PushTokenController } from './notifications/push';
import { OperationsController } from './operations/operations.controller';
import { ReportsController } from './reports/reports.controller';
import { WorkstationsController } from './workstations/workstations.controller';
import { MessagesController } from './messages/messages.controller';
import { ReplicationController } from './replication/replication.controller';
import { ReplicationService } from './replication/replication.service';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.THROTTLE_LIMIT) || 120 }]),
    DbModule,
    AuditModule,
    AuthModule,
  ],
  controllers: [
    OrganizationsController, LogoController, PhotosController, UsersController, ReferentialsController, ProducersController,
    CollectorsController, DeclarationsController, FinanceController,
    ReceptionController, StockController, LotsController, SyncController,
    AccountingController, LoansController, PaymentsController, QualityController, ComplianceController, ParcelsController, GeoController, ReferenceLayersController, TasksController, LogisticsController, SalesController, NotificationsController, AccessAdminController, ProducerStatusController, PrefinancingController, StockCountController, MeController, OpsController, AppUpdateController, MapPacksController, ReplicationController, MessagesController, ConvoysController, SavingsController, ProductsController, DuesController, OperationsController, BankStatementsController, ReportSchedulesController, PushTokenController, ProfileController, WorkstationsController, ReportsController, FieldRecordsController, TrainingController, TrainingExchangeController, DispatchController, DeliveriesController, AuditsController, ProducerAssignmentsController, QuestionnairesController,
  ],
  providers: [NotificationsService, ReportScheduler, PushService, ReportsController, ReplicationService, 
    GeoService, GeoImportService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
})
export class AppModule {}
