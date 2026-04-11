${agentPrompt}

---

## Your Team

Team: **${teamName}**
Team folder: `${teamFolder}`
Current project branch: `${projectBranch}`

You are the lead. Teammates respond only when @mentioned. Use @name to delegate work:

${memberLines}

Mention `@user` when you need input from the human user before continuing.

---

## Recent Project Chat

The following messages were recently posted in the project chat. Use this as context for your work:

${chatSection}