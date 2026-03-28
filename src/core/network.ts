/**
 * AgentNetwork — centralna sieć agentów
 * Zarządza rejestracją, harmonogramem CRON, WebSocket broadcast, i API
 */
import cron from 'node-cron';
import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { BaseAgent, AgentResult } from './agent';
import { eventBus, LogEntry } from './events';
import logger from '../utils/logger';

/** Stan sieci agentów */
export interface NetworkStatus {
  name: string;
  version: string;
  uptime: number;
  startedAt: Date;
  agents: ReturnType<BaseAgent['toJSON']>[];
  totalRuns: number;
  activeAgents: number;
}

class AgentNetwork {
  private agents = new Map<string, BaseAgent>();
  private cronJobs = new Map<string, cron.ScheduledTask>();
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private startedAt = new Date();
  private totalRuns = 0;

  readonly name = 'Spektra Agent Network';
  readonly version = '3.0.0';

  /** Zarejestruj agenta w sieci */
  register(agent: BaseAgent): void {
    if (this.agents.has(agent.name)) {
      logger.warn(`⚠️ Agent "${agent.name}" już zarejestrowany — zastępuję`);
    }

    this.agents.set(agent.name, agent);

    // Nasłuchuj eventów agenta
    agent.on('start', (data) => {
      eventBus.log('info', agent.name, `Agent uruchomiony`, data);
      this.broadcast({ type: 'agent:start', agent: agent.name, data });
    });

    agent.on('complete', (data) => {
      this.totalRuns++;
      const level = data.result.success ? 'success' : 'warn';
      eventBus.log(level, agent.name, data.result.message, data);
      this.broadcast({
        type: 'agent:complete',
        agent: agent.name,
        result: data.result,
        duration: data.duration,
      });
    });

    agent.on('error', (data) => {
      this.totalRuns++;
      eventBus.log('error', agent.name, `Błąd: ${data.error?.message}`, data);
      this.broadcast({ type: 'agent:error', agent: agent.name, error: data.error?.message });
    });

    // Ustaw CRON jeśli zdefiniowany
    if (agent.cronSchedule && agent.enabled) {
      this.scheduleCron(agent);
    }

    eventBus.log('info', 'Network', `Zarejestrowano agenta: ${agent.icon} ${agent.name}`);
    this.broadcast({ type: 'agent:registered', agent: agent.toJSON() });
  }

  /** Usuń agenta z sieci */
  unregister(name: string): boolean {
    const job = this.cronJobs.get(name);
    if (job) {
      job.stop();
      this.cronJobs.delete(name);
    }

    const removed = this.agents.delete(name);
    if (removed) {
      eventBus.log('info', 'Network', `Wyrejestrowano agenta: ${name}`);
      this.broadcast({ type: 'agent:unregistered', agent: name });
    }
    return removed;
  }

  /** Pobierz agenta po nazwie */
  getAgent(name: string): BaseAgent | undefined {
    return this.agents.get(name);
  }

  /** Zarejestruj dynamicznego agenta w runtime (z pliku JS) */
  async registerDynamic(filePath: string, className: string): Promise<boolean> {
    try {
      const module = require(filePath);
      const AgentClass = module[className];
      if (!AgentClass) {
        logger.error(`❌ [Network] Klasa ${className} nie znaleziona w ${filePath}`);
        return false;
      }
      const agent = new AgentClass() as BaseAgent;
      this.register(agent);
      if (agent.cronSchedule) {
        this.scheduleCron(agent);
      }
      eventBus.log('success', 'Network', `Dynamiczny agent zarejestrowany: ${agent.name}`);
      return true;
    } catch (error) {
      logger.error(`❌ [Network] Błąd rejestracji dynamicznej:`, error);
      return false;
    }
  }

  /** Pobierz wszystkich agentów */
  getAllAgents(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  /** Uruchom agenta ręcznie */
  async runAgent(name: string): Promise<AgentResult> {
    const agent = this.agents.get(name);
    if (!agent) {
      return { success: false, message: `Agent "${name}" nie istnieje` };
    }
    return agent.run();
  }

  /** Uruchom wszystkich agentów (fault-tolerant — jeden crash nie blokuje reszty) */
  async runAll(): Promise<Record<string, AgentResult>> {
    const results: Record<string, AgentResult> = {};
    for (const [name, agent] of this.agents) {
      if (agent.enabled) {
        try {
          results[name] = await agent.run();
        } catch (error) {
          results[name] = { success: false, message: `Crash: ${(error as Error).message}` };
          logger.error(`❌ [Network] Agent ${name} crash — pomijam, kontynuuję:`, error);
          eventBus.log('error', 'Network', `Agent ${name} crash — pominięty: ${(error as Error).message}`);
        }
      }
    }
    return results;
  }

  /** Ustaw CRON dla agenta */
  scheduleCron(agent: BaseAgent): void {
    if (!agent.cronSchedule) return;

    const existing = this.cronJobs.get(agent.name);
    if (existing) {
      existing.stop();
    }

    const job = cron.schedule(agent.cronSchedule, () => {
      agent.run().catch((error) => {
        logger.error(`❌ [CRON] ${agent.name} crash — pominięty:`, error);
        eventBus.log('error', 'CRON', `${agent.name} crash: ${(error as Error).message}`);
      });
    });

    this.cronJobs.set(agent.name, job);
    logger.info(`⏰ [Network] CRON ${agent.name}: ${agent.cronSchedule}`);
  }

  /** Uruchom sieć — aktywuj CRON schedules */
  start(): void {
    this.startedAt = new Date();

    for (const [, agent] of this.agents) {
      if (agent.cronSchedule && agent.enabled) {
        this.scheduleCron(agent);
      }
    }

    eventBus.log('success', 'Network', `${this.name} v${this.version} uruchomiona — ${this.agents.size} agentów`);
    this.broadcast({ type: 'network:started', agents: this.agents.size });
  }

  /** Zatrzymaj sieć */
  stop(): void {
    for (const [, job] of this.cronJobs) {
      job.stop();
    }
    this.cronJobs.clear();

    if (this.wss) {
      for (const client of this.clients) {
        client.close();
      }
      this.wss.close();
    }

    eventBus.log('info', 'Network', 'Sieć zatrzymana');
  }

  /** Inicjalizuj WebSocket server */
  initWebSocket(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      logger.info(`🔌 [WebSocket] Nowe połączenie (${this.clients.size} klientów)`);

      // Wyślij aktualny stan sieci
      ws.send(
        JSON.stringify({
          type: 'network:state',
          data: this.getStatus(),
        }),
      );

      // Wyślij ostatnie 50 logów
      ws.send(
        JSON.stringify({
          type: 'logs:history',
          data: eventBus.getLogs({ limit: 50 }),
        }),
      );

      ws.on('close', () => {
        this.clients.delete(ws);
        logger.debug(`🔌 [WebSocket] Rozłączenie (${this.clients.size} klientów)`);
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleWsMessage(ws, msg);
        } catch {
          // Ignoruj nieprawidłowe wiadomości
        }
      });
    });

    // Subskrybuj logi do broadcast
    eventBus.on('log', (entry: LogEntry) => {
      this.broadcast({ type: 'log', data: entry });
    });

    logger.info(`🔌 [WebSocket] Server gotowy na /ws`);
  }

  /** Obsługa wiadomości WebSocket od klienta */
  private handleWsMessage(ws: WebSocket, msg: any): void {
    switch (msg.type) {
      case 'agent:run':
        if (msg.agent) {
          this.runAgent(msg.agent);
        }
        break;
      case 'agent:enable':
        this.getAgent(msg.agent)?.enable();
        this.broadcastStatus();
        break;
      case 'agent:disable':
        this.getAgent(msg.agent)?.disable();
        this.broadcastStatus();
        break;
      case 'network:status':
        ws.send(JSON.stringify({ type: 'network:state', data: this.getStatus() }));
        break;
    }
  }

  /** Broadcast do wszystkich WebSocket klientów */
  private broadcast(data: any): void {
    if (!this.wss) return;
    const msg = JSON.stringify(data);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  /** Broadcast statusu sieci */
  private broadcastStatus(): void {
    this.broadcast({ type: 'network:state', data: this.getStatus() });
  }

  /** Pobierz status sieci */
  getStatus(): NetworkStatus {
    return {
      name: this.name,
      version: this.version,
      uptime: Date.now() - this.startedAt.getTime(),
      startedAt: this.startedAt,
      agents: Array.from(this.agents.values()).map((a) => a.toJSON()),
      totalRuns: this.totalRuns,
      activeAgents: Array.from(this.agents.values()).filter((a) => a.status === 'running').length,
    };
  }
}

/** Singleton sieci agentów */
export const agentNetwork = new AgentNetwork();
