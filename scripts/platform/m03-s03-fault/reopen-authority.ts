// Isolated test child: reopen the real authority from retained files.
import { createPrivateKey,createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DisposableDurableRecoveryAuthority } from "../../../packages/database/src/schema-operator-experimental-durable-authority";
import { FileExperimentalRecoveryAnchor } from "../../../packages/database/src/schema-operator-experimental-anchor";
const [directory,mode]=process.argv.slice(2);
if(process.env.NODE_ENV!=="test"||process.env.M03_PHYSICAL_COMPONENT!=="1"||process.env.GITHUB_ACTIONS!=="true"||!directory||!["CLEAN","CRASH"].includes(mode??""))throw Error("disposable child only");
const key=createPrivateKey(readFileSync(join(directory,"ledger-key.pem")));
const anchor=new FileExperimentalRecoveryAnchor(join(directory,"separate-anchor"),createPrivateKey(readFileSync(join(directory,"anchor-key.pem"))));
const admin=createPublicKey(readFileSync(join(directory,"admin-key.pem")));
const authority=DisposableDurableRecoveryAuthority.open(directory,key,anchor,admin);
if(mode==="CRASH"){if(!authority.snapshot().pending)throw Error("expected pending");process.kill(process.pid,"SIGKILL");throw Error("kill returned");}
console.log(JSON.stringify(authority.snapshot()));
authority.close();
