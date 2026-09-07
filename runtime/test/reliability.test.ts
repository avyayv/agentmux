import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntimeServer } from "../src/server.js";
import type { RuntimeConfig } from "../src/types.js";

test("report leases honor bounded requested duration and health does not rewrite state", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "cd-reliability-"));
  const config: RuntimeConfig = { host:"127.0.0.1", port:0, stateDir, tokenFile:"token", tmuxSession:"test", agents:{}, delegateAgent:"mock" };
  const instant = new Date("2026-01-01T00:00:00Z");
  const server = createRuntimeServer(config,"secret",{run(){return {status:0};}},{now:()=>instant});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();assert.ok(address && typeof address === "object");
  const base=`http://127.0.0.1:${address.port}`, headers={authorization:"Bearer secret","content-type":"application/json"};
  const reportPath=join(stateDir,"parent-reports.jsonl");
  writeFileSync(reportPath,JSON.stringify({id:"report",runId:"run",routerId:"router",chatId:"chat",message:"test",createdAt:instant.toISOString()})+"\n");
  try {
    const before=statSync(reportPath).mtimeMs;
    assert.equal((await fetch(base+"/health",{headers})).status,200);
    assert.equal(statSync(reportPath).mtimeMs,before);
    assert.equal((await fetch(base+"/health")).status,401);
    const lease=async(leaseSeconds:unknown)=>fetch(base+"/v1/reports/lease",{method:"POST",headers,body:JSON.stringify({routerId:"router",chatId:"chat",leaseSeconds})});
    for(const invalid of [0,-1,3601,1.5,"1320"]) assert.equal((await lease(invalid)).status,400);
    const response=await lease(1320);assert.equal(response.status,200);
    const report=(await response.json() as any).report;
    assert.equal(Date.parse(report.leaseUntil)-instant.getTime(),1320_000);
    assert.equal((await (await lease(1320)).json() as any).report,undefined);
    assert.equal(JSON.parse(readFileSync(reportPath,"utf8")).leaseId,report.leaseId);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
