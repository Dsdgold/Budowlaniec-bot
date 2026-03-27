/**
 * BaseAgent — abstrakcyjna klasa bazowa dla wszystkich agentów w sieci
 * Zapewnia: lifecycle, health check, metryki, eventy, logi
 */
import { EventEmitter } from 'events';
import logger from '../utils/logger';

/** Stan agenta */
export type AgentStatus = 'idle' | 'running' | 'error' | 'disabled' | 'starting';

/** Wynik działania agenta */
export interface AgentResult {
  success: boolean;
  message: string;
  data?: Record<string, any>;
  duration?: number;
}

/** Metryki agenta */
export interface AgentMetrics {
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  avgDurationMs: number;
  lastRunAt: Date | null;
  lastResult: AgentResult | null;
  uptime: number;
}

/** Konfiguracja agenta */
export interface AgentConfig {
  name: string;
  description: string;
  icon: string;
  cronSchedule?: string;
  enabled?: boolean;
  tags?: string[];
}

/**
 * Abstrakcyjna klasa bazowa agenta
 */
export abstract class BaseAgent extends EventEmitter {
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly tags: string[];

  protected _status: AgentStatus = 'idle';
  protected _enabled: boolean;
  protected _metrics: AgentMetrics = {
    totalRuns: 0,
    successRuns: 0,
    failedRuns: 0,
    avgDurationMs: 0,
    lastRunAt: null,
    lastResult: null,
    uptime: 0,
  };
  protected _startedAt: Date = new Date();
  protected _cronSchedule?: string;
  private _runHistory: Array<{ at: Date; result: AgentResult }> = [];
  private readonly MAX_HISTORY = 50;

  constructor(config: AgentConfig) {
    super();
    this.name = config.name;
    this.description = config.description;
    this.icon = config.icon;
    this.tags = config.tags || [];
    this._enabled = config.enabled !== false;
    this._cronSchedule = config.cronSchedule;
  }

  /** Implementacja logiki agenta — do nadpisania */
  protected abstract execute(): Promise<AgentResult>;

  /** Opcjonalny health check — do nadpisania */
  async healthCheck(): Promise<boolean> {
    return this._status !== 'error';
  }

  /** Status agenta */
  get status(): AgentStatus {
    return this._status;
  }

  /** Czy agent jest włączony */
  get enabled(): boolean {
    return this._enabled;
  }

  /** Harmonogram CRON */
  get cronSchedule(): string | undefined {
    return this._cronSchedule;
  }

  /** Metryki agenta */
  get metrics(): AgentMetrics {
    return {
      ...this._metrics,
      uptime: Date.now() - this._startedAt.getTime(),
    };
  }

  /** Historia uruchomień */
  get history() {
    return [...this._runHistory];
  }

  /** Włącz agenta */
  enable(): void {
    this._enabled = true;
    this._status = 'idle';
    this.emit('enabled', this.name);
    logger.info(`✅ [${this.name}] Agent włączony`);
  }

  /** Wyłącz agenta */
  disable(): void {
    this._enabled = false;
    this._status = 'disabled';
    this.emit('disabled', this.name);
    logger.info(`⛔ [${this.name}] Agent wyłączony`);
  }

  /**
   * Uruchom agenta z pełnym trackingiem
   */
  async run(): Promise<AgentResult> {
    if (!this._enabled) {
      return { success: false, message: `Agent ${this.name} jest wyłączony` };
    }

    if (this._status === 'running') {
      return { success: false, message: `Agent ${this.name} już działa` };
    }

    this._status = 'running';
    const startTime = Date.now();

    this.emit('start', { agent: this.name, at: new Date() });
    logger.info(`${this.icon} [${this.name}] Start...`);

    try {
      const result = await this.execute();
      const duration = Date.now() - startTime;
      result.duration = duration;

      // Aktualizuj metryki
      this._metrics.totalRuns++;
      if (result.success) {
        this._metrics.successRuns++;
      } else {
        this._metrics.failedRuns++;
      }
      this._metrics.avgDurationMs = Math.round(
        (this._metrics.avgDurationMs * (this._metrics.totalRuns - 1) + duration) /
          this._metrics.totalRuns,
      );
      this._metrics.lastRunAt = new Date();
      this._metrics.lastResult = result;

      // Zapisz w historii
      this._runHistory.push({ at: new Date(), result });
      if (this._runHistory.length > this.MAX_HISTORY) {
        this._runHistory.shift();
      }

      this._status = result.success ? 'idle' : 'error';

      const emoji = result.success ? '✅' : '⚠️';
      logger.info(`${emoji} [${this.name}] Zakończony (${duration}ms): ${result.message}`);

      this.emit('complete', { agent: this.name, result, duration });
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorResult: AgentResult = {
        success: false,
        message: `Krytyczny błąd: ${(error as Error).message}`,
        duration,
      };

      this._metrics.totalRuns++;
      this._metrics.failedRuns++;
      this._metrics.lastRunAt = new Date();
      this._metrics.lastResult = errorResult;
      this._status = 'error';

      this._runHistory.push({ at: new Date(), result: errorResult });
      if (this._runHistory.length > this.MAX_HISTORY) {
        this._runHistory.shift();
      }

      logger.error(`❌ [${this.name}] Krytyczny błąd:`, error);
      this.emit('error', { agent: this.name, error, duration });

      return errorResult;
    }
  }

  /** Serializacja do JSON (dla API/dashboard) */
  toJSON() {
    return {
      name: this.name,
      description: this.description,
      icon: this.icon,
      tags: this.tags,
      status: this._status,
      enabled: this._enabled,
      cronSchedule: this._cronSchedule,
      metrics: this.metrics,
      lastRun: this._metrics.lastRunAt,
      lastResult: this._metrics.lastResult,
    };
  }
}
