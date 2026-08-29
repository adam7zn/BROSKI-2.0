# Study plan

`study-plan.json` is the material the companion draws questions from. Each item
is one idea, phrased the way the course phrases it — the agent is told to stay
inside `sourceText` and not drift into neighbouring notation.

The seed items are placeholders in the right shape. Replace them with sentences
from William's actual textbook and lesson plan; that is what makes the questions
worth sending. Keep each `sourceText` to one or two sentences: it is the whole
of what the agent is allowed to build a question from.

| Field | Meaning |
|---|---|
| `id` | Stable id. Selection history is keyed on it, so do not renumber. |
| `topic` | Short label; also the image alt text. |
| `sourceText` | The exact course sentence the question must follow. |
| `difficulty` | `easy` one step, `medium` two, `hard` two plus a judgement. |
| `image` | Optional image URL sent with the question, or `null`. |

Copyrighted textbook pages do not belong in this file — one paraphrased sentence
per idea is what the pilot needs (`docs/RULES.md` §8.2).

# Course calendar

`course-plan.json` is what makes the companion timeline-aware rather than a
question generator. Without real dates in it, every decision falls back to
"whatever is due", which is the least interesting thing it can do.

| Field | Meaning |
|---|---|
| `startsAt` | Local wall-clock time, `YYYY-MM-DD HH:MM`, in the course timezone. |
| `topic` | What the lesson is about, quoted back in the reason. |
| `covers` | Study items that lesson teaches — used to practise afterwards. |
| `prepares` | Study items worth meeting before it. Falls back to `covers`. |

`pnpm onboard` writes this file from the lesson times the student gives, four
weeks ahead, and overwrites whatever was here. It leaves every `covers` list
empty — filling those in is the one step that makes `PREPARE` and `PRACTISE`
work, and it is deliberately a person's job.

Fill it in a couple of weeks at a time from the actual schedule. `npm run plan`
shows what the calendar would produce for the coming week before a single
message is sent.
