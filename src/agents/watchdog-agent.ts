/**
 * WatchdogAgent — pilnuje żeby system ZAWSZE coś robił
 * Jeśli nic się nie dzieje — wymusza akcję. Odpala agentów,
 * tworzy taski, restartuje procesy. Zero przestojów.
 */
import { BaseAgent, AgentResult } from '../core/agent';
import { agentNetwork } from '../core/network';
import { query } from '../db/client';
import { eventBus } from '../core/events';
import logger from '../utils/logger';

export class WatchdogAgent extends BaseAgent {
  constructor() {
    super({
      name: 'WatchdogAgent',
      description: 'Pilnuje ze system ZAWSZE pracuje. Wymusza akcje gdy nic sie nie dzieje.',
      icon: '🐕',
      cronSchedule: '*/10 * * * *', // co 10 minut
      tags: ['watchdog', 'autonomous', 'meta'],
    });
  }

  protected async execute(): Promise<AgentResult> {
    const actions: string[] = [];

    // 1. Sprawdz czy Visionary generuje pomysly
    const visionary = agentNetwork.getAgent('VisionaryAgent');
    if (visionary && visionary.metrics.lastRunAt) {
      const minSinceRun = (Date.now() - visionary.metrics.lastRunAt.getTime()) / 60000;
      if (minSinceRun > 40) {
        // Visionary nie ruszyl od 40 min — odpal go
        visionary.run().catch(() => {});
        actions.push('Wymuszono Visionary — nie ruszyl od ' + Math.round(minSinceRun) + ' min');
      }
    } else if (visionary) {
      visionary.run().catch(() => {});
      actions.push('Wymuszono pierwszy run Visionary');
    }

    // 2. Sprawdz czy sa taski w review bez reakcji Executora
    try {
      const stale = await query(
        "SELECT COUNT(*) as cnt FROM code_tasks WHERE status = 'review' AND updated_at < NOW() - INTERVAL '20 minutes'"
      );
      if (Number(stale[0]?.cnt || 0) > 0) {
        const executor = agentNetwork.getAgent('ExecutorAgent');
        if (executor) {
          executor.run().catch(() => {});
          actions.push('Wymuszono Executor — ' + stale[0].cnt + ' zaleglychtaskow');
        }
      }
    } catch {}

    // 3. Sprawdz czy pending taski czekaja za dlugo — auto-approve
    try {
      const pending = await query(
        "UPDATE code_tasks SET status = 'approved' WHERE status = 'pending' AND created_at < NOW() - INTERVAL '30 minutes' RETURNING id"
      );
      if (pending.length > 0) {
        actions.push('Auto-approved ' + pending.length + ' zaleglychtaskow');
      }
    } catch {}

    // 4. Sprawdz czy approved taski nie sa wdrazane — wymus Evolution
    try {
      const approved = await query(
        "SELECT COUNT(*) as cnt FROM code_tasks WHERE status = 'approved'"
      );
      if (Number(approved[0]?.cnt || 0) > 0) {
        const evo = agentNetwork.getAgent('EvolutionAgent');
        if (evo) {
          evo.run().catch(() => {});
          actions.push('Wymuszono Evolution — ' + approved[0].cnt + ' approved do wdrozenia');
        }
      }
    } catch {}

    // 5. Sprawdz czy agenci maja 0 runow — odpal ich
    const agents = agentNetwork.getAllAgents();
    for (const agent of agents) {
      if (agent.name === this.name) continue;
      if (agent.enabled && agent.metrics.totalRuns === 0 && agent.status === 'idle') {
        agent.run().catch(() => {});
        actions.push('Pierwszy run: ' + agent.name);
        break; // jeden na raz zeby nie przeciazyc
      }
    }

    // 6. Jesli zero akcji — wszystko dziala, log heartbeat
    if (actions.length === 0) {
      const totalRuns = agents.reduce((s, a) => s + a.metrics.totalRuns, 0);
      actions.push('System aktywny — ' + totalRuns + ' runow, ' + agents.length + ' agentow');
    }

    eventBus.log('info', this.name, actions.join(' | '));

    return {
      success: true,
      message: actions.join('; '),
      data: { actions },
    };
  }
}
