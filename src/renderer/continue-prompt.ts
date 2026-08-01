export const continuePrompt = `Continue the previous task from the exact interruption point.

Execution Rules:
- Keep all prior decisions, assumptions, and constraints.
- Do not restart the task.
- Do not repeat completed work.
- Identify the first unfinished step and continue from there.
- Preserve the existing implementation unless a change is strictly necessary.
- Continue until the task is fully completed or another interruption occurs.

Only request clarification if a required piece of information is genuinely unavailable.`;

export const isContinuePrompt = (text: string) => text === continuePrompt;
