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
