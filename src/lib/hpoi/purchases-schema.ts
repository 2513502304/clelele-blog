import { z } from 'zod';

export const hpoiRecordId = z.string().regex(/^[1-9]\d{0,19}$/);
const optionalText = z.string().max(20_000).nullable();

/** Public figure IDs and Hpoi's internal item IDs are different namespaces. */
export const hpoiPurchaseReferenceSchema = z.object({
  itemId: hpoiRecordId.optional(),
  figureId: hpoiRecordId,
  title: z.string().max(1_000),
});

export const hpoiPurchaseSchema = hpoiPurchaseReferenceSchema.extend({
  itemId: hpoiRecordId,
  collectionId: hpoiRecordId,
  state: z.string().max(100),
  stateLabel: z.string().max(200),
  orderTime: optionalText,
  orderWay: optionalText,
  // Decimal strings retain upstream precision. Missing/unparseable amounts are never coerced to zero.
  orderMoney: z
    .string()
    .regex(/^\d+(?:\.\d+)?$/)
    .nullable(),
  orderMoneyCurrency: optionalText,
  currencyLabel: optionalText,
  orderForm: optionalText,
  orderFormLabel: optionalText,
  tags: optionalText,
  comment: optionalText,
});

export type HpoiPurchaseReference = z.infer<typeof hpoiPurchaseReferenceSchema>;
export type HpoiPurchase = z.infer<typeof hpoiPurchaseSchema>;

export const hpoiPurchaseJobSchema = z.object({
  id: z.string().uuid(),
  startedAt: z.string().datetime(),
  references: z.array(hpoiPurchaseReferenceSchema).max(10_000),
  records: z.array(hpoiPurchaseSchema).max(10_000),
  next: z.number().int().min(0).max(10_000),
  discovery: z.object({ page: z.number().int().min(1).max(101), pages: z.number().int().min(0).max(100).nullable() }),
  discovered: z.boolean(),
  error: z.enum(['upstream', 'discovery']).nullable(),
  lease: z.object({ token: z.string().uuid(), until: z.number().int().positive() }).nullable(),
});

/** Only a fully validated run can replace snapshot; pending records remain separate and resumable. */
export const hpoiPurchaseStoreSchema = z
  .object({
    version: z.literal(1),
    revision: z.string().uuid(),
    sourceUserId: hpoiRecordId,
    snapshot: z.object({ fetchedAt: z.string().datetime(), records: z.array(hpoiPurchaseSchema).max(10_000) }).nullable(),
    job: hpoiPurchaseJobSchema.nullable(),
  })
  .superRefine((value, context) => {
    const job = value.job;
    if (job && (job.next !== job.records.length || job.next > job.references.length))
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid purchase checkpoint cursor.' });
    if (job && new Set(job.references.map((entry) => entry.figureId)).size !== job.references.length)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate purchase discovery identity.' });
    for (const records of [value.snapshot?.records, job?.records]) {
      if (records && new Set(records.map((record) => record.collectionId)).size !== records.length)
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate purchase record identity.' });
    }
    if (
      job?.records.some(
        (record, index) =>
          (job.references[index]?.itemId && record.itemId !== job.references[index]?.itemId) ||
          record.figureId !== job.references[index]?.figureId,
      )
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Purchase checkpoint references changed.' });
  });

export type HpoiPurchaseStore = z.infer<typeof hpoiPurchaseStoreSchema>;
