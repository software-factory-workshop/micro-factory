import { eveChannel } from "eve/channels/eve";
import { factoryAuth } from "../lib/route-auth";
// Shared protected workshop workspace; station authorization uses immutable initiator attributes.
export default eveChannel({ auth: factoryAuth });
