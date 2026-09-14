import { defineHook } from "eve/hooks";
import { workState } from "./work-state";
export default defineHook({events:{
 async "turn.completed"(_,ctx){if(workState.get().sandboxStarted&&workState.get().recorded)await(await ctx.getSandbox()).stop();},
 async "turn.cancelled"(_,ctx){if(workState.get().sandboxStarted)await(await ctx.getSandbox()).stop();}
}});
