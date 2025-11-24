/**
 * Monitoring Module
 * 監視モジュール
 *
 * メトリクス収集、監視、アラート、ログ管理、メンテナンスモード、バックアップ機能を提供します。
 */

export { MetricsCollector } from './metrics-collector';
export type {
  SystemResourceMetrics,
  CustomMetric,
  MetricsSummary,
  MetricsCollectorConfig,
  StorageProvider,
} from './metrics-collector';

export { MonitoringService, AlertLevel, HealthStatus } from './monitoring-service';
export type {
  AlertThresholds,
  Alert,
  HealthCheckResult,
  AlertHandler,
  MonitoringServiceConfig,
} from './monitoring-service';

export { StructuredLogger, LogLevel, initializeLogger, getLogger } from './structured-logger';
export type {
  LogMetadata,
  ErrorInfo,
  LogEntry,
  StructuredLoggerConfig,
} from './structured-logger';

export {
  MaintenanceModeManager,
  MaintenanceStatus,
  initializeMaintenanceMode,
  getMaintenanceManager,
} from './maintenance-mode';
export type { MaintenanceInfo, MaintenanceModeConfig } from './maintenance-mode';

export {
  BackupManager,
  BackupStatus,
  initializeBackupManager,
  getBackupManager,
} from './backup-manager';
export type { BackupResult, BackupConfig } from './backup-manager';
