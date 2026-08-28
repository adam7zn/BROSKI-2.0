import {
  loadCoursePlan,
  loadStudyPlan,
  planStudySession,
  reviewStates,
} from '@msc/backend';

import { readConfig } from './config.js';
import { openStore } from './wire.js';

/**
 * Shadow mode: what the companion would do, and why, without sending anything.
 *
 * `docs/PHASES.md` Phase 5 requires every proposed message to have a visible
 * reason before scheduling is allowed to exist. This is where you read it.
 */
const config = readConfig();
const store = openStore(config);

try {
  const items = loadStudyPlan(config.studyPlanPath);
  const plan = loadCoursePlan(config.coursePlanPath);
  const history = store.attemptHistory();
  const reviews = reviewStates(history);

  console.log(`\n${plan.courseName} — ${items.length} study items, ${plan.lessons.length} lessons`);
  console.log(`${history.length} attempts on record\n`);

  const now = new Date();
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    // Look at the same three moments each day: morning, after school, evening.
    for (const hour of [7, 15, 20]) {
      const at = new Date(now);
      at.setDate(at.getDate() + dayOffset);
      at.setHours(hour, 0, 0, 0);
      if (at.getTime() < now.getTime()) continue;

      const decision = planStudySession({ now: at, plan, items, reviews });
      const when = at.toLocaleString('sv-SE', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
      const what =
        decision.mode === 'NO_ACTION'
          ? 'stays quiet'
          : `${decision.mode} ${decision.item?.topic}`;
      console.log(`${when.padEnd(22)} ${what}`);
      console.log(`${''.padEnd(22)}   ${decision.reason}`);
    }
  }

  if (reviews.size > 0) {
    console.log('\nReview state:');
    for (const state of [...reviews.values()].sort(
      (a, b) => a.dueAt.getTime() - b.dueAt.getTime(),
    )) {
      console.log(
        `  ${state.studyItemId.padEnd(22)} due ${state.dueAt.toISOString().slice(0, 10)}` +
          `  (last ${state.lastResult}, interval ${state.intervalDays}d, streak ${state.streak})`,
      );
    }
  }
  console.log();
} finally {
  store.close();
}
