import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

import type { SourceBoundingBox } from '@math-study-companion/contracts';

interface Response {
  id: string;
  latex?: string;
  confidence?: number | null;
  error?: string;
}

interface Pending {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
}

export class Pix2TexClient {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, Pending>();
  private sequence = 0;

  constructor(python: string, scriptPath: string) {
    this.process = spawn(python, [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = createInterface({ input: this.process.stdout });
    lines.on('line', (line) => {
      let response: Response;
      try { response = JSON.parse(line) as Response; }
      catch { return; }
      const pending = this.pending.get(response.id);
      if (pending === undefined) return;
      this.pending.delete(response.id);
      pending.resolve(response);
    });
    this.process.on('exit', (code) => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`pix2tex worker exited with code ${String(code)}.`));
      }
      this.pending.clear();
    });
  }

  async recognize(imagePath: string, boundingBox: SourceBoundingBox): Promise<Response> {
    const id = String(++this.sequence);
    const result = new Promise<Response>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.process.stdin.write(`${JSON.stringify({ id, imagePath, boundingBox })}\n`);
    return result;
  }

  async close(): Promise<void> {
    this.process.stdin.end();
    if (this.process.exitCode !== null) return;
    await new Promise<void>((resolve) => this.process.once('exit', () => resolve()));
  }
}
