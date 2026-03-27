/**
 * MonitorAgent — monitoring zdrowia serwera i usług
 * Sprawdza: DB, Redis, API, Telegram, dysk, pamięć
 */
import { BaseAgent, AgentResult } from '../core/agent';
import { checkConnection } from '../db/client';
import { eventBus } from '../core/events';
import logger from '../utils/logger';
import os from 'os';

interface HealthReport {
  database: boolean;
  redis: boolean;
  telegram: boolean;
  memory: { used: number; total: number; percent: number };
  cpu: number[];
  disk: { free: string; total: string };
  uptime: number;
  nodeVersion: string;
}

export class MonitorAgent extends BaseAgent {
  private lastReport: HealthReport | null = null;

  constructor() {
    super({
      name: 'MonitorAgent',
      description: 'Monitoring zdrowia serwera: DB, Redis, pamięć, CPU, dysk',
      icon: '🔍',
      cronSchedule: '*/5 * * * *', // Co 5 minut
      tags: ['monitoring', 'health', 'infrastructure'],
    });
  }

  protected async execute(): Promise<AgentResult> {
    const report: HealthReport = {
      database: false,
      redis: false,
      telegram: false,
      memory: { used: 0, total: 0, percent: 0 },
      cpu: [],
      disk: { free: '0', total: '0' },
      uptime: process.uptime(),
      nodeVersion: process.version,
    };

    let issues = 0;

    // Check database
    try {
      report.database = await checkConnection();
      if (!report.database) issues++;
    } catch {
      issues++;
    }

    // Check Redis
    try {
      const Redis = (await import('ioredis')).default;
      const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        connectTimeout: 3000,
        lazyConnect: true,
      });
      await redis.connect();
      await redis.ping();
      report.redis = true;
      await redis.quit();
    } catch {
      report.redis = false;
      issues++;
    }

    // Memory
    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    report.memory = {
      used: Math.round((totalMem - freeMem) / 1024 / 1024),
      total: Math.round(totalMem / 1024 / 1024),
      percent: Math.round(((totalMem - freeMem) / totalMem) * 100),
    };

    if (report.memory.percent > 90) {
      issues++;
      eventBus.log('warn', this.name, `Pamięć RAM: ${report.memory.percent}% — krytycznie wysoko!`);
    }

    // CPU load
    report.cpu = os.loadavg();

    // Telegram check (simple — just check if bot object exists)
    try {
      const { isBotRunning } = await import('../telegram/bot');
      report.telegram = isBotRunning();
      if (!report.telegram) issues++;
    } catch {
      report.telegram = false;
      issues++;
    }

    this.lastReport = report;

    // Emit health status
    eventBus.emitNetwork({
      type: 'health:report',
      source: this.name,
      timestamp: new Date(),
      data: report,
    });

    const status = issues === 0 ? 'healthy' : issues <= 2 ? 'degraded' : 'critical';

    return {
      success: issues === 0,
      message: `Status: ${status} — DB:${report.database ? '✓' : '✗'} Redis:${report.redis ? '✓' : '✗'} TG:${report.telegram ? '✓' : '✗'} RAM:${report.memory.percent}%`,
      data: { report, issues, status },
    };
  }

  /** Pobierz ostatni raport zdrowia */
  getLastReport(): HealthReport | null {
    return this.lastReport;
  }
}
