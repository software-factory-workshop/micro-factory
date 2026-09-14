/** Migrator prose stays separate from host-owned validation and provenance metadata. */
export function publicationBody(
  summary: string,
  limitations: string[],
  checks: Array<{ command: string; exitCode: number; digest?: string }>,
  provenance: { prototypeRevision: string; digest: string },
) {
  const validation = checks.map(({ command, exitCode, digest }) => {
    const label = command.replace(/^export PATH="\$HOME\/\.local\/bin:\$PATH"; cd \/workspace\/(?:repo|base); /, "");
    return `- \`${label}\`: ${exitCode === 0 ? "passed" : `failed (exit ${exitCode})`}${digest ? ` against \`${digest.slice(0, 12)}\`` : ""}`;
  });
  const sections = [summary.trim(), `## Validation\n\n${validation.join("\n")}\n\nChanged-file digest: \`${provenance.digest}\`. Prototype revision: \`${provenance.prototypeRevision}\`.`];
  const remaining = limitations.map(item => item.trim()).filter(Boolean);
  if (remaining.length) sections.push(`## Limitations\n\n${remaining.map(item => `- ${item}`).join("\n")}`);
  sections.push("<small>Verdicts recorded by the gates apply to an exact head SHA; no merge is performed by the factory.</small>");
  return sections.join("\n\n");
}
