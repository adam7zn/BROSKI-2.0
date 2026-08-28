export interface LogEntry {
  level: 'info' | 'warn' | 'error';
  event: string;
  traceId: string;
  interactionId?: string;
  method?: string;
  path?: string;
  status?: number;
  code?: string;
}

export interface Logger {
  write(entry: LogEntry): void;
}

export const jsonLogger: Logger = {
  write(entry) {
    process.stdout.write(
      `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`,
    );
  },
};
