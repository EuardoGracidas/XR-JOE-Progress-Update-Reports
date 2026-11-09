# XR-JOE

## Members
- Dr. Oscar Meruvia-Pastor (co-supervisor)
- Dr. Jay Henderson (co-supervisor)
- MsC student Eduardo Gracidas-Reyes

## Summary

This GitHub project is for keeping a track into the projects developed by us as well as the decisions we take in our bi-weekely meetings. 

---

## Using the Kanban board

The Kanban board shows every task we are working on and its current status. It lives in the **Projects** tab of this repository.

### Opening the board
1. At the top of this repository page, click the **Projects** tab.
2. Click the board's name to open it.

### Columns
| Column | Meaning |
|---|---|
| **Backlog** | Tasks we agree to do but in the future (as extra features that are not necessary). |
| **Ready** | Tasks we agreed to do but have not started. |
| **In Progress** | Tasks someone is actively working on. |
| **Done** | Finished tasks. |

### Adding a task
1. Scroll to the bottom of the **Todo** column and click **+ Add item**.
2. Type a short, clear title (e.g. *"Set up Unity project for XR prototype"*) and press **Enter**.
3. Click the new card to open it and add more detail:
   - **Description:** what needs to be done and any useful links.
   - **Assignees:** who is responsible for it.
   - Optionally, click **Convert to issue** so the task gets its own page and can be discussed with comments.

### Updating a task
- **Change its status:** drag the card to another column, or open the card and change the **Status** field.
- **Leave an update:** open the card and write a comment (only available after converting it to an issue).
- **Finish it:** move the card to **Done**. Tasks in **Done** can be archived later to keep the board tidy.

### Good habits
- Keep one task per card. Break big tasks into smaller ones.
- Every card in **In Progress** should have an assignee.
- Look over the board at the start of each meeting to review progress.

---

## Recording meeting notes

Every bi-weekly meeting gets its own notes file in the [`meetings`](meetings/) folder. This keeps a record of what we discussed and decided.

### Creating the notes for a meeting
1. Open the [`meetings`](meetings/) folder.
2. Click **Add file → Create new file** (top right).
3. Name the file with the meeting date in `YYYY-MM-DD.md` format, e.g. `2026-11-05.md`. Using this format keeps the files in date order.
4. Copy the template below into the file and fill in each section.
5. Click **Commit changes**, add a short message such as *"Notes for 2026-11-05 meeting"*, and confirm.

### Template

```markdown
# Meeting YYYY-MM-DD

**Attendees:** Oscar, Jay, Eduardo

## Agenda
- Topic 1
- Topic 2

## Discussion
- Summary of what was talked about for each topic.

## Decisions
- Each decision we agreed on, written as one clear sentence.

## Action items
- [ ] Task description — Person responsible — Due date

## Next meeting
- Date:
- Topics to bring:
```

### Editing notes afterwards
1. Open the meeting file in the [`meetings`](meetings/) folder.
2. Click the **pencil icon** (✏️) to edit.
3. Make the changes and click **Commit changes**.

However, avoid editing notes unless it is strictly necessary.

### Tips
- Add each **action item** as a card on the Kanban board too, so it gets tracked until it's done.
- At the start of the next meeting, open the previous notes and go through the action items.
- Ticking a checkbox (`- [x]`) in the notes marks an action item as completed.

## Disclaimer

This repository as well as the project Kanban board is being automated using Claude with the constant supervision of Eduardo Gracidas-Reyes. 
