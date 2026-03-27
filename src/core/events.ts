/**
 * EventBus — centralny system eventów dla sieci agentów
 * Umożliwia komunikację między agentami, logowanie, i real-time updates
 */
import { EventEmitter } from 'events';
import logger from '../utils/logger';

/** Typy eventów w sieci */
export interface NetworkEvent {
  type: string;
  source: string;
  timestamp: Date;
  data?: any;
}

/** Log entry dla dashboardu */
export interface LogEntry {
  id: number;
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'success';
  source: string;
  message: string;
  data?: any;
}

class EventBus extends EventEmitter {
  private _logs: LogEntry[] = [];
  private _logId = 0;
  private readonly MAX_LOGS = 500;

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /** Emituj event sieciowy */
  emitNetwork(event: NetworkEvent): void {
    this.emit('network', event);
    this.emit(event.type, event);
  }

  /** Dodaj log */
  log(level: LogEntry['level'], source: string, message: string, data?: any): void {
    const entry: LogEntry = {
      id: ++this._logId,
      timestamp: new Date(),
      level,
      source,
      message,
      data,
    };

    this._logs.push(entry);
    if (this._logs.length > this.MAX_LOGS) {
      this._logs.shift();
    }

    this.emit('log', entry);

    // Loguj też przez winston
    const prefix = `[${source}]`;
    switch (level) {
      case 'error':
        logger.error(`${prefix} ${message}`);
        break;
      case 'warn':
        logger.warn(`${prefix} ${message}`);
        break;
      case 'success':
        logger.info(`✅ ${prefix} ${message}`);
        break;
      default:
        logger.info(`${prefix} ${message}`);
    }
  }

  /** Pobierz logi (z opcjonalnym filtrem) */
  getLogs(options?: { limit?: number; source?: string; level?: string }): LogEntry[] {
    let logs = [...this._logs];

    if (options?.source) {
      logs = logs.filter((l) => l.source === options.source);
    }
    if (options?.level) {
      logs = logs.filter((l) => l.level === options.level);
    }

    const limit = options?.limit || 100;
    return logs.slice(-limit);
  }

  /** Wyczyść logi */
  clearLogs(): void {
    this._logs = [];
    this._logId = 0;
  }
}

/** Singleton event bus */
export const eventBus = new EventBus();
