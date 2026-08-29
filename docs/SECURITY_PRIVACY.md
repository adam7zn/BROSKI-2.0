# Security, Privacy, and Content Handling

## 1. Scope

The MVP processes private educational information and a potentially copyrighted textbook. It is for one named user and must not be treated as a public multi-user school product without a separate legal, security, and safeguarding review.

## 2. Data categories

### Personal data

- William's name and messaging address;
- course enrollment and timetable;
- assignments, assessments, and lesson-plan information;
- messages and answers;
- inferred learning strengths, weaknesses, and misconceptions;
- usage and delivery metadata.

### Content data

- textbook file and page images;
- extracted textbook text;
- exercises, solutions, and diagrams;
- Canvas content and attachments.

### Credentials

- Canvas access credential;
- database/service credentials;
- model-provider key;
- messaging-provider credentials;
- storage credentials.

## 3. Minimum-security rules

1. Keep all credentials in a secrets manager or environment configuration excluded from source control.
2. Use separate development and production credentials.
3. Do not give a local Mac messaging bridge database credentials.
4. Use a narrow authenticated API between the bridge and hosted backend.
5. Encrypt transport with TLS.
6. Restrict database and storage access to project members who need it.
7. Require authentication for every admin route.
8. Keep outbound messaging disabled by default in non-production environments.
9. Redact secrets and unnecessary private text from logs.
10. Review dependency and infrastructure access before adding collaborators.

## 4. Canvas access

- Request the least privilege required.
- Store tokens encrypted at rest where the platform supports it.
- Do not place Canvas tokens in client-side code.
- Record token creation, rotation, and revocation procedure.
- Make source freshness visible so stale data is not mistaken for current teacher intent.
- Delete cached private attachments that are not required for the MVP.

## 5. Textbook handling

- Use the textbook only for the authorized personal MVP.
- Keep the original and extracted content private.
- Do not publish or commit textbook pages, full extracted text, answer keys, or embeddings to a public repository.
- Use small sanitized or synthetic fixtures in tests.
- Preserve a `license_note` describing the permitted use and unresolved questions.
- Before expanding to other students, obtain an appropriate content-license strategy or use content the project is permitted to process and deliver.

## 6. Model-provider handling

- Send only the minimum relevant source chunks and student context needed for the task.
- Do not send the entire textbook or full message history in every request.
- Review provider data-retention and training settings before using real private data.
- Store provider request IDs for audit without logging complete sensitive payloads unnecessarily.
- Never include secrets in model prompts.

## 7. Messaging safeguards

- Use a dedicated service conversation identity where technically possible.
- Verify inbound provider events.
- Allow immediate pause/stop.
- Configure quiet hours.
- Do not include sensitive full course records in lock-screen-visible messages.
- Avoid sending assessment scores or detailed weakness summaries proactively unless William has explicitly enabled it.
- Treat images and attachments as private objects with expiring URLs where possible.
- Sendblue media inputs must be HTTPS URLs. The first live flow is text-only; never expose local or
  private textbook paths merely to make them downloadable by the provider.
- Keep the hosted live-delivery kill switch off except during a controlled, allowlisted phone test.
- Do not log Sendblue payloads, message bodies, API credentials, webhook secrets, or bearer tokens.

## 8. Retention

Recommended MVP defaults:

| Data | Retention |
|---|---|
| Raw attempts | Duration of pilot plus review period |
| Messages | Duration needed for learning evidence and debugging |
| Provider raw webhook payloads | Short, unless needed for unresolved delivery issues |
| Agent-run context snapshots | Redacted or minimized; retain version/hash and decision evidence |
| Textbook source | While authorized and needed for the personal MVP |
| Canvas snapshots | Keep only versions needed to understand timeline changes |
| Operational logs | Short bounded period |

Finalize exact durations before the live pilot.

## 9. Export and deletion

The system should support:

```text
export William's:
- course timeline
- attempts
- derived concept states
- review schedule
- messages
- misconception records
- agent decision history
```

Deletion must remove or anonymize personal records and private storage objects while preserving only operational records that are strictly necessary and non-identifying.

## 10. Incident response for MVP

If a credential or private source is exposed:

1. disable proactive messaging if relevant;
2. revoke and rotate the credential;
3. remove the exposed artifact from accessible locations and repository history where needed;
4. inspect logs for access;
5. notify both project members;
6. document the cause and preventive change;
7. resume only after verification.

## 11. Before adding another student

Complete a separate review covering:

- lawful basis and notices;
- age/minor safeguards;
- content licensing;
- account isolation;
- role-based access;
- data export/deletion UX;
- school-system terms and permissions;
- automated decision transparency;
- abuse and inappropriate-content handling;
- accessibility;
- security testing; and
- incident response ownership.
