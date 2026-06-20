export interface AgentChunk {
    type?: string;
    node: string;
    run_id?: string;
    status?: 'running' | 'completed' | 'error';
    action_executed: [string, string] | null;
    final_response: string | null;
    error?: string;
    detail?: string;
    plan?: string[];
    past_steps?: [string, any][];
    created_at?: string;
    report_html_url?: string;
}

export interface LogEntry {
    type: 'log';
    ts: string;
    level: string;
    title: string;
    detail: string;
    node?: string;
    input_tokens?: number;
    output_tokens?: number;
    created_at?: string;
}
