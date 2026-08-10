# Automation Runs (Infrastructure)

## Flow

```text
domain event → bridge → AutomationsService.handleEvent
  → conditions evaluated → run created (UNIQUE automation+run_key)
  → BullMQ `vibress-automations` (run)
  → AutomationRunnerWorker.executeRun: steps in order
  → wait step → run status 'waiting' + delayed job on
    `vibress-automations-delayed` → resume → completed
```

## Durability

- Run/step state is persisted in PostgreSQL; delayed resumes are BullMQ
  delayed jobs — both survive API/Worker restarts. No in-memory timers.
- Retries: BullMQ attempts (5, exponential backoff); completed steps are
  never re-executed.
