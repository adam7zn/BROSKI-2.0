import assert from 'node:assert/strict';
import test from 'node:test';

import type { BackendToConversation } from '@math-study-companion/contracts';

import { DeterministicDemoAgent } from '../src/index.js';

const context: BackendToConversation = {
  interactionId: 'demo-001',
  topic: 'linear equations',
  sourceText: 'Solve equations by applying the same operation to both sides.',
  difficulty: 'easy',
  image: null,
  mode: 'PRACTISE',
  reason: 'Manual judge MVP demonstration',
};

test('runs the transport-independent ConversationAgent fixture end to end', async () => {
  const agent = new DeterministicDemoAgent();
  let output = await agent.startSession({
    context,
    profile: null,
    traceId: 'trace-1',
  });
  assert.equal(output.outbound[0]?.purpose, 'onboarding-course');

  output = await turn(agent, output.agentState, 'Mathematics 3c');
  output = await turn(agent, output.agentState, 'not a level');
  assert.equal(output.outbound[0]?.purpose, 'onboarding-level-retry');
  output = await turn(agent, output.agentState, 'OKAY');
  output = await turn(agent, output.agentState, 'SKIP');
  assert.deepEqual(output.profile, {
    course: 'Mathematics 3c',
    selfAssessedLevel: 'okay',
    previousGrade: null,
  });
  assert.deepEqual(
    output.outbound.map((intent) => intent.purpose),
    ['onboarding-confirmation', 'question'],
  );
  output = await turn(agent, output.agentState, '8/2');
  assert.equal(output.status, 'completed');
  assert.equal(output.result?.result, 'correct');
});

for (const [reply, verdict] of [
  ['x = 3', 'incorrect'],
  ['not sure', 'unclear'],
] as const) {
  test(`returns ${verdict} through the agent boundary`, async () => {
    const agent = new DeterministicDemoAgent();
    const started = await agent.startSession({
      context,
      profile: {
        course: 'Mathematics 3c',
        selfAssessedLevel: 'okay',
        previousGrade: null,
      },
      traceId: 'trace-1',
    });
    const output = await turn(agent, started.agentState, reply);
    assert.equal(output.result?.result, verdict);
  });
}

function turn(
  agent: DeterministicDemoAgent,
  agentState: unknown,
  text: string,
) {
  return agent.handleInbound({
    interactionId: 'demo-001',
    context,
    text,
    receivedAt: '2026-08-29T12:00:00.000Z',
    history: [],
    agentState,
    traceId: 'trace-1',
  });
}
