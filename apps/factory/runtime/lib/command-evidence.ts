export interface CommandEvidence { command: string; exitCode: number; stdout: string; stderr: string; capturedAt: string; truncated: boolean; digest?: string }
export function commandEvidence(command:string,result:{exitCode:number;stdout:string;stderr:string;truncated?:boolean},digest?:string):CommandEvidence {
  return { command,exitCode:result.exitCode,stdout:result.stdout.slice(-12000),stderr:result.stderr.slice(-12000),capturedAt:new Date().toISOString(),truncated:result.truncated===true||result.stdout.length>12000||result.stderr.length>12000,...(digest?{digest}:{}) };
}

// Parses the summary line of `node --test` ("ℹ tests 12") and Vitest
// ("Tests  12 passed (12)"). Unparseable output returns undefined so a
// missing count is a limitation, never a zero.
export function stripAnsi(output: string): string {
  return output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

export function testCountFromOutput(output: string): number | undefined {
  let total = 0;
  let matched = false;
  // Vitest colours its summary even when stdout is not a TTY inside the sandbox
  // (reference run b68d408e, 14 Sep 2026): strip escape codes before matching.
  for (const line of stripAnsi(output).split(/\r?\n/)) {
    const nodeTest = /^\W*tests\s+(\d+)\s*$/i.exec(line.trim());
    const vitest = /^\s*Tests\s+(?:\d+\s+\w+\s*\|?\s*)*\((\d+)\)\s*$/.exec(line);
    const count = nodeTest?.[1] ?? vitest?.[1];
    if (!count) continue;
    total += Number(count);
    matched = true;
  }
  return matched ? total : undefined;
}
