import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";
// The SDK derives team/project/token together from the OIDC context. The model
// and preparation tool verify that identity before any paid call or sandbox use.
// Passing only teamId/projectId selects explicit auth and requires a token too.
export default defineSandbox({backend:vercel({resources:{vcpus:4},timeout:600000})});
