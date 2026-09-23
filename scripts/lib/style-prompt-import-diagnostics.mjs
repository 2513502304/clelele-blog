/** Compare the initial prompt snapshot with confirmed publication, not the last response after a retry. */
export function summarizePublishedImport(records, published, beforeByHash) {
  const created = new Set();
  const updated = new Set();
  const added = new Set();
  for (const [index, record] of records.entries()) {
    const item = published[index]?.item;
    if (!item || !item.prompts.some((entry) => entry.prompt === record.prompt))
      throw new Error(`Publication readback is missing an imported prompt at record ${index + 1}.`);
    const before = beforeByHash.get(item.imageHash);
    if (before?.prompts.includes(record.prompt)) continue;
    added.add(`${item.imageHash}\n${record.prompt}`);
    (before ? updated : created).add(item.imageHash);
  }
  return {
    written: created.size + updated.size,
    created: created.size,
    updated: updated.size,
    addedPrompts: added.size,
    skippedDuplicates: records.length - added.size,
    promptChangedHashes: [...updated],
  };
}

/** Explain image sources and counts before diagnostics use those terms. */
export function describeImportContext({ overwriteImages, dryRun, metadataOnly, overwriteTag, tags = [], apiBaseUrl } = {}) {
  return [
    '\n[导入说明] 本脚本从 Codex 会话 JSONL 中提取图片和对应的 Prompt。',
    '  会话内嵌图：图片数据保存在 JSONL 中，即使电脑上的原文件丢失，仍可读取。',
    '  UI images：会话保存的用户界面图片。模型输入可能另有一份缩小图；脚本优先读取可用的 UI 图片，但 UI 图片本身也可能已被压缩。',
    '  同一输入的 UI 图与模型图只对应一条导入记录；脚本会关联已核对的版本哈希，避免重导时把缩小图与原图分别建卡。',
    '  本地附件：会话记录指向的电脑文件。路径和内容校验通过后，脚本才会使用该文件；文件丢失或不匹配时保留会话内嵌图。界面的附件图标不能证明图片是否压缩。',
    '',
    '[图片、卡片与 Prompt]',
    '  一条记录是一组图片与对应回复。一张卡片可以包含多张图片、多个模型的 Prompt；同一图片也可能在会话中出现多次。',
    '  同图同 Prompt 会跳过；同图不同 Prompt 会追加到已有卡片。文件哈希、完全相同的解码像素或已确认的版本关联用于识别同图，仅仅看起来相似不会自动合并。',
    '  新图片分别保存源图与缩略图：例如 38 张新图片通常对应 76 个文件，不代表新增 76 张卡片。已有文件会复用。',
    '  原文件找回后若对应另一张有效卡片，脚本会报冲突，请先在网站中合并；--overwrite-images 不会替你选择保留哪张卡片。',
    '',
    '[本轮设置]',
    ...(apiBaseUrl ? [`  目标网站：${new URL(apiBaseUrl).origin}。`] : []),
    dryRun
      ? '  本轮为 --dry-run：只检查和列出计划，不上传文件、不修改线上数据。'
      : metadataOnly
        ? '  本轮为 --metadata-only：只处理已有卡片的 Prompt 元数据，不替换图片。'
        : overwriteImages
          ? '  已开启 --overwrite-images：检查已有卡片的原图；符合条件时替换图片并同步 URL 哈希，保留日期、Prompt、标签、示例和点赞。'
          : '  默认模式：保留已发布图片，只为新卡片寻找原图。需要检查并替换已有图片时，请显式添加 --overwrite-images。',
    tags.length
      ? `  标签：${tags.map((tag) => `#${tag}`).join(' ')}；${overwriteTag ? '覆盖目标卡片的标签集合，未列出的旧标签会被移除' : '追加到目标卡片，保留已有标签'}。重复图片/Prompt 也参与标签处理。`
      : '  未提供 --tag：不读取或修改标签。--overwrite-images 与标签覆盖是两个独立选项。',
    '  先检查来源与去重，再上传缺失文件、分批发布卡片，最后处理标签。检查计划不是成功数量，请以发布/回读结果为准。',
    '  中断后可以重跑，但发布响应丢失时应先回读确认，不能把网络报错当作“没有写入”。脚本不会用覆盖图片来覆盖你独立编辑的 Prompt。',
    '  普通导入的最终数量按导入前后回读差异汇总；重试响应中的“重复”可能表示前一次请求已经保存成功，不代表本轮没有新增。',
  ].join('\n');
}

/** The help page shares the startup explanation and adds commands, prerequisites and less common options. */
export function describeImportHelp() {
  return [
    '用法：npm run import:style-prompts -- <codex-session.jsonl> [选项]',
    describeImportContext(),
    '',
    '[开始之前]',
    '  在项目根目录运行。通过环境变量或被 gitignore 的 .env.local 提供 STYLE_GALLERY_UPLOAD_TOKEN；不要把密码写进命令或提交到仓库。',
    '  --dry-run 也需要 token，因为它会只读查询线上图片身份；--help 不需要 token、JSONL 文件或网络访问。',
    '  JSONL 必须包含图片和对应反推回复；提取器按现有的中文主体占位符模板识别回复，不是任意聊天记录的批量上传器。',
    '  会话文件会逐行读取；图片数据仍会占用内存。脚本只读取会话中经核对的附件路径，不会扫描电脑寻找同名文件。',
    '',
    '[常用选项]',
    '  --dry-run                只检查并显示计划，不上传或修改线上数据。',
    '  --overwrite-images       检查已有图片的可恢复原图，按需替换并同步 URL 哈希；不会无条件重传，不会把更大的线上图换成较小附件。',
    '  --tag "插画"              可重复，例如 --tag "插画" --tag "现实"；默认追加并保留旧标签。不传则完全不处理标签。',
    '  --overwrite-tag          将目标卡片标签替换为本次 --tag 集合，移除未列出的旧标签；必须至少有一个 --tag。',
    '  --prompt-model=名称      显式指定本次导入的模型名称；未指定时读取会话中的模型信息。',
    '  --metadata-only          只对已有卡片执行 Prompt 元数据 upsert，允许更新匹配变体的元数据；跳过新卡片，不替换图片。别名：--update-metadata-only。',
    '  --api-base-url=https://…  指定目标网站，默认 clelele-blog.vercel.app。请先确认目标，避免写入错误环境。',
    '  --help / -h              显示本说明。--overwrite-images 不能与 --metadata-only 同用。',
    '',
    '[示例]',
    '  npm run import:style-prompts -- "/path/session.jsonl" --dry-run',
    '  npm run import:style-prompts -- "/path/session.jsonl" --tag "插画" --tag "现实"',
    '  npm run import:style-prompts -- "/path/session.jsonl" --overwrite-images --dry-run',
    '  npm run import:style-prompts -- "/path/session.jsonl" --overwrite-images',
    '  npm run import:style-prompts -- "/path/session.jsonl" --tag "插画" --overwrite-tag',
    '',
    '[怎样读结果与处理失败]',
    '  原图恢复数统计消息中的单张图片；替换数统计去重后的已有卡片。日志会列出已是原图、保留更大线上图、缺失附件、重复记录等差额原因。',
    '  Additional prompt 表示同图新增提示词；Duplicate skipped 表示图片和提示词都相同，但显式指定的标签仍可能变化。',
    '  上传文件数会拆成源图与缩略图；标签会拆成处理、改变、未改变。重跑没有新增是正常的，不能仅凭 Recovered 或 Uploaded 判断线上修改数量。',
    '  缺失附件会保留会话图片；两张有效卡片的身份冲突需要手动合并；版本冲突先检查是否有人编辑。不要用 --overwrite-tag 处理图片冲突。',
    '  网络中断后，脚本先回读替换结果，不重复发送仍可能在执行的写入。若最终不能确认，先核对线上数据与恢复快照，再重跑；不要同时启动多个写入任务。',
    '  各批次独立发布，并非整份会话一次性事务。异常退出不代表此前成功的批次被撤销；归档会话重跑前请先确认它确实属于反推 Prompt 任务。',
  ].join('\n');
}

/** Partition recovered image occurrences before counting unique replacement cards; never subtract unlike units. */
export function describeOriginalRecovery({ items, fallback, migrations, overwriteImages, dryRun }) {
  const recovered = items.filter((item) => item.restoredImages > 0);
  const total = recovered.reduce((sum, item) => sum + item.restoredImages, 0);
  const categories = [
    ['replace', '需要替换已有卡片的图片'],
    ['current', '线上已是这份原图且 URL 一致，无需再次替换'],
    ['larger', '线上图片分辨率更高，保留线上版本'],
    ['incomplete', '同组附件未全部通过校验，整张卡片暂不替换'],
    ['new', '对应新卡片，将随新卡片导入，不属于覆盖已有卡片'],
    ['preserved', '默认模式保留已有卡片，不覆盖'],
  ];
  const lines = [
    '\n[原图检查]',
    `  找到并校验通过 ${total} 张与会话内嵌图字节不同的本地原图，涉及 ${recovered.length} 条图片/Prompt 记录。`,
  ];
  for (const [reason, label] of categories) {
    const records = recovered.filter((item) => item.reason === reason);
    if (!records.length) continue;
    const images = records.reduce((sum, item) => sum + item.restoredImages, 0);
    lines.push(`  - ${label}：${images} 张图片 / ${records.length} 条记录。`);
  }
  const replacements = items.filter((item) => item.reason === 'replace');
  const cards = new Set(replacements.map((item) => item.slug));
  const recoveredCards = new Set(recovered.filter((item) => item.reason === 'replace').map((item) => item.slug));
  if (replacements.length > cards.size)
    lines.push(`  重复记录归并：${replacements.length} 条待替换记录对应 ${cards.size} 张不同卡片，同一卡片只替换一次。`);
  if (migrations > recoveredCards.size)
    lines.push(
      `  另有 ${migrations - recoveredCards.size} 张卡片需要校正图片版本或 URL，但附件与本轮内嵌图字节相同，未计入上面的“找到原图”。`,
    );
  lines.push(`  不可用附件：${fallback} 张（文件缺失或校验不通过）；具体原因见上方行号警告，不会用它们覆盖线上图片。`);
  lines.push(
    dryRun
      ? `  覆盖计划：${migrations} 张已有卡片；当前是 --dry-run，不执行写入。`
      : overwriteImages
        ? `  即将替换：${migrations} 张已有卡片（--overwrite-images 已开启）。发布成功后会逐批确认。`
        : '  已有卡片图片替换：0；默认保留模式。',
  );
  lines.push(
    '  计数口径：上面的恢复数按单张图片在消息中出现的次数统计；替换数按去重后的卡片统计。一张卡片可含多张图片，也可能在会话中反复出现。',
  );
  return lines.join('\n');
}

/** Keep records, cards, prompts and files distinct. Plans are estimates; write results are acknowledgements. */
export function describeImportPlan(prepared, existingByHash, metadataOnly = false) {
  const newItems = prepared.items.filter((item) => !existingByHash.has(item.imageHash));
  const existingItems = prepared.items.filter((item) => existingByHash.has(item.imageHash));
  const count = (items) => items.reduce((sum, item) => sum + item.prompts.length, 0);
  const additional = prepared.recordDetails.filter((detail) => detail.kind === 'variant').length;
  const lines = [
    `\n[Plan] ${prepared.sourceSlugs.length} distinct card(s) touched; ${count(prepared.items)} candidate prompt(s) to write.`,
    `  New cards: ${newItems.length}, with ${count(newItems)} prompt(s). Existing cards: ${existingItems.length}, with ${count(existingItems)} ${metadataOnly ? 'replacement' : 'additional'} prompt(s).`,
    `  Duplicate skipped: ${prepared.skippedDuplicates} identical image/prompt record(s); no image or prompt write for these records. Tags may still change.`,
    `  ${metadataOnly ? 'Replacement' : 'Additional'} prompt records: ${additional} (same image, different prompt; published cards or earlier records in this session).`,
  ];
  const ordinals = { duplicate: 0, variant: 0 };
  for (const detail of prepared.recordDetails) {
    const previous = detail.previousLine ? `session image line ${detail.previousLine}` : 'published card';
    const label = detail.kind === 'duplicate' ? 'Duplicate skipped' : metadataOnly ? 'Replacement prompt' : 'Additional prompt';
    lines.push(
      `  ${label} [${++ordinals[detail.kind]}]: ${detail.slug}; image line ${detail.sourceLine ?? '?'}, prompt line ${detail.promptLine ?? '?'}; matches ${previous}.`,
    );
  }
  return lines.join('\n');
}

/** The metadata endpoint preserves existing images; image migration is a separate preceding stage. */
export function describeMetadataWrite(result, migratedHashes = new Set()) {
  const changed = result.promptChangedHashes ?? [];
  const both = changed.filter((hash) => migratedHashes.has(hash)).length;
  return `${result.created ?? 0} new card(s); ${changed.length} existing card(s) with prompt changes (${changed.length - both} prompt-only, ${both} also image-replaced earlier); ${result.addedPrompts ?? 0} prompt(s) added; ${result.skippedDuplicates ?? 0} duplicate prompt(s) skipped. Image replacements in this metadata batch: 0.`;
}
