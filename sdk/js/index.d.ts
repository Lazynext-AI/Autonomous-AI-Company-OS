export interface LazynextOptions { apiKey?: string; baseUrl?: string; }

export declare class Lazynext {
  constructor(opts?: LazynextOptions);
  apiKey: string;
  baseUrl: string;
  status(): Promise<Record<string, unknown>>;
  health(): Promise<{ ok: boolean }>;
  joinWaitlist(email: string): Promise<{ ok: boolean }>;
  listBriefings(limit?: number): Promise<unknown[]>;
  getBriefing(id: number): Promise<unknown>;
  listTasks(limit?: number): Promise<unknown[]>;
  createTask(description: string, opts?: { channel?: string; priority?: number }): Promise<unknown>;
  searchKnowledge(query: string, topK?: number): Promise<unknown>;
  listAgents(): Promise<unknown[]>;
  mcpTools(): Promise<unknown[]>;
  mcpCall(name: string, args?: Record<string, unknown>): Promise<unknown>;
}
export default Lazynext;
