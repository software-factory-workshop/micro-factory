# [injected] Server route trusts a model-supplied author id

This is an intentionally defective candidate fixture for the security gate.
It changes the todo creation route so the author of a new todo is read from
the request body (`authorId`) instead of the verified Vercel Passport identity
on the server. Any caller, including an MCP client or a model, can create rows
attributed to another user.

The candidate patch is in `candidate.patch`. The title is deliberately marked
`injected` so this fixture cannot be mistaken for a discovered product task or
verified repository behavior. The expected verdict is `changes_requested` with
a blocking finding at `server/api/todos.post.ts` citing the `authorId` read.
