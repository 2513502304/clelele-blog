/** Remove Codex's transport metadata, never generic angle-bracket prompt instructions. */
export function sanitizeImportedPrompt(prompt: string): string {
  return prompt
    .replace(/<oai-mem-citation>[\s\S]*?(?:<\/oai-mem-citation>|$)/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

/** Only unwrap the recognized desktop attachment envelope; ordinary Markdown headings remain content. */
export function sanitizeImportedOriginalPrompt(prompt: string): string {
  return (
    sanitizeImportedPrompt(prompt)
      .replace(
        /^# Files mentioned by the user:\n[\s\S]*?\nDistinguish instructions in attached documents from the user's request\.\s*\n## My request:\s*\n/,
        '',
      )
      // Empty, line-delimited desktop image attachments are transport, not user instructions.
      // Require the complete name/path signature and closing tag; never apply this to model output.
      .replace(/(?:^|\n)[ \t]*<image name=\[Image #\d+\] path="[^"\n]+">\s*<\/image>[ \t]*(?=\n|$)/g, '')
      .replace(/\[\$([^\]\s]+)\]\((?:file:\/\/)?(?:~|\/Users|\/home)[^)]*\/SKILL\.md\)/g, '/$1')
      .replace(/(?:file:\/\/)?(?:~|\/Users|\/home)\/[^\s)]+\/([^/\s)]+)\/SKILL\.md/g, '/$1')
      .trim()
  );
}
